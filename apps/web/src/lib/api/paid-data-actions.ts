"use server";

/**
 * 付费数据（DataForSEO）server actions：
 * - 网关判定预告（前端在付费按钮旁标注计费路径/剩余额度/拒绝原因）
 * - 租户自备 key（BYOK）：状态（脱敏）/ 保存 / 验证 / 删除
 * 凭证只写不回显：GET 只回 configured + verifiedAt（后端 mask 锁死）。
 */
import { EntityApiError, getApiBaseUrl, mapEntityErrorMessage } from "./entities-config";
import { sessionHeaders } from "./session";
import { getLang } from "@/i18n/lang";

export type PaidDataActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const base = getApiBaseUrl();
  const headers = await sessionHeaders();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new EntityApiError(
      res.status,
      (data as { message?: string } | null)?.message ?? `Request failed (${res.status})`
    );
  }
  return data as T;
}

async function attempt<T>(fn: () => Promise<T>): Promise<PaidDataActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, error: mapEntityErrorMessage(error, await getLang()) };
  }
}

export type PaidDataFeatureKey =
  | "keywords-expand"
  | "keywords-intent"
  | "keywords-ad-measure"
  | "catalog-ad-count"
  | "serp-ads"
  | "brand-bidding";

export interface PaidDataAccessInfo {
  feature: string;
  allowed: boolean;
  keySource: "platform" | "tenant-own" | "owner" | null;
  credentialsConfigured: boolean;
  remainingCalls: number | null;
  reason?: "no_grant" | "expired" | "cap_exceeded";
  tenantOwnConfigured: boolean;
}

/** 网关判定预告（只判定不消费）：供付费按钮旁标注计费路径。 */
export async function getPaidDataAccessAction(feature: PaidDataFeatureKey) {
  return attempt(() =>
    apiFetch<PaidDataAccessInfo>(`/api/v1/paid-data/access?feature=${feature}`)
  );
}

export interface TenantDataForSeoStatus {
  configured: boolean;
  verifiedAt: string | null;
}

export async function getTenantDataForSeoStatusAction() {
  return attempt(() => apiFetch<TenantDataForSeoStatus>("/api/v1/settings/dataforseo"));
}

export async function saveTenantDataForSeoAction(login: string, password: string) {
  return attempt(() =>
    apiFetch<TenantDataForSeoStatus & { saved: boolean }>("/api/v1/settings/dataforseo", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login, password }),
    })
  );
}

export async function deleteTenantDataForSeoAction() {
  return attempt(() =>
    apiFetch<{ configured: boolean; deleted: boolean }>("/api/v1/settings/dataforseo", {
      method: "DELETE",
    })
  );
}

export async function verifyTenantDataForSeoAction(login?: string, password?: string) {
  return attempt(() =>
    apiFetch<{ verified: boolean; login: string | null; balance: number | null }>(
      "/api/v1/settings/dataforseo/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login, password }),
      }
    )
  );
}

/* ── Offer 一键初筛（与商品库同一阶梯，结论写回 Offer 徽标字段） ──
 * 返回里附加 hotPicks（可能热销推荐榜）：与 outcomes 并存、不互相
 * 覆盖；推荐仅供人工复核，绝不改变初筛结论。 */

export interface HotPicksResult {
  picks: Array<{
    offerId: string;
    name: string;
    brandName: string | null;
    category: string | null;
    asin: string | null;
    productId: string | null;
    price: number | null;
    commissionRate: number | null;
    commissionUsd: number;
    rating: number | null;
    reviewCount: number | null;
    monthlySales: number | null;
    seasonalEvidence: string;
    promoUrl: string;
    riskCost: string[];
    reasons: string[];
    prescreenVerdict: "go" | "unknown" | "stop" | null;
    verdictNote: string;
  }>;
  droppedByBrand: Array<{
    offerId: string;
    name: string;
    brandName: string | null;
    reasons: string[];
  }>;
  counts: { picks: number; droppedByBrand: number; notRecommended: number };
}

export interface OfferPrescreenResult {
  outcomes: Array<{ offerId: string; verdict: "go" | "unknown" | "stop"; reason: string }>;
  counts: { go: number; unknown: number; stop: number; notFound: number };
  skippedPaidLayer: boolean;
  /** 付费数据层被降级的原因（如站长未配 DataForSEO）。 */
  paidLayerError?: string | null;
  hotPicks?: HotPicksResult;
}

export async function prescreenOffersAction(
  ids: string[],
  opts: {
    excludedBrands?: string[];
    excludedCategories?: string[];
    evidence?: LooseScreenEvidence;
  } = {}
) {
  return attempt(() =>
    apiFetch<OfferPrescreenResult>("/api/v1/offers/prescreen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ids: ids.slice(0, 50),
        ...(opts.excludedBrands?.length
          ? { excludedBrands: opts.excludedBrands }
          : {}),
        ...(opts.excludedCategories?.length
          ? { excludedCategories: opts.excludedCategories }
          : {}),
        ...(opts.evidence ? { evidence: opts.evidence } : {}),
      }),
    })
  );
}

/* ── 宽松型筛查（mode=loose）：只作本轮筛查报告，不写回初筛徽标 ── */

export interface LooseScreenEvidence {
  seasonal?: Record<string, string>;
  stock?: Record<string, "in_stock" | "out_of_stock">;
  rating?: Record<string, number>;
  reviewCount?: Record<string, number>;
  monthlySales?: Record<string, number>;
  epcUsd?: Record<string, number>;
  conversionRate?: Record<string, number>;
  /** 目标 CPC（美元/点击）：给出后引擎按每点击期望利润排序，并算保本 CVR。 */
  cpc?: Record<string, number>;
  lowPriceTraffic?: Record<string, "winnable" | "not_winnable">;
}

export interface LooseScreenResult {
  mode: "loose";
  qualified: Array<{
    offerId: string;
    name: string;
    brandName: string | null;
    category: string | null;
    asin: string | null;
    productId: string | null;
    price: number | null;
    commissionRate: number | null;
    commissionUsd: number;
    stock: "in_stock";
    rating: number | null;
    reviewCount: number | null;
    monthlySales: number | null;
    seasonalEvidence: string;
    lowPriceTraffic: "winnable" | "unknown";
    epcUsd: number | null;
    conversionRate: number | null;
    /** 该条 EPC / 转化率是投放实测、人工假设，还是无数据。 */
    epcSource?: "measured" | "assumed" | "unknown";
    conversionSource?: "measured" | "assumed" | "unknown";
    /** 可采信的实测点击样本量；0 = 无实测。 */
    measuredClicks?: number;
    /** 实测拒单率（0–1）；null = 无数据，未做扣减。 */
    rejectionRate?: number | null;
    /** 扣拒单率后的净 EPC。 */
    netEpcUsd?: number | null;
    /** 生效的 CPC（人工填优先，其次 Google Ads 实测）。 */
    cpcExpected?: number | null;
    /** CPC 来源：manual / measured / unknown。 */
    cpcSource?: "manual" | "measured" | "unknown";
    /** 每点击期望利润 = 净EPC − CPC。 */
    profitPerClick?: number | null;
    /** 保本转化率（%）：这个 Offer 需要多高的 CVR 才不亏。 */
    breakevenCvr?: number | null;
    /** 经济性判定：viable ≤5% / marginal ≤10% / unviable >10%。 */
    economics?: "unknown" | "viable" | "marginal" | "unviable";
    promoUrl: string;
    riskCost: string[];
  }>;
  dropped: Array<{
    offerId: string;
    name: string;
    brandName: string | null;
    reasons: string[];
  }>;
  counts: { qualified: number; dropped: number; notFound: number };
}

export async function looseScreenOffersAction(
  ids: string[],
  opts: {
    minCommissionUsd?: number;
    excludedBrands?: string[];
    excludedCategories?: string[];
    evidence?: LooseScreenEvidence;
  } = {}
) {
  return attempt(() =>
    apiFetch<LooseScreenResult>("/api/v1/offers/prescreen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ids: ids.slice(0, 50),
        mode: "loose",
        ...(opts.minCommissionUsd !== undefined
          ? { minCommissionUsd: opts.minCommissionUsd }
          : {}),
        ...(opts.excludedBrands?.length
          ? { excludedBrands: opts.excludedBrands }
          : {}),
        ...(opts.excludedCategories?.length
          ? { excludedCategories: opts.excludedCategories }
          : {}),
        ...(opts.evidence ? { evidence: opts.evidence } : {}),
      }),
    })
  );
}

/* ── 关键词推荐（按保本 CPC 给候选词，不编造搜索量） ── */

export interface KeywordSuggestionDto {
  keyword: string;
  intent: "transactional" | "commercial" | "informational";
  matchType: "exact" | "phrase";
  maxCpcUsd: number | null;
  verdict: "test" | "skip" | "blocked";
  note: string;
}

export interface KeywordRecommendResult {
  offerId: string;
  payoutUsd: number | null;
  riskCost: string[];
  brandBiddingForbidden: boolean;
  core: string;
  maxCpcUsd: number | null;
  breakeven: {
    netPayoutUsd: number;
    targetCvrPct: number;
    rejectionRate: number;
    refundRate: number;
  } | null;
  suggestions: KeywordSuggestionDto[];
  /** 长尾候选（规格词重组），不含搜索量。 */
  longTail?: Array<{ keyword: string; basis: string; note: string }>;
  skipped: Array<{ keyword: string; reason: string }>;
  notes: string[];
}

export async function recommendKeywordsAction(
  offerId: string,
  opts: { targetCvrPct?: number; maxKeywords?: number } = {}
) {
  return attempt(() =>
    apiFetch<KeywordRecommendResult>("/api/v1/keywords/recommend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        offerId,
        ...(opts.targetCvrPct !== undefined
          ? { targetCvrPct: opts.targetCvrPct }
          : {}),
        ...(opts.maxKeywords !== undefined
          ? { maxKeywords: opts.maxKeywords }
          : {}),
      }),
    })
  );
}
