import { createHash, randomBytes, randomUUID } from "node:crypto";
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
import {
  MIN_CREATIVE_DIFFERENCE,
  creativeDifference,
} from "../services/creative-difference.js";

/**
 * Phase 3 — A/B Experiment API (one tenant per user; session auth only).
 *
 * Experiments only swap the *destination* (landing page vs direct link) for a
 * given offer. They NEVER differentiate by user-agent or crawler signals —
 * see the iron rule below and `assignVariant`.
 *
 * NOTE: the `Experiment` table is owned by Worker 1 (schema.prisma), so this
 * file deliberately does NOT depend on the generated Prisma types for it.
 * Access goes through a minimal delegate cast; once Worker 1's migration is
 * applied the real client exposes `prisma.experiment` with the same shape.
 */

export interface ExperimentRouteDeps {
  prisma: PrismaClient;
}

export type ExperimentStatus = "DRAFT" | "RUNNING" | "COMPLETED" | "CANCELLED";
export type ExperimentVariantType = "LANDING_PAGE" | "DIRECT_LINK" | "AD_GROUP";
export type ExperimentWinner = "A" | "B" | "TIE";
/** P1-12：实验类型（LANDING_PAGE | DIRECT_LINK | AD_GROUP）+ 毕业动作。 */
export type ExperimentType = "LANDING_PAGE" | "DIRECT_LINK" | "AD_GROUP";
export type GraduationAction = "none" | "pause_loser";

export interface ExperimentVariant {
  type: ExperimentVariantType;
  /** LANDING_PAGE/DIRECT_LINK 用；AD_GROUP 用 headlines/descriptions。 */
  trackingLinkId: string | null;
  label: string;
  /** P1-12：AD_GROUP 变体文案（headlines + descriptions）。 */
  headlines?: string[];
  descriptions?: string[];
}

/** Numeric metrics snapshot for one variant. All fields optional; missing
 * fields are treated as unknown (never as zero). */
export interface ExperimentMetrics {
  clicks?: number;
  ctr?: number;
  cpc?: number;
  lpViews?: number;
  affiliateClicks?: number;
  cvr?: number;
  cpa?: number;
  revenue?: number;
  profit?: number;
  approvalRate?: number;
  refundRate?: number;
}

export const EXPERIMENT_STATUSES: ExperimentStatus[] = [
  "DRAFT",
  "RUNNING",
  "COMPLETED",
  "CANCELLED",
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const METRIC_FIELDS = [
  "clicks",
  "ctr",
  "cpc",
  "lpViews",
  "affiliateClicks",
  "cvr",
  "cpa",
  "revenue",
  "profit",
  "approvalRate",
  "refundRate",
] as const;

/** Raw row shape of the Worker-1-owned Experiment table. */
export interface ExperimentRow {
  id: string;
  tenantId: string;
  offerId: string;
  name: string;
  status: string;
  variantA: unknown;
  variantB: unknown;
  trafficSplitA: number;
  splitSeed: string | null;
  metricsA: unknown;
  metricsB: unknown;
  winner: string | null;
  confidence: number | null;
  preconditionCheck: unknown;
  startedAt: string | Date | null;
  endedAt: string | Date | null;
  deletedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  /** P1-12：实验类型 / 种子广告组 / 毕业动作（旧行缺失时按默认值处理）。 */
  experimentType?: string | null;
  seedAdGroupId?: string | null;
  graduationAction?: string | null;
}

/** Minimal delegate for `prisma.experiment` (schema owned by Worker 1). */
interface ExperimentDelegate {
  findFirst(args: unknown): Promise<ExperimentRow | null>;
  findMany(args: unknown): Promise<ExperimentRow[]>;
  create(args: unknown): Promise<ExperimentRow>;
  update(args: unknown): Promise<ExperimentRow>;
}

function experiments(prisma: PrismaClient): ExperimentDelegate {
  return (prisma as unknown as { experiment: ExperimentDelegate }).experiment;
}

async function requireSession(
  deps: ExperimentRouteDeps,
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

function asTrimmedString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function asFiniteNumber(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function parseVariant(raw: unknown, side: "A" | "B"): ExperimentVariant {
  const r = (raw ?? {}) as Record<string, unknown>;
  const typeRaw = typeof r.type === "string" ? r.type.trim().toUpperCase() : "";
  if (typeRaw !== "LANDING_PAGE" && typeRaw !== "DIRECT_LINK" && typeRaw !== "AD_GROUP") {
    throw new ValidationError(
      `variant${side}.type must be LANDING_PAGE, DIRECT_LINK or AD_GROUP`
    );
  }
  // P1-12：AD_GROUP 变体携带文案（headlines/descriptions），不绑定追踪链接。
  if (typeRaw === "AD_GROUP") {
    const strArr = (v: unknown, field: string): string[] => {
      if (!Array.isArray(v) || v.length === 0) {
        throw new ValidationError(`variant${side}.${field} must be a non-empty string array`);
      }
      return v.map((x) => {
        if (typeof x !== "string" || !x.trim()) {
          throw new ValidationError(`variant${side}.${field} must be a non-empty string array`);
        }
        return x.trim();
      });
    };
    return {
      type: "AD_GROUP",
      trackingLinkId: null,
      label: asTrimmedString(r.label) ?? `Variant ${side}`,
      headlines: strArr(r.headlines, "headlines"),
      descriptions: strArr(r.descriptions, "descriptions"),
    };
  }
  const trackingLinkId =
    typeof r.trackingLinkId === "string" ? r.trackingLinkId.trim() : "";
  if (!UUID_RE.test(trackingLinkId)) {
    throw new ValidationError(
      `variant${side}.trackingLinkId must be a valid UUID`
    );
  }
  return {
    type: typeRaw as ExperimentVariantType,
    trackingLinkId,
    label: asTrimmedString(r.label) ?? `Variant ${side}`,
  };
}

/** P1-12：AD_GROUP 变体文案差异度（非 AD_GROUP → null）。 */
export function variantCreativeDifference(
  variantA: ExperimentVariant,
  variantB: ExperimentVariant
): number | null {
  if (variantA.type !== "AD_GROUP" || variantB.type !== "AD_GROUP") return null;
  const textA = [...(variantA.headlines ?? []), ...(variantA.descriptions ?? [])].join(" ");
  const textB = [...(variantB.headlines ?? []), ...(variantB.descriptions ?? [])].join(" ");
  return creativeDifference(textA, textB);
}

function parseMetricsSnapshot(raw: unknown): ExperimentMetrics {
  const out: ExperimentMetrics = {};
  const r = (raw ?? {}) as Record<string, unknown>;
  for (const f of METRIC_FIELDS) {
    const n = asFiniteNumber(r[f]);
    if (n !== undefined) out[f] = n;
  }
  return out;
}

/**
 * Deterministic traffic assignment — verifiable because `splitSeed` is stored
 * on the experiment row. IRON RULE: assignment depends ONLY on the split seed,
 * the split ratio and a stable per-request key (e.g. the click public id).
 * It never looks at user-agent, IP, or any crawler signal.
 */
export function assignVariant(
  splitSeed: string,
  trafficSplitA: number,
  key: string
): "A" | "B" {
  const digest = createHash("sha256")
    .update(`${splitSeed}:${key}`, "utf8")
    .digest();
  const roll = (digest.readUInt16BE(0) / 65536) * 100;
  return roll < trafficSplitA ? "A" : "B";
}

/** Normalize a rate that may be stored as a fraction (0.05) or percent (5). */
function normalizeRate(v: number | undefined): number | undefined {
  if (v === undefined) return undefined;
  const r = v > 1 ? v / 100 : v;
  return Math.min(1, Math.max(0, r));
}

/** Standard normal CDF (Abramowitz & Stegun approximation). */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p =
    d *
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

export interface WinnerVerdict {
  winner: ExperimentWinner;
  /** 0..1 — how confident the call is. */
  confidence: number;
  detail: {
    basis: "profit" | "cvr" | "insufficient_sample";
    clicksA: number;
    clicksB: number;
    conversionsA: number;
    conversionsB: number;
    zScore: number | null;
    note: string;
  };
}

const MIN_CLICKS_PER_VARIANT = 30;

/**
 * Decide a winner from the two metrics snapshots.
 * Primary metric: profit (both sides numeric) → else cvr.
 * Confidence: two-proportion z-test on conversion rates
 * (samples: clicks; conversions derived from cvr).
 * Insufficient sample (< 30 clicks either side) → TIE with low confidence.
 */
export function determineWinner(
  metricsA: ExperimentMetrics,
  metricsB: ExperimentMetrics
): WinnerVerdict {
  const clicksA = asFiniteNumber(metricsA.clicks) ?? 0;
  const clicksB = asFiniteNumber(metricsB.clicks) ?? 0;
  const convRateA = normalizeRate(asFiniteNumber(metricsA.cvr)) ?? 0;
  const convRateB = normalizeRate(asFiniteNumber(metricsB.cvr)) ?? 0;
  const conversionsA = Math.min(
    clicksA,
    Math.round(clicksA * convRateA)
  );
  const conversionsB = Math.min(
    clicksB,
    Math.round(clicksB * convRateB)
  );

  if (clicksA < MIN_CLICKS_PER_VARIANT || clicksB < MIN_CLICKS_PER_VARIANT) {
    return {
      winner: "TIE",
      confidence: 0.15,
      detail: {
        basis: "insufficient_sample",
        clicksA,
        clicksB,
        conversionsA,
        conversionsB,
        zScore: null,
        note: `样本不足：每组至少需要 ${MIN_CLICKS_PER_VARIANT} 次点击，当前 A=${clicksA} / B=${clicksB}`,
      },
    };
  }

  const profitA = asFiniteNumber(metricsA.profit);
  const profitB = asFiniteNumber(metricsB.profit);
  let winner: ExperimentWinner;
  let basis: "profit" | "cvr";
  if (profitA !== undefined && profitB !== undefined) {
    basis = "profit";
    winner = profitA > profitB ? "A" : profitB > profitA ? "B" : "TIE";
  } else {
    basis = "cvr";
    winner =
      convRateA > convRateB ? "A" : convRateB > convRateA ? "B" : "TIE";
  }

  const p1 = conversionsA / clicksA;
  const p2 = conversionsB / clicksB;
  const pooled = (conversionsA + conversionsB) / (clicksA + clicksB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / clicksA + 1 / clicksB));
  let confidence: number;
  let zScore: number | null = null;
  if (se === 0) {
    // No variance at all: either perfectly identical (confident TIE) or an
    // undetectable edge (low confidence in a winner call).
    confidence = winner === "TIE" ? 0.99 : 0.5;
  } else {
    zScore = (p1 - p2) / se;
    const pValue = 2 * (1 - normalCdf(Math.abs(zScore)));
    // For a winner call: 1-p = confidence the difference is real.
    // For a TIE call: p itself = confidence there is no significant difference.
    confidence = winner === "TIE" ? pValue : 1 - pValue;
    confidence = Math.min(0.99, Math.max(0.01, confidence));
    confidence = Math.round(confidence * 100) / 100;
  }

  return {
    winner,
    confidence,
    detail: {
      basis,
      clicksA,
      clicksB,
      conversionsA,
      conversionsB,
      zScore: zScore === null ? null : Math.round(zScore * 100) / 100,
      note:
        winner === "TIE"
          ? "两组指标持平，未分出胜负"
          : `按 ${basis === "profit" ? "利润" : "转化率"} 判定 ${winner} 胜；置信度来自转化率双比例 z 检验`,
    },
  };
}

function toDto(row: ExperimentRow): Record<string, unknown> {
  const iso = (d: string | Date | null | undefined) =>
    d == null ? null : d instanceof Date ? d.toISOString() : d;
  // P1-12：AD_GROUP 实验返回文案差异度 + 是否足够（<50% 为警告，不拦截）。
  let creativeDifferenceValue: number | null = null;
  try {
    const va = row.variantA as ExperimentVariant;
    const vb = row.variantB as ExperimentVariant;
    if (va?.type === "AD_GROUP" && vb?.type === "AD_GROUP") {
      creativeDifferenceValue = variantCreativeDifference(va, vb);
    }
  } catch {
    creativeDifferenceValue = null;
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    offerId: row.offerId,
    name: row.name,
    status: row.status,
    variantA: row.variantA,
    variantB: row.variantB,
    trafficSplitA: row.trafficSplitA,
    splitSeed: row.splitSeed,
    metricsA: row.metricsA,
    metricsB: row.metricsB,
    winner: row.winner,
    confidence: row.confidence,
    preconditionCheck: row.preconditionCheck,
    startedAt: iso(row.startedAt),
    endedAt: iso(row.endedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    experimentType: row.experimentType ?? "LANDING_PAGE",
    seedAdGroupId: row.seedAdGroupId ?? null,
    graduationAction: row.graduationAction ?? "none",
    creativeDifference: creativeDifferenceValue,
    creativeDifferenceSufficient:
      creativeDifferenceValue == null
        ? null
        : creativeDifferenceValue >= MIN_CREATIVE_DIFFERENCE,
    creativeDifferenceWarning:
      creativeDifferenceValue != null &&
      creativeDifferenceValue < MIN_CREATIVE_DIFFERENCE
        ? "创意差异度不足 50%，建议重新生成（警告，不拦截）"
        : null,
  };
}

async function writeExperimentAudit(
  prisma: PrismaClient,
  info: SessionAuthInfo,
  experimentId: string,
  action: string,
  reason: string,
  after: Record<string, unknown>
) {
  await prisma.auditLog.create({
    data: {
      id: randomUUID(),
      tenantId: info.tenantId,
      actorId: info.id,
      action,
      entityType: "Experiment",
      entityId: experimentId,
      before: { id: experimentId } as never,
      after: after as never,
      reason,
      ip: null,
      userAgent: null,
    } as never,
  });
}

async function loadExperiment(
  prisma: PrismaClient,
  tenantId: string,
  id: string
): Promise<ExperimentRow> {
  const row = await experiments(prisma).findFirst({
    where: { id, tenantId, deletedAt: null },
  });
  if (!row) throw new NotFoundError("Experiment not found");
  return row;
}

export async function registerExperimentRoutes(
  app: FastifyInstance,
  deps: ExperimentRouteDeps
): Promise<void> {
  const { prisma } = deps;

  /** Create an experiment (DRAFT). */
  app.post<{
    Body: {
      offerId?: unknown;
      name?: unknown;
      variantA?: unknown;
      variantB?: unknown;
      trafficSplitA?: unknown;
      experimentType?: unknown;
      seedAdGroupId?: unknown;
      graduationAction?: unknown;
    };
  }>("/api/v1/experiments", async (request) => {
    const info = await requireSession(deps, request);
    const body = request.body ?? {};

    const offerId =
      typeof body.offerId === "string" ? body.offerId.trim() : "";
    if (!UUID_RE.test(offerId)) {
      throw new ValidationError("offerId must be a valid UUID");
    }
    const name = asTrimmedString(body.name);
    if (!name) throw new ValidationError("name is required");
    // P1-12：实验类型（默认 LANDING_PAGE；AD_GROUP = 文案 A/B）。
    const experimentTypeRaw =
      typeof body.experimentType === "string"
        ? body.experimentType.trim().toUpperCase()
        : "LANDING_PAGE";
    const experimentType: ExperimentType =
      experimentTypeRaw === "AD_GROUP"
        ? "AD_GROUP"
        : experimentTypeRaw === "DIRECT_LINK"
          ? "DIRECT_LINK"
          : experimentTypeRaw === "LANDING_PAGE"
            ? "LANDING_PAGE"
            : (() => {
                throw new ValidationError(
                  "experimentType must be LANDING_PAGE, DIRECT_LINK or AD_GROUP"
                );
              })();
    const seedAdGroupId =
      typeof body.seedAdGroupId === "string" && UUID_RE.test(body.seedAdGroupId.trim())
        ? body.seedAdGroupId.trim()
        : null;
    if (body.seedAdGroupId !== undefined && body.seedAdGroupId !== null && !seedAdGroupId) {
      throw new ValidationError("seedAdGroupId must be a valid UUID");
    }
    const graduationActionRaw =
      typeof body.graduationAction === "string"
        ? body.graduationAction.trim().toLowerCase()
        : "none";
    const graduationAction: GraduationAction =
      graduationActionRaw === "pause_loser" ? "pause_loser" : graduationActionRaw === "none" ? "none" : (() => {
        throw new ValidationError("graduationAction must be none or pause_loser");
      })();
    const variantA = parseVariant(body.variantA, "A");
    const variantB = parseVariant(body.variantB, "B");
    // P1-12：AD_GROUP 变体类型必须与实验类型一致；LANDING_PAGE/DIRECT_LINK 实验仍用链接变体。
    if (experimentType === "AD_GROUP") {
      if (variantA.type !== "AD_GROUP" || variantB.type !== "AD_GROUP") {
        throw new ValidationError("AD_GROUP experiments require AD_GROUP variants");
      }
    } else if (variantA.type === "AD_GROUP" || variantB.type === "AD_GROUP") {
      throw new ValidationError("AD_GROUP variants require experimentType AD_GROUP");
    }
    // P1-12：AD_GROUP 创意差异度（<50% 警告，不拦截）。
    const creativeDiff = variantCreativeDifference(variantA, variantB);
    let trafficSplitA = 50;
    if (body.trafficSplitA !== undefined && body.trafficSplitA !== null) {
      const n = asFiniteNumber(body.trafficSplitA);
      if (n === undefined || !Number.isInteger(n) || n < 1 || n > 99) {
        throw new ValidationError(
          "trafficSplitA must be an integer between 1 and 99"
        );
      }
      trafficSplitA = n;
    }

    const offer = await prisma.offer.findFirst({
      where: { id: offerId, tenantId: info.tenantId, deletedAt: null },
    });
    if (!offer) throw new NotFoundError("Offer not found");

    // Every variant's tracking link must be bound to this offer.
    // P1-12：AD_GROUP 变体无追踪链接，跳过绑定检查。
    if (experimentType !== "AD_GROUP") {
      for (const v of [variantA, variantB]) {
        if (!v.trackingLinkId) {
          throw new ValidationError(
            `variant ${v.label}: tracking link is required for ${experimentType} experiments`
          );
        }
        const binding = await prisma.trackingLinkOffer.findFirst({
          where: {
            tenantId: info.tenantId,
            offerId,
            trackingLinkId: v.trackingLinkId,
          },
        });
        if (!binding) {
          throw new ValidationError(
            `variant ${v.label}: tracking link ${v.trackingLinkId} is not bound to this offer`
          );
        }
      }
    }

    const row = await experiments(prisma).create({
      data: {
        id: randomUUID(),
        tenantId: info.tenantId,
        offerId,
        name,
        status: "DRAFT",
        variantA: variantA as never,
        variantB: variantB as never,
        trafficSplitA,
        splitSeed: null,
        metricsA: {} as never,
        metricsB: {} as never,
        winner: null,
        confidence: null,
        preconditionCheck: null,
        experimentType,
        seedAdGroupId,
        graduationAction,
      },
    });

    await writeExperimentAudit(
      prisma,
      info,
      row.id,
      "experiment.created",
      `创建实验 ${name}`,
      { name, offerId, trafficSplitA, experimentType, seedAdGroupId, graduationAction, creativeDifference: creativeDiff }
    );
    return toDto(row);
  });

  /** List experiments (tenant-isolated, optional offerId/status filters). */
  app.get<{
    Querystring: { offerId?: string; status?: string };
  }>("/api/v1/experiments", async (request) => {
    const info = await requireSession(deps, request);
    const { offerId, status } = request.query ?? {};
    const where: Record<string, unknown> = {
      tenantId: info.tenantId,
      deletedAt: null,
    };
    if (offerId !== undefined && offerId !== "") {
      if (!UUID_RE.test(offerId)) {
        throw new ValidationError("offerId must be a valid UUID");
      }
      where.offerId = offerId;
    }
    if (status !== undefined && status !== "") {
      const s = status.trim().toUpperCase();
      if (!EXPERIMENT_STATUSES.includes(s as ExperimentStatus)) {
        throw new ValidationError(
          `status must be one of ${EXPERIMENT_STATUSES.join(", ")}`
        );
      }
      where.status = s;
    }
    const rows = await experiments(prisma).findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return { items: rows.map(toDto), total: rows.length };
  });

  /** Experiment detail. */
  app.get<{ Params: { id: string } }>(
    "/api/v1/experiments/:id",
    async (request) => {
      const info = await requireSession(deps, request);
      const row = await loadExperiment(prisma, info.tenantId, request.params.id);
      return toDto(row);
    }
  );

  /** Start an experiment — runs the compliance precondition checks. */
  app.post<{ Params: { id: string } }>(
    "/api/v1/experiments/:id/start",
    async (request) => {
      const info = await requireSession(deps, request);
      const row = await loadExperiment(prisma, info.tenantId, request.params.id);
      if (row.status !== "DRAFT") {
        throw new ValidationError("Only DRAFT experiments can be started");
      }

      const checks: Array<{
        check: string;
        passed: boolean;
        detail: string;
      }> = [];
      const fail = (check: string, detail: string): never => {
        checks.push({ check, passed: false, detail });
        throw new ValidationError(detail);
      };

      // 1. Latest policy scan for this offer.
      const policy = await prisma.offerPolicy.findFirst({
        where: { offerId: row.offerId, tenantId: info.tenantId, deletedAt: null },
        orderBy: { createdAt: "desc" },
      });
      if (!policy) {
        throw new ValidationError(
          "该 offer 尚未做条款扫描（OfferPolicy 缺失），无法确认直链/LP 合规性，请先在 Offer 详情页扫描条款"
        );
      }
      const rules = (policy.rules ?? {}) as Record<string, unknown>;
      const directLinkRule = String(rules.DIRECT_LINK ?? "UNKNOWN").toUpperCase();
      checks.push({
        check: "policy_scan",
        passed: true,
        detail: `使用最新条款扫描结论（DIRECT_LINK=${directLinkRule}）`,
      });

      const variantA = row.variantA as ExperimentVariant;
      const variantB = row.variantB as ExperimentVariant;

      for (const [side, v] of [
        ["A", variantA],
        ["B", variantB],
      ] as const) {
        if (v.type === "DIRECT_LINK") {
          // 2. Direct-link variants need an explicit ALLOWED verdict.
          if (directLinkRule === "FORBIDDEN") {
            fail(
              "direct_link_policy",
              `variant ${side}（${v.label}）为直链，但该 offer 的条款扫描结论为 DIRECT_LINK=FORBIDDEN（直链禁止），不能启动实验`
            );
          }
          if (directLinkRule !== "ALLOWED") {
            fail(
              "direct_link_policy",
              `variant ${side}（${v.label}）为直链，但该 offer 的 DIRECT_LINK 条款结论为 ${directLinkRule}（非明确允许），不能启动实验`
            );
          }
          checks.push({
            check: `direct_link_policy_${side}`,
            passed: true,
            detail: `variant ${side}（${v.label}）直链：条款明确允许（DIRECT_LINK=ALLOWED）`,
          });
        } else {
          // 3. Landing-page variants require the offer to have an active LP
          //    and the variant's tracking link to point at one.
          const lp = await prisma.landingPage.findFirst({
            where: {
              tenantId: info.tenantId,
              offerId: row.offerId,
              status: "ACTIVE",
              deletedAt: null,
            },
            orderBy: { createdAt: "desc" },
          });
          if (!lp) {
            fail(
              "landing_page_binding",
              `variant ${side}（${v.label}）为落地页，但该 offer 没有可用的 LandingPage 绑定，不能启动实验`
            );
          }
          const variantLinkId = v.trackingLinkId;
          if (!variantLinkId) {
            fail(
              "landing_page_binding",
              `variant ${side}（${v.label}）为落地页，但未绑定 tracking link，不能启动实验`
            );
            // fail() 抛错，上句永不返回；写 throw 让 TS 收窄 variantLinkId 为 string。
            throw new Error("unreachable");
          }
          const link = await prisma.trackingLink.findFirst({
            where: { id: variantLinkId, tenantId: info.tenantId },
          });
          const linkLpId = (link as unknown as { landingPageId?: string | null } | null)
            ?.landingPageId;
          if (!linkLpId) {
            fail(
              "landing_page_binding",
              `variant ${side}（${v.label}）为落地页，但其 tracking link 未绑定 LandingPage，不能启动实验`
            );
          }
          checks.push({
            check: `landing_page_binding_${side}`,
            passed: true,
            detail: `variant ${side}（${v.label}）落地页：offer 有可用 LP，tracking link 已绑定 LP`,
          });
        }

        // 4. Tracking link itself must be active.
        // P1-12：AD_GROUP 变体无追踪链接，跳过本检查。
        if (!v.trackingLinkId) {
          continue;
        }
        const linkRow = await prisma.trackingLink.findFirst({
          where: {
            id: v.trackingLinkId,
            tenantId: info.tenantId,
            status: "ACTIVE",
            deletedAt: null,
          },
        });
        if (!linkRow) {
          fail(
            "tracking_link_active",
            `variant ${side}（${v.label}）的 tracking link 不可用（非 ACTIVE 或已删除），不能启动实验`
          );
        }
        checks.push({
          check: `tracking_link_active_${side}`,
          passed: true,
          detail: `variant ${side}（${v.label}）tracking link 为 ACTIVE`,
        });
      }

      const splitSeed = randomBytes(16).toString("hex");
      const startedAt = new Date();
      const preconditionCheck = {
        passedAt: startedAt.toISOString(),
        policyId: (policy as { id?: string }).id ?? null,
        directLinkRule,
        trafficSplitA: row.trafficSplitA,
        checks,
      };
      const updated = await experiments(prisma).update({
        where: { id: row.id },
        data: {
          status: "RUNNING",
          startedAt,
          splitSeed,
          preconditionCheck: preconditionCheck as never,
        },
      });

      await writeExperimentAudit(
        prisma,
        info,
        row.id,
        "experiment.started",
        `启动实验 ${row.name}`,
        { status: "RUNNING", splitSeed, checks: checks.length }
      );
      return toDto(updated);
    }
  );

  /** Submit a metrics snapshot for one variant (RUNNING only). */
  app.post<{
    Params: { id: string };
    Body: { variant?: unknown; metrics?: unknown };
  }>("/api/v1/experiments/:id/metrics", async (request) => {
    const info = await requireSession(deps, request);
    const row = await loadExperiment(prisma, info.tenantId, request.params.id);
    if (row.status !== "RUNNING") {
      throw new ValidationError("Metrics can only be submitted for RUNNING experiments");
    }
    const body = request.body ?? {};
    const variant =
      typeof body.variant === "string" ? body.variant.trim().toUpperCase() : "";
    if (variant !== "A" && variant !== "B") {
      throw new ValidationError('variant must be "A" or "B"');
    }
    const snapshot = parseMetricsSnapshot(body.metrics);
    const field = variant === "A" ? "metricsA" : "metricsB";
    const updated = await experiments(prisma).update({
      where: { id: row.id },
      data: { [field]: snapshot as never },
    });

    await writeExperimentAudit(
      prisma,
      info,
      row.id,
      "experiment.metrics",
      `录入实验 ${row.name} variant ${variant} 指标`,
      { variant, metrics: snapshot }
    );
    return toDto(updated);
  });

  /** Complete an experiment — decides the winner from metrics snapshots. */
  app.post<{ Params: { id: string } }>(
    "/api/v1/experiments/:id/complete",
    async (request) => {
      const info = await requireSession(deps, request);
      const row = await loadExperiment(prisma, info.tenantId, request.params.id);
      if (row.status !== "RUNNING") {
        throw new ValidationError("Only RUNNING experiments can be completed");
      }
      const verdict = determineWinner(
        parseMetricsSnapshot(row.metricsA),
        parseMetricsSnapshot(row.metricsB)
      );
      const updated = await experiments(prisma).update({
        where: { id: row.id },
        data: {
          status: "COMPLETED",
          endedAt: new Date(),
          winner: verdict.winner,
          confidence: verdict.confidence,
        },
      });

      await writeExperimentAudit(
        prisma,
        info,
        row.id,
        "experiment.completed",
        `结束实验 ${row.name}，winner=${verdict.winner}`,
        { winner: verdict.winner, confidence: verdict.confidence, detail: verdict.detail }
      );
      return { ...toDto(updated), winnerDetail: verdict.detail };
    }
  );

  /**
   * P1-12：毕业（仅 COMPLETED 且已分出胜负）。
   * graduationAction=pause_loser 时：不直接暂停任何广告，只记录
   * EXPERIMENT_GRADUATION_REQUESTED 审计 + 返回 Script 渠道操作指引；
   * 实际暂停走 Script 渠道 + 人工确认。TIE 时不毕业。
   */
  app.post<{ Params: { id: string } }>(
    "/api/v1/experiments/:id/graduate",
    async (request) => {
      const info = await requireSession(deps, request);
      const row = await loadExperiment(prisma, info.tenantId, request.params.id);
      if (row.status !== "COMPLETED") {
        throw new ValidationError("Only COMPLETED experiments can graduate");
      }
      if (row.winner !== "A" && row.winner !== "B") {
        throw new ValidationError("TIE experiments cannot graduate (no winner)");
      }
      const loser = row.winner === "A" ? "B" : "A";
      const graduationAction = row.graduationAction ?? "none";
      await writeExperimentAudit(
        prisma,
        info,
        row.id,
        "experiment.graduation_requested",
        `毕业实验 ${row.name}，winner=${row.winner}，graduationAction=${graduationAction}`,
        { winner: row.winner, loser, graduationAction }
      );
      return {
        ...toDto(row),
        graduation: {
          winner: row.winner,
          loser,
          action: graduationAction,
          requiresManualConfirmation: graduationAction === "pause_loser",
          scriptInstructions:
            graduationAction === "pause_loser"
              ? `请在 Google Ads 中手动确认后，通过 Script 渠道暂停失败变体 ${loser} 对应的广告/广告组（本系统不直接操作广告状态）。`
              : "毕业动作 = none，无需操作。",
          abuseNote:
            "同一广告反复投放同一 ADS 属于滥用（禁止）；3 创意 A/B 需每对差异度 ≥ 50%。",
        },
      };
    }
  );

  /** Cancel an experiment (DRAFT/RUNNING only). */
  app.post<{ Params: { id: string } }>(
    "/api/v1/experiments/:id/cancel",
    async (request) => {
      const info = await requireSession(deps, request);
      const row = await loadExperiment(prisma, info.tenantId, request.params.id);
      if (row.status !== "DRAFT" && row.status !== "RUNNING") {
        throw new ValidationError("Only DRAFT or RUNNING experiments can be cancelled");
      }
      const updated = await experiments(prisma).update({
        where: { id: row.id },
        data: { status: "CANCELLED", endedAt: new Date() },
      });

      await writeExperimentAudit(
        prisma,
        info,
        row.id,
        "experiment.cancelled",
        `取消实验 ${row.name}`,
        { from: row.status, to: "CANCELLED" }
      );
      return toDto(updated);
    }
  );
}
