/**
 * P1-11：归因透明化 + 冲突处理。
 *
 * - GET/PUT /api/v1/attribution/settings — 归因窗口 / gclid 去重分钟 / 重复点击是否计转化。
 * - GET /api/v1/attribution/conflicts — 冲突列表（open 在前）。
 * - POST /api/v1/attribution/conflicts — 人工上报冲突（orderId + 冲突 offer 列表）。
 * - POST /api/v1/attribution/conflicts/:id/resolve — 人工选择归属 Offer（写 AuditLog，
 *   绝不静默取第一个匹配）。
 * - GET /api/v1/reports/attribution — 可归因 vs 不可归因拆分：
 *   可归因订单（有 conversionId）→ 归属 Offer/系列；不可归因订单（无 conversionId，
 *   如“买了未投商品”）→ 只归品牌，不归到某个商品。
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import { authenticateSessionRequest, type SessionAuthInfo } from "../auth/sessions.js";
import {
  DEFAULT_ATTRIBUTION_SETTINGS,
  getAttributionSettings,
} from "../services/attribution-settings.js";

export interface AttributionRouteDeps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: AttributionRouteDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) throw new UnauthorizedError("Authentication required");
  return info;
}

function asInt(v: unknown, field: string, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ValidationError(`${field} must be an integer between ${min} and ${max}`);
  }
  return n;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asUuid(v: unknown, field: string): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) {
    throw new ValidationError(`${field} must be a UUID`);
  }
  return v;
}

export async function registerAttributionRoutes(
  app: FastifyInstance,
  deps: AttributionRouteDeps
): Promise<void> {
  const { prisma } = deps;

  /** GET /api/v1/attribution/settings */
  app.get("/api/v1/attribution/settings", async (request) => {
    const info = await requireSession(deps, request);
    const settings = await getAttributionSettings(prisma, info.tenantId);
    return { tenantId: info.tenantId, ...settings };
  });

  /** PUT /api/v1/attribution/settings */
  app.put<{ Body: Record<string, unknown> }>(
    "/api/v1/attribution/settings",
    async (request) => {
      const info = await requireSession(deps, request);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const data = {
        attributionWindowDays:
          body.attributionWindowDays === undefined
            ? DEFAULT_ATTRIBUTION_SETTINGS.attributionWindowDays
            : asInt(body.attributionWindowDays, "attributionWindowDays", 1, 365),
        gclidDedupeMinutes:
          body.gclidDedupeMinutes === undefined
            ? DEFAULT_ATTRIBUTION_SETTINGS.gclidDedupeMinutes
            : asInt(body.gclidDedupeMinutes, "gclidDedupeMinutes", 1, 1440),
        duplicateClicksCountAsConversion:
          body.duplicateClicksCountAsConversion === true,
      };
      const row = await prisma.attributionSettings.upsert({
        where: { tenantId: info.tenantId },
        create: { id: randomUUID(), tenantId: info.tenantId, ...data },
        update: { ...data },
      });
      return {
        tenantId: info.tenantId,
        attributionWindowDays: row.attributionWindowDays,
        gclidDedupeMinutes: row.gclidDedupeMinutes,
        duplicateClicksCountAsConversion: row.duplicateClicksCountAsConversion,
      };
    }
  );

  /** GET /api/v1/attribution/conflicts */
  app.get<{ Querystring: { status?: string } }>(
    "/api/v1/attribution/conflicts",
    async (request) => {
      const info = await requireSession(deps, request);
      const rows = await prisma.attributionConflict.findMany({
        where: {
          tenantId: info.tenantId,
          ...(request.query.status ? { status: request.query.status } : {}),
        },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        take: 200,
      });
      return {
        items: rows.map((r) => ({
          id: r.id,
          orderId: r.orderId,
          mainOfferId: r.mainOfferId,
          conflictOfferIds: r.conflictOfferIds,
          reason: r.reason,
          status: r.status,
          resolvedOfferId: r.resolvedOfferId,
          resolvedBy: r.resolvedBy,
          resolvedAt: r.resolvedAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    }
  );

  /** POST /api/v1/attribution/conflicts — 人工上报冲突。 */
  app.post<{ Body: Record<string, unknown> }>(
    "/api/v1/attribution/conflicts",
    async (request) => {
      const info = await requireSession(deps, request);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const orderId = asUuid(body.orderId, "orderId");
      const order = await prisma.order.findFirst({
        where: { id: orderId, tenantId: info.tenantId },
        select: { id: true },
      });
      if (!order) throw new NotFoundError("Order", orderId);
      const conflictOfferIds = Array.isArray(body.conflictOfferIds)
        ? body.conflictOfferIds.map((v) => asUuid(v, "conflictOfferIds[]"))
        : [];
      if (conflictOfferIds.length < 2) {
        throw new ValidationError("conflictOfferIds must contain at least 2 offers");
      }
      const row = await prisma.attributionConflict.create({
        data: {
          id: randomUUID(),
          tenantId: info.tenantId,
          orderId,
          mainOfferId:
            typeof body.mainOfferId === "string" ? asUuid(body.mainOfferId, "mainOfferId") : null,
          conflictOfferIds,
          reason: typeof body.reason === "string" ? body.reason : null,
          status: "open",
        },
      });
      return { id: row.id, status: row.status };
    }
  );

  /** POST /api/v1/attribution/conflicts/:id/resolve — 人工选择归属，写审计。 */
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/v1/attribution/conflicts/:id/resolve",
    async (request) => {
      const info = await requireSession(deps, request);
      const conflict = await prisma.attributionConflict.findFirst({
        where: { id: request.params.id, tenantId: info.tenantId },
      });
      if (!conflict) throw new NotFoundError("AttributionConflict", request.params.id);
      if (conflict.status !== "open") {
        throw new ValidationError("Conflict is already resolved");
      }
      const body = (request.body ?? {}) as Record<string, unknown>;
      const resolvedOfferId = asUuid(body.resolvedOfferId, "resolvedOfferId");
      const candidates = (conflict.conflictOfferIds as unknown[]).filter(
        (v): v is string => typeof v === "string"
      );
      if (!candidates.includes(resolvedOfferId)) {
        throw new ValidationError("resolvedOfferId must be one of conflictOfferIds");
      }
      const updated = await prisma.attributionConflict.update({
        where: { id: conflict.id },
        data: {
          status: "resolved",
          resolvedOfferId,
          resolvedBy: info.id,
          resolvedAt: new Date(),
        },
      });
      await prisma.auditLog.create({
        data: {
          id: randomUUID(),
          tenantId: info.tenantId,
          actorId: info.id,
          action: "ATTRIBUTION_CONFLICT_RESOLVED",
          entityType: "AttributionConflict",
          entityId: conflict.id,
          before: { status: "open", conflictOfferIds: candidates },
          after: { status: "resolved", resolvedOfferId },
          reason: "P1-11: manual attribution resolution (never silent first-match)",
        },
      });
      return { id: updated.id, status: updated.status, resolvedOfferId };
    }
  );

  /** GET /api/v1/reports/attribution — 可归因 vs 不可归因拆分。 */
  app.get("/api/v1/reports/attribution", async (request) => {
    const info = await requireSession(deps, request);
    const orders = await prisma.order.findMany({
      where: { tenantId: info.tenantId },
      select: { id: true, conversionId: true, value: true, clickId: true },
      take: 5000,
    });
    const attributable = orders.filter((o) => o.conversionId);
    const unattributable = orders.filter((o) => !o.conversionId);
    const sum = (rows: typeof orders) =>
      rows.reduce((s, o) => s + Number(o.value ?? 0), 0);
    // 可归因订单的 Offer 归属：经 Click → offerId（缺失时归“未知 Offer”，不编造）。
    const clickIds = [...new Set(attributable.map((o) => o.clickId).filter(Boolean))] as string[];
    const clicks = clickIds.length
      ? await prisma.click.findMany({
          where: { tenantId: info.tenantId, id: { in: clickIds } },
          select: { id: true, offerId: true },
        })
      : [];
    const offerByClick = new Map(clicks.map((c) => [c.id, c.offerId]));
    const byOffer = new Map<string, { orders: number; value: number }>();
    for (const o of attributable) {
      const key = (o.clickId && offerByClick.get(o.clickId)) || "unknown";
      const cur = byOffer.get(key) ?? { orders: 0, value: 0 };
      cur.orders += 1;
      cur.value += Number(o.value ?? 0);
      byOffer.set(key, cur);
    }
    return {
      attributable: {
        orders: attributable.length,
        value: sum(attributable),
        byOffer: [...byOffer.entries()].map(([offerId, v]) => ({ offerId, ...v })),
      },
      unattributable: {
        orders: unattributable.length,
        value: sum(unattributable),
        note: "不可归因订单（如“买了未投商品”）只归品牌，不归到某个商品；佣金按品牌口径统计，不进单品 ROI。",
      },
      total: { orders: orders.length, value: sum(orders) },
    };
  });
}
