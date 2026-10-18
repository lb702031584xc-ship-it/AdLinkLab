"use server";

/**
 * 流量需求门（traffic gate）server actions.
 *
 * 后端契约：POST /api/v1/traffic/gate
 *   body: { brand?: string, domain?: string, keywords?: string[], geo?: string }
 *   返回 TrafficGate { passed, reason, officialSite, signals }
 * 只做检测展示，不落库。客户端组件通过这里调用，避免 import server-only 模块。
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";
import type { TrafficGate } from "./amazon-types";

export interface TrafficGateInput {
  brand?: string;
  title?: string;
  domain?: string;
  keywords?: string[];
  geo?: string;
  /** 用户手动输入的月访问量（正整数）；后端以它为准判定 */
  manualMonthlyVisits?: number;
  /** SEMrush 域名概览手动值：自然流量（正整数） */
  organicTraffic?: number;
  /** SEMrush 域名概览手动值：付费流量（非负整数，0 允许） */
  paidTraffic?: number;
  /** SEMrush 域名概览手动值：付费关键词数（非负整数，0 允许） */
  paidKeywords?: number;
}

export type TrafficGateActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function mapError(e: unknown, fallback: string): { ok: false; error: string } {
  return {
    ok: false,
    error: e instanceof Error && e.message ? e.message : fallback,
  };
}

export async function checkTrafficGateAction(
  input: TrafficGateInput
): Promise<TrafficGateActionResult<TrafficGate>> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/traffic/gate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify(input),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "网络请求失败，请稍后重试。" };
  }
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `检测失败（${res.status}）`;
    try {
      const body = (await res.json()) as {
        message?: string;
        error?: string;
      };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    return { ok: false, error: message };
  }
  try {
    const data = (await res.json()) as TrafficGate;
    return { ok: true, data };
  } catch (e) {
    return mapError(e, "检测结果解析失败。");
  }
}

/** 季节选品：单关键词季节信号（Trends 时间线算出；Trends 是相对热度，绝不是销量）。 */
export interface SeasonalSignal {
  current: number | null;
  direction: "rising" | "flat" | "falling" | null;
  yoyChangePct: number | null;
  lastYearPeak: { time: number; value: number } | null;
  daysToPeak: number | null;
  verdict:
    | "approaching"
    | "upcoming"
    | "justPassed"
    | "past"
    | "rising"
    | "flat"
    | "insufficient";
}

export interface SeasonalWindow {
  name: string;
  date: string;
  daysUntil: number;
  leadDays: number;
  withinLead: boolean;
}

export interface SeasonalKeywordResult {
  keyword: string;
  country: string;
  trendsRateLimited: boolean;
  timeline: Array<{ time: number; value: number }>;
  signal: SeasonalSignal;
  /** DataForSEO 绝对月搜索量（付费，未配置 → null） */
  volume: number | null;
  /** DataForSEO 逐月量 YoY（%）；无同期 → null */
  volumeYoyPct: number | null;
  /** 季节评分（代码按实测信号算，透明分项；数据不足时 score=null） */
  score: {
    score: number | null;
    items: Array<{ key: string; points: number; max: number }>;
  } | null;
}

/** 季节 AI 判断（只用传入的实测数，不编销量/CPC/CVR/payout）。 */
export interface SeasonalityJudgment {
  suggestion: "go" | "watch" | "skip";
  reason: string;
  confidence: number;
}

/**
 * 季节 AI 判断。
 * 后端契约：POST /api/v1/ai/seasonality-judgment
 *   body: { keyword, countryLabel, verdict, direction, yoyChangePct, daysToPeak, volume, volumeYoyPct, score, language }
 *   → { suggestion, reason, confidence }；AI 未配置时 400。
 */
export async function checkSeasonalityAiAction(
  input: {
    keyword: string;
    countryLabel: string;
    verdict: string;
    direction: string | null;
    yoyChangePct: number | null;
    daysToPeak: number | null;
    volume: number | null;
    volumeYoyPct: number | null;
    score: number | null;
    language: "zh" | "en";
  }
): Promise<TrafficGateActionResult<SeasonalityJudgment>> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/ai/seasonality-judgment`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify(input),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "网络请求失败，请稍后重试。" };
  }
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `AI 判断失败（${res.status}）`;
    try {
      const body = (await res.json()) as {
        message?: string;
        error?: string;
      };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    return { ok: false, error: message };
  }
  try {
    const data = (await res.json()) as SeasonalityJudgment;
    return { ok: true, data };
  } catch (e) {
    return mapError(e, "AI 判断结果解析失败。");
  }
}

export interface SeasonalityResponse {
  country: string;
  windows: SeasonalWindow[];
  results: SeasonalKeywordResult[];
}

/**
 * 季节选品查询。
 * 后端契约：POST /api/v1/traffic/seasonality
 *   body: { keywords: string[]（1-10）, country?: string, leadDays?: number }
 *   → { country, windows, results }
 */
export async function checkSeasonalityAction(
  keywords: string[],
  country: string,
  leadDays = 14
): Promise<TrafficGateActionResult<SeasonalityResponse>> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/traffic/seasonality`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({ keywords, country, leadDays }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "网络请求失败，请稍后重试。" };
  }
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `查询失败（${res.status}）`;
    try {
      const body = (await res.json()) as {
        message?: string;
        error?: string;
      };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    return { ok: false, error: message };
  }
  try {
    const data = (await res.json()) as SeasonalityResponse;
    return { ok: true, data };
  } catch (e) {
    return mapError(e, "查询结果解析失败。");
  }
}
export interface OcrMetrics {
  rating: number | null;
  reviewCount: number | null;
  price: number | null;
  currency: string | null;
  soldCount: number | null;
  confidence: number | null;
  needsReview: true;
}

/** AI 量级参考（非实测）：后台无 EPC / 转化率时，按行业基准给保守的量级区间。 */
export interface EpcReference {
  vertical: string;
  verticalLabel: string;
  cvrLow: number;
  cvrHigh: number;
  epcLow: number;
  epcHigh: number;
  sources: string[];
  reasoning: string;
  confidence: number;
}

/**
 * AI 量级参考。
 * 后端契约：POST /api/v1/ai/epc-reference
 *   body: { offerName, payout, avgPrice?, commissionRate?, network?, language }
 *   → EpcReference；AI 未配置时 400。
 * 硬隔离：返回的参考值只做展示，调用方绝不许写进 EPC / 转化率输入框、出价公式。
 */
export async function getEpcReferenceAction(
  input: {
    offerName: string;
    payout: number;
    avgPrice?: number | null;
    commissionRate?: number | null;
    network?: string;
    language: "zh" | "en";
  }
): Promise<TrafficGateActionResult<EpcReference>> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/ai/epc-reference`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify(input),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "网络请求失败，请稍后重试。" };
  }
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `生成失败（${res.status}）`;
    try {
      const body = (await res.json()) as {
        message?: string;
        error?: string;
      };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    return { ok: false, error: message };
  }
  try {
    const data = (await res.json()) as EpcReference;
    return { ok: true, data };
  } catch (e) {
    return mapError(e, "参考值解析失败。");
  }
}
export interface NetworkOcrMetrics {
  epc: number | null;
  conversionRate: number | null;
  clicks: number | null;
  confidence: number | null;
  needsReview: true;
}

/**
 * 截图 OCR 识别（第四批）。
 * 后端契约：POST /api/v1/offer-metrics/ocr[?kind=network]（multipart 单图 ≤8MB）
 *   → OcrMetrics（商品页）或 NetworkOcrMetrics（kind=network，网络后台截图）；识别失败 422。
 * 图片只转发给后端在内存里处理，不落盘。
 */
export async function ocrScreenshotAction(
  formData: FormData,
  kind?: "product"
): Promise<TrafficGateActionResult<OcrMetrics>>;
export async function ocrScreenshotAction(
  formData: FormData,
  kind: "network"
): Promise<TrafficGateActionResult<NetworkOcrMetrics>>;
export async function ocrScreenshotAction(
  formData: FormData,
  kind: "product" | "network" = "product"
): Promise<TrafficGateActionResult<OcrMetrics | NetworkOcrMetrics>> {
  const file = formData.get("screenshot");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "请先选择一张截图。" };
  }
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "只接受图片文件。" };
  }
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  const out = new FormData();
  out.append("screenshot", file, file.name || "screenshot.png");
  let res: Response;
  try {
    res = await fetch(
      `${base}/api/v1/offer-metrics/ocr${kind === "network" ? "?kind=network" : ""}`,
      {
        method: "POST",
        headers: { ...authHeaders },
        body: out,
        cache: "no-store",
      }
    );
  } catch {
    return { ok: false, error: "网络请求失败，请稍后重试。" };
  }
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `识别失败（${res.status}）`;
    try {
      const body = (await res.json()) as {
        message?: string;
        error?: string;
      };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    return { ok: false, error: message };
  }
  try {
    const data = (await res.json()) as OcrMetrics | NetworkOcrMetrics;
    return { ok: true, data };
  } catch (e) {
    return mapError(e, "识别结果解析失败。");
  }
}
