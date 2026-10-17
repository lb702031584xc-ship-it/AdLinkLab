/**
 * P1 "make money & stay alive" API clients (server-side only).
 * Brand-check, offer performance stats, and traffic monitoring.
 * Talks to the API with the forwarded session cookie. Never logs secrets.
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export class P1ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "P1ApiError";
    this.status = status;
    this.code = code;
  }
}

async function p1Fetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        // Only declare a JSON body when one is actually sent — Fastify
        // rejects an empty body paired with content-type: application/json.
        ...(init.body != null ? { "content-type": "application/json" } : {}),
        ...authHeaders,
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new P1ApiError(0, "network failure");
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
      code = body.code ?? body.error;
    } catch {
      /* ignore */
    }
    throw new P1ApiError(res.status, message, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Brand check
// ---------------------------------------------------------------------------

export interface BrandCheckResult {
  keyword: string;
  conflict: boolean;
  matchedTerms: string[];
}

export interface BrandCheckResponse {
  results: BrandCheckResult[];
  negatives: {
    exact: string[];
    phrase: string[];
  };
  stats: {
    total: number;
    conflicts: number;
  };
}

export async function brandCheck(
  keywords: string[],
  brandTerms: string[]
): Promise<BrandCheckResponse> {
  return p1Fetch<BrandCheckResponse>("/api/v1/ai/brand-check", {
    method: "POST",
    body: JSON.stringify({ keywords, brandTerms }),
  });
}

// ---------------------------------------------------------------------------
// Offer performance stats
// ---------------------------------------------------------------------------

export interface OfferPerformance {
  offerId: string;
  days: number;
  clicks: number;
  conversions: number;
  cvrPct: number;
  revenue: number;
  revenueCurrency: string | null;
  epc: number | null;
  ordersConfirmed: number;
  ordersRefunded: number;
  refundRatePct: number | null;
}

export async function getOfferPerformance(
  offerId: string,
  days: number
): Promise<OfferPerformance> {
  return p1Fetch<OfferPerformance>(
    `/api/v1/stats/offer-performance?offerId=${encodeURIComponent(offerId)}&days=${encodeURIComponent(String(days))}`
  );
}

// ---------------------------------------------------------------------------
// Monitoring rules & alerts
// ---------------------------------------------------------------------------

export type MonitoringMetric =
  | "cvr_drop"
  | "refund_spike"
  | "geo_anomaly"
  | string;

export interface MonitoringRule {
  id: string;
  name: string;
  metric: MonitoringMetric;
  thresholdPct: number;
  windowHours: number;
  baselineHours: number;
  minClicks: number;
  autoPause: boolean;
  enabled: boolean;
  /** P1-22：通知渠道 + Webhook URL。 */
  channels?: string[];
  webhookUrl?: string | null;
}

export interface CreateRuleInput {
  name: string;
  metric: string;
  thresholdPct: number;
  windowHours?: number;
  baselineHours?: number;
  minClicks?: number;
  autoPause?: boolean;
  /** P1-22：通知渠道（in_app | webhook）。 */
  channels?: string[];
  webhookUrl?: string;
}

export interface UpdateRuleInput {
  name?: string;
  enabled?: boolean;
  thresholdPct?: number;
  autoPause?: boolean;
  /** P1-22：通知渠道 + Webhook URL。 */
  channels?: string[];
  webhookUrl?: string | null;
}

export interface MonitoringAlert {
  id: string;
  ruleId: string;
  trackingLinkId: string | null;
  metric: string;
  severity: "high" | "medium" | "low";
  message: string;
  data: unknown;
  status: "open" | "acknowledged" | "resolved";
  createdAt: string;
}

/** P0-8 — 近 24h 服务端错误（error_reports 去重后列表）。 */
export interface MonitoringError {
  id: string;
  level: string;
  message: string;
  requestId: string | null;
  path: string | null;
  method: string | null;
  statusCode: number | null;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export async function listMonitoringErrors(
  limit = 50
): Promise<MonitoringError[]> {
  const data = await p1Fetch<{ errors: MonitoringError[] }>(
    `/api/v1/monitoring/errors?limit=${limit}`
  );
  return data.errors ?? [];
}

export async function listMonitoringRules(): Promise<MonitoringRule[]> {
  const data = await p1Fetch<{ rules: MonitoringRule[] }>(
    "/api/v1/monitoring/rules"
  );
  return data.rules ?? [];
}

export async function createMonitoringRule(
  input: CreateRuleInput
): Promise<MonitoringRule> {
  const data = await p1Fetch<{ rule: MonitoringRule }>(
    "/api/v1/monitoring/rules",
    { method: "POST", body: JSON.stringify(input) }
  );
  return data.rule;
}

export async function updateMonitoringRule(
  id: string,
  input: UpdateRuleInput
): Promise<MonitoringRule> {
  const data = await p1Fetch<{ rule: MonitoringRule }>(
    `/api/v1/monitoring/rules/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) }
  );
  return data.rule;
}

export async function deleteMonitoringRule(id: string): Promise<void> {
  await p1Fetch<{ ok: boolean }>(
    `/api/v1/monitoring/rules/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
}

export async function createDefaultMonitoringRules(): Promise<
  MonitoringRule[]
> {
  const data = await p1Fetch<{ rules: MonitoringRule[] }>(
    "/api/v1/monitoring/rules/defaults",
    { method: "POST" }
  );
  return data.rules ?? [];
}

export async function listMonitoringAlerts(
  status?: string
): Promise<MonitoringAlert[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const data = await p1Fetch<{ alerts: MonitoringAlert[] }>(
    `/api/v1/monitoring/alerts${qs}`
  );
  return data.alerts ?? [];
}

export async function ackMonitoringAlert(id: string): Promise<void> {
  await p1Fetch<{ ok: boolean }>(
    `/api/v1/monitoring/alerts/${encodeURIComponent(id)}/ack`,
    { method: "POST" }
  );
}

export async function runMonitoringCheck(): Promise<{
  checked: number;
  alertsCreated: number;
}> {
  return p1Fetch<{ checked: number; alertsCreated: number }>(
    "/api/v1/monitoring/run",
    { method: "POST" }
  );
}
