"use server";

/**
 * Launch archive (投放报表) server actions.
 * Server-side only: forwards the user's session cookie to the API.
 * (Never import @/lib/api/entities here from a client component —
 * it uses next/headers and is server-only. This module IS server-only.)
 */
import { revalidatePath } from "next/cache";
import { sessionHeaders } from "./session";
import { getApiBaseUrl, mapEntityErrorMessage } from "./entities-config";
import { getLang } from "@/i18n/lang";

export type LaunchArchiveActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface LaunchArchiveAdCopy {
  headlines: string[];
  descriptions: string[];
}

export interface LaunchArchive {
  id: string;
  offerId: string | null;
  offerName: string;
  offerUrl: string | null;
  network: string;
  decision: string | null;
  decisionReason: string | null;
  termsBrandBidding: string | null;
  termsDirectLinking: string | null;
  termsSummary: string | null;
  payout: number | null;
  epc: number | null;
  breakevenCpc: number | null;
  breakevenCvrPct: number | null;
  recommendedBid: number | null;
  myBid: number | null;
  officialBid: number | null;
  dailyBudget: number | null;
  budgetCurrency: string | null;
  keywords: string[];
  adCopy: LaunchArchiveAdCopy | null;
  impressions: number | null;
  clicks: number | null;
  spend: number | null;
  conversions: number | null;
  revenue: number | null;
  status: string;
  notes: string | null;
  launchedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Server-computed derived fields (displayed as returned). */
  actualCpc: number | null;
  actualCvr: number | null;
  actualRoi: number | null;
  profit: number | null;
  diagnosis: string | null;
}

export interface LaunchArchiveListFilters {
  from?: string;
  to?: string;
  network?: string;
  status?: string;
  decision?: string;
  offerId?: string;
  page?: number;
  pageSize?: number;
}

export interface LaunchArchiveCreateInput {
  offerName: string;
  network: string;
  offerId?: string | null;
  offerUrl?: string;
  decision?: string;
  decisionReason?: string;
  termsBrandBidding?: string;
  termsDirectLinking?: string;
  termsSummary?: string;
  payout?: number;
  epc?: number;
  breakevenCpc?: number;
  breakevenCvrPct?: number;
  recommendedBid?: number;
  myBid?: number;
  officialBid?: number;
  dailyBudget?: number;
  budgetCurrency?: string;
  keywords?: string[];
  adCopy?: LaunchArchiveAdCopy;
  impressions?: number;
  clicks?: number;
  spend?: number;
  conversions?: number;
  revenue?: number;
  status?: string;
  notes?: string;
  launchedAt?: string;
  endedAt?: string;
}

/** PATCH allows only these fields (server rejects the rest). */
export type LaunchArchivePatchInput = Partial<
  Pick<
    LaunchArchive,
    | "offerName"
    | "network"
    | "decision"
    | "decisionReason"
    | "termsBrandBidding"
    | "termsDirectLinking"
    | "termsSummary"
    | "myBid"
    | "officialBid"
    | "impressions"
    | "clicks"
    | "spend"
    | "conversions"
    | "revenue"
    | "status"
    | "notes"
    | "launchedAt"
    | "endedAt"
  >
>;

async function attempt<T>(
  fn: () => Promise<T>,
  revalidate: string[]
): Promise<LaunchArchiveActionResult<T>> {
  try {
    const data = await fn();
    for (const p of revalidate) revalidatePath(p);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: mapEntityErrorMessage(error, await getLang()) };
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getApiBaseUrl();
  const headers = await sessionHeaders();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...headers },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Launch archive request failed (HTTP ${res.status}) ${body}`);
  }
  const text = await res.text().catch(() => "");
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

async function apiFetchText(path: string): Promise<string> {
  const base = getApiBaseUrl();
  const headers = await sessionHeaders();
  const res = await fetch(`${base}${path}`, {
    headers: { ...headers },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Launch archive export failed (HTTP ${res.status}) ${body}`);
  }
  return await res.text();
}

function toQuery(filters: LaunchArchiveListFilters): string {
  const qs = new URLSearchParams();
  if (filters.from) qs.set("from", filters.from);
  if (filters.to) qs.set("to", filters.to);
  if (filters.network) qs.set("network", filters.network);
  if (filters.status) qs.set("status", filters.status);
  if (filters.decision) qs.set("decision", filters.decision);
  if (filters.offerId) qs.set("offerId", filters.offerId);
  if (filters.page) qs.set("page", String(filters.page));
  if (filters.pageSize) qs.set("pageSize", String(filters.pageSize));
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/** List archives (newest first) with the given filters. */
export async function listLaunchArchivesAction(filters: LaunchArchiveListFilters = {}) {
  return attempt(
    () => apiFetch<{ items: LaunchArchive[]; total: number }>(`/api/v1/launch-archives${toQuery(filters)}`),
    []
  );
}

/** Fetch one archive (full record, incl. keywords / ad copy). */
export async function getLaunchArchiveAction(id: string) {
  return attempt(() => apiFetch<LaunchArchive>(`/api/v1/launch-archives/${encodeURIComponent(id)}`), []);
}

/** Manually create an archive. */
export async function createLaunchArchiveAction(input: LaunchArchiveCreateInput) {
  return attempt(
    () => apiFetch<LaunchArchive>("/api/v1/launch-archives", { method: "POST", body: JSON.stringify(input) }),
    ["/reports/launch"]
  );
}

/** Update only the PATCH-allowed fields of an archive. */
export async function updateLaunchArchiveAction(id: string, input: LaunchArchivePatchInput) {
  return attempt(
    () =>
      apiFetch<LaunchArchive>(`/api/v1/launch-archives/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    ["/reports/launch"]
  );
}

/** Delete an archive. */
export async function deleteLaunchArchiveAction(id: string) {
  return attempt(
    () => apiFetch<unknown>(`/api/v1/launch-archives/${encodeURIComponent(id)}`, { method: "DELETE" }),
    ["/reports/launch"]
  );
}

/** Export the current filter as CSV text (client turns it into a Blob download). */
export async function exportLaunchArchivesAction(filters: LaunchArchiveListFilters = {}) {
  return attempt(() => apiFetchText(`/api/v1/launch-archives/export${toQuery(filters)}`), []);
}
