"use server";

/**
 * 封号复盘库 server actions（server-side only）。
 * Forwards the user's `alk_session` cookie to the API. Never logs tokens.
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export interface BanEvent {
  id: string;
  tenantId: string;
  network: string;
  offerId: string | null;
  operationType: string;
  lostBalanceUsd: number;
  lostPendingUsd: number;
  recovered: boolean;
  recoveredUsd: number;
  note: string | null;
  occurredAt: string;
  createdAt?: string;
}

export interface SurvivalStat {
  network: string;
  operationType: string;
  banCount: number;
  totalLostUsd: number;
  totalRecoveredUsd: number;
  activeSlotCount: number;
  observedBanShare: number;
  observedBanShareDefinition: string;
}

export type BanLogActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function banLogFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    let message = `Ban log API ${res.status}`;
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

export async function listBanEventsAction(): Promise<
  BanLogActionResult<BanEvent[]>
> {
  try {
    const data = await banLogFetch<{ banEvents: BanEvent[] }>(
      "/api/v1/ban-events"
    );
    return { ok: true, data: data.banEvents };
  } catch (e) {
    return toError(e);
  }
}

export async function createBanEventAction(input: {
  network: string;
  operationType: string;
  offerId?: string | null;
  lostBalanceUsd?: number;
  lostPendingUsd?: number;
  note?: string;
}): Promise<BanLogActionResult<BanEvent>> {
  try {
    const data = await banLogFetch<{ banEvent: BanEvent }>(
      "/api/v1/ban-events",
      { method: "POST", body: JSON.stringify(input) }
    );
    return { ok: true, data: data.banEvent };
  } catch (e) {
    return toError(e);
  }
}

export async function markBanEventRecoveredAction(
  id: string,
  recoveredUsd: number
): Promise<BanLogActionResult<BanEvent>> {
  try {
    const data = await banLogFetch<{ banEvent: BanEvent }>(
      `/api/v1/ban-events/${id}/recovered`,
      { method: "PATCH", body: JSON.stringify({ recoveredUsd }) }
    );
    return { ok: true, data: data.banEvent };
  } catch (e) {
    return toError(e);
  }
}

export async function getSurvivalStatsAction(): Promise<
  BanLogActionResult<SurvivalStat[]>
> {
  try {
    const data = await banLogFetch<{ stats: SurvivalStat[] }>(
      "/api/v1/ban-events/survival-stats"
    );
    return { ok: true, data: data.stats };
  } catch (e) {
    return toError(e);
  }
}
