"use server";

/**
 * 账号矩阵 server actions（server-side only）。
 * Forwards the user's `alk_session` cookie to the API. Never logs tokens.
 * accountLabel 只是自由文本标签，绝不存任何账号凭证。
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export interface AccountSlot {
  id: string;
  slotIndex: number;
  accountLabel: string;
  network: string;
  offerId: string | null;
  status: string;
  balanceUsd: number;
  pendingUsd: number;
  investedUsd: number;
  earnedUsd: number;
  offer: { id: string; name: string } | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface PortfolioView {
  totalInvested: number;
  totalEarned: number;
  liveSlots: number;
  bannedSlots: number;
  totalAtRisk: number;
  withdrawAlerts: Array<{
    slotIndex: number;
    accountLabel: string;
    network: string;
    amountUsd: number;
    excessOverPayoutLineUsd: number;
  }>;
  portfolioRoi: number | null;
  expectedSurvivors: number;
  perSlotCommissionUsd: number | null;
  totalBudgetCap: number | null;
  perSlotBudget: number | null;
}

export type AccountMatrixActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function accountMatrixFetch<T>(
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
    let message = `Account matrix API ${res.status}`;
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

export async function createTemplateSlotsAction(input: {
  network: string;
  labelPrefix: string;
}): Promise<AccountMatrixActionResult<AccountSlot[]>> {
  try {
    const data = await accountMatrixFetch<{ slots: AccountSlot[] }>(
      "/api/v1/account-matrix/slots/template",
      { method: "POST", body: JSON.stringify(input) }
    );
    return { ok: true, data: data.slots };
  } catch (e) {
    return toError(e);
  }
}

export async function listAccountSlotsAction(): Promise<
  AccountMatrixActionResult<AccountSlot[]>
> {
  try {
    const data = await accountMatrixFetch<{ slots: AccountSlot[] }>(
      "/api/v1/account-matrix/slots"
    );
    return { ok: true, data: data.slots };
  } catch (e) {
    return toError(e);
  }
}

export async function updateAccountSlotAction(
  id: string,
  patch: Partial<{
    status: string;
    balanceUsd: number;
    pendingUsd: number;
    investedUsd: number;
    earnedUsd: number;
    offerId: string | null;
    accountLabel: string;
  }>
): Promise<AccountMatrixActionResult<AccountSlot>> {
  try {
    const data = await accountMatrixFetch<{ slot: AccountSlot }>(
      `/api/v1/account-matrix/slots/${id}`,
      { method: "PATCH", body: JSON.stringify(patch) }
    );
    return { ok: true, data: data.slot };
  } catch (e) {
    return toError(e);
  }
}

export async function assignAccountSlotAction(
  id: string,
  offerId: string
): Promise<AccountMatrixActionResult<{ slot: AccountSlot; warnings: string[] }>> {
  try {
    const data = await accountMatrixFetch<{ slot: AccountSlot; warnings: string[] }>(
      `/api/v1/account-matrix/slots/${id}/assign`,
      { method: "POST", body: JSON.stringify({ offerId }) }
    );
    return { ok: true, data };
  } catch (e) {
    return toError(e);
  }
}

export async function markSlotBannedAction(
  id: string,
  input: {
    operationType: string;
    lostBalanceUsd?: number;
    lostPendingUsd?: number;
    note?: string;
  }
): Promise<
  AccountMatrixActionResult<{
    slot: AccountSlot;
    banEvent: Record<string, unknown>;
    refillSlot: AccountSlot;
  }>
> {
  try {
    const data = await accountMatrixFetch<{
      slot: AccountSlot;
      banEvent: Record<string, unknown>;
      refillSlot: AccountSlot;
    }>(`/api/v1/account-matrix/slots/${id}/mark-banned`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true, data };
  } catch (e) {
    return toError(e);
  }
}

export async function getPortfolioAction(input: {
  expectedSurvivors?: number;
  perSlotCommissionUsd?: number | null;
}): Promise<AccountMatrixActionResult<PortfolioView>> {
  try {
    const q = new URLSearchParams();
    if (input.expectedSurvivors !== undefined) {
      q.set("expectedSurvivors", String(input.expectedSurvivors));
    }
    if (input.perSlotCommissionUsd !== undefined && input.perSlotCommissionUsd !== null) {
      q.set("perSlotCommissionUsd", String(input.perSlotCommissionUsd));
    }
    const suffix = q.toString() ? `?${q.toString()}` : "";
    const data = await accountMatrixFetch<{ portfolio: PortfolioView }>(
      `/api/v1/account-matrix/portfolio${suffix}`
    );
    return { ok: true, data: data.portfolio };
  } catch (e) {
    return toError(e);
  }
}
