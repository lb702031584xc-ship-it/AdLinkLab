/**
 * AI analysis API client (server-side only).
 * Talks to /api/v1/ai/* on the API with the forwarded session cookie.
 * Never logs API keys or tokens.
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export class AiApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "AiApiError";
    this.status = status;
    this.code = code;
  }
}

export interface AiProfitability {
  payout: number | null;
  payoutCurrency: string | null;
  estimatedCpc: number | null;
  breakEvenCvrPct: number | null;
}

export interface AiFinding {
  area: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
}

export interface AiAnalysisReport {
  overallRisk: number;
  riskLevel: "low" | "medium" | "high";
  scores: {
    merchant: number;
    policy: number;
    network: number;
  };
  findings: AiFinding[];
  suggestions: string[];
  keywords: string[];
  adAngles: string[];
}

export interface AiAnalysis {
  id: string;
  merchant: string | null;
  network: string | null;
  language: string;
  profitability: AiProfitability;
  analysis: AiAnalysisReport;
  analyzedAt: string;
}

export interface AiAnalysisSummary {
  id: string;
  merchant: string | null;
  network: string | null;
  payout: number | null;
  payoutCurrency: string | null;
  overallRisk: number;
  riskLevel: "low" | "medium" | "high";
  createdAt: string;
}

export interface AiSettings {
  configured: boolean;
  provider: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  ownedDomains: string[];
  hasAmazonPaapi: boolean;
  /** 后端返回的流量信号 key 配置状态（后端未返回时为 undefined） */
  hasTrafficSimilarweb?: boolean;
  hasTrafficDataforseo?: boolean;
  /** Keepa API Key 配置状态（后端未返回时为 undefined） */
  hasKeepa?: boolean;
}

export interface AnalyzeInput {
  url?: string;
  text?: string;
  merchant?: string;
  network?: string;
  payout?: number;
  payoutCurrency?: string;
  estimatedCpc?: number;
  language?: string;
}

export interface SaveSettingsInput {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  ownedDomains?: string[];
  amazonPaapi?: {
    accessKey: string;
    secretKey: string;
    partnerTag: string;
    region: string;
  } | null;
  /**
   * 流量信号付费 key（加密存储由后端处理）：
   * traffic.similarwebKey（SimilarWeb 月访问量），
   * traffic.dataforseoLogin / traffic.dataforseoPassword（DataForSEO 月搜索量）。
   * 未配置时对应流量信号显示"暂无数据"。
   */
  traffic?: {
    similarwebKey?: string;
    dataforseoLogin?: string;
    dataforseoPassword?: string;
  } | null;
  /**
   * Keepa API Key（keepa.com 付费 key，用于 Day5 自动筛选）。
   * 非空字符串才加密写入；undefined 表示不修改已有值。
   */
  keepaKey?: string;
}

export type RestrictionValue = "allowed" | "forbidden" | "restricted" | "unknown";

export interface AiTermsTraffic {
  search: RestrictionValue;
  display: RestrictionValue;
  email: RestrictionValue;
  social: RestrictionValue;
  incentivized: RestrictionValue;
}

export interface AiTermsRedFlag {
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
}

export interface AiTermsResult {
  id: string;
  language: string;
  terms: {
    overallVerdict: "go" | "caution" | "stop";
    traffic: AiTermsTraffic;
    brandBidding: RestrictionValue;
    directLinking: RestrictionValue;
    geoRestrictions: string[];
    caps: string | null;
    payoutTerms: string | null;
    redFlags: AiTermsRedFlag[];
    summary: string;
  };
  analyzedAt: string;
}

export interface AiScreenItemInput {
  name?: string;
  text: string;
}

export interface AiScreenResultItem {
  name: string;
  verdict: "go" | "caution" | "stop";
  keyRisks: string[];
  summary: string;
}

export interface AiScreenResponse {
  results: AiScreenResultItem[];
  analyzedAt: string;
}

export type UrlCheckVerdict =
  | "owned"
  | "affiliate_direct"
  | "suspicious"
  | "unknown";

export interface AiUrlCheckResult {
  inputUrl: string;
  finalUrl: string;
  finalDomain: string;
  isOwnedDomain: boolean;
  affiliateParams: string[];
  verdict: UrlCheckVerdict;
}

export interface AiUrlCheckResponse {
  results: AiUrlCheckResult[];
  ownedDomains: string[];
}

async function aiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...authHeaders,
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new AiApiError(0, "network failure");
  }
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `request failed (${res.status})`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as {
        message?: string;
        error?: string;
        code?: string;
      };
      message = body.message ?? body.error ?? message;
      // API serializes AppError as {error: <code>, message}; accept both shapes.
      code = body.code ?? body.error;
    } catch {
      /* ignore */
    }
    throw new AiApiError(res.status, message, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Admin-only: read AI provider settings. */
export async function getAiSettings(): Promise<AiSettings> {
  return aiFetch<AiSettings>("/api/v1/ai/settings");
}

/** Admin-only: update AI provider settings. */
export async function saveAiSettings(
  input: SaveSettingsInput
): Promise<{ ok: boolean; configured: boolean }> {
  return aiFetch<{ ok: boolean; configured: boolean }>("/api/v1/ai/settings", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export interface AiConnectionTestResult {
  ok: boolean;
  stage: "config" | "dns" | "connect" | "tls" | "http" | "ok";
  message: string;
  latencyMs?: number;
  httpStatus?: number;
}

/** Admin-only: 一键诊断 LLM 连接，分层定位故障（dns/connect/tls/http）。 */
export async function testAiConnection(input: {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}): Promise<AiConnectionTestResult> {
  return aiFetch<AiConnectionTestResult>("/api/v1/ai/test-connection", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Analyze an offer. Throws AiApiError with code "AI_NOT_CONFIGURED" (400) when unset. */
export async function analyzeOffer(input: AnalyzeInput): Promise<AiAnalysis> {
  return aiFetch<AiAnalysis>("/api/v1/ai/analyze", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** List recent analyses for the current tenant. */
export async function listAnalyses(): Promise<AiAnalysisSummary[]> {
  const data = await aiFetch<{ items: AiAnalysisSummary[] }>(
    "/api/v1/ai/analyses"
  );
  return data.items ?? [];
}

/** Fetch one full analysis record. */
export async function getAnalysis(id: string): Promise<AiAnalysis> {
  return aiFetch<AiAnalysis>(
    `/api/v1/ai/analyses/${encodeURIComponent(id)}`
  );
}

/** Parse offer terms into structured restrictions. Throws AiApiError with code "AI_NOT_CONFIGURED" (400) when unset. */
export async function analyzeTerms(
  text: string,
  language?: string
): Promise<AiTermsResult> {
  return aiFetch<AiTermsResult>("/api/v1/ai/analyze-terms", {
    method: "POST",
    body: JSON.stringify({ text, language }),
  });
}

export interface TrafficPlanKeywordInput {
  keyword: string;
  volume?: number;
  cpc?: number;
  plannerLow?: number;
  plannerHigh?: number;
  competition?: string;
  density?: number;
  intent?: string;
}

export interface TrafficPlanInput {
  mode: "landing" | "direct";
  brandPolicy: "allowed" | "forbidden";
  offerName: string;
  payout?: number;
  network?: string;
  cookieDays?: number;
  epc?: number;
  networkCvr?: number;
  refundRate?: number;
  bestPayout?: number;
  bestPayoutNetwork?: string;
  competitorAds?: string;
  spyfuKeywords?: string;
  spyfuBudgetTrend?: string;
  similarwebNotes?: string;
  /** 电商产品数据（插件抓 Amazon/Keepa/Shopping 实查）。 */
  ecommerceNotes?: string;
  keywords: TrafficPlanKeywordInput[];
  negativeKeywords: string[];
  targetProfitMargin?: number;
  notes?: string;
  language?: string;
}

export interface TrafficPlanMathRow {
  keyword: string;
  refCpc: number | null;
  breakEvenCvrPct: number | null;
  maxBid: number | null;
  affordable: boolean | null;
  verdict: string;
}

export interface TrafficPlanResult {
  id: string;
  language: string;
  combo: string;
  report: string;
  math: { rows: TrafficPlanMathRow[]; epcVerdict: string | null };
  analyzedAt: string;
}

/** 投流决策分析：2×2 组合 + EPC 优先，返回五板块 markdown 报告。 */
export async function analyzeTrafficPlan(
  input: TrafficPlanInput
): Promise<TrafficPlanResult> {
  return aiFetch<TrafficPlanResult>("/api/v1/ai/traffic-plan", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** AI 推荐关键词思路：只给词和选词理由，不打分（分数必须来自真实数据）。 */
export interface RecommendedKeyword {
  keyword: string;
  reason: string;
  /** capture = 抓取页面里的真实词（带搜索量），ai = AI 现想的思路。 */
  source?: "capture" | "ai";
  /** 抓取词的月搜索量（页面原文）。 */
  volume?: number | null;
}

export async function recommendKeywords(
  product: string,
  count = 10,
  language?: string
): Promise<{ product: string; keywords: RecommendedKeyword[] }> {
  return aiFetch<{ product: string; keywords: RecommendedKeyword[] }>(
    "/api/v1/ai/recommend-keywords",
    {
      method: "POST",
      body: JSON.stringify({ product, count, language }),
    }
  );
}

/** Batch-screen up to 10 offers' terms, ranked go → caution → stop. */
export async function screenOffers(
  items: AiScreenItemInput[],
  language?: string
): Promise<AiScreenResponse> {
  return aiFetch<AiScreenResponse>("/api/v1/ai/screen-offers", {
    method: "POST",
    body: JSON.stringify({ items, language }),
  });
}

/** Check ad URLs for direct-link exposure. */
export async function checkUrls(
  urls: string[],
  ownedDomains?: string[]
): Promise<AiUrlCheckResponse> {
  return aiFetch<AiUrlCheckResponse>("/api/v1/ai/check-urls", {
    method: "POST",
    body: JSON.stringify({ urls, ownedDomains }),
  });
}

/** Profit analysis input: fixed commission or price × percentage ranges. */
import type {
  ProfitAnalysisInput,
  ProfitAnalysisResult,
} from "./profit-types";
export type {
  ProfitAnalysisInput,
  BidSuggestion,
  ProfitScenario,
  ProfitAnalysisResult,
} from "./profit-types";

/** Full profit analysis with bid suggestions (pure math, no LLM). */
export async function analyzeProfit(
  input: ProfitAnalysisInput
): Promise<{ analysis: ProfitAnalysisResult }> {
  return aiFetch<{ analysis: ProfitAnalysisResult }>(
    "/api/v1/ai/profit-analysis",
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
}

/** Amazon 自动选品 */
export interface AmazonDiscoveryCriteria {
  keywords: string[];
  minPrice?: number | null;
  maxPrice?: number | null;
  minRating?: number | null;
  minReviews?: number | null;
  region?: string;
  maxResults?: number;
  opportunityMode?: boolean;
  opportunityMinReviews?: number | null;
  opportunityMinRating?: number | null;
  opportunityMaxRating?: number | null;
}

import type { AmazonScoredProduct } from "./amazon-types";
export type { AmazonScoredProduct } from "./amazon-types";

export async function runAmazonDiscovery(
  criteria: AmazonDiscoveryCriteria
): Promise<{
  runId: string;
  products: AmazonScoredProduct[];
  totalFound: number;
  totalKept: number;
  errors: string[];
}> {
  return aiFetch<{
    runId: string;
    products: AmazonScoredProduct[];
    totalFound: number;
    totalKept: number;
    errors: string[];
  }>("/api/v1/amazon/discover", {
    method: "POST",
    body: JSON.stringify(criteria),
  });
}

export async function importAmazonProducts(
  runId: string,
  asins: string[]
): Promise<{ imported: Array<{ asin: string; offerId: string }>; count: number }> {
  return aiFetch<{ imported: Array<{ asin: string; offerId: string }>; count: number }>(
    `/api/v1/amazon/discoveries/${runId}/import`,
    {
      method: "POST",
      body: JSON.stringify({ asins }),
    }
  );
}

/** 解析 Amazon 产品链接：提取 ASIN + slug 产品名（纯本地解析；BSR 拿不到） */export interface ParsedAmazonUrl {
  asin: string | null;
  name: string | null;
  nameSource: "slug" | "none";
}

export async function parseAmazonProductUrl(url: string): Promise<ParsedAmazonUrl> {
  return aiFetch<ParsedAmazonUrl>("/api/v1/amazon/parse-url", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

/** Keepa 自动筛选单项结果。 */
export interface KeepaValidateItem {
  asin: string;
  verdict: "pass" | "kill" | "unknown";
  reasons: Array<{ code: string; detail: string }>;
  metrics: {
    priceDrop30dPct: number | null;
    rankMaxMinRatio90d: number | null;
    reviewGrowth90d: number | null;
    stockoutDays90d: number | null;
  };
}

/** Keepa API Key 是否已配置。 */
export async function getKeepaStatus(): Promise<{ hasKey: boolean }> {
  return aiFetch<{ hasKey: boolean }>("/api/v1/keepa/status");
}

/** Keepa 自动筛选：逐个 ASIN 查官方 API 并按规则判 pass/kill/unknown。 */
export async function validateKeepa(
  asins: string[],
  country?: string
): Promise<{ results: KeepaValidateItem[] }> {
  return aiFetch<{ results: KeepaValidateItem[] }>("/api/v1/keepa/validate", {
    method: "POST",
    body: JSON.stringify({ asins, country }),
  });
}

/** Keepa 截图 AI 看图判断结果（vision LLM）。 */
export interface KeepaVisionJudgment {
  asin: string | null;
  verdict: "pass" | "kill" | "unknown";
  reasons: string[];
  metrics: {
    priceDrop30dPct: number | null;
    rankStable: boolean | null;
    confidence: "high" | "medium" | "low";
  };
}

/** Vision LLM 是否已配置（AI 设置）。 */
export async function getKeepaVisionStatus(): Promise<{ llmConfigured: boolean }> {
  return aiFetch<{ llmConfigured: boolean }>("/api/v1/keepa/vision-status");
}

/** Keepa 手动输入数字判定的输入（"AI 看图"弹窗手动模式）。 */
export interface KeepaManualInput {
  amazonPriceNow: number;
  amazonPrice30dAgo: number;
  priceLow90d: number;
  priceHigh90d: number;
  rankNow: number | null;
  rankBest90d: number | null;
  rankWorst90d: number | null;
  reviewsNow: number;
  reviews90dAgo?: number | null;
}

/** Keepa 手动输入数字判定结果（纯计算，与 evaluateKeepa 同阈值）。 */
export interface KeepaManualJudgment {
  verdict: "pass" | "kill" | "unknown";
  reasons: Array<{ code: string; detail: string }>;
  metrics: {
    priceDrop30dPct: number | null;
    priceVolatility90dPct: number | null;
    rankRatio90d: number | null;
    reviewGrowth90d: number | null;
  };
}

/** Keepa 手动输入数字判定：纯计算，无外部调用。 */
export async function judgeKeepaManual(
  input: KeepaManualInput
): Promise<KeepaManualJudgment> {
  return aiFetch<KeepaManualJudgment>("/api/v1/keepa/manual-judge", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** 流量门阈值：官网月访问量 / 品牌热度（0-100 相对值）/ 关键词热度（0-100 相对值） */
export interface TrafficThresholds {
  officialSiteMonthlyVisits: number;
  brandInterest: number;
  keywordInterest: number;
}

/** 读取当前流量门阈值。 */
export async function getTrafficThresholds(): Promise<TrafficThresholds> {
  return aiFetch<TrafficThresholds>("/api/v1/traffic/thresholds");
}

/** 更新流量门阈值（body 可只带部分字段），返回更新后的阈值。 */
export async function updateTrafficThresholds(
  input: Partial<TrafficThresholds>
): Promise<TrafficThresholds> {
  return aiFetch<TrafficThresholds>("/api/v1/traffic/thresholds", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/* ---------- Offer 一键推演报告 ---------- */

export interface BlueprintInput {
  offerName: string;
  productDescription: string;
  avgPrice?: number | null;
  commissionType: "percentage" | "fixed";
  commissionValue: number;
  currency?: string;
  targetMarket?: string;
  termsText?: string;
  offerUrl?: string;
  /** offer-fetch 抓到的页面正文（后端广告生成直接用） */
  pageText?: string;
  landingMode: "landing" | "direct";
  brandPolicy: "allowed" | "forbidden";
  keywordCount?: number;
  /** 用户已选的关键词（关键词页/手动输入）：推演优先评估它们，再补充。 */
  seedKeywords?: string[];
}

export interface BlueprintKeyword {
  keyword: string;
  reason: string;
  matchType: "exact" | "phrase";
  source?: "user" | "ai";
}

export interface BlueprintResult {
  offer: {
    name: string;
    productDescription: string;
    avgPrice: number | null;
    commissionType: "percentage" | "fixed";
    commissionValue: number;
    currency: string;
    targetMarket: string;
    landingMode: "landing" | "direct";
    brandPolicy: "allowed" | "forbidden";
  };
  payout: number | null;
  payoutCurrency: string;
  terms: {
    skipped: boolean;
    result: {
      overallVerdict: "go" | "caution" | "stop";
      traffic: Record<string, string>;
      brandBidding: string;
      directLinking: string;
      geoRestrictions: string[];
      caps: string | null;
      payoutTerms: string | null;
      redFlags: Array<{ severity: string; title: string; detail: string }>;
      summary: string;
    } | null;
    error: string | null;
  };
  profit: {
    payout: number | null;
    payoutCurrency: string;
    breakEven: Array<{ cvrPct: number; breakEvenCpc: number | null }>;
    note: string;
  };
  keywords: { items: BlueprintKeyword[]; error: string | null };
  adPlan: {
    plan: {
      campaign: { name: string };
      adGroups: Array<{
        group: {
          name: string;
          keywords: Array<{ text: string; matchType: string }>;
          negativeKeywords: Array<{ text: string; matchType: string }>;
        };
        rsa: {
          headlines: string[];
          descriptions: string[];
          finalUrl: string;
          path1?: string | null;
          path2?: string | null;
        };
      }>;
    } | null;
    error: string | null;
  };
  traffic: { report: string | null; combo: string | null; error: string | null };
  monitor: {
    currency: string;
    stopLossPerKeyword: number | null;
    campaignKillSpend: number | null;
    scaleCpa: number | null;
    testDailyBudget: string;
  };
  verdict: { level: "go" | "caution" | "stop"; reasons: string[] };
  generatedAt: string;
}

/** 生成 Offer 一键推演报告（约 1~2 分钟，4 次 AI 调用）。 */
export async function generateBlueprint(
  input: BlueprintInput,
  language?: string
): Promise<{ blueprint: BlueprintResult }> {
  return aiFetch<{ blueprint: BlueprintResult }>("/api/v1/ai/offer-blueprint", {
    method: "POST",
    body: JSON.stringify({ ...input, language }),
  });
}

/* ---------- Offer 页面元信息抓取 ---------- */

export interface OfferMetaResult {
  finalUrl: string;
  title: string | null;
  description: string | null;
  price: number | null;
  currency: string | null;
  /** 广告生成用的正文（随 blueprint 请求带回后端） */
  text: string;
  /** html=直接抓取，screenshot=无头浏览器截图+OCR，extension=浏览器插件 */
  source: "html" | "screenshot" | "extension";
}

export interface OfferCaptureItem extends OfferMetaResult {
  id: string;
  createdAt: string;
  /** 是否带有插件发来的真实 HTML（落地页拆解用） */
  hasHtml: boolean;
}

export interface OfferCaptureDetail extends OfferCaptureItem {
  html: string | null;
}

/** 浏览器插件抓取记录（最近 10 条）。 */
export async function listOfferCaptures(): Promise<OfferCaptureItem[]> {
  const res = await aiFetch<{ items: OfferCaptureItem[] }>("/api/v1/ai/offer-captures", {
    method: "GET",
  });
  return res.items ?? [];
}

export interface BrandBidder {
  domain: string;
  title: string | null;
  isOfficial: boolean;
}

export type BrandBiddingVerdict = "no_ads" | "official_only" | "non_official_present";

export interface BrandBiddingResult {
  status: "ok" | "unavailable" | "error";
  keyword: string;
  officialDomain: string;
  adsFound: number;
  officialAds: number;
  nonOfficialAds: number;
  nonOfficial: BrandBidder[];
  verdict: BrandBiddingVerdict | null;
  assessment: string[];
  checkedAt: string;
  source: string;
}

export interface ParsedKeywordRow {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  kd: number | null;
  competition: "Low" | "Medium" | "High" | null;
}

export interface ParsedKeywordData {
  keyword: string | null;
  volume: number | null;
  cpc: number | null;
  plannerLow: number | null;
  plannerHigh: number | null;
  competition: "Low" | "Medium" | "High" | null;
  /** 抓取到的表格行（为空时用上面单值字段）。 */
  rows?: ParsedKeywordRow[];
}

export interface EcommerceData {
  price: number | null;
  rating: number | null;
  reviewCount: number | null;
  bsr: number | null;
  bsrCategory: string | null;
}

/** 解析插件抓到的 Amazon / Keepa / Shopping 页面 → 产品数据（找不到为 null）。 */
export async function parseEcommerceCapture(
  captureId: string
): Promise<EcommerceData> {
  return aiFetch<EcommerceData>("/api/v1/ai/parse-ecommerce-capture", {
    method: "POST",
    body: JSON.stringify({ captureId }),
  });
}

export interface AiKeywordRow {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  plannerLow: number | null;
  plannerHigh: number | null;
  competition: "Low" | "Medium" | "High" | null;
  intent: string | null;
}

/** 抓取页面 AI 提取关键词：AI 认表格、逐行提取、判断购买意图。 */
export async function parseKeywordCaptureAi(
  captureId: string,
  language?: string
): Promise<{ rows: AiKeywordRow[] }> {
  return aiFetch<{ rows: AiKeywordRow[] }>("/api/v1/ai/parse-keyword-capture-ai", {
    method: "POST",
    body: JSON.stringify({ captureId, language }),
  });
}

export type IntelKind = "spyfu" | "transparency" | "similarweb" | "negatives";

/** 情报页抓取 AI 提取：只提取该框要的内容，提不出返回 null。 */
export async function parseIntelCapture(
  captureId: string,
  kind: IntelKind,
  language?: string
): Promise<{ summary: string | null }> {
  return aiFetch<{ summary: string | null }>("/api/v1/ai/parse-intel-capture", {
    method: "POST",
    body: JSON.stringify({ captureId, kind, language }),
  });
}

/** 解析插件抓到的 SEMrush / Planner 页面 → 关键词表一行（找不到为 null）。 */
export async function parseKeywordCapture(captureId: string): Promise<ParsedKeywordData> {
  return aiFetch<ParsedKeywordData>("/api/v1/ai/parse-keyword-capture", {
    method: "POST",
    body: JSON.stringify({ captureId }),
  });
}

/** 品牌词投流检查：谁在投这个品牌词（官方 vs 非官方）+ 评估。 */
export async function checkBrandBidding(
  brandKeyword: string,
  officialDomain: string
): Promise<BrandBiddingResult> {
  return aiFetch<BrandBiddingResult>("/api/v1/ai/brand-bidding", {
    method: "POST",
    body: JSON.stringify({ brandKeyword, officialDomain }),
  });
}

/** 单条抓取记录详情（含 HTML）。 */
export async function getOfferCapture(id: string): Promise<OfferCaptureDetail> {
  return aiFetch<OfferCaptureDetail>(`/api/v1/ai/offer-captures/${encodeURIComponent(id)}`, {
    method: "GET",
  });
}

/** 抓取 offer 页面：标题/描述/价格自动提取，抓不到返回 null。 */
export async function fetchOfferMeta(url: string): Promise<OfferMetaResult> {
  return aiFetch<OfferMetaResult>("/api/v1/ai/offer-fetch", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}
