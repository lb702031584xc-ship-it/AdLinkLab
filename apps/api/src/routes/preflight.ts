/**
 * P1-14：Preflight 双类型（MCC / 个人）上线前检查。
 *
 * POST /api/v1/ads/preflight { accountId, landingUrl?, dailyBudget? }
 * → { verdict: "ready" | "degraded" | "blocked", checks: PreflightCheck[] }
 *
 * 检查项（status: ok | warn | error | skip）：
 * - 通用：账号存在（不存在 → 404）；健康（suspended → error 阻塞；
 *   limited → warn）；预算 >0（仅当传了 dailyBudget）；落地页可达
 *   （仅当传了 landingUrl；1.5s 超时，网络失败 → warn 软失败，绝不硬拦）；
 *   转化跟踪（30 天内有 Conversion → ok，否则 skip“暂无数据，无法判断”）；
 *   发布通道（ACTIVE Script 集成存在 → ok，否则 warn）。
 * - MCC：≥1 可用子账号（healthStatus=active）→ ok，否则 warn；
 *   不适用个人检查。
 * - 个人：个人 OAuth/Script 已配置（oauthCredentialRef 存在 → ok，
 *   否则 warn）；MCC 子账号检查必须 NOT 应用于个人（skip）。
 *
 * verdict：任一 error → blocked；否则任一 warn → degraded；否则 ready。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import { authenticateSessionRequest, type SessionAuthInfo } from "../auth/sessions.js";
import { fetchPage } from "../ai/fetch-page.js";

export interface PreflightDeps {
  prisma: PrismaClient;
}

export type PreflightStatus = "ok" | "warn" | "error" | "skip";

export interface PreflightCheck {
  key: string;
  status: PreflightStatus;
  message: string;
}

async function requireSession(
  deps: PreflightDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) throw new UnauthorizedError("Authentication required");
  return info;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LANDING_TIMEOUT_MS = 1500;

export async function registerPreflightRoutes(
  app: FastifyInstance,
  deps: PreflightDeps
): Promise<void> {
  const { prisma } = deps;

  app.post<{
    Body: { accountId?: unknown; landingUrl?: unknown; dailyBudget?: unknown };
  }>("/api/v1/ads/preflight", async (request) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
    if (!accountId || !UUID_RE.test(accountId)) {
      throw new ValidationError("accountId must be a UUID");
    }
    const account = await prisma.googleAccount.findFirst({
      where: { id: accountId, tenantId: info.tenantId },
    });
    if (!account) throw new NotFoundError("GoogleAccount", accountId);

    const checks: PreflightCheck[] = [];
    const push = (key: string, status: PreflightStatus, message: string) =>
      checks.push({ key, status, message });

    // 健康：suspended 阻塞；limited 警告。
    if (account.healthStatus === "suspended") {
      push(
        "account_health",
        "error",
        `账号已封停${account.suspensionReason ? `（${account.suspensionReason}）` : ""}，无法发布`
      );
    } else if (account.healthStatus === "limited") {
      push("account_health", "warn", "账号受限，请先确认受限原因");
    } else {
      push("account_health", "ok", "账号健康正常");
    }

    // 发布通道：ACTIVE Script 集成。
    const integration = await prisma.googleAdsScriptIntegration.findFirst({
      where: { tenantId: info.tenantId, status: "ACTIVE" },
    });
    if (integration) {
      push("publish_channel", "ok", "已配置 ACTIVE Script 集成，可发布");
    } else {
      push("publish_channel", "warn", "未找到 ACTIVE Script 集成，请先配置 Script 集成");
    }

    // 类型专属检查：MCC 与个人互斥，绝不混用。
    const accountType = account.accountType === "PERSONAL" ? "PERSONAL" : "MCC";
    if (accountType === "MCC") {
      const usableSubs = await prisma.googleAccount.count({
        where: {
          tenantId: info.tenantId,
          managerCustomerId: account.customerId,
          healthStatus: "active",
        },
      });
      if (usableSubs >= 1) {
        push("mcc_sub_accounts", "ok", `MCC 下有 ${usableSubs} 个可用子账号`);
      } else {
        push("mcc_sub_accounts", "warn", "MCC 下无可用子账号，请先确认子账号关联与健康状态");
      }
      push("personal_oauth", "skip", "MCC 账户不适用个人 OAuth 检查");
    } else {
      if (account.oauthCredentialRef) {
        push("personal_oauth", "ok", "个人账号已配置 OAuth 凭证");
      } else {
        push("personal_oauth", "warn", "个人账号未配置 OAuth 凭证，请先完成授权");
      }
      push("mcc_sub_accounts", "skip", "个人账户不适用 MCC 子账号检查");
    }

    // 转化跟踪：30 天内有 Conversion → ok；否则 skip（不编造“已配置”）。
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentConversions = await prisma.conversion.count({
      where: { tenantId: info.tenantId, createdAt: { gte: thirtyDaysAgo } },
    });
    if (recentConversions > 0) {
      push("conversion_tracking", "ok", `近 30 天有 ${recentConversions} 个转化记录`);
    } else {
      push("conversion_tracking", "skip", "近 30 天无转化记录，暂无法判断转化跟踪是否生效");
    }

    // 预算（仅当传了 dailyBudget）。
    if (body.dailyBudget !== undefined && body.dailyBudget !== null && body.dailyBudget !== "") {
      const budget = Number(body.dailyBudget);
      if (!Number.isFinite(budget) || budget <= 0) {
        push("budget", "error", "日预算必须 > 0");
      } else {
        push("budget", "ok", `日预算 ${budget}`);
      }
    } else {
      push("budget", "skip", "未提供预算，跳过预算检查");
    }

    // 落地页可达（仅当传了 landingUrl；软失败 → warn，绝不硬拦）。
    // 用 SSRF 守卫的 fetchPage（禁止私网/回环/链路本地地址），不用直连 fetch；
    // race 保留 1.5s 语义（fetchPage 自身超时 10s，超 1.5s 即判 warn，不等它）。
    if (typeof body.landingUrl === "string" && body.landingUrl.trim()) {
      const url = body.landingUrl.trim();
      try {
        // fetchPage 成功 = 2xx 可达；非 2xx / SSRF 拦截 / 网络失败均抛错 → 统一 warn 软失败。
        const probed = fetchPage(url)
          .then(() => true as const)
          .catch(() => null);
        const result = await Promise.race([
          probed,
          new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), LANDING_TIMEOUT_MS)
          ),
        ]);
        if (result) {
          push("landing_reachable", "ok", "落地页可达（HTTP 2xx）");
        } else {
          push(
            "landing_reachable",
            "warn",
            "落地页在 1.5s 内未响应、不可达或被拦截（软失败，未硬拦；请人工打开确认）"
          );
        }
      } catch {
        push(
          "landing_reachable",
          "warn",
          "落地页在 1.5s 内未响应、不可达或被拦截（软失败，未硬拦；请人工打开确认）"
        );
      }
    } else {
      push("landing_reachable", "skip", "未提供落地页，跳过可达检查");
    }

    const verdict = checks.some((c) => c.status === "error")
      ? "blocked"
      : checks.some((c) => c.status === "warn")
        ? "degraded"
        : "ready";
    return {
      verdict,
      accountType,
      healthStatus: account.healthStatus,
      checks,
    };
  });
}
