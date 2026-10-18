/**
 * 季节选品：按国家算季节信号 + 节日/季节窗口。
 *
 * 全部纯函数（可单测），不碰网络、不碰数据库。
 *
 * 季节信号来自 Trends 周粒度时间线（相对热度 0-100，绝不是销量）：
 * - 当前热度 vs 52 周前同周 → 同比变化（YoY）
 * - 去年同季峰值 + 365 天 → 预计峰值日 → 距峰值天数
 * - 最近 4 周均值 vs 再往前 4 周均值 → 上升/平稳/下降
 *
 * 结论只作选 offer 参考：去年模式 ≠ 今年模式；Trends 是相对指数，
 * 绝不能当成"预计销量 N 件"。
 */
import type { TrendsTimelinePoint } from "./trends.js";

/** 季节国家：Trends geo + DataForSEO location_name（国家名，不用数字 code，零错配）。 */
export interface SeasonalCountry {
  /** Trends geo（ISO 国家码） */
  code: string;
  /** 中文名 */
  label: string;
  /** DataForSEO location_name */
  dataforseoLocation: string;
  /** DataForSEO language_code */
  languageCode: string;
}

export const SEASONAL_COUNTRIES: SeasonalCountry[] = [
  { code: "US", label: "美国", dataforseoLocation: "United States", languageCode: "en" },
  { code: "GB", label: "英国", dataforseoLocation: "United Kingdom", languageCode: "en" },
  { code: "DE", label: "德国", dataforseoLocation: "Germany", languageCode: "de" },
  { code: "CA", label: "加拿大", dataforseoLocation: "Canada", languageCode: "en" },
  { code: "AU", label: "澳大利亚", dataforseoLocation: "Australia", languageCode: "en" },
  { code: "FR", label: "法国", dataforseoLocation: "France", languageCode: "fr" },
  // 东南亚：DataForSEO location_name 用国家名；语言用各国主流语言。
  { code: "SG", label: "新加坡", dataforseoLocation: "Singapore", languageCode: "en" },
  { code: "MY", label: "马来西亚", dataforseoLocation: "Malaysia", languageCode: "en" },
  { code: "TH", label: "泰国", dataforseoLocation: "Thailand", languageCode: "th" },
  { code: "ID", label: "印度尼西亚", dataforseoLocation: "Indonesia", languageCode: "id" },
  { code: "VN", label: "越南", dataforseoLocation: "Vietnam", languageCode: "vi" },
  { code: "PH", label: "菲律宾", dataforseoLocation: "Philippines", languageCode: "en" },
];

export function seasonalCountry(code: string): SeasonalCountry | null {
  const c = SEASONAL_COUNTRIES.find((x) => x.code === code.toUpperCase());
  return c ?? null;
}

export type SeasonalDirection = "rising" | "flat" | "falling";

export type SeasonalVerdict =
  | "approaching" // 距峰值 ≤ 提前量：即将进入热销季，现在布局
  | "upcoming" // 距峰值在提前量~60 天：可以开始准备
  | "justPassed" // 刚过峰（14 天内）
  | "past" // 已过峰：别追
  | "rising" // 无近峰值，但热度在上升
  | "flat" // 无近峰值，热度平稳
  | "insufficient"; // 数据不足（<26 周或无峰值可算）

export interface SeasonalSignal {
  /** 当前周相对热度（0-100）；null = 无数据 */
  current: number | null;
  /** 最近 4 周 vs 再往前 4 周 */
  direction: SeasonalDirection | null;
  /** 当前 vs 52 周前同周，百分比；null = 无同期可比 */
  yoyChangePct: number | null;
  /** 去年同季峰值点 */
  lastYearPeak: { time: number; value: number } | null;
  /** 距预计峰值（去年峰值 + 365 天）天数；负 = 已过 */
  daysToPeak: number | null;
  verdict: SeasonalVerdict;
}

const WEEK_MS = 7 * 86400000;
const DAY_MS = 86400000;

function avg(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * 由 Trends 周时间线算季节信号。
 * @param points 周粒度点（可乱序，内部按时间排序）
 * @param nowMs 现在（毫秒；测试可注入）
 * @param leadDays 提前量（天）：距峰值 ≤ leadDays 判 approaching，默认 14
 */
export function analyzeSeasonality(
  points: TrendsTimelinePoint[],
  nowMs = Date.now(),
  leadDays = 14
): SeasonalSignal {
  const sorted = [...points]
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value))
    .sort((a, b) => a.time - b.time);
  if (sorted.length < 26) {
    return {
      current: sorted.length > 0 ? sorted[sorted.length - 1]?.value ?? null : null,
      direction: null,
      yoyChangePct: null,
      lastYearPeak: null,
      daysToPeak: null,
      verdict: "insufficient",
    };
  }
  const last = sorted[sorted.length - 1]!;
  const current = last.value;

  // 方向：最近 4 周均值 vs 再往前 4 周均值（±10% 为阈值）
  const recent4 = sorted.slice(-4).map((p) => p.value);
  const prev4 = sorted.slice(-8, -4).map((p) => p.value);
  let direction: SeasonalDirection = "flat";
  if (prev4.length > 0) {
    const change = (avg(recent4) - avg(prev4)) / (avg(prev4) || 1);
    if (change > 0.1) direction = "rising";
    else if (change < -0.1) direction = "falling";
  }

  // YoY：找最接近“52 周前同周”的点（±10 天内）
  const yoyTarget = last.time - 52 * WEEK_MS;
  let yoyPoint: TrendsTimelinePoint | null = null;
  let bestDiff = Infinity;
  for (const p of sorted) {
    const diff = Math.abs(p.time - yoyTarget);
    if (diff < bestDiff) {
      bestDiff = diff;
      yoyPoint = p;
    }
  }
  let yoyChangePct: number | null = null;
  if (yoyPoint && bestDiff <= 10 * DAY_MS && yoyPoint.value > 0) {
    yoyChangePct = Math.round(((current - yoyPoint.value) / yoyPoint.value) * 1000) / 10;
  }

  // 去年同季峰值：去年同周 ±6 周窗口内的最高点
  const peakLo = last.time - 52 * WEEK_MS - 6 * WEEK_MS;
  const peakHi = last.time - 52 * WEEK_MS + 6 * WEEK_MS;
  let lastYearPeak: { time: number; value: number } | null = null;
  for (const p of sorted) {
    if (p.time >= peakLo && p.time <= peakHi) {
      if (!lastYearPeak || p.value > lastYearPeak.value) {
        lastYearPeak = { time: p.time, value: p.value };
      }
    }
  }
  const daysToPeak =
    lastYearPeak != null
      ? Math.round((lastYearPeak.time + 365 * DAY_MS - nowMs) / DAY_MS)
      : null;

  let verdict: SeasonalVerdict;
  if (lastYearPeak == null || daysToPeak == null) {
    verdict = direction === "rising" ? "rising" : "flat";
  } else if (daysToPeak >= 0 && daysToPeak <= leadDays) {
    verdict = "approaching";
  } else if (daysToPeak > leadDays && daysToPeak <= 60) {
    verdict = "upcoming";
  } else if (daysToPeak < 0 && daysToPeak >= -14) {
    verdict = "justPassed";
  } else if (daysToPeak < -14) {
    verdict = "past";
  } else {
    verdict = direction === "rising" ? "rising" : "flat";
  }

  return { current, direction, yoyChangePct, lastYearPeak, daysToPeak, verdict };
}

/** DataForSEO 逐月量 → YoY：最新月 vs 12 个月前同月；任一缺失 → null。 */
export function computeVolumeYoy(
  monthly: Array<{ year: number; month: number; volume: number }>,
  nowMs = Date.now()
): number | null {
  if (monthly.length === 0) return null;
  const sorted = [...monthly].sort(
    (a, b) => a.year * 12 + a.month - (b.year * 12 + b.month)
  );
  const latest = sorted[sorted.length - 1]!;
  const latestKey = latest.year * 12 + latest.month;
  const yearAgo = sorted.find((m) => m.year * 12 + m.month === latestKey - 12);
  if (!yearAgo || yearAgo.volume <= 0) return null;
  // 最新月若早于当前月超过 3 个月，视为过期数据，不算 YoY。
  const now = new Date(nowMs);
  const ageMonths =
    (now.getUTCFullYear() - latest.year) * 12 + (now.getUTCMonth() + 1 - latest.month);
  if (ageMonths > 3) return null;
  return Math.round(((latest.volume - yearAgo.volume) / yearAgo.volume) * 1000) / 10;
}

/** 推荐排序：approaching 最前，past / insufficient 最后。 */
export function seasonalVerdictRank(v: SeasonalVerdict): number {
  switch (v) {
    case "approaching":
      return 0;
    case "upcoming":
      return 1;
    case "rising":
      return 2;
    case "justPassed":
      return 3;
    case "flat":
      return 4;
    case "past":
      return 5;
    case "insufficient":
      return 6;
  }
}

export interface SeasonalScoreItem {
  /** 分项名（与字典键对应：verdict / direction / yoy / peak / volumeYoy） */
  key: string;
  /** 本项得分 */
  points: number;
  /** 本项满分 */
  max: number;
}

export interface SeasonalScore {
  /** 总分 0-100；数据不足时 null（不编分） */
  score: number | null;
  items: SeasonalScoreItem[];
}

/**
 * 季节评分：纯代码算，只用实测信号（Trends 结论/方向/YoY、距峰值、DataForSEO 量 YoY），不经过 LLM。
 * 分项透明：每一项多少分、满分多少都在返回里，前端直接展示分项，分数可复算。
 * 缺失数据不扣分也不补分（该项 0 分）；数据不足（insufficient）时 score 为 null。
 */
export function seasonalScore(
  signal: SeasonalSignal,
  volumeYoyPct: number | null,
  leadDays = 14
): SeasonalScore {
  if (signal.verdict === "insufficient") {
    return { score: null, items: [] };
  }
  const items: SeasonalScoreItem[] = [];
  const verdictPoints =
    signal.verdict === "approaching"
      ? 40
      : signal.verdict === "upcoming"
        ? 25
        : signal.verdict === "rising"
          ? 20
          : signal.verdict === "flat"
            ? 10
            : signal.verdict === "justPassed"
              ? 5
              : 0;
  items.push({ key: "verdict", points: verdictPoints, max: 40 });
  const directionPoints =
    signal.direction === "rising" ? 15 : signal.direction === "flat" ? 5 : 0;
  items.push({ key: "direction", points: directionPoints, max: 15 });
  const yoy = signal.yoyChangePct;
  const yoyPoints = yoy == null ? 0 : yoy > 10 ? 15 : yoy >= 0 ? 5 : 0;
  items.push({ key: "yoy", points: yoyPoints, max: 15 });
  const d = signal.daysToPeak;
  const peakPoints =
    d == null ? 0 : d >= 0 && d <= leadDays ? 15 : d > leadDays && d <= 60 ? 5 : 0;
  items.push({ key: "peak", points: peakPoints, max: 15 });
  const volumeYoyPoints =
    volumeYoyPct == null ? 0 : volumeYoyPct > 10 ? 15 : volumeYoyPct >= 0 ? 5 : 0;
  items.push({ key: "volumeYoy", points: volumeYoyPoints, max: 15 });
  const score = items.reduce((sum, it) => sum + it.points, 0);
  return { score, items };
}

/* ---------------- 节日 / 季节窗口（参考窗口，非实测数据） ---------------- */

/** 格里高利复活节（Meeus/Jones/Butcher 算法）：返回当年复活节星期日的 UTC 午夜。 */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=3月, 4=4月
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

type WindowRule =
  | { name: string; kind: "fixed"; month: number; day: number; leadDays: number }
  | { name: string; kind: "nthWeekday"; month: number; weekday: number; nth: number; leadDays: number }
  | { name: string; kind: "nthWeekdayOffset"; month: number; weekday: number; nth: number; offsetDays: number; leadDays: number }
  | { name: string; kind: "easterOffset"; offsetDays: number; leadDays: number };

function dateOfRule(rule: WindowRule, year: number): Date {
  if (rule.kind === "fixed") {
    return new Date(Date.UTC(year, rule.month - 1, rule.day));
  }
  if (rule.kind === "easterOffset") {
    return new Date(easterSunday(year).getTime() + rule.offsetDays * DAY_MS);
  }
  // 第 nth 个 weekday（weekday: 0=周日）
  const first = new Date(Date.UTC(year, rule.month - 1, 1));
  const delta = (rule.weekday - first.getUTCDay() + 7) % 7;
  const day = 1 + delta + (rule.nth - 1) * 7;
  const base = new Date(Date.UTC(year, rule.month - 1, day));
  if (rule.kind === "nthWeekdayOffset") {
    return new Date(base.getTime() + rule.offsetDays * DAY_MS);
  }
  return base;
}

const COMMON_WINDOWS: WindowRule[] = [
  { name: "元旦", kind: "fixed", month: 1, day: 1, leadDays: 14 },
  { name: "情人节", kind: "fixed", month: 2, day: 14, leadDays: 21 },
  { name: "万圣节", kind: "fixed", month: 10, day: 31, leadDays: 21 },
  { name: "圣诞节", kind: "fixed", month: 12, day: 25, leadDays: 28 },
];

/** 东南亚购物节（Shopee / Lazada / TikTok Shop，固定日期，全年最大窗口是 11.11）。 */
const SEA_SALE_WINDOWS: WindowRule[] = [
  { name: "9.9 购物节", kind: "fixed", month: 9, day: 9, leadDays: 14 },
  { name: "10.10 购物节", kind: "fixed", month: 10, day: 10, leadDays: 14 },
  { name: "11.11 购物节", kind: "fixed", month: 11, day: 11, leadDays: 21 },
  { name: "12.12 购物节", kind: "fixed", month: 12, day: 12, leadDays: 14 },
];

const COUNTRY_WINDOWS: Record<string, WindowRule[]> = {
  US: [
    ...COMMON_WINDOWS,
    { name: "母亲节", kind: "nthWeekday", month: 5, weekday: 0, nth: 2, leadDays: 21 },
    { name: "父亲节", kind: "nthWeekday", month: 6, weekday: 0, nth: 3, leadDays: 21 },
    { name: "黑五", kind: "nthWeekday", month: 11, weekday: 5, nth: 4, leadDays: 28 },
    { name: "网一", kind: "nthWeekdayOffset", month: 11, weekday: 5, nth: 4, offsetDays: 3, leadDays: 28 },
  ],
  GB: [
    ...COMMON_WINDOWS,
    // 英国母亲节 = 母亲主日（复活节前 21 天）
    { name: "母亲节", kind: "easterOffset", offsetDays: -21, leadDays: 21 },
    { name: "父亲节", kind: "nthWeekday", month: 6, weekday: 0, nth: 3, leadDays: 21 },
    { name: "黑五", kind: "nthWeekday", month: 11, weekday: 5, nth: 4, leadDays: 28 },
  ],
  DE: [
    ...COMMON_WINDOWS,
    { name: "黑五", kind: "nthWeekday", month: 11, weekday: 5, nth: 4, leadDays: 28 },
  ],
  CA: [
    ...COMMON_WINDOWS,
    { name: "母亲节", kind: "nthWeekday", month: 5, weekday: 0, nth: 2, leadDays: 21 },
    { name: "父亲节", kind: "nthWeekday", month: 6, weekday: 0, nth: 3, leadDays: 21 },
    { name: "黑五", kind: "nthWeekday", month: 11, weekday: 5, nth: 4, leadDays: 28 },
  ],
  AU: [
    ...COMMON_WINDOWS,
    { name: "母亲节", kind: "nthWeekday", month: 5, weekday: 0, nth: 2, leadDays: 21 },
    // 澳大利亚父亲节 = 9 月第一个周日（与美国不同）
    { name: "父亲节", kind: "nthWeekday", month: 9, weekday: 0, nth: 1, leadDays: 21 },
    { name: "黑五", kind: "nthWeekday", month: 11, weekday: 5, nth: 4, leadDays: 28 },
  ],
  FR: [
    ...COMMON_WINDOWS,
    { name: "黑五", kind: "nthWeekday", month: 11, weekday: 5, nth: 4, leadDays: 28 },
  ],
  // 东南亚：Shopee / Lazada / TikTok Shop 购物节（固定日期）+ 通用窗口。
  // 斋月（印尼/马来西亚）与春节（新加坡/马来西亚）每年日期不同，不进固定窗口，见消费习惯卡。
  SG: [
    ...COMMON_WINDOWS,
    ...SEA_SALE_WINDOWS,
  ],
  MY: [
    ...COMMON_WINDOWS,
    ...SEA_SALE_WINDOWS,
  ],
  TH: [
    ...COMMON_WINDOWS,
    ...SEA_SALE_WINDOWS,
  ],
  ID: [
    ...COMMON_WINDOWS,
    ...SEA_SALE_WINDOWS,
  ],
  VN: [
    ...COMMON_WINDOWS,
    ...SEA_SALE_WINDOWS,
  ],
  PH: [
    ...COMMON_WINDOWS,
    ...SEA_SALE_WINDOWS,
  ],
};

export interface SeasonalWindow {
  name: string;
  /** yyyy-mm-dd */
  date: string;
  /** 距窗口天数 */
  daysUntil: number;
  /** 建议提前布局天数 */
  leadDays: number;
  /** 是否已进入提前布局期（daysUntil ≤ leadDays） */
  withinLead: boolean;
}

/**
 * 该国未来 horizonDays 天内的节日/季节窗口（按距今天数升序）。
 * 未收录国家 → 用通用窗口（元旦/情人节/万圣节/圣诞节）。
 */
export function getSeasonalWindows(
  countryCode: string,
  nowMs = Date.now(),
  horizonDays = 60
): SeasonalWindow[] {
  const rules = COUNTRY_WINDOWS[countryCode.toUpperCase()] ?? COMMON_WINDOWS;
  const now = new Date(nowMs);
  const year = now.getUTCFullYear();
  const out: SeasonalWindow[] = [];
  for (const rule of rules) {
    for (const y of [year, year + 1]) {
      const d = dateOfRule(rule, y);
      const daysUntil = Math.round((d.getTime() - nowMs) / DAY_MS);
      if (daysUntil < 0 || daysUntil > horizonDays) continue;
      out.push({
        name: rule.name,
        date: d.toISOString().slice(0, 10),
        daysUntil,
        leadDays: rule.leadDays,
        withinLead: daysUntil <= rule.leadDays,
      });
    }
  }
  out.sort((a, b) => a.daysUntil - b.daysUntil);
  return out;
}
