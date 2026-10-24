"use server";

/**
 * 成本账 server actions（server-side only）。
 * Forwards the user's `alk_session` cookie to the API. Never logs tokens.
 * 只算成本、不拦截任何操作（见 API 服务层注释）。
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export interface RiskParam {
  network: string;
  operationType: string;
  banProbability: number;
}

export interface CostLedgerEvaluation {
  network: string;
  operationType: string;
  banProbability: number;
  banProbabilitySource: "override" | "default";
  balanceUsd: number;
  pendingUsd: number;
  sunkCost: number;
  expectedLossUsd: number;
  expectedProfitUsd: number | null;
  lossToProfitRatio: number | null;
  riskTier: string;
  offer: {
    id: string;
    prescreenVerdict: string | null;
    prescreenReason: string | null;
  } | null;
}

export type CostLedgerActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function costLedgerFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...authHeaders,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `Cost ledger API ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

function toError(e: unknown): { ok: false; error: string } {
  return {
    ok: false,
    error: e instanceof Error && e.message ? e.message : "Unknown error",
  };
}

export async function listRiskParamsAction(): Promise<
  CostLedgerActionResult<RiskParam[]>
> {
  try {
    const data = await costLedgerFetch<{ params: RiskParam[] }>(
      "/api/v1/cost-ledger/risk-params"
    );
    return { ok: true, data: data.params };
  } catch (e) {
    return toError(e);
  }
}

export async function upsertRiskParamAction(input: {
  network: string;
  operationType: string;
  banProbability: number;
}): Promise<CostLedgerActionResult<RiskParam>> {
  try {
    const data = await costLedgerFetch<{ param: RiskParam }>(
      "/api/v1/cost-ledger/risk-params",
      { method: "POST", body: JSON.stringify(input) }
    );
    return { ok: true, data: data.param };
  } catch (e) {
    return toError(e);
  }
}

export interface BidMathResult {
  cpcUsd: number;
  roiTarget: number;
  requiredEpcUsd: number;
  /** 小数，如 0.2 = 20%；无 payout 时为 null。 */
  requiredCr: number | null;
  clicksForBudget: number | null;
  /** API 原样返回的量级提示，不得改写。 */
  scaleNote: string;
  payoutUsd: number | null;
  budgetUsd: number | null;
  geo: string | null;
  format: string | null;
}

export async function getBidMathAction(input: {
  cpcUsd?: number;
  roiTarget?: number;
  payoutUsd?: number | null;
  budgetUsd?: number | null;
  geo?: string;
  format?: string;
}): Promise<CostLedgerActionResult<BidMathResult>> {
  try {
    const q = new URLSearchParams();
    if (input.cpcUsd !== undefined) q.set("cpcUsd", String(input.cpcUsd));
    if (input.roiTarget !== undefined) q.set("roiTarget", String(input.roiTarget));
    if (input.payoutUsd !== undefined && input.payoutUsd !== null) {
      q.set("payoutUsd", String(input.payoutUsd));
    }
    if (input.budgetUsd !== undefined && input.budgetUsd !== null) {
      q.set("budgetUsd", String(input.budgetUsd));
    }
    if (input.geo) q.set("geo", input.geo);
    if (input.format) q.set("format", input.format);
    const data = await costLedgerFetch<BidMathResult>(
      `/api/v1/cost-ledger/bid-math?${q.toString()}`
    );
    return { ok: true, data };
  } catch (e) {
    return toError(e);
  }
}

export async function evaluateCostLedgerAction(input: {
  offerId?: string;
  network: string;
  operationType: string;
  balanceUsd: number;
  pendingUsd: number;
  expectedProfitUsd?: number | null;
}): Promise<CostLedgerActionResult<CostLedgerEvaluation>> {
  try {
    const q = new URLSearchParams({
      network: input.network,
      operationType: input.operationType,
      balanceUsd: String(input.balanceUsd),
      pendingUsd: String(input.pendingUsd),
    });
    if (input.offerId) q.set("offerId", input.offerId);
    if (input.expectedProfitUsd !== undefined && input.expectedProfitUsd !== null) {
      q.set("expectedProfitUsd", String(input.expectedProfitUsd));
    }
    const data = await costLedgerFetch<CostLedgerEvaluation>(
      `/api/v1/cost-ledger/evaluate?${q.toString()}`
    );
    return { ok: true, data };
  } catch (e) {
    return toError(e);
  }
}
