/**
 * 投放档案（LaunchArchive）API。
 *
 * 一次投放的完整档案：决策、条款、出价、文案、投后数据。确认广告计划后
 * 自动建档（draft）；投后在档案里回填 impressions/clicks/spend 等，诊断
 * 出价与展示问题（出价低于官方推荐且无展示 → 建议提价，等）。
 *
 * - POST   /api/v1/launch-archives          手动建档
 * - GET    /api/v1/launch-archives          列表（from/to/network/status/decision/offerId + 分页）
 * - GET    /api/v1/launch-archives/export    CSV 导出（同列表过滤条件）
 * - GET    /api/v1/launch-archives/:id       详情
 * - PATCH  /api/v1/launch-archives/:id       只改决策/出价/投后数据等白名单字段
 * - DELETE /api/v1/launch-archives/:id
 *
 * Session auth + tenant 隔离。响应每条档案都带派生字段
 * actualCpc / actualCvr / actualRoi / profit / diagnosis（同一份计算）。
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import { parseScalingPhase, parseTestingPhase } from "../services/staged-budget.js";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";

export interface LaunchArchiveRouteDeps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: LaunchArchiveRouteDeps,
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

function asOptionalNumber(v: unknown, field: string): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "string" ? Number(v.trim()) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new ValidationError(`${field} must be a finite number`);
  }
  return n;
}

function asOptionalInt(v: unknown, field: string): number | undefined {
  const n = asOptionalNumber(v, field);
  if (n === undefined) return undefined;
  if (!Number.isInteger(n)) {
    throw new ValidationError(`${field} must be an integer`);
  }
  return n;
}

function asOptionalDate(v: unknown, field: string): Date | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") {
    throw new ValidationError(`${field} must be an ISO date string`);
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError(`${field} must be an ISO date string`);
  }
  return d;
}

function asOptionalStringArray(v: unknown, field: string): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
    throw new ValidationError(`${field} must be an array of strings`);
  }
  return v.map((s) => s.trim()).filter(Boolean);
}

function asOptionalAdCopy(v: unknown): { headlines: string[]; descriptions: string[] } | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) {
    throw new ValidationError("adCopy must be an object { headlines, descriptions }");
  }
  const o = v as Record<string, unknown>;
  const headlines = asOptionalStringArray(o.headlines, "adCopy.headlines") ?? [];
  const descriptions = asOptionalStringArray(o.descriptions, "adCopy.descriptions") ?? [];
  return { headlines, descriptions };
}

const DECISIONS = ["go", "goWithWarn", "noGo", "incomplete"] as const;
const STATUSES = ["draft", "running", "paused", "ended"] as const;

function asEnum(
  v: unknown,
  allowed: readonly string[],
  field: string
): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const s = asTrimmedString(v);
  if (!s || !(allowed as readonly string[]).includes(s)) {
    throw new ValidationError(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return s;
}

function asCurrency(v: unknown): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const c = String(v).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) {
    throw new ValidationError("budgetCurrency must be a 3-letter currency code");
  }
  return c;
}

function asOptionalUuid(v: unknown, field: string): string | undefined {
  const s = asTrimmedString(v);
  if (s === undefined) return undefined;
  if (!UUID_RE.test(s)) {
    throw new ValidationError(`${field} must be a UUID`);
  }
  return s;
}

// ---------------------------------------------------------------------------
// 派生指标 + 诊断：唯一计算入口，list/detail/export 三处共用。
// ---------------------------------------------------------------------------

export interface ArchiveDerivedInput {
  impressions?: number | null;
  clicks?: number | null;
  spend?: number | null;
  conversions?: number | null;
  revenue?: number | null;
  myBid?: number | null;
  officialBid?: number | null;
  /** P2-6：预算耗尽判定用（testingPhase.totalBudget；未设置则不判）。 */
  testingPhase?: unknown;
  /** P2-6：质量得分（1–10）。LaunchArchive 目前无此列 → 不传则绝不触发，绝不编造。 */
  qualityScore?: number | null;
  /** P2-6：NO_IMPRESSIONS 仅对已上线（launchedAt 已设）且展示为 0 的档案触发。 */
  launchedAt?: Date | string | null;
}

export interface ArchiveDerived {
  actualCpc: number | null;
  actualCvr: number | null;
  actualRoi: number | null;
  profit: number | null;
  diagnosis: string;
  /**
   * P1-29：CTR（点击率 = clicks / impressions）。仅当累计展示 ≥100 时统计；
   * 展示 <100 时为 null（样本不足，暂不统计 CTR，小样本不判）。
   */
  actualCtr: number | null;
  /** P1-29：展示是否达到 CTR 统计门槛（≥100 次）。 */
  ctrSampleSufficient: boolean;
  /** P1-29：CTR 样本不足时的说明（展示 <100 时非 null）。 */
  ctrNote: string | null;
  /**
   * P2-6：诊断码（统一阈值，见 DIAGNOSIS_THRESHOLDS；仅真实数据触发，绝不编造）。
   * 与 diagnosis 文案并存：文案给人读，码给筛选/聚合用。
   */
  diagnosisCodes: DiagnosisCode[];
}

/**
 * P2-6：诊断码 + 统一阈值（唯一口径；不照搬培训站不一致的 0.5 vs 0.8 / QS 5 vs 6）。
 * - LOW_CTR：CTR < 5%（讲师经验）且样本充足（展示 ≥100，与 P1-29 同门槛）。
 * - LOW_QUALITY_SCORE：质量得分 < 5（1–10 分制）。档案无 QS 列 → 无数据时绝不触发。
 * - BUDGET_EXHAUSTED：spend ≥ testingPhase.totalBudget（未设 totalBudget 则不判）。
 * - NO_CONVERSIONS：clicks > 0 且 conversions === 0。
 * - NO_IMPRESSIONS：已上线（launchedAt 已设）且 impressions === 0。
 */
export type DiagnosisCode =
  | "NO_IMPRESSIONS"
  | "LOW_CTR"
  | "LOW_QUALITY_SCORE"
  | "BUDGET_EXHAUSTED"
  | "NO_CONVERSIONS";

export const DIAGNOSIS_THRESHOLDS = {
  lowCtr: 0.05, // 与 CTR_BENCHMARKS.poor 同值（此处用字面量，避免 TDZ：CTR_BENCHMARKS 在下方定义）
  lowQualityScore: 5,
} as const;

export const DIAGNOSIS_CODE_LABELS: Record<DiagnosisCode, string> = {
  NO_IMPRESSIONS: "无展示",
  LOW_CTR: "CTR 偏低（<5%，讲师经验）",
  LOW_QUALITY_SCORE: "质量得分偏低（<5）",
  BUDGET_EXHAUSTED: "预算耗尽",
  NO_CONVERSIONS: "有点击无转化",
};

/** P1-29：CTR 统计最低累计展示次数（新站实测 + 视频经验口径）。 */
export const CTR_MIN_IMPRESSIONS = 100;

/** P1-29：CTR 诊断基准（讲师经验，非平台官方标准）。 */
export const CTR_BENCHMARKS = {
  poor: 0.05,
  good: 0.1,
} as const;

/**
 * P1-29：CTR 基准文案（讲师经验：<5% 差 / 5%–10% 一般 / ≥10% 舒服）。
 * 仅在样本充足时调用；样本不足时返回 null。
 */
export function ctrBenchmarkLabel(ctr: number | null): string | null {
  if (ctr === null || !Number.isFinite(ctr)) return null;
  if (ctr < CTR_BENCHMARKS.poor) return "CTR 低于 5%（偏低，讲师经验）";
  if (ctr < CTR_BENCHMARKS.good) return "CTR 5%–10%（一般，讲师经验）";
  return "CTR ≥ 10%（舒服，讲师经验）";
}

/**
 * 派生指标 + 诊断（唯一计算入口）。
 * impressions/clicks 为 null 时按 0 处理（无数据即无展示）。
 * 诊断优先级按顺序取第一条命中。
 */
export function deriveArchiveMetrics(input: ArchiveDerivedInput): ArchiveDerived {
  const impressions = input.impressions ?? 0;
  const clicks = input.clicks ?? 0;
  const spend = input.spend ?? null;
  const conversions = input.conversions ?? null;
  const revenue = input.revenue ?? null;

  const actualCpc = spend !== null && clicks > 0 ? spend / clicks : null;
  const actualCvr =
    conversions !== null && clicks > 0 ? conversions / clicks : null;
  const actualRoi =
    spend !== null && revenue !== null && spend > 0
      ? (revenue - spend) / spend
      : null;
  const profit =
    spend !== null && revenue !== null ? revenue - spend : null;

  // P1-29：CTR 只对累计展示 ≥100 的档案统计；小样本不判。
  const ctrSampleSufficient = impressions >= CTR_MIN_IMPRESSIONS;
  const actualCtr =
    ctrSampleSufficient && impressions > 0 ? clicks / impressions : null;
  const ctrNote =
    impressions > 0 && !ctrSampleSufficient
      ? `样本不足（展示 ${impressions} < ${CTR_MIN_IMPRESSIONS}），暂不统计 CTR`
      : null;

  let diagnosis: string;
  if (
    impressions === 0 &&
    input.myBid != null &&
    input.officialBid != null &&
    input.myBid < input.officialBid
  ) {
    diagnosis = "出价低于官方推荐且无展示，建议提高出价至官方推荐附近";
  } else if (impressions === 0) {
    diagnosis = "无展示但出价不低于官方推荐，检查关键词/广告状态/预算/审核";
  } else if (spend !== null && spend > 0 && revenue !== null && revenue < spend) {
    diagnosis = "亏损（ROI为负），建议降低出价或停投";
  } else if (spend !== null && spend > 0 && revenue !== null && revenue > spend) {
    diagnosis = "盈利，可考虑加预算/适当提价抢量";
  } else if (clicks > 0 && conversions === 0) {
    diagnosis = "有点击无转化，检查落地页/Offer转化";
  } else {
    diagnosis = "数据不足，暂无诊断";
  }

  return {
    actualCpc,
    actualCvr,
    actualRoi,
    profit,
    diagnosis,
    actualCtr,
    ctrSampleSufficient,
    ctrNote,
    diagnosisCodes: deriveDiagnosisCodes(input, {
      impressions,
      clicks,
      conversions,
      actualCtr,
      ctrSampleSufficient,
      spend,
    }),
  };
}

/** P2-6：诊断码计算（纯函数，仅真实数据触发）。 */
function deriveDiagnosisCodes(
  input: ArchiveDerivedInput,
  m: {
    impressions: number;
    clicks: number;
    conversions: number | null;
    actualCtr: number | null;
    ctrSampleSufficient: boolean;
    spend: number | null;
  }
): DiagnosisCode[] {
  const codes: DiagnosisCode[] = [];
  if (input.launchedAt && m.impressions === 0) codes.push("NO_IMPRESSIONS");
  if (
    m.ctrSampleSufficient &&
    m.actualCtr !== null &&
    m.actualCtr < DIAGNOSIS_THRESHOLDS.lowCtr
  ) {
    codes.push("LOW_CTR");
  }
  if (
    typeof input.qualityScore === "number" &&
    Number.isFinite(input.qualityScore) &&
    input.qualityScore < DIAGNOSIS_THRESHOLDS.lowQualityScore
  ) {
    codes.push("LOW_QUALITY_SCORE");
  }
  const testingPhase =
    input.testingPhase && typeof input.testingPhase === "object"
      ? (input.testingPhase as Record<string, unknown>)
      : null;
  const totalBudget =
    typeof testingPhase?.totalBudget === "number" ? testingPhase.totalBudget : null;
  if (
    m.spend !== null &&
    totalBudget !== null &&
    totalBudget > 0 &&
    m.spend >= totalBudget
  ) {
    codes.push("BUDGET_EXHAUSTED");
  }
  if (m.clicks > 0 && m.conversions === 0) codes.push("NO_CONVERSIONS");
  return codes;
}

type LaunchArchiveRow = {
  id: string;
  tenantId: string;
  offerId: string | null;
  offerName: string;
  network: string;
  offerUrl: string | null;
  decision: string | null;
  decisionReason: string | null;
  termsBrandBidding: string | null;
  termsDirectLinking: string | null;
  termsSummary: string | null;
  payout: number | null;
  epc: number | null;
  breakevenCpc: number | null;
  breakevenCvrPct: number | null;
  recommendedBid: number | null;
  myBid: number | null;
  officialBid: number | null;
  dailyBudget: number | null;
  budgetCurrency: string;
  keywords: unknown;
  adCopy: unknown;
  /** P1-4：分阶段预算（JSONB，null = 未设置）。 */
  testingPhase?: unknown;
  scalingPhase?: unknown;
  impressions: number | null;
  clicks: number | null;
  spend: number | null;
  conversions: number | null;
  revenue: number | null;
  status: string;
  notes: string | null;
  launchedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function serializeArchive(row: LaunchArchiveRow) {
  const derived = deriveArchiveMetrics(row);
  return {
    id: row.id,
    tenantId: row.tenantId,
    offerId: row.offerId,
    offerName: row.offerName,
    network: row.network,
    offerUrl: row.offerUrl,
    decision: row.decision,
    decisionReason: row.decisionReason,
    termsBrandBidding: row.termsBrandBidding,
    termsDirectLinking: row.termsDirectLinking,
    termsSummary: row.termsSummary,
    payout: row.payout,
    epc: row.epc,
    breakevenCpc: row.breakevenCpc,
    breakevenCvrPct: row.breakevenCvrPct,
    recommendedBid: row.recommendedBid,
    myBid: row.myBid,
    officialBid: row.officialBid,
    dailyBudget: row.dailyBudget,
    budgetCurrency: row.budgetCurrency,
    keywords: row.keywords,
    adCopy: row.adCopy,
    testingPhase: row.testingPhase ?? null,
    scalingPhase: row.scalingPhase ?? null,
    impressions: row.impressions,
    clicks: row.clicks,
    spend: row.spend,
    conversions: row.conversions,
    revenue: row.revenue,
    status: row.status,
    notes: row.notes,
    launchedAt: row.launchedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...derived,
  };
}

function parseDateFilter(
  v: unknown,
  field: string
): { date: Date; endOfDay: boolean } | undefined {
  const s = asTrimmedString(v);
  if (!s) return undefined;
  // YYYY-MM-DD（列表过滤用日期，不含时间）。
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new ValidationError(`${field} must be YYYY-MM-DD`);
  }
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError(`${field} must be a valid date`);
  }
  return { date: d, endOfDay: field === "to" };
}

function buildListWhere(
  tenantId: string,
  query: Record<string, unknown>
): Record<string, unknown> {
  const where: Record<string, unknown> = { tenantId };
  const from = parseDateFilter(query.from, "from");
  const to = parseDateFilter(query.to, "to");
  if (from || to) {
    const createdAt: Record<string, unknown> = {};
    if (from) createdAt.gte = from.date;
    if (to) {
      // to 当天 24:00 之前都算（包含 to 当天整天）。
      createdAt.lt = new Date(to.date.getTime() + 24 * 60 * 60 * 1000);
    }
    where.createdAt = createdAt;
  }
  const network = asTrimmedString(query.network);
  if (network) where.network = network;
  const status = asTrimmedString(query.status);
  if (status) where.status = status;
  const decision = asTrimmedString(query.decision);
  if (decision) where.decision = decision;
  const offerId = asOptionalUuid(query.offerId, "offerId");
  if (offerId) where.offerId = offerId;
  return where;
}

function csvEscape(v: string | null | undefined): string {
  const s = v ?? "";
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_COLUMNS = [
  "id",
  "offerId",
  "offerName",
  "network",
  "offerUrl",
  "decision",
  "decisionReason",
  "termsBrandBidding",
  "termsDirectLinking",
  "termsSummary",
  "payout",
  "epc",
  "breakevenCpc",
  "breakevenCvrPct",
  "recommendedBid",
  "myBid",
  "officialBid",
  "dailyBudget",
  "budgetCurrency",
  "keywords",
  "adCopy",
  "impressions",
  "clicks",
  "spend",
  "conversions",
  "revenue",
  "actualCpc",
  "actualCvrPct",
  "actualRoiPct",
  "actualCtrPct",
  "profit",
  "diagnosis",
  "status",
  "notes",
  "launchedAt",
  "endedAt",
  "createdAt",
  "updatedAt",
] as const;

function archiveToCsvRow(a: ReturnType<typeof serializeArchive>): string[] {
  const num = (v: number | null | undefined) =>
    v === null || v === undefined ? "" : String(v);
  /** Ratios (actualCvr/actualRoi) are written as percentages in CSV for readability. */
  const pct = (v: number | null | undefined) =>
    v === null || v === undefined ? "" : String(Math.round(v * 10000) / 100);
  const str = (v: string | null | undefined) => v ?? "";
  const json = (v: unknown) => (v === null || v === undefined ? "" : JSON.stringify(v));
  return [
    a.id,
    str(a.offerId),
    a.offerName,
    a.network,
    str(a.offerUrl),
    str(a.decision),
    str(a.decisionReason),
    str(a.termsBrandBidding),
    str(a.termsDirectLinking),
    str(a.termsSummary),
    num(a.payout),
    num(a.epc),
    num(a.breakevenCpc),
    num(a.breakevenCvrPct),
    num(a.recommendedBid),
    num(a.myBid),
    num(a.officialBid),
    num(a.dailyBudget),
    a.budgetCurrency,
    json(a.keywords),
    json(a.adCopy),
    num(a.impressions),
    num(a.clicks),
    num(a.spend),
    num(a.conversions),
    num(a.revenue),
    num(a.actualCpc),
    pct(a.actualCvr),
    pct(a.actualRoi),
    pct(a.actualCtr),
    num(a.profit),
    a.diagnosis,
    a.status,
    str(a.notes),
    str(a.launchedAt),
    str(a.endedAt),
    a.createdAt,
    a.updatedAt,
  ];
}

export async function registerLaunchArchiveRoutes(
  app: FastifyInstance,
  deps: LaunchArchiveRouteDeps
): Promise<void> {
  const { prisma } = deps;

  /** POST /api/v1/launch-archives — 手动建档。 */
  app.post<{ Body: Record<string, unknown> }>(
    "/api/v1/launch-archives",
    async (request) => {
      const info = await requireSession(deps, request);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const offerName = asTrimmedString(body.offerName);
      if (!offerName) throw new ValidationError("offerName is required");
      const network = asTrimmedString(body.network);
      if (!network) throw new ValidationError("network is required");
      const row = await prisma.launchArchive.create({
        data: {
          id: randomUUID(),
          tenantId: info.tenantId,
          offerId: asOptionalUuid(body.offerId, "offerId") ?? null,
          offerName,
          network,
          offerUrl: asTrimmedString(body.offerUrl) ?? null,
          decision: asEnum(body.decision, DECISIONS, "decision") ?? null,
          decisionReason: asTrimmedString(body.decisionReason) ?? null,
          termsBrandBidding: asTrimmedString(body.termsBrandBidding) ?? null,
          termsDirectLinking: asTrimmedString(body.termsDirectLinking) ?? null,
          termsSummary: asTrimmedString(body.termsSummary) ?? null,
          payout: asOptionalNumber(body.payout, "payout") ?? null,
          epc: asOptionalNumber(body.epc, "epc") ?? null,
          breakevenCpc: asOptionalNumber(body.breakevenCpc, "breakevenCpc") ?? null,
          breakevenCvrPct:
            asOptionalNumber(body.breakevenCvrPct, "breakevenCvrPct") ?? null,
          recommendedBid:
            asOptionalNumber(body.recommendedBid, "recommendedBid") ?? null,
          myBid: asOptionalNumber(body.myBid, "myBid") ?? null,
          officialBid: asOptionalNumber(body.officialBid, "officialBid") ?? null,
          dailyBudget: asOptionalNumber(body.dailyBudget, "dailyBudget") ?? null,
          budgetCurrency: asCurrency(body.budgetCurrency) ?? "USD",
          keywords: asOptionalStringArray(body.keywords, "keywords") ?? [],
          adCopy: asOptionalAdCopy(body.adCopy) ?? { headlines: [], descriptions: [] },
          impressions: asOptionalInt(body.impressions, "impressions") ?? null,
          clicks: asOptionalInt(body.clicks, "clicks") ?? null,
          spend: asOptionalNumber(body.spend, "spend") ?? null,
          conversions: asOptionalInt(body.conversions, "conversions") ?? null,
          revenue: asOptionalNumber(body.revenue, "revenue") ?? null,
          status: asEnum(body.status, STATUSES, "status") ?? "draft",
          notes: asTrimmedString(body.notes) ?? null,
          launchedAt: asOptionalDate(body.launchedAt, "launchedAt") ?? null,
          endedAt: asOptionalDate(body.endedAt, "endedAt") ?? null,
        },
      });
      return serializeArchive(row as LaunchArchiveRow);
    }
  );

  /** GET /api/v1/launch-archives — 列表（过滤 + 分页）。 */
  app.get<{ Querystring: Record<string, string> }>(
    "/api/v1/launch-archives",
    async (request) => {
      const info = await requireSession(deps, request);
      const page = Math.max(1, Number(request.query.page) || 1);
      const pageSize = Math.min(
        100,
        Math.max(1, Number(request.query.pageSize) || 20)
      );
      const where = buildListWhere(
        info.tenantId,
        request.query as Record<string, unknown>
      );
      const [rows, total] = await Promise.all([
        prisma.launchArchive.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        prisma.launchArchive.count({ where }),
      ]);
      return {
        items: rows.map((r) => serializeArchive(r as LaunchArchiveRow)),
        total,
        page,
        pageSize,
      };
    }
  );

  /** GET /api/v1/launch-archives/export — CSV 导出（同列表过滤条件）。 */
  app.get<{ Querystring: Record<string, string> }>(
    "/api/v1/launch-archives/export",
    async (request, reply) => {
      const info = await requireSession(deps, request);
      const where = buildListWhere(
        info.tenantId,
        request.query as Record<string, unknown>
      );
      const rows = await prisma.launchArchive.findMany({
        where,
        take: 5000,
        orderBy: { createdAt: "desc" },
      });
      const lines = [
        CSV_COLUMNS.map(csvEscape).join(","),
        ...rows.map((r) =>
          archiveToCsvRow(serializeArchive(r as LaunchArchiveRow))
            .map(csvEscape)
            .join(",")
        ),
      ];
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header(
          "content-disposition",
          'attachment; filename="launch-archives.csv"'
        )
        .send(lines.join("\n"));
    }
  );

  /** GET /api/v1/launch-archives/:id — 详情。 */
  app.get<{ Params: { id: string } }>(
    "/api/v1/launch-archives/:id",
    async (request) => {
      const info = await requireSession(deps, request);
      const row = await prisma.launchArchive.findFirst({
        where: { id: request.params.id, tenantId: info.tenantId },
      });
      if (!row) throw new NotFoundError("LaunchArchive", request.params.id);
      return serializeArchive(row as LaunchArchiveRow);
    }
  );

  /**
   * PATCH /api/v1/launch-archives/:id — 只改白名单字段。
   * 快照字段（keywords/adCopy/payout 等）建档后不改；投后数据/出价/状态可改。
   */
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/v1/launch-archives/:id",
    async (request) => {
      const info = await requireSession(deps, request);
      const existing = await prisma.launchArchive.findFirst({
        where: { id: request.params.id, tenantId: info.tenantId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("LaunchArchive", request.params.id);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const data: Record<string, unknown> = {};
      const setIf = (key: string, v: unknown) => {
        if (v !== undefined) data[key] = v;
      };
      const decision = asEnum(body.decision, DECISIONS, "decision");
      if (decision !== undefined) data.decision = decision;
      // Offer 身份字段：仅 body 明确带了非空值才改（Web 省略 = 不改；空值不清空，避免必填字段设 null）。
      if (body.offerName !== undefined) {
        const v = asTrimmedString(body.offerName);
        if (v) data.offerName = v;
      }
      if (body.network !== undefined) {
        const v = asTrimmedString(body.network);
        if (v) data.network = v;
      }
      setIf("decisionReason", asTrimmedString(body.decisionReason) ?? null);
      setIf("termsBrandBidding", asTrimmedString(body.termsBrandBidding) ?? null);
      setIf("termsDirectLinking", asTrimmedString(body.termsDirectLinking) ?? null);
      setIf("termsSummary", asTrimmedString(body.termsSummary) ?? null);
      if (body.myBid !== undefined) {
        data.myBid = asOptionalNumber(body.myBid, "myBid") ?? null;
      }
      if (body.officialBid !== undefined) {
        data.officialBid = asOptionalNumber(body.officialBid, "officialBid") ?? null;
      }
      if (body.impressions !== undefined) {
        data.impressions = asOptionalInt(body.impressions, "impressions") ?? null;
      }
      if (body.clicks !== undefined) {
        data.clicks = asOptionalInt(body.clicks, "clicks") ?? null;
      }
      if (body.spend !== undefined) {
        data.spend = asOptionalNumber(body.spend, "spend") ?? null;
      }
      if (body.conversions !== undefined) {
        data.conversions = asOptionalInt(body.conversions, "conversions") ?? null;
      }
      if (body.revenue !== undefined) {
        data.revenue = asOptionalNumber(body.revenue, "revenue") ?? null;
      }
      const status = asEnum(body.status, STATUSES, "status");
      if (status !== undefined) data.status = status;
      // P1-4：分阶段预算（校验后存 JSON；null = 清空）。
      if (body.testingPhase !== undefined) {
        if (body.testingPhase === null) {
          data.testingPhase = null;
        } else {
          try {
            data.testingPhase = parseTestingPhase(body.testingPhase);
          } catch (e) {
            throw new ValidationError((e as Error).message);
          }
        }
      }
      if (body.scalingPhase !== undefined) {
        if (body.scalingPhase === null) {
          data.scalingPhase = null;
        } else {
          try {
            data.scalingPhase = parseScalingPhase(body.scalingPhase);
          } catch (e) {
            throw new ValidationError((e as Error).message);
          }
        }
      }
      setIf("notes", asTrimmedString(body.notes) ?? null);
      if (body.launchedAt !== undefined) {
        data.launchedAt = asOptionalDate(body.launchedAt, "launchedAt") ?? null;
      }
      if (body.endedAt !== undefined) {
        data.endedAt = asOptionalDate(body.endedAt, "endedAt") ?? null;
      }
      const row = await prisma.launchArchive.update({
        where: { id: request.params.id },
        data,
      });
      return serializeArchive(row as LaunchArchiveRow);
    }
  );

  /** DELETE /api/v1/launch-archives/:id */
  app.delete<{ Params: { id: string } }>(
    "/api/v1/launch-archives/:id",
    async (request) => {
      const info = await requireSession(deps, request);
      const existing = await prisma.launchArchive.findFirst({
        where: { id: request.params.id, tenantId: info.tenantId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("LaunchArchive", request.params.id);
      await prisma.launchArchive.delete({ where: { id: request.params.id } });
      return { id: request.params.id, deleted: true };
    }
  );
}

// ---------------------------------------------------------------------------
// 确认计划后自动建档（ads-auto confirm 调用；失败静默，绝不让确认失败）。
// ---------------------------------------------------------------------------

export interface AutoArchivePlanInput {
  planId: string;
  offerId: string | null;
  campaignName: string;
  dailyBudgetAmount: number;
  dailyBudgetCurrency: string;
  /** 出价 = 系列 maxCpc，缺失时取第一个广告组 maxCpc。 */
  campaignMaxCpc: number | null;
  firstAdGroupMaxCpc: number | null;
  keywords: string[];
  headlines: string[];
  descriptions: string[];
  finalUrl: string | null;
}

/**
 * 从确认的计划 + Offer 实体 + 投流快照推导档案字段。
 * payout：Offer 实体派生（百分比 = 均价 × 佣金率；固定 = 佣金值），缺失时取投流快照 payout。
 * CVR：投流快照 networkCvr。epc = payout × CVR；breakevenCpc = epc；
 * recommendedBid = EPC ÷ (1 + 目标 ROI)，目标 ROI 默认 100% 即 EPC/2。
 */
export function buildAutoArchiveData(input: {
  plan: AutoArchivePlanInput;
  offer: {
    name?: string | null;
    network?: string | null;
    destinationUrl?: string | null;
    commissionType?: string | null;
    commissionValue?: number | null;
    avgPrice?: number | null;
  } | null;
  plannerSnapshot: Record<string, unknown> | null;
}) {
  const { plan, offer, plannerSnapshot } = input;
  const num = (v: unknown): number | null => {
    const n = typeof v === "string" ? Number(v.trim()) : v;
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
  };

  // payout：Offer 实体优先，缺失时取投流快照。
  let payout: number | null = null;
  if (offer) {
    const cv = offer.commissionValue;
    if (cv !== null && cv !== undefined && Number.isFinite(cv) && cv > 0) {
      if (offer.commissionType === "fixed") {
        payout = cv;
      } else if (offer.commissionType === "percentage") {
        const avg = offer.avgPrice;
        payout =
          avg !== null && avg !== undefined && Number.isFinite(avg) && avg > 0
            ? (avg * cv) / 100
            : null;
      }
    }
  }
  if (payout === null) {
    payout = num(plannerSnapshot?.payout);
  }
  const cvrPct = num(plannerSnapshot?.networkCvr);
  const cvr = cvrPct !== null ? cvrPct / 100 : null;
  const epc = payout !== null && cvr !== null ? payout * cvr : null;
  const recommendedBid = epc !== null ? epc / 2 : null; // 目标 ROI 默认 100%

  const myBid = plan.campaignMaxCpc ?? plan.firstAdGroupMaxCpc ?? null;

  return {
    offerId: plan.offerId,
    offerName: offer?.name?.trim() || plan.campaignName,
    network: offer?.network?.trim() || "manual",
    offerUrl: plan.finalUrl ?? offer?.destinationUrl ?? null,
    decision: null as string | null,
    decisionReason: null as string | null,
    termsBrandBidding: null as string | null,
    termsDirectLinking: null as string | null,
    termsSummary: null as string | null,
    payout,
    epc,
    breakevenCpc: epc,
    breakevenCvrPct: null as number | null,
    recommendedBid,
    myBid,
    officialBid: null as number | null,
    dailyBudget: plan.dailyBudgetAmount,
    budgetCurrency: plan.dailyBudgetCurrency,
    keywords: plan.keywords,
    adCopy: { headlines: plan.headlines, descriptions: plan.descriptions },
    impressions: null as number | null,
    clicks: null as number | null,
    spend: null as number | null,
    conversions: null as number | null,
    revenue: null as number | null,
    status: "draft",
    notes: null as string | null,
    launchedAt: null as Date | null,
    endedAt: null as Date | null,
  };
}
