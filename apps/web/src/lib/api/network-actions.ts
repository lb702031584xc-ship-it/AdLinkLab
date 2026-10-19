"use server";

/**
 * Network API framework — server actions (2026-10-07).
 * Server-side only: forwards the user's session cookie to the API.
 */
import { revalidatePath } from "next/cache";
import { sessionHeaders } from "./session";
import { getApiBaseUrl, mapEntityErrorMessage } from "./entities-config";
import { getLang } from "@/i18n/lang";

export type NetworkActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface NetworkRow {
  id: string;
  name: string;
  kind: string;
  website: string | null;
  apiConfigured: boolean;
  apiBaseUrl: string | null;
  sessionListPath: string | null;
  lastPullAt: string | null;
  pullStatus: string;
  pullError: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface NetworkOfferRow {
  id: string;
  externalId: string;
  name: string;
  payout: number | null;
  currency: string | null;
  termsText: string | null;
  url: string | null;
  lastSeenAt: string;
}

export interface NetworkPullRow {
  id: string;
  pulledAt: string;
  offerCount: number;
  newCount: number;
  updatedCount: number;
  status: string;
  error: string | null;
}

export interface NetworkPullSummary {
  networkId: string;
  tenantId: string;
  status: "SUCCESS" | "FAILED";
  offerCount: number;
  newCount: number;
  updatedCount: number;
  error?: string;
}

async function attempt<T>(
  fn: () => Promise<T>,
  revalidate: string[]
): Promise<NetworkActionResult<T>> {
  try {
    const data = await fn();
    for (const p of revalidate) revalidatePath(p);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: mapEntityErrorMessage(error, await getLang()) };
  }
}

async function apiFetch(path: string, init?: RequestInit) {
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
    throw new Error(
      detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`
    );
  }
  return res.json() as Promise<never>;
}

export async function listNetworksAction() {
  return attempt(
    () =>
      apiFetch("/api/v1/networks") as Promise<{
        networks: NetworkRow[];
        supportedKinds: string[];
      }>,
    []
  );
}

export async function createNetworkAction(input: {
  name: string;
  kind: string;
  website?: string;
  apiBaseUrl?: string;
  sessionListPath?: string;
  apiKey?: string;
}) {
  return attempt(async () => {
    const body = await apiFetch("/api/v1/networks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    return (body as { network: NetworkRow }).network;
  }, ["/networks"]);
}

export async function updateNetworkAction(
  id: string,
  input: {
    name?: string;
    website?: string | null;
    kind?: string;
    apiBaseUrl?: string | null;
    sessionListPath?: string | null;
    apiKey?: string | null;
  }
) {
  return attempt(async () => {
    const body = await apiFetch(`/api/v1/networks/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    return (body as { network: NetworkRow }).network;
  }, ["/networks"]);
}

export async function pullNetworkNowAction(id: string) {
  return attempt(async () => {
    const body = await apiFetch(`/api/v1/networks/${id}/pull-now`, {
      method: "POST",
    });
    return (body as { pull: NetworkPullSummary }).pull;
  }, ["/networks"]);
}

export async function listNetworkPullsAction(id: string, page = 1) {
  return attempt(
    () =>
      apiFetch(`/api/v1/networks/${id}/pulls?page=${page}&pageSize=20`) as Promise<{
        total: number;
        page: number;
        pageSize: number;
        pulls: NetworkPullRow[];
      }>,
    []
  );
}

export async function listNetworkOffersAction(id: string, page = 1) {
  return attempt(
    () =>
      apiFetch(
        `/api/v1/networks/${id}/offers?page=${page}&pageSize=20`
      ) as Promise<{
        total: number;
        page: number;
        pageSize: number;
        offers: NetworkOfferRow[];
      }>,
    []
  );
}
