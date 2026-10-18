/**
 * Network API framework — management HTTP routes (2026-10-07).
 *
 * Session-auth management API (tenant-isolated via requireTenant):
 *   GET    /api/v1/networks                 — list (credentials masked)
 *   POST   /api/v1/networks                 — create { name, kind, apiBaseUrl?, apiKey? }
 *   PATCH  /api/v1/networks/:id            — update (apiKey rotates when provided)
 *   POST   /api/v1/networks/:id/pull-now   — manual pull (400 when no credentials)
 *   GET    /api/v1/networks/:id/pulls      — pull history (paginated)
 *   GET    /api/v1/networks/:id/offers     — pulled offers (paginated)
 *
 * The encrypted apiKeyRef (and the plaintext apiKey) are NEVER returned.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { NotFoundError, ValidationError } from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import { requireTenant, type AuthContext } from "../auth/tenant.js";
import { requireSession } from "./auth.js";
import {
  assertNetworkApiPepperConfigured,
  encryptApiKey,
} from "../networks/network-crypto.js";
import {
  getAdapter,
  isSessionSupported,
  isSupportedNetworkKind,
  SUPPORTED_NETWORK_KINDS,
} from "../networks/index.js";
import {
  pullNetwork,
  type NetworkPullServiceDeps,
} from "../services/network-pull-service.js";
import {
  incrementGrantUsage,
  requireActiveGrant,
} from "../services/admin-grants.js";
import { writeCatalogAudit } from "../services/catalog-blacklist.js";
import { isSyncMode } from "../networks/types.js";

/**
 * 登录态采集 ToS 风险提示原文（文档 + 切换模式 API 的 400 响应共用）。
 */
export const SESSION_TOS_RISK_TEXT =
  "登录态采集风险提示：使用登录态（Cookie）自动采集商品数据，可能违反 " +
  "YeahPromos/PartnerBoost 服务条款中关于自动化访问的条款，存在账号被警告、" +
  "限流或封禁的风险。请仅采集您自己账号可见的商品数据，不要高频抓取。" +
  "如该联盟日后提供官方商品 API，请优先切换为官方 API 模式。" +
  "继续即代表您已了解并自行承担该风险。";

export interface NetworkRouteServices {
  prisma: PrismaClient;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asTrimmedString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function asKind(v: unknown): string {
  const s = asTrimmedString(v) ?? "impact";
  if (!isSupportedNetworkKind(s)) {
    throw new ValidationError(
      `不支持的网络类型: ${s}（支持: ${SUPPORTED_NETWORK_KINDS.join(", ")}）`
    );
  }
  return s.toLowerCase();
}

function asApiBaseUrl(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return undefined;
  const s = asTrimmedString(v);
  if (!s) return null;
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    throw new ValidationError("apiBaseUrl 不是合法的 URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ValidationError("apiBaseUrl 必须是 http(s) 地址");
  }
  if (parsed.username || parsed.password) {
    throw new ValidationError("apiBaseUrl 不得包含用户名密码");
  }
  return s;
}

function assertId(id: unknown): string {
  const s = asTrimmedString(id);
  if (!s || !UUID_RE.test(s)) throw new NotFoundError("Network not found");
  return s;
}

/** session 商品列表路径覆盖（可选；必须以 / 开头，≤500 字符）。 */
function asSessionListPath(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return undefined;
  const s = asTrimmedString(v);
  if (!s) return null;
  if (!s.startsWith("/")) {
    throw new ValidationError("sessionListPath 必须以 / 开头");
  }
  if (s.length > 500) throw new ValidationError("sessionListPath 过长（上限 500）");
  return s;
}

/** Public shape — credentials masked to a boolean flag. */
export function serializeNetwork(row: {
  id: string;
  name: string;
  kind: string;
  website: string | null;
  apiConfigured: boolean;
  apiKeyRef: string | null;
  apiBaseUrl: string | null;
  lastPullAt: Date | null;
  pullStatus: string | null;
  pullError: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  syncMode?: string | null;
  sessionRef?: string | null;
  sessionStatus?: string | null;
  sessionListPath?: string | null;
}) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    website: row.website,
    apiConfigured: row.apiConfigured || Boolean(row.apiKeyRef),
    apiBaseUrl: row.apiBaseUrl,
    lastPullAt: row.lastPullAt ? row.lastPullAt.toISOString() : null,
    pullStatus: row.pullStatus ?? "NEVER",
    pullError: row.pullError,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    syncMode: row.syncMode ?? "api",
    sessionConfigured: Boolean(row.sessionRef),
    sessionStatus: row.sessionStatus ?? "NEVER",
    sessionListPath: row.sessionListPath ?? null,
  };
}

function pageArgs(query: Record<string, unknown>): {
  page: number;
  pageSize: number;
} {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
  return { page, pageSize };
}

export async function registerNetworkRoutes(
  app: FastifyInstance,
  services: NetworkRouteServices,
  auth: AuthContext,
  pullDeps?: Partial<NetworkPullServiceDeps>
): Promise<void> {
  const resolveTenant = (
    request: Parameters<typeof requireTenant>[1]
  ): string => requireTenant(auth, request);

  const findNetwork = async (tenantId: string, id: string) => {
    const row = await services.prisma.affiliateNetwork.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!row) throw new NotFoundError("Network not found");
    return row;
  };

  app.get("/api/v1/networks", async (request) => {
    const tenantId = resolveTenant(request);
    const rows = await services.prisma.affiliateNetwork.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return {
      networks: rows.map((r) =>
        serializeNetwork(r as Parameters<typeof serializeNetwork>[0])
      ),
      supportedKinds: [...SUPPORTED_NETWORK_KINDS],
    };
  });

  app.post<{ Body: Record<string, unknown> }>(
    "/api/v1/networks",
    async (request, reply) => {
      const tenantId = resolveTenant(request);
      const body = request.body ?? {};
      const name = asTrimmedString(body.name);
      if (!name) throw new ValidationError("名称不能为空");
      const kind = asKind(body.kind);
      const apiBaseUrl = asApiBaseUrl(body.apiBaseUrl);

      let apiKeyRef: string | null = null;
      const apiKey = asTrimmedString(body.apiKey);
      if (apiKey) {
        const pepper = assertNetworkApiPepperConfigured();
        apiKeyRef = encryptApiKey(apiKey, pepper);
      }

      const row = await services.prisma.affiliateNetwork.create({
        data: {
          id: randomUUID(),
          tenantId,
          name,
          website: asTrimmedString(body.website) ?? null,
          kind,
          apiConfigured: Boolean(apiKeyRef),
          apiKeyRef,
          ...(apiBaseUrl !== undefined ? { apiBaseUrl } : {}),
        },
      });
      // Validate adapter exists eagerly (fail fast on unsupported kind).
      getAdapter(kind);
      return reply.status(201).send({
        network: serializeNetwork(
          row as Parameters<typeof serializeNetwork>[0]
        ),
      });
    }
  );

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/v1/networks/:id",
    async (request) => {
      const tenantId = resolveTenant(request);
      const id = assertId(request.params.id);
      const row = await findNetwork(tenantId, id);
      const body = request.body ?? {};
      const patch: Record<string, unknown> = {};

      const name = asTrimmedString(body.name);
      if (name !== undefined) patch.name = name;
      const website = body.website;
      if (website !== undefined) patch.website = asTrimmedString(website);
      if (body.kind !== undefined) {
        const kind = asKind(body.kind);
        getAdapter(kind);
        patch.kind = kind;
      }
      const apiBaseUrl = asApiBaseUrl(body.apiBaseUrl);
      if (apiBaseUrl !== undefined) patch.apiBaseUrl = apiBaseUrl;
      const sessionListPath = asSessionListPath(body.sessionListPath);
      if (sessionListPath !== undefined) patch.sessionListPath = sessionListPath;

      // apiKey rotation: string → re-encrypt; null → clear credentials.
      if (body.apiKey !== undefined) {
        if (body.apiKey === null) {
          patch.apiKeyRef = null;
          patch.apiConfigured = false;
        } else {
          const apiKey = asTrimmedString(body.apiKey);
          if (apiKey) {
            const pepper = assertNetworkApiPepperConfigured();
            patch.apiKeyRef = encryptApiKey(apiKey, pepper);
            patch.apiConfigured = true;
          }
        }
      }

      const updated = await services.prisma.affiliateNetwork.update({
        where: { id: row.id },
        data: patch,
      });
      return {
        network: serializeNetwork(
          updated as Parameters<typeof serializeNetwork>[0]
        ),
      };
    }
  );

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/v1/networks/:id/sync-mode",
    async (request) => {
      // 商品库同步模式切换：同样先 requireSession（B6 授权在下方强制执行）。
      const info = await requireSession({ prisma: services.prisma }, request);
      const tenantId = info.tenantId;
      const id = assertId(request.params.id);
      const row = await findNetwork(tenantId, id);
      const body = request.body ?? {};
      const syncMode = body.syncMode;
      if (!isSyncMode(syncMode)) {
        throw new ValidationError('syncMode 必须为 "api" 或 "session"');
      }
      // B6：切换同步模式要求 catalog-sync 授权（whitelist=kind），无授权 403。
      const grant = await requireActiveGrant(services.prisma, {
        tenantId,
        userId: info.id,
        capability: "catalog-sync",
        whitelistValue: row.kind,
      });
      if (syncMode === "session") {
        if (!isSessionSupported(row.kind)) {
          throw new ValidationError(`该网络（${row.kind}）暂不支持 session 模式`);
        }
        // 切到 session 必须显式确认 ToS 风险，否则 400 并返回风险文本。
        if (body.confirmTosRisk !== true) {
          throw new ValidationError("切换到 session 模式必须确认 ToS 风险", {
            tosRisk: SESSION_TOS_RISK_TEXT,
          });
        }
      }
      const from = (row as { syncMode?: string }).syncMode ?? "api";
      const updated = await services.prisma.affiliateNetwork.update({
        where: { id: row.id },
        data: { syncMode },
      });
      await writeCatalogAudit(services.prisma, {
        tenantId,
        grantId: grant.id,
        actorId: info.id,
        action: "NETWORK_SYNC_MODE_CHANGED",
        detail: { kind: row.kind, networkId: row.id, from, to: syncMode },
      });
      await incrementGrantUsage(services.prisma, grant);
      return {
        network: serializeNetwork(
          updated as Parameters<typeof serializeNetwork>[0]
        ),
      };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/v1/networks/:id/pull-now",
    async (request, reply) => {
      const tenantId = resolveTenant(request);
      const id = assertId(request.params.id);
      const row = await findNetwork(tenantId, id);
      if (!row.apiKeyRef) {
        throw new ValidationError(
          "该网络尚未配置 API 凭证：请先在编辑弹窗中填写 API Key 后再拉取"
        );
      }
      const summary = await pullNetwork(
        {
          prisma: services.prisma,
          ...(pullDeps ?? {}),
        },
        tenantId,
        row.id
      );
      return reply.status(202).send({ pull: summary });
    }
  );

  app.get<{ Params: { id: string } }>(
    "/api/v1/networks/:id/pulls",
    async (request) => {
      const tenantId = resolveTenant(request);
      const id = assertId(request.params.id);
      await findNetwork(tenantId, id);
      const { page, pageSize } = pageArgs(
        request.query as Record<string, unknown>
      );
      const where = { tenantId, networkId: id };
      const [total, rows] = await Promise.all([
        services.prisma.networkOfferPull.count({ where }),
        services.prisma.networkOfferPull.findMany({
          where,
          orderBy: { pulledAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return {
        total,
        page,
        pageSize,
        pulls: rows.map((r) => ({
          id: r.id,
          pulledAt: r.pulledAt.toISOString(),
          offerCount: r.offerCount,
          newCount: r.newCount,
          updatedCount: r.updatedCount,
          status: r.status,
          error: r.error,
        })),
      };
    }
  );

  app.get<{ Params: { id: string } }>(
    "/api/v1/networks/:id/offers",
    async (request) => {
      const tenantId = resolveTenant(request);
      const id = assertId(request.params.id);
      await findNetwork(tenantId, id);
      const { page, pageSize } = pageArgs(
        request.query as Record<string, unknown>
      );
      const where = { tenantId, networkId: id };
      const [total, rows] = await Promise.all([
        services.prisma.networkOffer.count({ where }),
        services.prisma.networkOffer.findMany({
          where,
          orderBy: { lastSeenAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return {
        total,
        page,
        pageSize,
        offers: rows.map((r) => ({
          id: r.id,
          externalId: r.externalId,
          name: r.name,
          payout: r.payout === null ? null : Number(r.payout),
          currency: r.currency,
          termsText: r.termsText,
          url: (r.rawData as Record<string, unknown> | null)?.url ?? null,
          lastSeenAt: r.lastSeenAt.toISOString(),
        })),
      };
    }
  );
}
