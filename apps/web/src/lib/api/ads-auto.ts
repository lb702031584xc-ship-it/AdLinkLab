/**
 * 功能2 — 自动化广告 API 客户端（server-side only）。
 * 通过 sessionHeaders 转发用户 alk_session cookie；不记录密钥。
 */
import { redirect } from "next/navigation";
import {
  EntityApiError,
  getApiBaseUrl,
} from "./entities-config";
import { sessionHeaders } from "./session";

/* ---------- Types (mirror apps/api/src/ai/ad-generator.ts) ---------- */

export type AdPlanDataQuality = "OBSERVED" | "PREDICTED" | "UNKNOWN";

export interface AdPlanMoney {
  amount: number;
  currency: string;
  dataQuality: AdPlanDataQuality;
}

export interface AdPlanKeyword {
  text: string;
  matchType: "EXACT" | "PHRASE" | "BROAD";
  dataQuality: AdPlanDataQuality;
}

export interface AdPlanAdGroupBlock {
  group: {
    name: string;
    finalUrl: string;
    keywords: AdPlanKeyword[];
    negativeKeywords: AdPlanKeyword[];
    maxCpc: AdPlanMoney | null;
    dataQuality: AdPlanDataQuality;
    /** 关键词来源：user=投放选词里定的词，ai=AI 生成 */
    keywordsSource?: "user" | "ai";
  };
  rsa: {
    headlines: string[];
    descriptions: string[];
    finalUrl: string;
    path1: string | null;
    path2: string | null;
    dataQuality: AdPlanDataQuality;
  };
}

export interface AdPlanAdSchedule {
  dayOfWeek: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

export interface AdPlan {
  version: 1;
  planId: string;
  tenantId: string;
  language: "zh" | "en";
  sourceUrls: string[];
  offerId: string | null;
  googleAccountId: string | null;
  /** 文案口吻：official=官方口吻，affiliate=联盟安全口吻，expert=专家营销口吻 */
  copyStyle?: "official" | "affiliate" | "expert";
  campaign: {
    name: string;
    dailyBudget: AdPlanMoney;
    geoTargets: string[];
    bidding: { strategy: string; maxCpc: AdPlanMoney | null };
    status: string;
    dataQuality: AdPlanDataQuality;
  };
  /** P1-25：广告排期（campaign 级；空/缺失 = 全天投放）。 */
  adSchedules?: AdPlanAdSchedule[];
  adGroups: AdPlanAdGroupBlock[];
  createdAt: string;
  dataQuality: AdPlanDataQuality;
}

export interface CreativeSelfCheckResult {
  dimensions: Record<
    "relevance" | "quality" | "attractiveness" | "diversity" | "clarity" | "brand" | "sensitivity",
    { score: number; note: string }
  >;
  overall: number;
  verdict: "pass" | "fail";
  brandSearchVolume: "unknown";
  sensitiveHits: string[];
  source: "heuristic-self-check";
}

export interface AutoCreateResult {
  planId: string;
  plan: AdPlan;
  /** P1-9：创意 7 维自检（启发式规则，非 AI 评分）。 */
  creativeCheck?: CreativeSelfCheckResult;
  expiresInSeconds: number;
}

export interface ConfirmResult {
  planId: string;
  targetId: string;
  taskType: string;
  status: string;
  alreadyQueued: boolean;
  integrationId?: string;
  scriptUrl?: string;
  copyPackUrl?: string;
}

export interface CreateCampaignScript {
  planId: string;
  fileName: string;
  templateVersion: string;
  source: string;
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
  return (await res.json()) as T;
}

async function apiFetchText(path: string): Promise<string> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      headers: { ...authHeaders },
      cache: "no-store",
    });
  } catch {
    throw new EntityApiError(0, "无法连接到 API 服务");
  }
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    throw new EntityApiError(res.status, `请求失败（${res.status}）`);
  }
  return res.text();
}

/* ---------- API ---------- */

export async function requestAdPlan(
  urls: string[],
  opts: { language?: "zh" | "en"; googleAccountId?: string; pageTexts?: Array<string | null>; keywords?: Array<{ text: string; matchType?: string }>; copyStyle?: "official" | "affiliate" | "expert"; serpCaptureId?: string; fxRate?: number; promotion?: string } = {}
): Promise<AutoCreateResult> {
  return apiFetch<AutoCreateResult>("/api/v1/ads/auto-create", {
    method: "POST",
    body: JSON.stringify({
      urls,
      language: opts.language ?? "en",
      googleAccountId: opts.googleAccountId || undefined,
      pageTexts: opts.pageTexts,
      keywords: opts.keywords,
      copyStyle: opts.copyStyle,
      serpCaptureId: opts.serpCaptureId,
      fxRate: opts.fxRate,
      promotion: opts.promotion,
    }),
  });
}

export async function confirmAdPlan(
  planId: string,
  maxCpc?: number,
  overrides?: {
    dailyBudget?: number;
    dailyBudgetCurrency?: string;
    maxCpcCurrency?: string;
    geoTargets?: string[];
    /** P1-25：确认时全量替换各组否词。 */
    negativeKeywords?: string[];
    /** P1-25：确认时全量替换排期。 */
    adSchedules?: AdPlanAdSchedule[];
  }
): Promise<ConfirmResult> {
  return apiFetch<ConfirmResult>("/api/v1/ads/auto-create/confirm", {
    method: "POST",
    body: JSON.stringify({
      planId,
      maxCpc,
      dailyBudget: overrides?.dailyBudget,
      dailyBudgetCurrency: overrides?.dailyBudgetCurrency,
      maxCpcCurrency: overrides?.maxCpcCurrency,
      geoTargets: overrides?.geoTargets,
      negativeKeywords: overrides?.negativeKeywords,
      adSchedules: overrides?.adSchedules,
    }),
  });
}

export interface PreflightCheck {
  key: string;
  status: "ok" | "warn" | "error" | "skip";
  message: string;
}

export interface PreflightResult {
  verdict: "ready" | "degraded" | "blocked";
  accountType: "MCC" | "PERSONAL";
  healthStatus: string;
  checks: PreflightCheck[];
}

export async function runPreflight(input: {
  accountId: string;
  landingUrl?: string;
  dailyBudget?: number;
}): Promise<PreflightResult> {
  return apiFetch<PreflightResult>("/api/v1/ads/preflight", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** P1-16：批量审计日志 + 回滚。 */
export interface BulkOperationLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export async function listBulkOperations(page = 1, pageSize = 20): Promise<{
  items: BulkOperationLog[];
  total: number;
  page: number;
  pageSize: number;
}> {
  return apiFetch(`/api/v1/ads/operations?page=${page}&pageSize=${pageSize}`);
}

export async function rollbackBulkOperation(auditLogId: string): Promise<{
  applied: boolean;
  pendingTargetDeleted: boolean;
  campaignName: string | null;
  manualSteps: string[];
}> {
  return apiFetch("/api/v1/ads/operations/rollback", {
    method: "POST",
    body: JSON.stringify({ auditLogId, confirm: true }),
  });
}

export async function getCopyPackText(planId: string): Promise<string> {
  return apiFetchText(
    `/api/v1/ads/auto-create/${encodeURIComponent(planId)}/copy-pack`
  );
}

export async function getCreateCampaignScript(
  planId: string
): Promise<CreateCampaignScript> {
  return apiFetch<CreateCampaignScript>(
    `/api/v1/ads/auto-create/${encodeURIComponent(planId)}/script`
  );
}

/** 生成直链轮换 Script（方案 B）。 */
export async function getRotationScript(
  label: string
): Promise<{ fileName: string; templateVersion: string; source: string }> {
  return apiFetch<{ fileName: string; templateVersion: string; source: string }>(
    "/api/v1/ads/rotation-script",
    {
      method: "POST",
      body: JSON.stringify({ label }),
    }
  );
}

/** 生成点击监测 Script：累计点击达到上限时自动暂停广告。 */
export async function getClickMonitorScript(
  label: string,
  maxClicks: number
): Promise<{ fileName: string; templateVersion: string; source: string }> {
  return apiFetch<{ fileName: string; templateVersion: string; source: string }>(
    "/api/v1/ads/click-monitor-script",
    {
      method: "POST",
      body: JSON.stringify({ label, maxClicks }),
    }
  );
}
