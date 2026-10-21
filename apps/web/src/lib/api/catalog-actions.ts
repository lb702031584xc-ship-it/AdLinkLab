"use server";

/**
 * Product catalog (商品库) — server actions (2026-10-18).
 * Server-side only: forwards the user's session cookie to the API.
 *
 * Backend contract (per parent-orchestrated spec):
 *   GET  /api/v1/catalog/products?networkId=&recommended=&q=&page=&pageSize=&minAdCount=&hasAds=
 *   POST /api/v1/catalog/sync {networkId, brandId?}      → {jobId, status} 后台任务（B6 grant required; 403 → apply at /admin/grants）
 *   GET  /api/v1/catalog/sync-jobs[/:id]                同步任务列表/轮询
 *   GET  /api/v1/catalog/funnel?networkId=              可投流漏斗计数
 *   GET  /api/v1/catalog/screening-preset
 *   PUT  /api/v1/catalog/screening-preset                (autoCreate* fields admin-only; 403 otherwise)
 *   POST /api/v1/catalog/screen {networkId?}
 *   POST /api/v1/catalog/session {networkId, sessionCookie}
 *   GET  /api/v1/catalog/session-status?networkId=
 *   PUT  /api/v1/networks/:id/sync-mode {syncMode, confirmTosRisk}
 *   POST /api/v1/catalog/offers/batch {productIds: 1-50}
 * Sync-mode/session fields also ride on GET /api/v1/networks.
 */
import { revalidatePath } from "next/cache";
import {
  EntityApiError,
  getApiBaseUrl,
  mapEntityErrorMessage,
} from "./entities-config";
import { sessionHeaders } from "./session";
import { getLang } from "@/i18n/lang";

export type CatalogActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; forbidden?: boolean };

export type SyncMode = "api" | "session";
export type SessionStatus = "NEVER" | "OK" | "EXPIRED" | "FAILED";

export interface CatalogNetwork {
  id: string;
  name: string;
  kind: string;
  website: string | null;
  apiConfigured: boolean;
  apiBaseUrl: string | null;
  lastPullAt: string | null;
  pullStatus: string;
  pullError: string | null;
  status: string;
  syncMode: SyncMode;
  sessionConfigured: boolean;
  sessionStatus: SessionStatus;
  /** 登录用户名（明文可显示；未设置 → null）。 */
  sessionUsername?: string | null;
  /** 是否已设置登录密码（只返回布尔值，密码永不回显）。 */
  sessionPasswordSet?: boolean;
  /** 登录态有效期天数（null → 默认 30）。 */
  sessionValidDays?: number | null;
  /** 上次登录/刷新时间（ISO）。 */
  lastLoginAt?: string | null;
  /** 登录态到期时间（ISO；算不出 → null）。 */
  sessionExpiresAt?: string | null;
}

/** 广告趋势：first 首次计算 | new 新投 | stopped 疑似停投 | active 持续在投 | none 无信息量（0→0）；null = 未计算。 */
export type AdTrend = "first" | "new" | "stopped" | "active" | "none";

export interface CatalogProduct {
  id: string;
  networkId: string;
  networkKind: string;
  networkName?: string | null;
  externalId: string | null;
  /** 数字型商品主键（主键ID 列展示；无数字 id 时回退 externalId）。 */
  productId?: string | null;
  mid?: string | null;
  name: string;
  brand: string | null;
  asin: string | null;
  price: number | null;
  commissionAmount: number | null;
  commissionRate: number | null;
  currency: string | null;
  reviewCount: number | null;
  recommended: boolean;
  recommendationScore: number | null;
  promoUrl: string | null;
  syncedAt: string | null;
  createdAt?: string | null;
  landingPageType: string | null;
  countryCode: string | null;
  status: string;
  /** 广告投放数量（按品牌查 SERP；null = 未计算；Amazon 商品 self/others 为 null）。 */
  adCount?: number | null;
  adCountSelf?: number | null;
  adCountOthers?: number | null;
  adCountCheckedAt?: string | null;
  /** 上次广告数快照（趋势对比用；null = 无上次记录）。 */
  lastAdCount?: number | null;
  lastAdCountAt?: string | null;
  /** 广告趋势标记（后端按 lastAdCount vs adCount 算出；null = 未计算）。 */
  adTrend?: AdTrend | null;
  /** 广告落地类型拆分：落地页为品牌首页/旗舰店的条数（null = 未知/未拆分）。 */
  adCountHome?: number | null;
  /** 广告落地类型拆分：落地页为单个商品页的条数；判不了类型的不计入，total 不变。 */
  adCountProduct?: number | null;
  /** Optional for forward-compat: the backend list-flag batch is still landing. */
  blacklisted?: boolean;
  whitelisted?: boolean;
  pinned?: boolean;
  /** 商家维度：后端新契约正在落地，可无，防御性读取。 */
  merchantName?: string | null;
  merchantId?: string | null;
  /** 补强 #1：所属商家结算率（百分比；null = 未验证，不编造）。 */
  settlementRatePct?: number | null;
  /** 补强 #3：备选池阶段 inbox | pool | testing | live。 */
  poolStage?: PoolStage | string | null;
  /** 补强 #4：offer 通过率（百分比；null = 未知，显示「—」）。 */
  approvalRatePct?: number | null;
  /** 补强 #4：返款/结算周期天数（null = 未知）。 */
  payoutCycleDays?: number | null;
  /** 商品级测试优先分（后端与 Offer 侧同构公式现算）：分数 0–100 + 理由短标签。 */
  testPriority?: { score: number; reasons: string[] } | null;
  /** 探针明细（组级，本次计算实际跑的全部探针逐条）；null = 未按明细口径计算过。 */
  adProbeDetail?: AdProbeDetailEntry[] | null;
  /** 一键筛选结论（未筛 → null）：pass | kill | review。 */
  screenVerdict?: string | null;
  screenReason?: string | null;
  screenedAt?: string | null;
}

/** 补强 #3：备选池阶段。 */
export type PoolStage = "inbox" | "pool" | "testing" | "live"; // 阶段值域（"use server" 文件禁止导出常量，需要列表时在客户端本地定义）

export interface ScreeningPreset {
  minReviews: number | null;
  minCommissionAmount: number | null;
  minCommissionRate: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  minScore: number | null;
  autoCreateOffer: boolean;
  autoCreateTopN: number;
}

export interface SyncResult {
  synced: number;
  created: number;
  updated: number;
  recommended: number;
  autoCreatedOffers: number;
  /** $8 佣金门槛（第一道）跳过的商品数：不入库，只计数。 */
  skippedLowCommission?: number;
  /** 业务跳过（黑名单账号 / 登录态过期等）：true 时原因看 skipReason。 */
  skipped?: boolean;
  skipReason?: string;
  /** 同步范围：full（全量）/ brand（按商家）。 */
  scope?: "full" | "brand";
  /** 按商家同步时的 brand_id。 */
  brandId?: string;
  /** 消失判定被守卫跳过的原因（brand_scope / circuit_breaker）。 */
  disappearedSkipped?: string;
}

/** 后台同步任务（POST /catalog/sync 建行，后端异步执行，前端轮询）。 */
export interface CatalogSyncJob {
  id: string;
  networkId: string;
  scope: "full" | "brand";
  brandId: string | null;
  status: "queued" | "running" | "succeeded" | "failed" | "skipped";
  /** 最近阶段：pulled / upserted / scored / offers / done；未开始为 null。 */
  stage: string | null;
  /** 终态时为完整 SyncResult；执行中为最近阶段的 partial（勿当完整结果用）。 */
  result: SyncResult | null;
  error: string | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/** 可投流漏斗计数（GET /catalog/funnel）。 */
export interface CatalogFunnel {
  total: number;
  passedGate: number;
  recommended: number;
  launchable: number;
  /** adCount >= 1 的商品数（未计算的不计入）。 */
  withAds: number;
  /** 算不出时后端给 null → UI 显示 "—"。 */
  offersCreated: number | null;
}

/**
 * 保存登录账号（用户名/密码/有效期）。密码只写不读：后端加密存储，
 * GET 永不回显；留空 = 不修改已保存的密码。
 */
export async function saveSessionCredentialsAction(
  networkId: string,
  input: { username?: string; password?: string; sessionValidDays?: number }
) {
  if (
    input.password &&
    new TextEncoder().encode(input.password).length > 8 * 1024
  ) {
    return { ok: false as const, error: "密码过长（上限 8KB）" };
  }
  return attempt(
    () =>
      apiFetch<{ saved: boolean }>("/api/v1/catalog/session-credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ networkId, ...input }),
      }),
    ["/catalog"]
  );
}

export interface BatchCreateResult {
  created: Array<{ offerId: string; productId: string }>;
  /** Idempotent replays: an Offer already exists for the product (not re-created, not a failure). */
  skippedExisting?: Array<{ offerId: string; productId: string }>;
  failed: Array<{ productId: string; reason: string }>;
  /** Blacklisted products skipped by batch offer creation (not created). Optional until the backend batch lands. */
  skippedBlacklist?: Array<{ productId: string; reason: string }>;
}

// ---------- 黑白名单 ----------

export type BlacklistEntityType =
  | "merchant"
  | "network_account"
  | "product"
  | "offer";
export type BlacklistSource = "auto" | "manual";
export type WhitelistSource = "manual" | "suggested";
export type RecheckOutcome = "still_blocked" | "recovered" | "unknown";
/** 渠道维度：返利网 / 联盟 / 亚马逊（同一商家在不同渠道表现可能不同）。 */
export type CatalogChannel = "cashback" | "affiliate" | "amazon";
/** 名单条目状态：active 正常；removed 已移除，进入观察期。 */
export type ListEntryStatus = "active" | "removed";

export interface BlacklistEntry {
  id: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  networkKind: string;
  reason: string;
  firstSeenAt: string | null;
  lastConfirmedAt: string | null;
  source: BlacklistSource;
  /** 以下字段后端新契约正在落地中，先做可选防御。 */
  channel?: string | null;
  status?: ListEntryStatus;
  removeReason?: string | null;
  observationUntil?: string | null;
}

export interface WhitelistEntry {
  id: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  note: string | null;
  source: WhitelistSource;
  suggestedAt: string | null;
  /** 以下字段后端新契约正在落地中，先做可选防御。 */
  channel?: string | null;
  status?: ListEntryStatus;
  removeReason?: string | null;
  observationUntil?: string | null;
}

export interface RecheckResult {
  result: RecheckOutcome;
  detail?: string | null;
}

export interface MerchantSignal {
  periodStart: string;
  periodDays: number;
  ownConversions: number | null;
  networkOrders: number | null;
  shavePct: number | null;
  adSpend: number | null;
  commission: number | null;
  roas: number | null;
  pendingOrders: number | null;
  oldestPendingDays: number | null;
}

export interface MerchantEvaluateResult {
  evaluated: number;
  blacklisted: Array<{
    merchantId: string;
    merchantName: string | null;
    reason: string;
  }>;
}

export async function listBlacklistAction(entityType?: string, channel?: string) {
  const qs = new URLSearchParams();
  if (entityType) qs.set("entityType", entityType);
  if (channel) qs.set("channel", channel);
  // 观察期条目（status=removed）也一并返回，前端展示观察期徽标。
  qs.set("includeRemoved", "true");
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return attempt(
    () =>
      apiFetch<{ items: BlacklistEntry[]; total: number }>(
        `/api/v1/catalog/blacklist${suffix}`
      ).then((r) => r.items),
    []
  );
}

export async function addBlacklistAction(input: {
  entityType: string;
  entityId: string;
  reason: string;
  channel?: string;
}) {
  return attempt(
    () =>
      apiFetch<BlacklistEntry>("/api/v1/catalog/blacklist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    ["/catalog"]
  );
}

/** 批量导入黑名单（逐条校验；已存在 active 跳过；单次上限 200 条）。 */
export async function importBlacklistAction(
  items: Array<{
    entityType: string;
    entityId: string;
    reason: string;
    channel?: string;
  }>
) {
  return attempt(
    () =>
      apiFetch<{
        added: number;
        skipped: number;
        errors: Array<{ index: number; entityId: string; message: string }>;
      }>("/api/v1/catalog/blacklist/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      }),
    ["/catalog"]
  );
}

/**
 * Admin-only on the backend (403 otherwise). reason 必填；
 * 后端改为软删除：条目 status → "removed"，进入观察期。
 */
export async function deleteBlacklistAction(id: string, reason: string) {
  if (!reason.trim()) {
    return { ok: false as const, error: "Remove reason is required" };
  }
  return attempt(
    () =>
      apiFetch<BlacklistEntry>(
        `/api/v1/catalog/blacklist/${encodeURIComponent(id)}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: reason.trim() }),
        }
      ),
    ["/catalog"]
  );
}

/** Manual recheck — never auto-removes. */
export async function recheckBlacklistAction(id: string) {
  return attempt(
    () =>
      apiFetch<RecheckResult>(
        `/api/v1/catalog/blacklist/${encodeURIComponent(id)}/recheck`,
        { method: "POST" }
      ),
    ["/catalog"]
  );
}

export async function listWhitelistAction(channel?: string) {
  const qs = channel ? `?channel=${encodeURIComponent(channel)}` : "";
  return attempt(
    () =>
      apiFetch<{ items: WhitelistEntry[] }>(
        `/api/v1/catalog/whitelist${qs}`
      ).then((r) => r.items),
    []
  );
}

export async function addWhitelistAction(input: {
  entityType: string;
  entityId: string;
  note?: string;
  channel?: string;
}) {
  return attempt(
    () =>
      apiFetch<WhitelistEntry>("/api/v1/catalog/whitelist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    ["/catalog"]
  );
}

export async function deleteWhitelistAction(id: string) {
  return attempt(
    () =>
      apiFetch<{ ok: boolean }>(
        `/api/v1/catalog/whitelist/${encodeURIComponent(id)}`,
        { method: "DELETE" }
      ),
    ["/catalog"]
  );
}

/** 手动触发商家评估（阈值 + 连续周期自动判定在后端完成）。 */
export async function evaluateMerchantsAction(channel?: string) {
  return attempt(
    () =>
      apiFetch<MerchantEvaluateResult>("/api/v1/catalog/merchants/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(channel ? { channel } : {}),
      }),
    ["/catalog"]
  );
}

/** 商家信号历史：只返回证据数字，不做判定。 */
export async function listMerchantSignalsAction(
  merchantId: string,
  channel?: string
) {
  const qs = new URLSearchParams({ merchantId });
  if (channel) qs.set("channel", channel);
  return attempt(
    () =>
      apiFetch<{ signals: MerchantSignal[] }>(
        `/api/v1/catalog/merchants/signals?${qs.toString()}`
      ).then((r) => r.signals),
    []
  );
}

export async function confirmWhitelistAction(id: string) {
  return attempt(
    () =>
      apiFetch<WhitelistEntry>(
        `/api/v1/catalog/whitelist/${encodeURIComponent(id)}/confirm`,
        { method: "POST" }
      ),
    ["/catalog"]
  );
}

async function attempt<T>(
  fn: () => Promise<T>,
  revalidate: string[]
): Promise<CatalogActionResult<T>> {
  try {
    const data = await fn();
    for (const p of revalidate) revalidatePath(p);
    return { ok: true, data };
  } catch (error) {
    const forbidden =
      error instanceof EntityApiError && error.status === 403;
    return {
      ok: false,
      error: mapEntityErrorMessage(error, await getLang()),
      forbidden,
    };
  }
}

async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const base = getApiBaseUrl();
  const headers = await sessionHeaders();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      detail = body.message ?? body.error ?? "";
    } catch {
      /* ignore */
    }
    throw new EntityApiError(
      res.status,
      detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`
    );
  }
  return (await res.json()) as T;
}

/** All networks; the client filters to partnerboost/yeahpromos kinds. */
export async function listCatalogNetworksAction() {
  return attempt(
    () =>
      apiFetch<{ networks: CatalogNetwork[] }>("/api/v1/networks").then(
        (r) => r.networks
      ),
    []
  );
}

/**
 * 发起同步：后端只建后台任务并立即返回 {jobId, status}，
 * 真正结果经 getSyncJobAction 轮询拿（job.result）。
 */
export async function syncCatalogAction(networkId: string, brandId?: string) {
  return attempt(
    () =>
      apiFetch<{ jobId: string; status: string }>("/api/v1/catalog/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          networkId,
          ...(brandId?.trim() ? { brandId: brandId.trim() } : {}),
        }),
      }),
    []
  );
}

export async function getSyncJobAction(jobId: string) {
  return attempt(
    () =>
      apiFetch<{ job: CatalogSyncJob }>(
        `/api/v1/catalog/sync-jobs/${encodeURIComponent(jobId)}`
      ).then((r) => r.job),
    []
  );
}

export async function listSyncJobsAction(networkId?: string) {
  const qs = networkId
    ? `?networkId=${encodeURIComponent(networkId)}`
    : "";
  return attempt(
    () =>
      apiFetch<{ jobs: CatalogSyncJob[] }>(
        `/api/v1/catalog/sync-jobs${qs}`
      ).then((r) => r.jobs),
    []
  );
}

export async function getCatalogFunnelAction(networkId?: string) {
  const qs = networkId
    ? `?networkId=${encodeURIComponent(networkId)}`
    : "";
  return attempt(
    () => apiFetch<CatalogFunnel>(`/api/v1/catalog/funnel${qs}`),
    []
  );
}

export async function getScreeningPresetAction() {
  return attempt(
    () =>
      apiFetch<{ preset: ScreeningPreset; saved: boolean }>(
        "/api/v1/catalog/screening-preset"
      ),
    []
  );
}

/**
 * Save the screening preset. Admin-only fields (autoCreateOffer/autoCreateTopN)
 * are only sent when `admin` is true — a non-admin sending them gets 403.
 */
export async function saveScreeningPresetAction(input: {
  minReviews: number | null;
  minCommissionAmount: number | null;
  minCommissionRate: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  minScore: number | null;
  autoCreateOffer?: boolean;
  autoCreateTopN?: number;
  admin?: boolean;
}) {
  const body: Record<string, number | boolean | null> = {
    minReviews: input.minReviews,
    minCommissionAmount: input.minCommissionAmount,
    minCommissionRate: input.minCommissionRate,
    minPrice: input.minPrice,
    maxPrice: input.maxPrice,
    minScore: input.minScore,
  };
  if (input.admin) {
    if (typeof input.autoCreateOffer === "boolean")
      body.autoCreateOffer = input.autoCreateOffer;
    if (typeof input.autoCreateTopN === "number")
      body.autoCreateTopN = input.autoCreateTopN;
  }
  return attempt(
    () =>
      apiFetch<{ preset: ScreeningPreset }>(
        "/api/v1/catalog/screening-preset",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      ).then((r) => r.preset),
    ["/catalog"]
  );
}

export async function screenCatalogAction(networkId?: string) {
  return attempt(
    () =>
      apiFetch<{ screened: number; recommended: number }>(
        "/api/v1/catalog/screen",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(networkId ? { networkId } : {}),
        }
      ),
    ["/catalog"]
  );
}

/** Max session-cookie payload accepted by the backend: 8KB. Module-private: "use server" files may only export async functions. */
const MAX_SESSION_COOKIE_BYTES = 8 * 1024;

export async function saveSessionCookieAction(
  networkId: string,
  sessionCookie: string
) {
  if (new TextEncoder().encode(sessionCookie).length > MAX_SESSION_COOKIE_BYTES) {
    return {
      ok: false as const,
      error: "Cookie exceeds the 8KB limit",
    };
  }
  return attempt(
    () =>
      apiFetch<{ ok: boolean }>("/api/v1/catalog/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ networkId, sessionCookie }),
      }),
    ["/catalog"]
  );
}

export async function getSessionStatusAction(networkId: string) {
  return attempt(
    () =>
      apiFetch<{ status: SessionStatus; updatedAt: string | null }>(
        `/api/v1/catalog/session-status?networkId=${encodeURIComponent(
          networkId
        )}`
      ),
    []
  );
}

export async function setSyncModeAction(
  networkId: string,
  syncMode: SyncMode,
  confirmTosRisk: boolean
) {
  return attempt(
    () =>
      apiFetch<CatalogNetwork>(
        `/api/v1/networks/${encodeURIComponent(networkId)}/sync-mode`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ syncMode, confirmTosRisk }),
        }
      ),
    ["/catalog"]
  );
}

export async function listCatalogProductsAction(params: {
  networkId?: string;
  recommended?: boolean;
  q?: string;
  page?: number;
  pageSize?: number;
  /** false → preset=0，关闭预设自动过滤；默认开启。 */
  preset?: boolean;
  /** 排序：id_desc（默认）/id_asc/price_desc/price_asc/reviews_desc/reviews_asc/score_desc/score_asc/created_desc/created_asc/recommended */
  sort?: string;
  /** 广告投放数量下限（adCount >= 值；未计算的不命中）。 */
  minAdCount?: number;
  /** 广告投放数量上限（adCount <= 值；与 minAdCount 合成区间，「甜蜜点」= 1–20）。 */
  maxAdCount?: number;
  /** 投放国家代码（两位大写，如 CA；不传 = 不限国家）。 */
  country?: string;
  /** true → 只看有广告在投的（adCount > 0）。 */
  hasAds?: boolean;
  /** 补强 #3：备选池阶段过滤（不传 = 全部阶段）。 */
  poolStage?: PoolStage;
}) {
  const qs = new URLSearchParams();
  if (params.networkId) qs.set("networkId", params.networkId);
  if (typeof params.recommended === "boolean")
    qs.set("recommended", String(params.recommended));
  if (params.q) qs.set("q", params.q);
  if (params.preset === false) qs.set("preset", "0");
  if (params.sort) qs.set("sort", params.sort);
  if (params.minAdCount != null && params.minAdCount > 0)
    qs.set("minAdCount", String(Math.floor(params.minAdCount)));
  if (params.maxAdCount != null && params.maxAdCount >= 0)
    qs.set("maxAdCount", String(Math.floor(params.maxAdCount)));
  if (params.country) qs.set("country", params.country);
  if (params.hasAds) qs.set("hasAds", "1");
  if (params.poolStage) qs.set("poolStage", params.poolStage);
  qs.set("page", String(params.page ?? 1));
  qs.set("pageSize", String(params.pageSize ?? 20));
  return attempt(
    () =>
      apiFetch<{
        items: CatalogProduct[];
        total: number;
        page: number;
        pageSize: number;
        presetApplied?: boolean;
        presetExcluded?: number;
      }>(`/api/v1/catalog/products?${qs.toString()}`),
    []
  );
}

/** 投放国家清单（当前租户在库商品出现过的国家代码，供列表国家筛选下拉）。 */
export async function listCatalogCountriesAction(networkId?: string) {
  const qs = new URLSearchParams();
  if (networkId) qs.set("networkId", networkId);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return attempt(
    () =>
      apiFetch<{ countries: string[] }>(`/api/v1/catalog/countries${suffix}`),
    []
  );
}

/* ── 品牌视图（按品牌聚合：品牌分排序 + Top 商品 + 品牌落地页） ── */

/** 品牌广告分档（与后端 brands 接口契约一致；注意 redocean 无下划线）。 */
export type AdBandKey = "none" | "small" | "sweet" | "hot" | "redocean";

/**
 * 探针明细一条（与后端 adProbeDetail 契约一致）：一次广告数计算实际跑的
 * 一条探针——q 查询词、kind 类型（bare 裸品牌词 / model 型号 / category
 * 类目）、paid 文字广告数、shopping 购物广告数、total 合计。
 * 这是单次搜索快照，不是该品牌广告总量。
 */
export interface AdProbeDetailEntry {
  q: string;
  kind: "bare" | "model" | "category";
  paid: number;
  shopping: number;
  total: number;
}

/** 品牌投放方式显式标注：brand 品牌页投放 / product 单品投放；null = 未标注。 */
export type BrandPromoMode = "brand" | "product";

export interface CatalogBrandTopProduct {
  id: string;
  name: string;
  price: number | null;
  ratePct: number | null;
  commissionUsd: number | null;
  score: number | null;
  promoUrl: string | null;
  poolStage: string | null;
}

export interface CatalogBrand {
  brand: string;
  brandKey: string;
  countryCode: string | null;
  networkId: string;
  productCount: number;
  priceMin: number | null;
  priceMax: number | null;
  maxRatePct: number | null;
  maxCommissionUsd: number | null;
  ge80Count: number;
  adCount: number | null;
  adCountSelf: number | null;
  adCountOthers: number | null;
  /** 广告落地类型拆分：落品牌首页/旗舰店条数、落单个商品页条数（null = 未知）。 */
  adCountHome: number | null;
  adCountProduct: number | null;
  lastAdCount: number | null;
  adTrend: AdTrend | null;
  adBand: AdBandKey | null;
  brandScore: number;
  /** 探针明细（品牌+国家组级，取组内第一个非 null；null = 未按明细口径计算过）。 */
  adProbeDetail?: AdProbeDetailEntry[] | null;
  /** 品牌落地页链接（旗舰店/官网首页）；null = 未填链接（不代表单品，投放方式看 promoMode）。 */
  landingUrl: string | null;
  /** 投放方式显式标注（用户在品牌行手动标）：brand/product；null = 未标注。 */
  promoMode: BrandPromoMode | null;
  topProducts: CatalogBrandTopProduct[];
}

/** 品牌榜：后端已按 brandScore 降序，前端不要重排。 */
export async function listCatalogBrandsAction(params?: {
  networkId?: string;
  country?: string;
  q?: string;
}) {
  const qs = new URLSearchParams();
  if (params?.networkId) qs.set("networkId", params.networkId);
  if (params?.country) qs.set("country", params.country);
  if (params?.q) qs.set("q", params.q);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return attempt(
    () =>
      apiFetch<{ brands: CatalogBrand[]; total: number }>(
        `/api/v1/catalog/brands${suffix}`
      ),
    []
  );
}

/**
 * 保存品牌落地页链接 / 投放方式标注（同一端点）：
 * landingUrl="" = 清除链接；promoMode 省略 = 不改、null = 清回未标注；
 * landingUrl 与 promoMode 至少给一个。
 */
export async function saveBrandLandingUrlAction(input: {
  networkId: string;
  brandKey: string;
  countryCode: string | null;
  landingUrl?: string;
  promoMode?: BrandPromoMode | null;
}) {
  return attempt(
    () =>
      apiFetch<{
        ok: boolean;
        landingUrl: string | null;
        promoMode: BrandPromoMode | null;
      }>("/api/v1/catalog/brands/landing-url", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    ["/catalog"]
  );
}

/** 从 rawData 回填 brand/asin/price/reviewCount（只补空，不覆盖）。 */
export async function backfillCatalogProductsAction(networkId?: string) {
  return attempt(
    () =>
      apiFetch<{ scanned: number; backfilled: number; normalizedIds?: number }>(
        "/api/v1/catalog/products/backfill",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(networkId ? { networkId } : {}),
        }
      ),
    ["/catalog"]
  );
}

export async function batchCreateOffersAction(productIds: string[]) {
  const ids = productIds.slice(0, 50);
  if (ids.length === 0) {
    return { ok: false as const, error: "No products selected" };
  }
  return attempt(() => apiFetch<BatchCreateResult>("/api/v1/catalog/offers/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productIds: ids }),
  }), ["/catalog", "/offers"]);
}

export async function calcScoreAction(productIds: string[]) {
  if (productIds.length === 0) {
    return { ok: false as const, error: "No products selected" };
  }
  return attempt(() => apiFetch<{ updated: number; requested: number }>(
    "/api/v1/catalog/products/calc-score",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: productIds }),
    }
  ), ["/catalog"]);
}

export async function offlineProductsAction(productIds: string[]) {
  if (productIds.length === 0) {
    return { ok: false as const, error: "No products selected" };
  }
  return attempt(() => apiFetch<{ updated: number; requested: number }>(
    "/api/v1/catalog/products/offline",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: productIds }),
    }
  ), ["/catalog"]);
}

export interface CalcAdCountResult {
  groupsQueried: number;
  groupsSkippedCache: number;
  /** 活口径（scope=alive）下整组判死而跳过的组数。 */
  skippedDeadGroups?: number;
  productsUpdated: number;
  errors: Array<{ brand: string; countryCode: string | null; message: string }>;
  /** 付费数据网关计费路径（platform / tenant-own / owner）。 */
  billing?: {
    keySource: "platform" | "tenant-own" | "owner";
    remainingCalls: number | null;
  } | null;
}

/**
 * 广告投放数量计算：ids 为空数组 = 全量（后端按 14 天缓存跳过已查组）。
 * opts.force = 忽略缓存强制重算；opts.scope = "alive" 时跳过全死组。
 * 付费调用——前端必须先走 previewCalcAdCountAction 预估确认再调本函数。
 */
export async function calcAdCountAction(
  productIds: string[],
  opts?: { force?: boolean; scope?: "all" | "alive" }
) {
  return attempt(() => apiFetch<CalcAdCountResult>(
    "/api/v1/catalog/products/calc-ad-count",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ids: productIds.slice(0, 500),
        force: opts?.force === true,
        scope: opts?.scope ?? "all",
      }),
    }
  ), ["/catalog"]);
}

export interface CalcAdCountPreviewResult {
  allowed: boolean;
  keySource: "platform" | "tenant-own" | "owner" | null;
  groupsTotal: number;
  groupsFresh: number;
  groupsStale: number;
  deadGroupsSkipped: number;
}

/** 广告数计算的只读预估（不计费、不记用量）：提交前确认框的数字来源。 */
export async function previewCalcAdCountAction(scope: "all" | "alive") {
  return attempt(() => apiFetch<CalcAdCountPreviewResult>(
    "/api/v1/catalog/products/calc-ad-count/preview",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope }),
    }
  ), ["/catalog"]);
}

export interface AddedProductIdsResult {
  ids: string[];
  total: number;
  truncated: boolean;
}

/**
 * 按新增（入库）日期取商品 id（纯选择辅助）：from/to 是前端按本地时区
 * 换算好的 [当天 00:00, 次日 00:00) UTC ISO 区间；networkId 可选过滤。
 */
export async function addedProductIdsAction(input: {
  from: string;
  to: string;
  networkId?: string;
}) {
  return attempt(() => apiFetch<AddedProductIdsResult>(
    "/api/v1/catalog/products/added-ids",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from: input.from,
        to: input.to,
        ...(input.networkId ? { networkId: input.networkId } : {}),
      }),
    }
  ), ["/catalog"]);
}

/* ── 一键筛选（黑名单 → $8 → 预设 → 广告数[付费层] → 流量门） ── */

export interface OneClickScreenReport {
  processed: number;
  killedBlacklist: number;
  killedCommission: number;
  killedPreset: number;
  killedAdCount: number;
  killedTrafficGate: number;
  review: number;
  passed: number;
  skippedPaidLayer: boolean;
  paidKeySource: "platform" | "tenant-own" | "owner" | null;
  offersCreated: number;
  offersSkippedExisting: number;
  offersFailed: Array<{ productId: string; reason: string }>;
  adTierDistribution: {
    none: number;
    small: number;
    sweet: number;
    hot: number;
    red_ocean: number;
  };
  /** 疑似停投数（上次有广告、本次查为 0 的品牌组）；后端未给时缺省，前端有值才渲染。 */
  adStoppedCount?: number;
  /** 广告层豁免数（所属品牌标了「单品投放」、初筛广告层被豁免的件数）；有值才渲染。 */
  adWaivedCount?: number;
  outcomes: Array<{
    productId: string;
    outcome: "pass" | "kill" | "review";
    killedBy?: string;
    reason?: string;
  }>;
  scope: string;
  truncated: boolean;
}

/**
 * 一键筛选：scope 三选——selected（传 ids）/ current（传与列表同款 filter）/
 * unscreened（全部未筛）。免费层无授权门；广告数层经付费数据网关，
 * 被拒时后端自动跳过并在报告里标 skippedPaidLayer。
 */
export async function oneClickScreenAction(input: {
  scope: "selected" | "current" | "unscreened";
  ids?: string[];
  filter?: Record<string, unknown>;
}) {
  return attempt(
    () =>
      apiFetch<OneClickScreenReport>("/api/v1/catalog/products/one-click-screen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    ["/catalog"]
  );
}

export interface ForceSelectResult {
  created: Array<{ productId: string; offerId: string }>;
  skippedExisting: Array<{ productId: string }>;
  refusedBlacklist: Array<{ productId: string; reason: string }>;
  failed: Array<{ productId: string; reason: string }>;
  notFound: number;
}

/** 人工强制入选：被杀商品强制建 Offer（黑名单不可强制，后端拒绝并说明）。 */
export async function forceSelectProductsAction(ids: string[]) {
  return attempt(
    () =>
      apiFetch<ForceSelectResult>("/api/v1/catalog/products/force-select", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: ids.slice(0, 50) }),
      }),
    ["/catalog"]
  );
}

export async function getScoreCalcPausedAction() {
  return attempt(() => apiFetch<{ paused: boolean }>(
    "/api/v1/catalog/score-calc-paused"
  ), []);
}

export async function setScoreCalcPausedAction(paused: boolean) {
  return attempt(() => apiFetch<{ paused: boolean }>(
    "/api/v1/catalog/score-calc-paused",
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paused }),
    }
  ), []);
}

/* ── 历史投放记录（商品 → Offer → 投放档案；真实数据） ── */

export interface ProductLaunchArchive {
  id: string;
  offerName: string;
  decision: string | null;
  impressions: number | null;
  clicks: number | null;
  spend: number | null;
  conversions: number | null;
  revenue: number | null;
  launchedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface ProductLaunchHistory {
  offers: Array<{ offerId: string; name: string; status: string; createdAt: string }>;
  archives: ProductLaunchArchive[];
}

/** 批量查投放次数（列表用；无记录 → 0，不编数）。 */
export async function getProductLaunchCountsAction(ids: string[]) {
  if (ids.length === 0) return { ok: true as const, data: { counts: {} as Record<string, number> } };
  return attempt(() =>
    apiFetch<{ counts: Record<string, number> }>(
      `/api/v1/catalog/products/launch-counts?ids=${encodeURIComponent(ids.join(","))}`
    )
  , []);
}

/** 单个商品的投放历史（弹窗用）。 */
export async function getProductLaunchHistoryAction(productId: string) {
  return attempt(() =>
    apiFetch<ProductLaunchHistory>(
      `/api/v1/catalog/products/${encodeURIComponent(productId)}/launch-history`
    )
  , []);
}

/* ── 备选池阶段移动（补强 #3；后端走 B6 catalog-sync 门禁 + 审计） ── */

/** 单条移动备选池阶段。 */
export async function moveProductPoolStageAction(
  productId: string,
  poolStage: PoolStage
) {
  return attempt(
    () =>
      apiFetch<{ updated: number; productId: string; poolStage: PoolStage }>(
        `/api/v1/catalog/products/${encodeURIComponent(productId)}/pool-stage`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ poolStage }),
        }
      ),
    ["/catalog"]
  );
}

/** 批量移动备选池阶段（单次上限 500，与后端 asIdArray 一致）。 */
export async function moveProductsPoolStageAction(
  productIds: string[],
  poolStage: PoolStage
) {
  if (productIds.length === 0) {
    return { ok: false as const, error: "No products selected" };
  }
  return attempt(
    () =>
      apiFetch<{ updated: number; requested: number; poolStage: PoolStage }>(
        "/api/v1/catalog/products/pool-stage",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: productIds.slice(0, 500), poolStage }),
        }
      ),
    ["/catalog"]
  );
}
