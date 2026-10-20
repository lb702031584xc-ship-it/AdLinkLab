"use server";

/**
 * Product catalog (商品库) — server actions (2026-10-18).
 * Server-side only: forwards the user's session cookie to the API.
 *
 * Backend contract (per parent-orchestrated spec):
 *   GET  /api/v1/catalog/products?networkId=&recommended=&q=&page=&pageSize=
 *   POST /api/v1/catalog/sync {networkId}                (B6 grant required; 403 → apply at /admin/grants)
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

export interface CatalogProduct {
  id: string;
  networkId: string;
  networkKind: string;
  networkName?: string | null;
  externalId: string | null;
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
  /** Optional for forward-compat: the backend list-flag batch is still landing. */
  blacklisted?: boolean;
  whitelisted?: boolean;
  pinned?: boolean;
  /** 商家维度：后端新契约正在落地，可无，防御性读取。 */
  merchantName?: string | null;
}

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
  /** Blacklisted accounts skipped by the sync (no request wasted). Optional until the backend batch lands. */
  skipped?: Array<{
    networkId: string;
    networkName?: string | null;
    reason?: string | null;
  }>;
  /** 同步范围：full（全量）/ brand（按商家）。 */
  scope?: "full" | "brand";
  /** 按商家同步时的 brand_id。 */
  brandId?: string;
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

export async function syncCatalogAction(networkId: string, brandId?: string) {
  return attempt(
    () =>
      apiFetch<SyncResult>("/api/v1/catalog/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          networkId,
          ...(brandId?.trim() ? { brandId: brandId.trim() } : {}),
        }),
      }),
    ["/catalog"]
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
}) {
  const qs = new URLSearchParams();
  if (params.networkId) qs.set("networkId", params.networkId);
  if (typeof params.recommended === "boolean")
    qs.set("recommended", String(params.recommended));
  if (params.q) qs.set("q", params.q);
  if (params.preset === false) qs.set("preset", "0");
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

/** 从 rawData 回填 brand/asin/price/reviewCount（只补空，不覆盖）。 */
export async function backfillCatalogProductsAction(networkId?: string) {
  return attempt(
    () =>
      apiFetch<{ scanned: number; backfilled: number }>(
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
