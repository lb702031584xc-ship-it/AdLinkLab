"use server";

/**
 * 直链速测 server actions（server-side only）。
 * Forwards the user's `alk_session` cookie to the API. Never logs tokens.
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export interface DirectTestPlan {
  planId: string;
  tenantId: string;
  finalUrl: string;
  offerId: string | null;
  googleAccountId: string | null;
  status: "DRAFT" | "CONFIRMED";
  targetId: string | null;
  landingPageLinked: boolean;
  landingPageId: string | null;
  createdAt: string;
}

export interface DirectTestCreated {
  planId: string;
  plan: DirectTestPlan;
  suggestedCampaignName: string;
  finalUrl: string;
  expiresInSeconds: number;
}

export interface DirectTestConfirmed {
  planId: string;
  plan: DirectTestPlan;
  targetId: string;
  taskType: string;
  status: string;
  alreadyQueued: boolean;
  integrationId?: string;
}

export interface DirectTestUpgraded {
  plan: DirectTestPlan;
  planId: string;
  landingPageLinked: boolean;
  landingPageId: string;
  targetId: string | null;
  scriptSyncUpdated: boolean;
  scriptSyncNote: string;
}

export type DirectTestActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function directTestFetch<T>(
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
    let message = `Direct test API ${res.status}`;
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

export async function createDirectTestPlanAction(input: {
  finalUrl: string;
  offerId?: string;
  googleAccountId?: string;
}): Promise<DirectTestActionResult<DirectTestCreated>> {
  try {
    const data = await directTestFetch<DirectTestCreated>(
      "/api/v1/direct-test",
      { method: "POST", body: JSON.stringify(input) }
    );
    return { ok: true, data };
  } catch (e) {
    return toError(e);
  }
}

export async function confirmDirectTestPlanAction(
  planId: string
): Promise<DirectTestActionResult<DirectTestConfirmed>> {
  try {
    const data = await directTestFetch<DirectTestConfirmed>(
      `/api/v1/direct-test/${planId}/confirm`,
      { method: "POST", body: JSON.stringify({}) }
    );
    return { ok: true, data };
  } catch (e) {
    return toError(e);
  }
}

export async function upgradeDirectTestPlanAction(
  planId: string,
  landingPageId: string
): Promise<DirectTestActionResult<DirectTestUpgraded>> {
  try {
    const data = await directTestFetch<DirectTestUpgraded>(
      `/api/v1/direct-test/${planId}/upgrade`,
      { method: "POST", body: JSON.stringify({ landingPageId }) }
    );
    return { ok: true, data };
  } catch (e) {
    return toError(e);
  }
}

export async function listDirectTestPlansAction(): Promise<
  DirectTestActionResult<DirectTestPlan[]>
> {
  try {
    const data = await directTestFetch<{ plans: DirectTestPlan[] }>(
      "/api/v1/direct-test/plans"
    );
    return { ok: true, data: data.plans };
  } catch (e) {
    return toError(e);
  }
}
