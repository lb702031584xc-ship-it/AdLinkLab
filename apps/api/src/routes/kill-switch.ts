/**
 * Phase 3 Optimization — Kill Switch API (one tenant per user; session auth only).
 * Pure addition: new endpoints only, no existing route behavior changed.
 *
 * Note: there is no zod dependency in this repo, so request validation follows
 * the existing lenient-validation convention (see offer-intel.ts), not zod.
 */
import { randomUUID } from "node:crypto";
import { getTestSpendSnapshot } from "../killswitch/engine.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";

export interface KillSwitchRouteDeps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: KillSwitchRouteDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) {
    throw new UnauthorizedError("Authentication required");
  }
  return info;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asTrimmedString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

/** Number or null (empty string / null / undefined clear the threshold). */
function asOptionalNumber(v: unknown, field: string): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new ValidationError(`${field} must be a finite number`);
  }
  return n;
}

function asOptionalBoolean(v: unknown, field: string): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  throw new ValidationError(`${field} must be a boolean`);
}

function asInt(v: unknown, field: string, def: number): number {
  if (v === undefined || v === null || v === "") return def;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) {
    throw new ValidationError(`${field} must be a positive integer`);
  }
  return Math.min(n, 200);
}

async function getOfferOr404(
  deps: KillSwitchRouteDeps,
  tenantId: string,
  offerId: string
) {
  if (!UUID_RE.test(offerId)) throw new NotFoundError("Offer", offerId);
  const offer = await deps.prisma.offer.findFirst({
    where: { id: offerId, tenantId, deletedAt: null },
  });
  if (!offer) throw new NotFoundError("Offer", offerId);
  return offer;
}

const DEFAULT_CONFIG = {
  enabled: false,
  maxSpend: null,
  minExpectedProfit: null,
  minCvr: null,
  maxPolicyRisk: null,
  pauseOnMerchantTerminated: true,
  testSpendCap: null,
  testZeroConvSpend: null,
  // P0-10: also queue a Google Ads campaign-toggle PAUSE on auto-pause.
  pauseGoogleAdsToo: false,
};

function serializeConfig(row: {
  id: string;
  offerId: string;
  enabled: boolean;
  maxSpend: unknown;
  minExpectedProfit: unknown;
  minCvr: unknown;
  maxPolicyRisk: unknown;
  pauseOnMerchantTerminated: boolean;
  testSpendCap: unknown;
  testZeroConvSpend: unknown;
  pauseGoogleAdsToo: boolean;
  createdAt: unknown;
  updatedAt: unknown;
}) {
  return {
    id: row.id,
    offerId: row.offerId,
    enabled: row.enabled,
    maxSpend: row.maxSpend === null ? null : Number(row.maxSpend),
    minExpectedProfit:
      row.minExpectedProfit === null ? null : Number(row.minExpectedProfit),
    minCvr: row.minCvr,
    maxPolicyRisk: row.maxPolicyRisk,
    pauseOnMerchantTerminated: row.pauseOnMerchantTerminated,
    testSpendCap: row.testSpendCap === null ? null : Number(row.testSpendCap),
    testZeroConvSpend:
      row.testZeroConvSpend === null ? null : Number(row.testZeroConvSpend),
    pauseGoogleAdsToo: row.pauseGoogleAdsToo ?? false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function registerKillSwitchRoutes(
  app: FastifyInstance,
  deps: KillSwitchRouteDeps
): Promise<void> {
  const { prisma } = deps;

  /**
   * GET /api/v1/offers/:id/kill-switch — fetch config, or safe defaults
   * when the offer has no config row yet.
   */
  app.get<{
    Params: { id: string };
  }>("/api/v1/offers/:id/kill-switch", async (request) => {
    const info = await requireSession(deps, request);
    const offer = await getOfferOr404(deps, info.tenantId, request.params.id);
    const row = (await prisma.killSwitchConfig.findUnique({
      where: { offerId: offer.id },
    })) as Parameters<typeof serializeConfig>[0] | null;
    if (!row) {
      return { offerId: offer.id, ...DEFAULT_CONFIG, configured: false };
    }
    return { ...serializeConfig(row), configured: true };
  });

  /**
   * GET /api/v1/offers/:id/test-spend — 测试止损监控：预估花费 + 止损线。
   * 花费口径：真实点击数 × ProfitModel base CPC；无数据返回 null 花费。
   */
  app.get<{
    Params: { id: string };
  }>("/api/v1/offers/:id/test-spend", async (request) => {
    const info = await requireSession(deps, request);
    const offer = await getOfferOr404(deps, info.tenantId, request.params.id);
    const row = (await prisma.killSwitchConfig.findUnique({
      where: { offerId: offer.id },
      select: { testSpendCap: true, testZeroConvSpend: true, tenantId: true },
    })) as {
      testSpendCap: unknown;
      testZeroConvSpend: unknown;
      tenantId: string;
    } | null;
    if (!row || row.tenantId !== info.tenantId) {
      return {
        offerId: offer.id,
        spend: null,
        clicks: null,
        conversions: null,
        testSpendCap: null,
        testZeroConvSpend: null,
      };
    }
    const snap = await getTestSpendSnapshot(prisma, info.tenantId, offer.id);
    return {
      offerId: offer.id,
      spend: snap ? snap.spend : null,
      clicks: snap ? snap.clicks : null,
      conversions: snap ? snap.conversions : null,
      testSpendCap: row.testSpendCap === null ? null : Number(row.testSpendCap),
      testZeroConvSpend:
        row.testZeroConvSpend === null ? null : Number(row.testZeroConvSpend),
    };
  });

  /**
   * PUT /api/v1/offers/:id/kill-switch — upsert thresholds + enabled flag.
   * Writes an AuditLog entry (kill-switch arming is a consequential action).
   */
  app.put<{
    Params: { id: string };
    Body: Record<string, unknown>;
  }>("/api/v1/offers/:id/kill-switch", async (request) => {
    const info = await requireSession(deps, request);
    const offer = await getOfferOr404(deps, info.tenantId, request.params.id);
    const body = (request.body ?? {}) as Record<string, unknown>;

    const enabled = asOptionalBoolean(body.enabled, "enabled");
    const maxSpend = asOptionalNumber(body.maxSpend, "maxSpend");
    const minExpectedProfit = asOptionalNumber(
      body.minExpectedProfit,
      "minExpectedProfit"
    );
    const minCvr = asOptionalNumber(body.minCvr, "minCvr");
    const maxPolicyRisk = asOptionalNumber(body.maxPolicyRisk, "maxPolicyRisk");
    const pauseOnMerchantTerminated = asOptionalBoolean(
      body.pauseOnMerchantTerminated,
      "pauseOnMerchantTerminated"
    );
    const testSpendCap = asOptionalNumber(body.testSpendCap, "testSpendCap");
    const testZeroConvSpend = asOptionalNumber(
      body.testZeroConvSpend,
      "testZeroConvSpend"
    );
    // P0-10: default false — the operator opts in deliberately.
    const pauseGoogleAdsToo = asOptionalBoolean(
      body.pauseGoogleAdsToo,
      "pauseGoogleAdsToo"
    );

    if (
      maxSpend !== undefined &&
      maxSpend !== null &&
      maxSpend < 0
    ) {
      throw new ValidationError("maxSpend must be >= 0");
    }
    for (const [v, name] of [
      [testSpendCap, "testSpendCap"],
      [testZeroConvSpend, "testZeroConvSpend"],
    ] as const) {
      if (v !== undefined && v !== null && v <= 0) {
        throw new ValidationError(`${name} must be > 0`);
      }
    }
    if (minCvr !== undefined && minCvr !== null && (minCvr < 0 || minCvr > 1)) {
      throw new ValidationError("minCvr must be between 0 and 1");
    }
    if (
      maxPolicyRisk !== undefined &&
      maxPolicyRisk !== null &&
      (!Number.isInteger(maxPolicyRisk) || maxPolicyRisk < 0 || maxPolicyRisk > 100)
    ) {
      throw new ValidationError("maxPolicyRisk must be an integer between 0 and 100");
    }
    const maxPolicyRiskInt =
      maxPolicyRisk === undefined || maxPolicyRisk === null
        ? maxPolicyRisk
        : Math.trunc(maxPolicyRisk);

    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (enabled !== undefined) data.enabled = enabled;
    if (maxSpend !== undefined) data.maxSpend = maxSpend;
    if (minExpectedProfit !== undefined) data.minExpectedProfit = minExpectedProfit;
    if (minCvr !== undefined) data.minCvr = minCvr;
    if (maxPolicyRiskInt !== undefined) data.maxPolicyRisk = maxPolicyRiskInt;
    if (pauseOnMerchantTerminated !== undefined)
      data.pauseOnMerchantTerminated = pauseOnMerchantTerminated;
    if (testSpendCap !== undefined) data.testSpendCap = testSpendCap;
    if (testZeroConvSpend !== undefined) data.testZeroConvSpend = testZeroConvSpend;
    if (pauseGoogleAdsToo !== undefined) data.pauseGoogleAdsToo = pauseGoogleAdsToo;

    const before = (await prisma.killSwitchConfig.findUnique({
      where: { offerId: offer.id },
    })) as Parameters<typeof serializeConfig>[0] | null;

    const row = (await prisma.killSwitchConfig.upsert({
      where: { offerId: offer.id },
      create: {
        id: randomUUID(),
        tenantId: info.tenantId,
        offerId: offer.id,
        enabled: enabled ?? false,
        maxSpend: maxSpend ?? null,
        minExpectedProfit: minExpectedProfit ?? null,
        minCvr: minCvr ?? null,
        maxPolicyRisk: maxPolicyRiskInt ?? null,
        pauseOnMerchantTerminated: pauseOnMerchantTerminated ?? true,
        testSpendCap: testSpendCap ?? null,
        testZeroConvSpend: testZeroConvSpend ?? null,
        pauseGoogleAdsToo: pauseGoogleAdsToo ?? false,
      },
      update: data,
    })) as Parameters<typeof serializeConfig>[0];

    const reason = asTrimmedString(body.reason) ?? "kill-switch config updated";
    await prisma.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId: info.tenantId,
        actorId: info.id,
        action: "KILL_SWITCH_CONFIG_UPDATE",
        entityType: "KillSwitchConfig",
        entityId: row.id,
        before: before
          ? (JSON.parse(JSON.stringify(before)) as never)
          : (null as never),
        after: JSON.parse(JSON.stringify(serializeConfig(row))) as never,
        reason,
        ip: request.ip ?? null,
        userAgent: request.headers["user-agent"] ?? null,
      },
    });

    return { ...serializeConfig(row), configured: true };
  });

  /**
   * GET /api/v1/kill-switch/events?offerId=&page=&pageSize= — firing history.
   */
  app.get<{
    Querystring: { offerId?: string; page?: string; pageSize?: string };
  }>("/api/v1/kill-switch/events", async (request) => {
    const info = await requireSession(deps, request);
    const { offerId } = request.query;
    if (offerId !== undefined) {
      if (!UUID_RE.test(offerId)) throw new ValidationError("offerId must be a UUID");
      await getOfferOr404(deps, info.tenantId, offerId);
    }
    const page = asInt(request.query.page, "page", 1);
    const pageSize = asInt(request.query.pageSize, "pageSize", 50);
    const where = {
      tenantId: info.tenantId,
      ...(offerId ? { offerId } : {}),
    };
    const [total, items] = await Promise.all([
      prisma.killSwitchEvent.count({ where }),
      prisma.killSwitchEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items, total, page, pageSize };
  });
}
