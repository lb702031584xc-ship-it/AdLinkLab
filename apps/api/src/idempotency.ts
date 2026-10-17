/**
 * P1-17：幂等键（`Idempotency-Key` 请求头，通用层）。
 *
 * 作用于三条写接口：POST /api/v1/ai/analyze、POST /api/v1/ads/auto-create、
 * POST /api/v1/offers。同一租户 + 同一 key + 同一 scope（路由）：
 * - 首次：正常执行；2xx 响应在 onSend 存入 idempotency_keys
 *   （response + statusCode，TTL 24h）。
 * - 重放：onRequest 查到已存 2xx 响应 → 直接返回相同 status + body，
 *   不再执行 handler（绝不重复扣 AI 用量/配额、不重复建 Offer/计划）。
 * - 非 2xx 不存（可重试）；过期（expiresAt < now）视为无记录。
 * - 无租户信息（未认证）时跳过幂等层，不拦截请求。
 *
 * 注意：Offers 还有 body 级 idempotencyKey（OfferService），与本通用层
 * 互补不冲突。
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { authenticateSessionRequest } from "./auth/sessions.js";

export const IDEMPOTENT_ROUTES = new Set([
  "POST:/api/v1/ai/analyze",
  "POST:/api/v1/ads/auto-create",
  "POST:/api/v1/offers",
]);

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

interface StoredResponse {
  statusCode: number;
  body: string;
  contentType: string;
}

async function resolveTenantId(
  prisma: PrismaClient,
  request: FastifyRequest
): Promise<string | null> {
  if (request.sessionAuth?.tenantId) return request.sessionAuth.tenantId;
  const headerTenant = request.headers["x-tenant-id"];
  if (typeof headerTenant === "string" && headerTenant.trim()) {
    return headerTenant.trim();
  }
  try {
    const info = await authenticateSessionRequest(prisma, request);
    if (info?.tenantId) return info.tenantId;
  } catch {
    // 未认证 → 跳过幂等层。
  }
  return null;
}

export function registerIdempotencyHooks(
  app: FastifyInstance,
  prisma: PrismaClient
): void {
  app.addHook("onRequest", async (request, reply) => {
    const scope = `${request.method}:${request.url.split("?")[0]}`;
    if (!IDEMPOTENT_ROUTES.has(scope)) return;
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || !key.trim()) return;
    const tenantId = await resolveTenantId(prisma, request);
    if (!tenantId) return;
    // 存到请求上下文，供 onSend 使用。
    (request as unknown as { idempotency?: { tenantId: string; key: string; scope: string } }).idempotency = {
      tenantId,
      key: key.trim(),
      scope,
    };
    const stored = await prisma.idempotencyKey.findUnique({
      where: { tenantId_key_scope: { tenantId, key: key.trim(), scope } },
    });
    if (
      stored &&
      stored.statusCode !== null &&
      stored.statusCode >= 200 &&
      stored.statusCode < 300 &&
      stored.expiresAt > new Date() &&
      stored.response !== null
    ) {
      const saved = stored.response as unknown as StoredResponse;
      await reply
        .code(saved.statusCode)
        .header("Content-Type", saved.contentType || "application/json")
        .header("X-Idempotency-Replayed", "true")
        .send(saved.body);
      return;
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const ctx = (
      request as unknown as {
        idempotency?: { tenantId: string; key: string; scope: string };
      }
    ).idempotency;
    if (!ctx) return payload;
    if (reply.statusCode < 200 || reply.statusCode >= 300) return payload;
    const body = typeof payload === "string" ? payload : JSON.stringify(payload ?? "");
    const contentType = reply.getHeader("Content-Type");
    try {
      await prisma.idempotencyKey.upsert({
        where: {
          tenantId_key_scope: { tenantId: ctx.tenantId, key: ctx.key, scope: ctx.scope },
        },
        create: {
          id: randomUUID(),
          tenantId: ctx.tenantId,
          key: ctx.key,
          scope: ctx.scope,
          response: {
            statusCode: reply.statusCode,
            body,
            contentType: typeof contentType === "string" ? contentType : "application/json",
          },
          statusCode: reply.statusCode,
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        },
        update: {
          response: {
            statusCode: reply.statusCode,
            body,
            contentType: typeof contentType === "string" ? contentType : "application/json",
          },
          statusCode: reply.statusCode,
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        },
      });
    } catch {
      // 幂等存储失败绝不影响主响应。
    }
    return payload;
  });
}
