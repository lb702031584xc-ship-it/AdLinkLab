"use server";

/**
 * Automation pack ① — dead link monitor server actions.
 * Server-side only: forwards the user's session cookie to the API.
 * (Never import @/lib/api/entities here from a client component —
 * it uses next/headers and is server-only. This module IS server-only.)
 */
import { revalidatePath } from "next/cache";
import { sessionHeaders } from "./session";
import { getApiBaseUrl, mapEntityErrorMessage } from "./entities-config";
import { getLang } from "@/i18n/lang";

export type DeadLinkActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface LinkHealthCheckSummary {
  checked: number;
  alive: number;
  dead: number;
  paused: number;
  alertsCreated: number;
  skippedNoUrl: number;
}

async function attempt<T>(
  fn: () => Promise<T>,
  revalidate: string[]
): Promise<DeadLinkActionResult<T>> {
  try {
    const data = await fn();
    for (const p of revalidate) revalidatePath(p);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: mapEntityErrorMessage(error, await getLang()) };
  }
}

async function postCheckNow(): Promise<LinkHealthCheckSummary> {
  const base = getApiBaseUrl();
  const headers = await sessionHeaders();
  const res = await fetch(`${base}/api/v1/link-health/check-now`, {
    method: "POST",
    headers: { ...headers },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Link health check failed (HTTP ${res.status})`);
  }
  const body = (await res.json()) as LinkHealthCheckSummary;
  return body;
}

/** Trigger a synchronous dead-link scan for the current tenant. */
export async function triggerLinkHealthCheckAction() {
  return attempt(() => postCheckNow(), ["/link-health"]);
}

export interface LinkHealthHistoryRow {
  id: string;
  trackingLinkId: string;
  checkedAt: string;
  statusCode: number | null;
  finalUrl: string | null;
  isAlive: boolean;
  failureReason: string | null;
  responseTimeMs: number | null;
  linkName: string | null;
  linkPublicId: string | null;
}

export interface LinkHealthHistory {
  total: number;
  page: number;
  pageSize: number;
  rows: LinkHealthHistoryRow[];
}

/** Paginated check history for the current tenant. */
export async function listLinkHealthHistoryAction(
  page = 1,
  pageSize = 20,
  trackingLinkId?: string
) {
  return attempt(async () => {
    const base = getApiBaseUrl();
    const headers = await sessionHeaders();
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (trackingLinkId) params.set("trackingLinkId", trackingLinkId);
    const res = await fetch(`${base}/api/v1/link-health?${params}`, {
      headers,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Failed to load link health history (HTTP ${res.status})`);
    }
    return (await res.json()) as LinkHealthHistory;
  }, []);
}

/** Update per-link health check config (interval + source). */
export async function updateLinkHealthConfigAction(
  trackingLinkId: string,
  input: { healthCheckIntervalSec?: number; linkSource?: string }
) {
  return attempt(async () => {
    const base = getApiBaseUrl();
    const headers = await sessionHeaders();
    const res = await fetch(
      `${base}/api/v1/tracking-links/${trackingLinkId}/health-config`,
      {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(input),
        cache: "no-store",
      }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        (body as { error?: string }).error ??
          `Failed to update health config (HTTP ${res.status})`
      );
    }
    return (await res.json()) as {
      ok: boolean;
      id: string;
      healthCheckIntervalSec: number;
      linkSource: string;
    };
  }, [`/tracking-links/${trackingLinkId}`]);
}
