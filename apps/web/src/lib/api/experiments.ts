/**
 * Experiment (A/B 实验) API clients (server-side only).
 * Talks to the API with the forwarded session cookie. Never logs secrets.
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export class ExperimentApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ExperimentApiError";
    this.status = status;
    this.code = code;
  }
}

export type ExperimentStatus = "DRAFT" | "RUNNING" | "COMPLETED" | "CANCELLED";
export type ExperimentVariantType = "LANDING_PAGE" | "DIRECT_LINK" | "AD_GROUP";
export type ExperimentWinner = "A" | "B" | "TIE";
/** P1-12：实验类型 + 毕业动作。 */
export type ExperimentType = "LANDING_PAGE" | "DIRECT_LINK" | "AD_GROUP";
export type GraduationAction = "none" | "pause_loser";

export interface ExperimentVariant {
  type: ExperimentVariantType;
  trackingLinkId: string | null;
  label: string;
  /** P1-12：AD_GROUP 变体文案。 */
  headlines?: string[];
  descriptions?: string[];
}

export interface ExperimentMetrics {
  clicks?: number;
  ctr?: number;
  cpc?: number;
  lpViews?: number;
  affiliateClicks?: number;
  cvr?: number;
  cpa?: number;
  revenue?: number;
  profit?: number;
  approvalRate?: number;
  refundRate?: number;
}

export interface Experiment {
  id: string;
  tenantId: string;
  offerId: string;
  name: string;
  status: ExperimentStatus;
  variantA: ExperimentVariant;
  variantB: ExperimentVariant;
  trafficSplitA: number;
  splitSeed: string | null;
  metricsA: ExperimentMetrics;
  metricsB: ExperimentMetrics;
  winner: ExperimentWinner | null;
  confidence: number | null;
  preconditionCheck: {
    passedAt: string;
    policyId: string | null;
    directLinkRule: string;
    trafficSplitA: number;
    checks: Array<{ check: string; passed: boolean; detail: string }>;
  } | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** P1-12：实验类型 / 种子广告组 / 毕业动作 / 创意差异度（AD_GROUP 才有）。 */
  experimentType?: ExperimentType;
  seedAdGroupId?: string | null;
  graduationAction?: GraduationAction;
  creativeDifference?: number | null;
  creativeDifferenceSufficient?: boolean | null;
  creativeDifferenceWarning?: string | null;
}

export interface ExperimentListResult {
  items: Experiment[];
  total: number;
}

export interface CreateExperimentInput {
  offerId: string;
  name: string;
  variantA: {
    type: ExperimentVariantType;
    trackingLinkId?: string | null;
    label?: string;
    headlines?: string[];
    descriptions?: string[];
  };
  variantB: {
    type: ExperimentVariantType;
    trackingLinkId?: string | null;
    label?: string;
    headlines?: string[];
    descriptions?: string[];
  };
  trafficSplitA?: number;
  experimentType?: ExperimentType;
  seedAdGroupId?: string | null;
  graduationAction?: GraduationAction;
}

export interface WinnerDetail {
  basis: "profit" | "cvr" | "insufficient_sample";
  clicksA: number;
  clicksB: number;
  conversionsA: number;
  conversionsB: number;
  zScore: number | null;
  note: string;
}

export interface CompleteExperimentResult extends Experiment {
  winnerDetail: WinnerDetail;
}

async function expFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    throw new ExperimentApiError(0, "network failure");
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
      if (typeof body.message === "string" && body.message) message = body.message;
      else if (typeof body.error === "string" && body.error) message = body.error;
      if (typeof body.code === "string") code = body.code;
    } catch {
      // Keep the generic message.
    }
    throw new ExperimentApiError(res.status, message, code);
  }
  return (await res.json()) as T;
}

export async function listExperiments(params?: {
  offerId?: string;
  status?: ExperimentStatus;
}): Promise<ExperimentListResult> {
  const q = new URLSearchParams();
  if (params?.offerId) q.set("offerId", params.offerId);
  if (params?.status) q.set("status", params.status);
  const qs = q.toString();
  return expFetch<ExperimentListResult>(
    `/api/v1/experiments${qs ? `?${qs}` : ""}`
  );
}

export async function getExperiment(id: string): Promise<Experiment> {
  return expFetch<Experiment>(`/api/v1/experiments/${encodeURIComponent(id)}`);
}

export async function createExperiment(
  input: CreateExperimentInput
): Promise<Experiment> {
  return expFetch<Experiment>("/api/v1/experiments", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function startExperiment(id: string): Promise<Experiment> {
  return expFetch<Experiment>(
    `/api/v1/experiments/${encodeURIComponent(id)}/start`,
    { method: "POST" }
  );
}

export async function submitExperimentMetrics(
  id: string,
  variant: "A" | "B",
  metrics: ExperimentMetrics
): Promise<Experiment> {
  return expFetch<Experiment>(
    `/api/v1/experiments/${encodeURIComponent(id)}/metrics`,
    { method: "POST", body: JSON.stringify({ variant, metrics }) }
  );
}

export async function completeExperiment(
  id: string
): Promise<CompleteExperimentResult> {
  return expFetch<CompleteExperimentResult>(
    `/api/v1/experiments/${encodeURIComponent(id)}/complete`,
    { method: "POST" }
  );
}

export async function cancelExperiment(id: string): Promise<Experiment> {
  return expFetch<Experiment>(
    `/api/v1/experiments/${encodeURIComponent(id)}/cancel`,
    { method: "POST" }
  );
}

/** P1-12：毕业（COMPLETED + 已分胜负；pause_loser 只返回 Script 指引，不直接暂停）。 */
export async function graduateExperiment(id: string): Promise<Experiment & { graduation: unknown }> {
  return expFetch<Experiment & { graduation: unknown }>(
    `/api/v1/experiments/${encodeURIComponent(id)}/graduate`,
    { method: "POST" }
  );
}
