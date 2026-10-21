/**
 * Entity management API client (server-side only).
 * Forwards the user's `alk_session` cookie to the API (see ./session).
 * Never logs Authorization headers or tokens.
 */
import { redirect } from "next/navigation";
import {
  EntityApiError,
  getApiBaseUrl,
} from "./entities-config";
import { sessionHeaders } from "./session";

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/* ---------- Entity shapes (dates arrive as ISO strings over JSON) ---------- */

export interface GoogleAccount {
  id: string;
  tenantId: string;
  userId: string;
  customerId: string;
  name: string;
  currency: string;
  timezone: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  /** P1-7：MCC | PERSONAL（创建时必填，创建后不可变更）。 */
  accountType?: "MCC" | "PERSONAL";
  managerCustomerId?: string;
  /** P1-8：active | suspended | limited。 */
  healthStatus?: "active" | "suspended" | "limited";
  suspensionReason?: string;
  appealStatus?: "none" | "pending" | "approved" | "rejected";
  appealNote?: string;
  suspendedAt?: string;
}

/** P1-8：账号申诉记录（只记录平台侧申诉时间/结果，不自动申诉）。 */
export interface GoogleAccountAppeal {
  id: string;
  tenantId: string;
  googleAccountId: string;
  level: string;
  status: string;
  note?: string | null;
  createdAt: string;
}

export interface GoogleAccountStatus {
  id: string;
  tenantId: string;
  customerId: string;
  status: string;
  oauthCredentialRefPresent?: boolean;
  providerKind?: string;
  liveApiEnabled?: boolean;
  mutationsEnabled?: boolean;
  phase?: string;
}

export interface Campaign {
  id: string;
  tenantId: string;
  googleAccountId: string;
  googleCampaignId: string;
  name: string;
  status: string;
  biddingStrategy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdGroup {
  id: string;
  tenantId: string;
  campaignId: string;
  googleAdGroupId: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Ad {
  id: string;
  tenantId: string;
  adGroupId: string;
  googleAdId: string;
  name: string;
  status: string;
  finalUrl?: string;
  trackingTemplate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MetricsSummary {
  score: number | null;
  grade: string | null;
  fetchedAt: string;
  /** P1-30：最近一次抓取的评论数（metrics.reviewCount），无数据时 null。 */
  reviewCount: number | null;
}

export interface Offer {
  id: string;
  tenantId: string;
  name: string;
  network: string;
  /** Offer 来源：affiliate | amazon | cashback */
  source: string;
  destinationUrl: string;
  /** 联盟链接：联盟后台给的带参跟踪链接（可空）。 */
  affiliateUrl: string | null;
  status: string;
  priority: number;
  startsAt?: string;
  endsAt?: string;
  createdAt: string;
  updatedAt: string;
  /** 商户/网络侧 offer ID（mid）。 */
  merchantId?: string | null;
  /** 佣金数值（Decimal 序列化为字符串）。 */
  commissionValue?: string | number | null;
  /** 佣金类型：percentage | fixed。 */
  commissionType?: string | null;
  /** 产品平均价（Decimal 序列化为字符串）。 */
  avgPrice?: string | number | null;
  /** 挑选日期。 */
  pickedAt?: string | null;
  /** P1-2：品牌名（自动提取仅建议，人工填写优先）。 */
  brandName?: string | null;
  /** P1-2：品牌名来源 manual | auto_extracted | domain_fallback。 */
  brandNameSource?: string | null;
  /** P1-2：品牌提取置信度 0–1；<0.6 需人工确认。 */
  brandNameConfidence?: number | null;
  /** P1-15：节日主题（只影响 RSA 文案）。 */
  festivalTheme?: string | null;
  /** 申请状态（与 status 生命周期独立）：not_applied | applied | approved | rejected；缺失按未申请。 */
  applicationStatus?: string | null;
  /** 申请日期（ISO 字符串）。 */
  appliedAt?: string | null;
  /** 申请备注（拒绝原因、审核进展等，≤500 字）。 */
  applicationNote?: string | null;
  /** 推荐指数摘要（第三批；无数据时为 null/缺失）。 */
  metricsSummary?: MetricsSummary | null;
  /** 一键初筛结论（go | unknown | stop；null/缺失 = 未筛）。 */
  prescreenVerdict?: string | null;
  prescreenReason?: string | null;
  prescreenedAt?: string | null;
}

export interface LandingPage {
  id: string;
  tenantId: string;
  offerId: string;
  name: string;
  url: string;
  domain: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrackingLink {
  id: string;
  tenantId: string;
  publicId: string;
  offerId: string;
  campaignId?: string;
  adGroupId?: string;
  adId?: string;
  criterionId?: string;
  landingPageId?: string;
  status: string;
  healthCheckIntervalSec?: number;
  linkSource?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrackingLinkOfferBinding {
  id: string;
  tenantId: string;
  trackingLinkId: string;
  offerId: string;
  priority: number;
  isFallback: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OfferSelectionResult {
  selectedOfferId: string | null;
  selectedLandingPageId?: string | null;
  reason?: string;
  fallbackUsed?: boolean;
  redirectUrl?: string;
  candidates?: Array<{
    offerId: string;
    priority: number;
    isFallback: boolean;
    eligible: boolean;
  }>;
}

export interface LinkSwapResult {
  request: UrlChangeRequest & {
    referralUrl?: string | null;
    deviceTarget?: string | null;
    googleAccountId?: string | null;
  };
  task: {
    type: string;
    scriptSyncTargetId: string;
    integrationId: string;
    entityType: string;
    entityId: string;
    desiredVersion: number;
  };
}

export interface TestClickChainReport {
  ok: boolean;
  trackingLinkId: string;
  publicId: string;
  clickId: string;
  isTestClick: boolean;
  hops: Array<{
    hop: number;
    label: "tracking" | "landing-page" | "affiliate" | "final";
    url: string;
    httpStatus: number | null;
    ms: number;
    expectedUrl?: string;
    deviated: boolean;
    error?: string;
  }>;
  chainOk: boolean;
  conversionPostbackSkipped: boolean;
}

export interface Click {
  id: string;
  clickId: string;
  tenantId: string;
  trackingLinkId: string;
  offerId?: string;
  landingPageId?: string;
  campaignId?: string;
  adGroupId?: string;
  adId?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  userAgent?: string;
  ipAddress?: string;
  referer?: string;
  country?: string;
  region?: string;
  city?: string;
  deviceType?: string;
  occurredAt: string;
  createdAt: string;
}

export interface Conversion {
  id: string;
  tenantId: string;
  clickId: string;
  conversionAction: string;
  conversionTime: string;
  value?: string;
  currency?: string;
  status: string;
  googleUploadStatus: string;
  gclid?: string;
  orderId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Order {
  id: string;
  tenantId: string;
  orderId: string;
  clickId?: string;
  conversionId?: string;
  value: string;
  currency: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface UrlVersion {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  finalUrl: string;
  finalMobileUrl?: string;
  finalAppUrl?: string;
  trackingTemplate?: string;
  customParameters: Record<string, string>;
  version: number;
  status: string;
  effectiveAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UrlChangeRequest {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  toVersionId: string;
  reason: string;
  requestedBy: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface SyncJob {
  id: string;
  tenantId?: string;
  type: string;
  status: string;
  provider: string;
  externalAccountId?: string;
  attempts: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  tenantId?: string;
  actorId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  requestId?: string;
  jobId?: string;
  createdAt: string;
}

/* ---------- Transport ---------- */

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        // 无 body 的请求（GET/DELETE）不带 JSON 头，
        // 否则 Fastify 会因 "application/json + 空 body" 直接 400
        ...(init.body != null ? { "content-type": "application/json" } : {}),
        ...authHeaders,
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new EntityApiError(0, "无法连接到 API 服务");
  }
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `请求失败（${res.status}）`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    throw new EntityApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function pageQuery(page?: number, pageSize?: number): string {
  const qs = new URLSearchParams();
  if (page) qs.set("page", String(page));
  if (pageSize) qs.set("pageSize", String(pageSize));
  const s = qs.toString();
  return s ? `?${s}` : "";
}

function post<T>(path: string, body: unknown = {}): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) });
}

function patch<T>(path: string, body: unknown = {}): Promise<T> {
  return apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}

function put<T>(path: string, body: unknown = {}): Promise<T> {
  return apiFetch<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

/* ---------- API ---------- */

export const entityApi = {
  googleAccounts: {
    list: (page?: number, pageSize?: number, filter?: { accountType?: string; healthStatus?: string }) => {
      const params = new URLSearchParams();
      if (page) params.set("page", String(page));
      if (pageSize) params.set("pageSize", String(pageSize));
      if (filter?.accountType) params.set("accountType", filter.accountType);
      if (filter?.healthStatus) params.set("healthStatus", filter.healthStatus);
      const qs = params.toString();
      return apiFetch<Paginated<GoogleAccount>>(
        `/api/v1/google-accounts${qs ? `?${qs}` : ""}`
      );
    },
    create: (input: {
      name: string;
      customerId: string;
      currency?: string;
      timezone?: string;
      accountType: "MCC" | "PERSONAL";
      managerCustomerId?: string;
    }) => post<GoogleAccount>(`/api/v1/google-accounts`, input),
    update: (id: string, input: { currency: string }) =>
      patch<GoogleAccount>(
        `/api/v1/google-accounts/${encodeURIComponent(id)}`,
        input
      ),
    getStatus: (id: string) =>
      apiFetch<GoogleAccountStatus>(
        `/api/v1/google-accounts/${encodeURIComponent(id)}/status`
      ),
    sync: (id: string) =>
      post<{ job: SyncJob; summary: unknown; created: boolean; replayed: boolean }>(
        `/api/v1/google-accounts/${encodeURIComponent(id)}/sync`
      ),
    /** P1-7：MCC 子账号（个人账户调此接口会 400）。 */
    listSubAccounts: (id: string) =>
      apiFetch<{ items: GoogleAccount[] }>(
        `/api/v1/google-accounts/${encodeURIComponent(id)}/sub-accounts`
      ),
    /** P1-8：记录封停 / 申诉（只做记录，不自动申诉）。 */
    recordSuspension: (id: string, suspensionReason: string) =>
      post<GoogleAccount>(
        `/api/v1/google-accounts/${encodeURIComponent(id)}/suspension`,
        { suspensionReason }
      ),
    listAppeals: (id: string) =>
      apiFetch<{ items: GoogleAccountAppeal[] }>(
        `/api/v1/google-accounts/${encodeURIComponent(id)}/appeals`
      ),
    recordAppeal: (id: string, input: { level: string; status: string; note?: string }) =>
      post<GoogleAccountAppeal>(
        `/api/v1/google-accounts/${encodeURIComponent(id)}/appeals`,
        input
      ),
  },

  campaigns: {
    list: (page?: number, pageSize?: number) =>
      apiFetch<Paginated<Campaign>>(
        `/api/v1/campaigns${pageQuery(page, pageSize)}`
      ),
  },

  adGroups: {
    list: (page?: number, pageSize?: number) =>
      apiFetch<Paginated<AdGroup>>(
        `/api/v1/ad-groups${pageQuery(page, pageSize)}`
      ),
  },

  ads: {
    list: (page?: number, pageSize?: number) =>
      apiFetch<Paginated<Ad>>(`/api/v1/ads${pageQuery(page, pageSize)}`),
  },

  offers: {
    list: (page?: number, pageSize?: number, source?: string) => {
      const qs = new URLSearchParams();
      if (page) qs.set("page", String(page));
      if (pageSize) qs.set("pageSize", String(pageSize));
      if (source) qs.set("source", source);
      const s = qs.toString();
      return apiFetch<Paginated<Offer>>(`/api/v1/offers${s ? `?${s}` : ""}`);
    },
    get: (id: string) =>
      apiFetch<Offer>(`/api/v1/offers/${encodeURIComponent(id)}`),
    create: (input: {
      name: string;
      network: string;
      source?: string;
      destinationUrl: string;
      affiliateUrl?: string;
      status?: string;
      priority?: number;
      startsAt?: string;
      endsAt?: string;
      idempotencyKey?: string;
      applicationStatus?: string;
      appliedAt?: string | null;
      applicationNote?: string | null;
    }) => post<{ offer: Offer; created: boolean; replayed: boolean }>("/api/v1/offers", input),
    update: (
      id: string,
      input: {
        name?: string;
        network?: string;
        destinationUrl?: string;
        affiliateUrl?: string;
        priority?: number;
        startsAt?: string | null;
        endsAt?: string | null;
        applicationStatus?: string;
        appliedAt?: string | null;
        applicationNote?: string | null;
      }
    ) => patch<Offer>(`/api/v1/offers/${encodeURIComponent(id)}`, input),
    changeStatus: (id: string, status: string) =>
      post<Offer>(`/api/v1/offers/${encodeURIComponent(id)}/status`, {
        status,
      }),
    remove: (id: string) =>
      apiFetch<{ deleted: boolean }>(`/api/v1/offers/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    listLandingPages: (offerId: string, page?: number, pageSize?: number) =>
      apiFetch<Paginated<LandingPage>>(
        `/api/v1/offers/${encodeURIComponent(offerId)}/landing-pages${pageQuery(page, pageSize)}`
      ),
  },

  trackingLinks: {
    list: (page?: number, pageSize?: number) =>
      apiFetch<Paginated<TrackingLink>>(
        `/api/v1/tracking-links${pageQuery(page, pageSize)}`
      ),
    get: (id: string) =>
      apiFetch<TrackingLink>(
        `/api/v1/tracking-links/${encodeURIComponent(id)}`
      ),
    listBindings: (id: string) =>
      apiFetch<TrackingLinkOfferBinding[]>(
        `/api/v1/tracking-links/${encodeURIComponent(id)}/offers`
      ),
    replaceBindings: (
      id: string,
      bindings: Array<{ offerId: string; priority?: number; isFallback?: boolean }>
    ) =>
      put<TrackingLinkOfferBinding[]>(
        `/api/v1/tracking-links/${encodeURIComponent(id)}/offers`,
        { bindings }
      ),
    selectOffer: (id: string) =>
      post<OfferSelectionResult>(
        `/api/v1/tracking-links/${encodeURIComponent(id)}/select-offer`
      ),
    swapUrl: (
      id: string,
      input: {
        newUrl: string;
        referralUrl?: string;
        deviceTarget?: string;
        googleAccountId?: string;
      }
    ) =>
      post<LinkSwapResult>(
        `/api/v1/tracking-links/${encodeURIComponent(id)}/swap-url`,
        input
      ),
    testClick: (id: string) =>
      post<TestClickChainReport>(`/api/v1/tracking/test-click`, {
        trackingLinkId: id,
      }),
    listClicks: (id: string, page?: number, pageSize?: number) =>
      apiFetch<Paginated<Click>>(
        `/api/v1/tracking-links/${encodeURIComponent(id)}/clicks${pageQuery(page, pageSize)}`
      ),
  },

  clicks: {
    list: (page?: number, pageSize?: number) =>
      apiFetch<Paginated<Click>>(`/api/v1/clicks${pageQuery(page, pageSize)}`),
    get: (id: string) =>
      apiFetch<Click>(`/api/v1/clicks/${encodeURIComponent(id)}`),
  },

  conversions: {
    list: (page?: number, pageSize?: number) =>
      apiFetch<Paginated<Conversion>>(
        `/api/v1/conversions${pageQuery(page, pageSize)}`
      ),
    get: (id: string) =>
      apiFetch<Conversion>(`/api/v1/conversions/${encodeURIComponent(id)}`),
    create: (input: {
      clickId: string;
      conversionAction: string;
      conversionTime?: string;
      value?: string;
      currency?: string;
      orderUuid?: string;
      idempotencyKey?: string;
    }) => post<{ conversion: Conversion; created: boolean }>("/api/v1/conversions", input),
    createFromOrder: (input: {
      orderId: string;
      conversionAction: string;
      conversionTime?: string;
      value?: string;
      currency?: string;
      idempotencyKey?: string;
    }) =>
      post<{ conversion: Conversion; order: Order; created: boolean }>(
        "/api/v1/conversions/from-order",
        input
      ),
    queue: (id: string) =>
      post<Conversion>(`/api/v1/conversions/${encodeURIComponent(id)}/queue`),
    execute: (id: string) =>
      post<Conversion>(`/api/v1/conversions/${encodeURIComponent(id)}/execute`),
    retry: (id: string) =>
      post<Conversion>(`/api/v1/conversions/${encodeURIComponent(id)}/retry`),
    cancel: (id: string) =>
      post<Conversion>(`/api/v1/conversions/${encodeURIComponent(id)}/cancel`),
  },

  orders: {
    list: (page?: number, pageSize?: number) =>
      apiFetch<Paginated<Order>>(`/api/v1/orders${pageQuery(page, pageSize)}`),
    get: (id: string) =>
      apiFetch<Order>(`/api/v1/orders/${encodeURIComponent(id)}`),
    create: (input: {
      orderId: string;
      clickId: string;
      value: string;
      currency: string;
      status?: string;
      idempotencyKey?: string;
    }) => post<{ order: Order; created: boolean }>("/api/v1/orders", input),
    changeStatus: (id: string, status: string) =>
      post<Order>(`/api/v1/orders/${encodeURIComponent(id)}/status`, {
        status,
      }),
  },

  urlVersions: {
    list: (page?: number, pageSize?: number) =>
      apiFetch<Paginated<UrlVersion>>(
        `/api/v1/url-versions${pageQuery(page, pageSize)}`
      ),
  },

  urlChangeRequests: {
    list: (page?: number, pageSize?: number) =>
      apiFetch<Paginated<UrlChangeRequest>>(
        `/api/v1/url-change-requests${pageQuery(page, pageSize)}`
      ),
    get: (id: string) =>
      apiFetch<UrlChangeRequest>(
        `/api/v1/url-change-requests/${encodeURIComponent(id)}`
      ),
    create: (input: {
      entityType: string;
      entityId: string;
      toVersionId: string;
      reason: string;
      requestedBy: string;
      idempotencyKey?: string;
    }) =>
      post<{ request: UrlChangeRequest; created: boolean }>(
        "/api/v1/url-change-requests",
        input
      ),
    validate: (id: string) =>
      post<UrlChangeRequest>(
        `/api/v1/url-change-requests/${encodeURIComponent(id)}/validate`
      ),
    preview: (id: string) =>
      post<unknown>(
        `/api/v1/url-change-requests/${encodeURIComponent(id)}/preview`
      ),
    queue: (id: string) =>
      post<UrlChangeRequest>(
        `/api/v1/url-change-requests/${encodeURIComponent(id)}/queue`
      ),
    execute: (id: string) =>
      post<UrlChangeRequest>(
        `/api/v1/url-change-requests/${encodeURIComponent(id)}/execute`
      ),
    cancel: (id: string) =>
      post<UrlChangeRequest>(
        `/api/v1/url-change-requests/${encodeURIComponent(id)}/cancel`
      ),
    rollback: (
      id: string,
      input: { requestedBy: string; reason?: string; idempotencyKey?: string }
    ) =>
      post<UrlChangeRequest>(
        `/api/v1/url-change-requests/${encodeURIComponent(id)}/rollback`,
        input
      ),
  },

  jobs: {
    list: (page?: number, pageSize?: number) =>
      apiFetch<Paginated<SyncJob>>(`/api/v1/jobs${pageQuery(page, pageSize)}`),
  },

  auditLogs: {
    list: (page?: number, pageSize?: number) =>
      apiFetch<Paginated<AuditLog>>(
        `/api/v1/audit-logs${pageQuery(page, pageSize)}`
      ),
  },
};
