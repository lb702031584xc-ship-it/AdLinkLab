/**
 * 付费数据（DataForSEO）租户侧接口：
 *
 * - GET    /api/v1/settings/dataforseo          自备 key 状态（脱敏：只回已配置/验证时间）
 * - PUT    /api/v1/settings/dataforseo          保存自备 key（login + password 只写，加密存储）
 * - DELETE /api/v1/settings/dataforseo          删除自备 key（删后回落平台 key 路径）
 * - POST   /api/v1/settings/dataforseo/verify   验活（appendix/user_data，官方不计费；
 *                                               失败透出 DataForSEO 原文 status_message）
 * - GET    /api/v1/paid-data/access?feature=    网关判定预告（供前端在付费按钮旁标注
 *                                               计费路径/剩余额度/拒绝原因；只判定不消费）
 *
 * 凭证永不回显：所有 GET 只回 mask 后的状态（测试锁死）。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { AppError, UnauthorizedError, ValidationError } from "@adlinklab/shared";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import {
  isPaidDataFeature,
  resolvePaidDataAccess,
} from "../services/paid-data-gateway.js";
import {
  DataForSeoVerifyError,
  deleteTenantDataForSeo,
  getTenantDataForSeoCredentials,
  getTenantDataForSeoSetting,
  markTenantDataForSeoVerified,
  maskDataForSeo,
  saveTenantDataForSeo,
  verifyDataForSeoCredentials,
} from "../services/tenant-dataforseo.js";

export interface PaidDataRouteDeps {
  prisma: PrismaClient;
  fetchImpl?: typeof fetch;
}

async function requireSession(
  deps: PaidDataRouteDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) throw new UnauthorizedError("Authentication required");
  return info;
}

function asTrimmed(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function registerPaidDataRoutes(
  app: FastifyInstance,
  deps: PaidDataRouteDeps
): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch;

  app.get("/api/v1/settings/dataforseo", async (request) => {
    const info = await requireSession(deps, request);
    const s = await getTenantDataForSeoSetting(deps.prisma, info.tenantId);
    return maskDataForSeo(s);
  });

  app.put<{ Body: Record<string, unknown> }>(
    "/api/v1/settings/dataforseo",
    async (request) => {
      const info = await requireSession(deps, request);
      const login = asTrimmed(request.body?.login);
      const password =
        typeof request.body?.password === "string"
          ? request.body.password
          : "";
      if (!login || login.length > 200) {
        throw new ValidationError("DataForSEO login 必填（≤200 字符）");
      }
      if (!password || password.length > 500) {
        throw new ValidationError("DataForSEO password 必填（≤500 字符）");
      }
      await saveTenantDataForSeo(deps.prisma, info.tenantId, {
        login,
        password,
      });
      const s = await getTenantDataForSeoSetting(deps.prisma, info.tenantId);
      return { ...maskDataForSeo(s), saved: true };
    }
  );

  app.delete("/api/v1/settings/dataforseo", async (request) => {
    const info = await requireSession(deps, request);
    await deleteTenantDataForSeo(deps.prisma, info.tenantId);
    return { configured: false, verifiedAt: null, deleted: true };
  });

  app.post<{ Body: Record<string, unknown> }>(
    "/api/v1/settings/dataforseo/verify",
    async (request) => {
      const info = await requireSession(deps, request);
      const bodyLogin = asTrimmed(request.body?.login);
      const bodyPassword =
        typeof request.body?.password === "string"
          ? request.body.password
          : "";
      const saved = await getTenantDataForSeoCredentials(
        deps.prisma,
        info.tenantId
      );
      const creds =
        bodyLogin && bodyPassword
          ? { login: bodyLogin, password: bodyPassword }
          : saved;
      if (!creds) {
        throw new ValidationError(
          "尚未保存 DataForSEO 凭证：请先填写 login + password 再验证"
        );
      }
      let result: { login: string | null; balance: number | null };
      try {
        result = await verifyDataForSeoCredentials(creds, fetchImpl);
      } catch (e) {
        if (e instanceof DataForSeoVerifyError) {
          throw new AppError(e.message, {
            code: "DATAFORSEO_VERIFY_FAILED",
            statusCode: 400,
          });
        }
        throw e;
      }
      // 验的是已保存的那对凭证 → 落验证时间；验的是表单里未保存的 → 只报结果。
      if (saved && saved.login === creds.login && saved.password === creds.password) {
        await markTenantDataForSeoVerified(deps.prisma, info.tenantId);
      }
      return { verified: true, login: result.login, balance: result.balance };
    }
  );

  app.get<{ Querystring: Record<string, unknown> }>(
    "/api/v1/paid-data/access",
    async (request) => {
      const info = await requireSession(deps, request);
      const feature = request.query?.feature;
      if (!isPaidDataFeature(feature)) {
        throw new ValidationError(
          "feature 必须是付费功能键（keywords-expand / keywords-intent / keywords-ad-measure / catalog-ad-count / serp-ads / brand-bidding）"
        );
      }
      const resolution = await resolvePaidDataAccess(deps.prisma, {
        tenantId: info.tenantId,
        userId: info.id,
        userRole: info.role,
        feature,
      });
      const own = await getTenantDataForSeoSetting(deps.prisma, info.tenantId);
      return {
        feature,
        tenantOwnConfigured: Boolean(own?.loginEnc && own?.passwordEnc),
        ...(resolution.allowed
          ? {
              allowed: true as const,
              keySource: resolution.keySource,
              credentialsConfigured: resolution.credentials !== null,
              remainingCalls: resolution.remainingCalls,
            }
          : {
              allowed: false as const,
              keySource: null,
              credentialsConfigured: false,
              remainingCalls: null,
              reason: resolution.reason,
            }),
      };
    }
  );
}
