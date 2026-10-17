/**
 * P1-6：Offer 自动状态联动 — 偏好设置 + 手动检查 + 批量执行。
 *
 * - GET  /api/v1/offers/:id/preferences — 读取偏好（无记录时返回默认值，不建行）。
 * - PUT  /api/v1/offers/:id/preferences — 保存偏好（autoStatusEnabled 默认 false）。
 * - POST /api/v1/offers/:id/auto-status/check — 手动评估一次（只评估，不改状态）。
 * - POST /api/v1/offers/auto-status/run — 对租户内已开启的 Offer 批量执行
 *   （traffic-monitor worker 每小时扫描后也会调用一次；失败不影响扫描）。
 *
 * 自动暂停仅发生在：已显式开启 + 零表现建议。ROAS 下滑只给建议。
 * 每次自动暂停写 AuditLog（OFFER_AUTO_PAUSED），可审计、可手动恢复。
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { assertOfferTransition } from "@adlinklab/domain";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import { authenticateSessionRequest, type SessionAuthInfo } from "../auth/sessions.js";
import { evaluateAutoStatus, type AutoStatusPrefs } from "../services/auto-status.js";

export interface OfferPreferencesRouteDeps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: OfferPreferencesRouteDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) throw new UnauthorizedError("Authentication required");
  return info;
}

const DEFAULT_PREFS: AutoStatusPrefs = {
  autoStatusEnabled: false,
  zeroPerfDays: 5,
  roscDeclineDays: 7,
};

function asInt(v: unknown, field: string, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ValidationError(`${field} must be an integer between ${min} and ${max}`);
  }
  return n;
}

function serializePrefs(row: {
  autoStatusEnabled: boolean;
  zeroPerfDays: number;
  roscDeclineDays: number;
}) {
  return {
    autoStatusEnabled: row.autoStatusEnabled,
    zeroPerfDays: row.zeroPerfDays,
    roscDeclineDays: row.roscDeclineDays,
  };
}

/**
 * 对单个 Offer 执行一次评估；开启且零表现时自动暂停（写 AuditLog）。
 * 返回评估结果 + 是否已执行暂停。纯评估路径（check）不调用本函数。
 */
export async function applyAutoStatusForOffer(
  prisma: PrismaClient,
  tenantId: string,
  offerId: string,
  prefs: AutoStatusPrefs
) {
  const offer = await prisma.offer.findFirst({
    where: { id: offerId, tenantId },
    select: { id: true, status: true },
  });
  if (!offer) throw new NotFoundError("Offer", offerId);
  const archives = await prisma.launchArchive.findMany({
    where: { tenantId, offerId },
    select: { createdAt: true, clicks: true, spend: true, revenue: true },
    orderBy: { createdAt: "asc" },
  });
  const evaluation = evaluateAutoStatus(prefs, archives);
  let paused = false;
  if (evaluation.willAutoPause && offer.status === "ACTIVE") {
    assertOfferTransition(offer.status, "PAUSED");
    await prisma.offer.update({
      where: { id: offerId },
      data: { status: "PAUSED" },
    });
    await prisma.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId,
        actorId: null,
        action: "OFFER_AUTO_PAUSED",
        entityType: "Offer",
        entityId: offerId,
        before: { status: offer.status },
        after: { status: "PAUSED" },
        reason: `P1-6 auto-status: ${evaluation.reason}`,
      },
    });
    paused = true;
  }
  return { offerId, ...evaluation, paused };
}

/** 批量执行：仅处理 autoStatusEnabled=true 的 Offer（worker + 手动 run 共用）。 */
export async function runAutoStatusCheck(
  prisma: PrismaClient,
  tenantId: string
): Promise<Array<{ offerId: string; suggestion: string; paused: boolean; reason: string }>> {
  const prefsRows = await prisma.offerPreference.findMany({
    where: { tenantId, autoStatusEnabled: true },
    select: { offerId: true, autoStatusEnabled: true, zeroPerfDays: true, roscDeclineDays: true },
  });
  const results = [];
  for (const p of prefsRows) {
    try {
      const r = await applyAutoStatusForOffer(prisma, tenantId, p.offerId, serializePrefs(p));
      results.push({ offerId: r.offerId, suggestion: r.suggestion, paused: r.paused, reason: r.reason });
    } catch {
      // 单个 Offer 失败不阻断其他 Offer（worker 侧已包 try/catch 日志）。
      results.push({ offerId: p.offerId, suggestion: "error", paused: false, reason: "evaluation failed" });
    }
  }
  return results;
}

export async function registerOfferPreferenceRoutes(
  app: FastifyInstance,
  deps: OfferPreferencesRouteDeps
): Promise<void> {
  const { prisma } = deps;

  /** GET /api/v1/offers/:id/preferences */
  app.get<{ Params: { id: string } }>(
    "/api/v1/offers/:id/preferences",
    async (request) => {
      const info = await requireSession(deps, request);
      const offer = await prisma.offer.findFirst({
        where: { id: request.params.id, tenantId: info.tenantId },
        select: { id: true },
      });
      if (!offer) throw new NotFoundError("Offer", request.params.id);
      const row = await prisma.offerPreference.findUnique({
        where: { offerId: request.params.id },
        select: { autoStatusEnabled: true, zeroPerfDays: true, roscDeclineDays: true },
      });
      return { offerId: request.params.id, ...(row ? serializePrefs(row) : DEFAULT_PREFS) };
    }
  );

  /** PUT /api/v1/offers/:id/preferences */
  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/v1/offers/:id/preferences",
    async (request) => {
      const info = await requireSession(deps, request);
      const offer = await prisma.offer.findFirst({
        where: { id: request.params.id, tenantId: info.tenantId },
        select: { id: true },
      });
      if (!offer) throw new NotFoundError("Offer", request.params.id);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const prefs: AutoStatusPrefs = {
        autoStatusEnabled: body.autoStatusEnabled === true,
        zeroPerfDays:
          body.zeroPerfDays === undefined
            ? DEFAULT_PREFS.zeroPerfDays
            : asInt(body.zeroPerfDays, "zeroPerfDays", 1, 30),
        roscDeclineDays:
          body.roscDeclineDays === undefined
            ? DEFAULT_PREFS.roscDeclineDays
            : asInt(body.roscDeclineDays, "roscDeclineDays", 1, 30),
      };
      const row = await prisma.offerPreference.upsert({
        where: { offerId: request.params.id },
        create: { id: randomUUID(), tenantId: info.tenantId, offerId: request.params.id, ...prefs },
        update: { ...prefs },
        select: { autoStatusEnabled: true, zeroPerfDays: true, roscDeclineDays: true },
      });
      return { offerId: request.params.id, ...serializePrefs(row) };
    }
  );

  /** POST /api/v1/offers/:id/auto-status/check — 只评估，不改状态。 */
  app.post<{ Params: { id: string } }>(
    "/api/v1/offers/:id/auto-status/check",
    async (request) => {
      const info = await requireSession(deps, request);
      const offer = await prisma.offer.findFirst({
        where: { id: request.params.id, tenantId: info.tenantId },
        select: { id: true, status: true },
      });
      if (!offer) throw new NotFoundError("Offer", request.params.id);
      const prefRow = await prisma.offerPreference.findUnique({
        where: { offerId: request.params.id },
        select: { autoStatusEnabled: true, zeroPerfDays: true, roscDeclineDays: true },
      });
      const prefs = prefRow ? serializePrefs(prefRow) : DEFAULT_PREFS;
      const archives = await prisma.launchArchive.findMany({
        where: { tenantId: info.tenantId, offerId: request.params.id },
        select: { createdAt: true, clicks: true, spend: true, revenue: true },
        orderBy: { createdAt: "asc" },
      });
      return {
        offerId: request.params.id,
        offerStatus: offer.status,
        prefs,
        ...evaluateAutoStatus(prefs, archives),
      };
    }
  );

  /** POST /api/v1/offers/auto-status/run — 批量执行已开启的 Offer。 */
  app.post("/api/v1/offers/auto-status/run", async (request) => {
    const info = await requireSession(deps, request);
    const results = await runAutoStatusCheck(prisma, info.tenantId);
    return { checked: results.length, results };
  });
}
