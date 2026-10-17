"use server";

/**
 * Budget pacer server actions (server-side only).
 * Forwards the user's `alk_session` cookie to the API. Never logs tokens.
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export interface BudgetRule {
  id: string;
  tenantId: string;
  googleAccountId: string;
  campaignName: string;
  campaignId: string | null;
  targetRoas: number;
  minDailyBudget: number;
  maxDailyBudget: number;
  increasePct: number;
  decreasePct: number;
  checkIntervalDays: number;
  enabled: boolean;
  lastEvaluatedAt: string | null;
  maxSpendCap: number | null;
  autoPauseOnBreach: boolean;
  lastAction: {
    action: "up" | "down" | "hold" | "init" | "paused";
    reason: string;
    at: string;
    oldBudget?: number;
    newBudget?: number;
    roas?: number | null;
    spend?: number;
    revenue?: number;
    taskId?: string;
    spendCap?: number;
    cumulativeSpend?: number;
    taskIds?: string[];
  } | null;
}

export interface CreateBudgetRulePayload {
  googleAccountId: string;
  campaignName: string;
  targetRoas: number;
  minDailyBudget: number;
  maxDailyBudget: number;
  increasePct?: number;
  decreasePct?: number;
  checkIntervalDays?: number;
  initialBudget?: number;
  maxSpendCap?: number | null;
  autoPauseOnBreach?: boolean;
}

export interface UpdateBudgetRulePayload {
  campaignName?: string;
  targetRoas?: number;
  minDailyBudget?: number;
  maxDailyBudget?: number;
  increasePct?: number;
  decreasePct?: number;
  checkIntervalDays?: number;
  enabled?: boolean;
  maxSpendCap?: number | null;
  autoPauseOnBreach?: boolean;
}

export type BudgetRuleActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

class BudgetRuleApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "BudgetRuleApiError";
    this.status = status;
  }
}

async function budgetRuleFetch<T>(
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
    let message = `Budget rule API ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    throw new BudgetRuleApiError(res.status, message);
  }
  return (await res.json()) as T;
}

function toError(e: unknown): { ok: false; error: string } {
  return {
    ok: false,
    error: e instanceof Error && e.message ? e.message : "Unknown error",
  };
}

export async function listBudgetRulesAction(): Promise<
  BudgetRuleActionResult<BudgetRule[]>
> {
  try {
    const data = await budgetRuleFetch<{ rules: BudgetRule[] }>(
      "/api/v1/budget-rules"
    );
    return { ok: true, data: data.rules };
  } catch (e) {
    return toError(e);
  }
}

export async function createBudgetRuleAction(
  input: CreateBudgetRulePayload
): Promise<BudgetRuleActionResult<BudgetRule>> {
  try {
    const data = await budgetRuleFetch<{ rule: BudgetRule }>(
      "/api/v1/budget-rules",
      { method: "POST", body: JSON.stringify(input) }
    );
    return { ok: true, data: data.rule };
  } catch (e) {
    return toError(e);
  }
}

export async function updateBudgetRuleAction(
  id: string,
  patch: UpdateBudgetRulePayload
): Promise<BudgetRuleActionResult<BudgetRule>> {
  try {
    const data = await budgetRuleFetch<{ rule: BudgetRule }>(
      `/api/v1/budget-rules/${id}`,
      { method: "PATCH", body: JSON.stringify(patch) }
    );
    return { ok: true, data: data.rule };
  } catch (e) {
    return toError(e);
  }
}

export async function getBudgetRuleHistoryAction(
  id: string
): Promise<
  BudgetRuleActionResult<{
    rule: BudgetRule;
    history: NonNullable<BudgetRule["lastAction"]>[];
  }>
> {
  try {
    const data = await budgetRuleFetch<{
      rule: BudgetRule;
      history: NonNullable<BudgetRule["lastAction"]>[];
    }>(`/api/v1/budget-rules/${id}/history`);
    return { ok: true, data };
  } catch (e) {
    return toError(e);
  }
}
