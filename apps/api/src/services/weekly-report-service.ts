/**
 * Automation round 2 — weekly report service.
 *
 * - generateWeeklyReport: aggregates one tenant's weekly stats
 *   (clicks excluding test clicks, conversions + revenue, top-5 offers,
 *   alerts, dead links, applied negatives, new LP optimization tasks),
 *   asks the LLM for a Chinese/Egnlish narrative (no fabricated numbers;
 *   spend is reported as missing), and persists a WeeklyReport row
 *   (upsert by tenantId/weekStart/weekEnd so scheduled + manual runs
 *   stay idempotent).
 * - listWeeklyReports / getWeeklyReport: route-layer reads (tenant-scoped).
 * - sendViaEmail: reserved for future email delivery — NOT implemented.
 *
 * All operations are tenant-scoped. chatJsonImpl / llmSettings are
 * injectable for unit tests (no network, no crypto in tests).
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import { AppError, NotFoundError, ValidationError } from "@adlinklab/shared";
import {
  AiError,
  chatJson,
  chatJsonValidated,
  type ChatJsonArgs,
} from "../ai/llm.js";
import {
  assertAiSettingsPepperConfigured,
  decryptSecret,
} from "../ai/crypto.js";

export const WEEKLY_REPORT_TIMEZONE = "America/New_York";

export type WeeklyReportLang = "zh" | "en";

export interface WeeklyTopOffer {
  offerId: string | null;
  offerName: string;
  network: string | null;
  clicks: number;
  conversions: number;
  /** Revenue in the report week. */
  revenue: number;
  /** Revenue in the previous 7 days (for rise/fall commentary). */
  prevRevenue: number;
  /**
   * 补强 #20：联盟有效唯一订单数（同一订单下单+退货先合并净值再计数）。
   * 无 Order 明细时每条 Conversion 各计一单（见 netValidOrderCount）。
   */
  validOrders: number;
  /** 补强 #20：转化率 = 有效唯一订单数 ÷ 广告点击；点击为 0 时 null。 */
  conversionRate: number | null;
  /** 补强 #20：ROI 状态（花费缺失或点击 < 100 时为 insufficient，不判定）。 */
  roiStatus: RoiStatus;
}

// ---------------------------------------------------------------------------
// 补强 #20：ROI / 转化率统一口径（Web 端 pace-checklist.ts 同口径实现）
// - 转化率 = 联盟有效唯一订单数 ÷ 广告总点击（不用 Ads 后台转化率冒充）。
// - 有效唯一订单：同一订单下单 + 退货先按 orderId 合并净值，净值 > 0 才计 1 单。
// - ROI 比值 = 收入 ÷ 花费；判定门槛：点击 < 100 不给判定；
//   ROI < 1 亏损（红）、≥ 2 盈利（绿）、中间中性。
// ---------------------------------------------------------------------------

/** ROI 给判定所需的最小样本点击数。 */
export const ROI_MIN_CLICKS = 100;

export type RoiStatus = "insufficient" | "loss" | "neutral" | "profitable";

export const ROI_STATUS_LABELS: Record<RoiStatus, string> = {
  insufficient: "样本不足（点击 < 100 或缺花费/收入），不判定",
  loss: "亏损（ROI < 1）",
  neutral: "中性（1 ≤ ROI < 2）",
  profitable: "盈利（ROI ≥ 2）",
};

export interface OrderLike {
  orderId?: string | null;
  value?: unknown;
  status?: string | null;
}

/**
 * 联盟有效唯一订单数：按 orderId 分组，先合并净值再计数。
 * 退货/取消行（REFUNDED / CANCELLED / RETURNED 且金额为正）按负值合并；
 * 净值 > 0 的订单计 1。无 orderId 的行各自独立成单。
 */
export function netValidOrderCount(orders: readonly OrderLike[]): number {
  const net = new Map<string, number>();
  orders.forEach((o, i) => {
    const key = o.orderId ?? `__row_${i}`;
    const raw = toNumber(o.value);
    const st = (o.status ?? "").trim().toUpperCase();
    const signed =
      (st === "REFUNDED" || st === "CANCELLED" || st === "RETURNED") &&
      raw > 0
        ? -raw
        : raw;
    net.set(key, (net.get(key) ?? 0) + signed);
  });
  let count = 0;
  for (const v of net.values()) {
    if (v > 1e-9) count += 1;
  }
  return count;
}

/** 转化率 = 有效唯一订单数 ÷ 广告总点击；点击为 0/未知 → null。 */
export function affiliateConversionRate(
  validOrders: number | null | undefined,
  clicks: number | null | undefined,
): number | null {
  if (validOrders == null || clicks == null) return null;
  if (!Number.isFinite(validOrders) || !Number.isFinite(clicks) || clicks <= 0) {
    return null;
  }
  return validOrders / clicks;
}

/** 收入 ÷ 花费；花费缺失/为 0 或收入缺失 → null（不编造）。 */
export function roiRatioOf(
  revenue: number | null | undefined,
  spend: number | null | undefined,
): number | null {
  if (revenue == null || spend == null) return null;
  if (!Number.isFinite(revenue) || !Number.isFinite(spend) || spend <= 0) {
    return null;
  }
  return revenue / spend;
}

/** ROI 状态判定：样本点击 ≥ 100 才给判定。 */
export function roiStatusFor(
  clicks: number | null | undefined,
  roiRatio: number | null | undefined,
): RoiStatus {
  if (clicks == null || !Number.isFinite(clicks) || clicks < ROI_MIN_CLICKS) {
    return "insufficient";
  }
  if (roiRatio == null || !Number.isFinite(roiRatio)) return "insufficient";
  if (roiRatio < 1) return "loss";
  if (roiRatio >= 2) return "profitable";
  return "neutral";
}

export interface WeeklyReportData {
  spend: number | null;
  revenue: number;
  conversions: number;
  /** 补强 #20：联盟有效唯一订单数（净值合并后计数）。 */
  validOrders: number;
  /** 补强 #20：转化率 = 有效唯一订单数 ÷ 广告总点击（不含测试点击）。 */
  conversionRate: number | null;
  /** 补强 #20：ROI 比值（收入 ÷ 花费）；花费缺失时 null。 */
  roiRatio: number | null;
  /** 补强 #20：ROI 状态；花费缺失或点击 < 100 时 insufficient。 */
  roiStatus: RoiStatus;
  clicks: number;
  topOffers: WeeklyTopOffer[];
  deadLinks: number;
  newNegatives: number;
  newTasks: number;
  alerts: number;
  alertsBySeverity: Record<string, number>;
  weekStart: string;
  weekEnd: string;
}

export interface GenerateWeeklyReportOptions {
  /** AI language; defaults to zh. */
  lang?: WeeklyReportLang;
  /** Injected LLM transport (unit tests). */
  chatJsonImpl?: typeof chatJson;
  /**
   * Injected LLM settings (unit tests). `undefined` = read from the
   * aiSetting table; `null` = force the no-AI template fallback.
   */
  llmSettings?: { baseUrl: string; model: string; apiKey: string } | null;
}

// ---------------------------------------------------------------------------
// Week range helpers (America/New_York)
// ---------------------------------------------------------------------------

const WEEKDAY_IDX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function zonedParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(date).map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts["year"]),
    month: Number(parts["month"]),
    day: Number(parts["day"]),
    weekday: parts["weekday"] as string,
  };
}

/** Offset (ms) such that utcMs = wallMs - offset; converges over 3 passes. */
function tzOffsetMs(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hour12: false,
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(date).map((p) => [p.type, p.value]),
  );
  const asUTC = Date.UTC(
    Number(parts["year"]),
    Number(parts["month"]) - 1,
    Number(parts["day"]),
    Number(parts["hour"]) % 24,
    Number(parts["minute"]),
    Number(parts["second"]),
    Number(parts["fractionalSecond"] ?? 0),
  );
  return asUTC - date.getTime();
}

/** Convert a tz wall-clock instant (expressed as ms) to real UTC ms. */
function zonedTimeToUtcMs(wallMs: number, timeZone: string): number {
  let utc = wallMs;
  for (let i = 0; i < 3; i += 1) {
    utc = wallMs - tzOffsetMs(timeZone, new Date(utc));
  }
  return utc;
}

/**
 * Previous full week (Monday 00:00 → Sunday 23:59:59.999) in the given
 * timezone, as UTC Dates. Pure function — unit-testable.
 */
export function getLastWeekRange(
  now: Date = new Date(),
  timeZone: string = WEEKLY_REPORT_TIMEZONE,
): { weekStart: Date; weekEnd: Date } {
  const zp = zonedParts(now, timeZone);
  const todayWallMs = Date.UTC(zp.year, zp.month - 1, zp.day);
  const weekday = WEEKDAY_IDX[zp.weekday] ?? 0;
  const daysSinceMonday = (weekday + 6) % 7;
  const lastMondayWallMs = todayWallMs - (daysSinceMonday + 7) * 86_400_000;
  const lastSundayWallMs = lastMondayWallMs + 6 * 86_400_000;
  return {
    weekStart: new Date(zonedTimeToUtcMs(lastMondayWallMs, timeZone)),
    weekEnd: new Date(
      zonedTimeToUtcMs(lastSundayWallMs + 86_399_999, timeZone),
    ),
  };
}

/** The 7-day window immediately before weekStart (rise/fall baseline). */
export function getPrevWeekRange(weekStart: Date): {
  gte: Date;
  lte: Date;
} {
  return {
    gte: new Date(weekStart.getTime() - 7 * 86_400_000),
    lte: new Date(weekStart.getTime() - 1),
  };
}

// ---------------------------------------------------------------------------
// LLM settings (same storage convention as the search-term service)
// ---------------------------------------------------------------------------

const SETTING_BASE_URL = "llm.baseUrl";
const SETTING_MODEL = "llm.model";
const SETTING_API_KEY_ENC = "llm.apiKeyEnc";

interface LlmSettings {
  baseUrl?: string;
  model?: string;
  apiKeyEnc?: string;
}

async function readLlmSettings(prisma: PrismaClient): Promise<LlmSettings> {
  const rows = (await prisma.aiSetting.findMany()) as Array<{
    key: string;
    value: string;
  }>;
  const out: LlmSettings = {};
  for (const r of rows) {
    if (r.key === SETTING_BASE_URL) out.baseUrl = r.value;
    else if (r.key === SETTING_MODEL) out.model = r.value;
    else if (r.key === SETTING_API_KEY_ENC) out.apiKeyEnc = r.value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// AI narrative
// ---------------------------------------------------------------------------

const SUMMARY_SPEC = `{
  "summary": "<周报解读正文（markdown），见下方结构>"
}`;

function buildWeeklyReportPrompt(
  data: WeeklyReportData,
  prevRevenueTotal: number,
  lang: WeeklyReportLang,
): { system: string; user: string } {
  const zh = lang === "zh";
  const lines: string[] = [
    `统计区间：${data.weekStart} ~ ${data.weekEnd}（America/New_York）`,
    `点击（不含测试点击）：${data.clicks}`,
    `转化：${data.conversions}`,
    `联盟有效唯一订单数（同订单下单+退货合并净值后计数）：${data.validOrders}`,
    data.conversionRate == null
      ? "转化率（有效唯一订单 ÷ 广告点击）：无点击，无法计算"
      : `转化率（有效唯一订单 ÷ 广告点击）：${(data.conversionRate * 100).toFixed(2)}%`,
    data.roiRatio == null
      ? `ROI 状态：${ROI_STATUS_LABELS[data.roiStatus]}（ROI 比值无法计算）`
      : `ROI 比值（收入 ÷ 花费）：${data.roiRatio.toFixed(2)}，ROI 状态：${ROI_STATUS_LABELS[data.roiStatus]}`,
    `收入：${data.revenue.toFixed(2)}`,
    data.spend == null
      ? "花费：数据缺失（库中无真实花费字段）"
      : `花费：${data.spend.toFixed(2)}`,
    `上周总收入（对照基线）：${prevRevenueTotal.toFixed(2)}`,
    `告警：${data.alerts}（按严重度：${JSON.stringify(data.alertsBySeverity)}）`,
    `死链：${data.deadLinks}`,
    `本周新增应用否词：${data.newNegatives}`,
    `本周新建落地页优化任务：${data.newTasks}`,
    "Top offers（收入降序）：",
    ...data.topOffers.map(
      (o, i) =>
        `  ${i + 1}. ${o.offerName}（${o.network ?? "未知网络"}）: 点击 ${o.clicks}, 转化 ${o.conversions}, 收入 ${o.revenue.toFixed(2)}, 上上周同期收入 ${o.prevRevenue.toFixed(2)}`,
    ),
  ];
  if (data.topOffers.length === 0) {
    lines.push("  （本周无 offer 数据）");
  }

  const system =
    (zh
      ? "你是联盟营销（affiliate arbitrage）投放的资深数据分析师。用户通过 Google Ads 为联盟 offer 买量、赚取佣金。请根据下方数据生成一份中文周报解读，返回 STRICT JSON。"
      : "You are a senior data analyst for affiliate arbitrage media buying. Write a weekly report narrative in English from the data below. Return STRICT JSON.") +
    `\n格式：\n${SUMMARY_SPEC}\n` +
    (zh
      ? `结构要求（markdown 正文）：
1. 一句话总览：本周花了多少、赚了多少、总体是涨是跌（与上周总收入基线对比）。
2. Offer 表现：哪个 offer 涨了、哪个跌了（对比上上周同期收入），必须点名具体 offer 和数字。
3. 异常提醒：死链、告警、新否词/优化任务的异常点；没有异常就明确说"本周无重大异常"。
4. 下周建议：2-3 条具体可执行的建议（预算、否词、落地页、offer 优先级）。
禁止空话条款：
- 只引用给定数据，禁止编造任何数字、禁止臆测原因（不要说"因为市场回暖"这类无法验证的话）。
- 花费数据缺失时必须明确写"花费数据缺失，无法计算 ROI"——绝不能估算或假设花费。
- 每句话都要有信息量；"继续保持""值得关注"这类空话直接删掉。
只返回 JSON，不要 markdown 代码块，不要解释文字。`
      : `Structure (markdown body):
1. One-line overview: spend, revenue, up/down vs the baseline.
2. Offer performance: which offers rose/fell (vs prior-week revenue), naming offers and numbers.
3. Anomalies: dead links, alerts, negatives/tasks; say explicitly "no major anomalies" when there are none.
4. Next-week actions: 2-3 concrete executable suggestions.
Rules:
- Cite only the given data; never invent numbers or speculate unverifiable causes.
- Spend is missing: state "spend data is unavailable, ROI cannot be computed" — never estimate spend.
- No filler. Return JSON only, no markdown fences, no commentary.`);

  return { system, user: lines.join("\n") };
}

function validateSummaryShape(obj: unknown): { summary: string } {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new AiError("summary: expected JSON object");
  }
  const summary = (obj as Record<string, unknown>)["summary"];
  if (typeof summary !== "string" || summary.trim().length < 50) {
    throw new AiError("summary: expected non-empty narrative (>= 50 chars)");
  }
  return { summary: summary.trim() };
}

/** Data-driven fallback when the LLM is not configured. No invented data. */
function buildTemplateSummary(data: WeeklyReportData): string {
  const rows = data.topOffers
    .map(
      (o, i) =>
        `${i + 1}. ${o.offerName}：点击 ${o.clicks}，转化 ${o.conversions}，有效唯一订单 ${o.validOrders}，转化率 ${o.conversionRate == null ? "—" : `${(o.conversionRate * 100).toFixed(2)}%`}，收入 ${o.revenue.toFixed(2)}`,
    )
    .join("\n");
  return [
    `## 周报（${data.weekStart} ~ ${data.weekEnd}）`,
    "",
    `- 点击（不含测试）：${data.clicks}`,
    `- 转化：${data.conversions}`,
    `- 联盟有效唯一订单：${data.validOrders}`,
    data.conversionRate == null
      ? "- 转化率（有效唯一订单 ÷ 广告点击）：无点击，无法计算"
      : `- 转化率（有效唯一订单 ÷ 广告点击）：${(data.conversionRate * 100).toFixed(2)}%`,
    `- 收入：${data.revenue.toFixed(2)}`,
    `- 花费：花费数据缺失，无法计算 ROI`,
    `- ROI 状态：${ROI_STATUS_LABELS[data.roiStatus]}`,
    `- 告警：${data.alerts}；死链：${data.deadLinks}；新增应用否词：${data.newNegatives}；新建落地页优化任务：${data.newTasks}`,
    "",
    "### Top Offers",
    rows || "（本周无 offer 数据）",
    "",
    "_注：AI 未配置，本节为模板生成；配置 AI 后将输出智能解读。_",
  ].join("\n");
}

async function generateAiSummary(
  prisma: PrismaClient,
  data: WeeklyReportData,
  prevRevenueTotal: number,
  opts: GenerateWeeklyReportOptions,
): Promise<string> {
  const lang = opts.lang ?? "zh";
  if (opts.llmSettings === null) {
    return buildTemplateSummary(data);
  }

  let args: ChatJsonArgs | null = null;
  if (opts.llmSettings) {
    args = {
      baseUrl: opts.llmSettings.baseUrl,
      model: opts.llmSettings.model,
      apiKey: opts.llmSettings.apiKey,
      system: "",
      user: "",
    };
  } else {
    const settings = await readLlmSettings(prisma);
    if (settings.baseUrl && settings.model && settings.apiKeyEnc) {
      const pepper = assertAiSettingsPepperConfigured();
      args = {
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey: decryptSecret(settings.apiKeyEnc, pepper),
        system: "",
        user: "",
      };
    }
  }

  if (!args) {
    // AI not configured — data-driven template instead of failing.
    return buildTemplateSummary(data);
  }

  const { system, user } = buildWeeklyReportPrompt(data, prevRevenueTotal, lang);
  try {
    const impl = opts.chatJsonImpl ?? chatJson;
    const parsed = await chatJsonValidated(
      { ...args, system, user },
      validateSummaryShape,
      impl,
    );
    return parsed.summary;
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw new AiError("LLM request failed");
  }
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function toNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "object" && "toString" in value) {
    const n = Number(
      (value as { toString(): string }).toString(),
    );
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Aggregate one tenant's weekly stats and persist a WeeklyReport row.
 * Test clicks (isTest=true) are excluded everywhere. Never fabricates
 * numbers — spend is null when no real spend source exists.
 */
export async function generateWeeklyReport(
  prisma: PrismaClient,
  tenantId: string,
  weekStart: Date,
  weekEnd: Date,
  opts: GenerateWeeklyReportOptions = {},
): Promise<{
  id: string;
  tenantId: string;
  weekStart: Date;
  weekEnd: Date;
  data: WeeklyReportData;
  aiSummary: string;
  status: string;
}> {
  if (!tenantId || typeof tenantId !== "string") {
    throw new ValidationError("tenantId is required");
  }
  if (
    !(weekStart instanceof Date) ||
    !(weekEnd instanceof Date) ||
    Number.isNaN(weekStart.getTime()) ||
    Number.isNaN(weekEnd.getTime()) ||
    weekStart >= weekEnd
  ) {
    throw new ValidationError("weekStart/weekEnd must be valid dates with weekStart < weekEnd");
  }

  const range = { gte: weekStart, lte: weekEnd };
  const prevRange = getPrevWeekRange(weekStart);

  const [clicks, convRows, prevConvRows, clickGroups, alerts, alertGroups, deadLinks, newNegatives, newTasks] =
    await Promise.all([
      prisma.click.count({
        where: { tenantId, createdAt: range, NOT: { isTest: true } },
      }),
      prisma.conversion.findMany({
        where: { tenantId, conversionTime: range },
        select: {
          id: true,
          status: true,
          value: true,
          click: { select: { offerId: true } },
          // 补强 #20：带出关联订单，按 orderId 合并净值算有效唯一订单数。
          orders: {
            select: { orderId: true, value: true, status: true },
          },
        },
      }),
      prisma.conversion.findMany({
        where: { tenantId, conversionTime: prevRange },
        select: { value: true, click: { select: { offerId: true } } },
      }),
      prisma.click.groupBy({
        by: ["offerId"],
        where: {
          tenantId,
          createdAt: range,
          NOT: { isTest: true },
          offerId: { not: null },
        },
        _count: { offerId: true },
      }),
      prisma.alert.count({ where: { tenantId, createdAt: range } }),
      prisma.alert.groupBy({
        by: ["severity"],
        where: { tenantId, createdAt: range },
        _count: { severity: true },
      }),
      prisma.linkHealthCheck.count({
        where: { tenantId, checkedAt: range, isAlive: false },
      }),
      prisma.searchTermSuggestion.count({
        where: { tenantId, createdAt: range, status: "APPLIED" },
      }),
      prisma.landingPageOptimizationTask.count({
        where: { tenantId, createdAt: range },
      }),
    ]);

  // Per-offer revenue/conversions for this week + previous week.
  // 补强 #20：同时收集订单明细（有 Order 时用 Order 行；没有时该 Conversion
  // 本身计为一单），后续按 orderId 合并净值算有效唯一订单数。
  const aggByOffer = new Map<
    string,
    { conversions: number; revenue: number; orders: OrderLike[] }
  >();
  const allOrders: OrderLike[] = [];
  for (const c of convRows as Array<{
    id?: string;
    status?: string;
    value: unknown;
    click: { offerId: string | null } | null;
    orders?: Array<{ orderId: string; value: unknown; status: string }>;
  }>) {
    const offerId = c.click?.offerId ?? null;
    if (!offerId) continue;
    const agg =
      aggByOffer.get(offerId) ?? { conversions: 0, revenue: 0, orders: [] };
    agg.conversions += 1;
    agg.revenue += toNumber(c.value);
    const orderLikes: OrderLike[] =
      c.orders && c.orders.length > 0
        ? c.orders.map((o) => ({
            orderId: o.orderId,
            value: o.value,
            status: o.status,
          }))
        : [{ orderId: c.id ?? null, value: c.value, status: c.status ?? null }];
    agg.orders.push(...orderLikes);
    allOrders.push(...orderLikes);
    aggByOffer.set(offerId, agg);
  }
  const prevRevenueByOffer = new Map<string, number>();
  let prevRevenueTotal = 0;
  for (const c of prevConvRows as Array<{
    value: unknown;
    click: { offerId: string | null } | null;
  }>) {
    const v = toNumber(c.value);
    prevRevenueTotal += v;
    const offerId = c.click?.offerId ?? null;
    if (!offerId) continue;
    prevRevenueByOffer.set(offerId, (prevRevenueByOffer.get(offerId) ?? 0) + v);
  }

  const clickCountByOffer = new Map<string, number>();
  for (const g of clickGroups as Array<{
    offerId: string | null;
    _count: { offerId: number };
  }>) {
    if (g.offerId) clickCountByOffer.set(g.offerId, g._count.offerId);
  }

  const offerIds = [...new Set([...aggByOffer.keys(), ...clickCountByOffer.keys()])];
  const offerRows =
    offerIds.length > 0
      ? ((await prisma.offer.findMany({
          where: { tenantId, id: { in: offerIds } },
          select: { id: true, name: true, network: true },
        })) as Array<{ id: string; name: string; network: string | null }>)
      : [];
  const offerMeta = new Map(offerRows.map((o) => [o.id, o]));

  const topOffers: WeeklyTopOffer[] = offerIds
    .map((offerId) => {
      const agg = aggByOffer.get(offerId);
      const meta = offerMeta.get(offerId);
      const offerClicks = clickCountByOffer.get(offerId) ?? 0;
      const offerValidOrders = agg ? netValidOrderCount(agg.orders) : 0;
      return {
        offerId,
        offerName: meta?.name ?? offerId,
        network: meta?.network ?? null,
        clicks: offerClicks,
        conversions: agg?.conversions ?? 0,
        revenue: agg?.revenue ?? 0,
        prevRevenue: prevRevenueByOffer.get(offerId) ?? 0,
        validOrders: offerValidOrders,
        conversionRate: affiliateConversionRate(
          offerValidOrders,
          offerClicks,
        ),
        // 周报无 per-offer 花费数据源 → roiRatio 为 null → 状态 insufficient。
        roiStatus: roiStatusFor(offerClicks, null),
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.conversions - a.conversions)
    .slice(0, 5);

  const revenue = [...aggByOffer.values()].reduce((s, a) => s + a.revenue, 0);
  const conversions = [...aggByOffer.values()].reduce(
    (s, a) => s + a.conversions,
    0,
  );
  const validOrders = netValidOrderCount(allOrders);
  const conversionRate = affiliateConversionRate(validOrders, clicks);
  const roiRatio = roiRatioOf(revenue, null);
  const roiStatus = roiStatusFor(clicks, roiRatio);

  const alertsBySeverity: Record<string, number> = {};
  for (const g of alertGroups as Array<{
    severity: string;
    _count: { severity: number };
  }>) {
    alertsBySeverity[g.severity] = g._count.severity;
  }

  const data: WeeklyReportData = {
    spend: null,
    revenue,
    conversions,
    validOrders,
    conversionRate,
    roiRatio,
    roiStatus,
    clicks,
    topOffers,
    deadLinks,
    newNegatives,
    newTasks,
    alerts,
    alertsBySeverity,
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
  };

  const aiSummary = await generateAiSummary(prisma, data, prevRevenueTotal, opts);

  const saved = await prisma.weeklyReport.upsert({
    where: {
      tenantId_weekStart_weekEnd: { tenantId, weekStart, weekEnd },
    },
    create: {
      id: randomUUID(),
      tenantId,
      weekStart,
      weekEnd,
      // JSON round-trip: plain-data clone satisfies Prisma's Json input type.
      data: JSON.parse(JSON.stringify(data)),
      aiSummary,
      status: "GENERATED",
    },
    update: {
      data: JSON.parse(JSON.stringify(data)),
      aiSummary,
    },
  });

  return {
    id: saved.id,
    tenantId: saved.tenantId,
    weekStart: saved.weekStart,
    weekEnd: saved.weekEnd,
    data,
    aiSummary,
    status: saved.status,
  };
}

/** List weekly reports for a tenant, newest week first. */
export async function listWeeklyReports(
  prisma: PrismaClient,
  tenantId: string,
) {
  return prisma.weeklyReport.findMany({
    where: { tenantId },
    orderBy: { weekStart: "desc" },
  });
}

/** Fetch one weekly report (tenant-isolated); 404 when not found. */
export async function getWeeklyReport(
  prisma: PrismaClient,
  tenantId: string,
  id: string,
) {
  const row = await prisma.weeklyReport.findFirst({
    where: { id, tenantId },
  });
  if (!row) {
    throw new NotFoundError("WeeklyReport", id);
  }
  return row;
}

// TODO: email delivery — wire tenant notification preferences / SMTP here.
// The status field transitions GENERATED → SENT once delivery lands.
export async function sendViaEmail(
  _tenantId: string,
  _reportId: string,
): Promise<void> {
  throw new AppError("Email delivery is not implemented", {
    code: "NOT_IMPLEMENTED",
    statusCode: 501,
  });
}
