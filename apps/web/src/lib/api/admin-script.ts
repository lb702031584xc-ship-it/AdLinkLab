/**
 * Phase 8.4.9 — Script Integration Admin API client (server-side).
 * Forwards the user's `alk_session` cookie to the API (see ./session).
 */
import { redirect } from "next/navigation";
import {
  getApiBaseUrl,
  AdminScriptConfigError,
} from "./admin-script-config";
import { sessionHeaders } from "./session";

export interface AdminIntegration {
  integrationId: string;
  name: string;
  status: string;
  googleAccountId: string;
  tokenPrefix: string;
  tokenStatus: string;
  configGeneration: number;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  targetCount: number;
}

export interface AdminTarget {
  targetId: string;
  entityType: "AD";
  entityId: string;
  googleAdId: string | null;
  campaignId: string | null;
  adGroupId: string | null;
  desiredVersion: number | null;
  appliedVersion: number | null;
  syncState: string;
  connectionHealth: string;
  lastExecution: string | null;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  desiredFinalUrl: string | null;
}

export interface CreateIntegrationResult {
  integrationId: string;
  name: string;
  status: string;
  googleAccountId: string;
  tokenPrefix: string;
  token: string;
}

export interface GenerateScriptResult {
  integrationId: string;
  scriptVersion: string;
  apiVersion: string;
  configEndpoint: string;
  syncResultEndpoint: string;
  source: string;
}

async function adminFetch<T>(
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
    let message = `Admin API ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    throw new AdminScriptConfigError(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const adminScriptApi = {
  listIntegrations() {
    return adminFetch<{ items: AdminIntegration[] }>(
      "/api/v1/admin/script-integrations"
    );
  },
  getIntegration(id: string) {
    return adminFetch<AdminIntegration>(
      `/api/v1/admin/script-integrations/${id}`
    );
  },
  createIntegration(input: { name: string; googleAccountId: string }) {
    return adminFetch<CreateIntegrationResult>(
      "/api/v1/admin/script-integrations",
      { method: "POST", body: JSON.stringify(input) }
    );
  },
  rotateToken(id: string) {
    return adminFetch<{ integrationId: string; tokenPrefix: string; token: string }>(
      `/api/v1/admin/script-integrations/${id}/rotate-token`,
      { method: "POST", body: "{}" }
    );
  },
  revoke(id: string) {
    return adminFetch<AdminIntegration>(
      `/api/v1/admin/script-integrations/${id}/revoke`,
      { method: "POST", body: "{}" }
    );
  },
  disable(id: string) {
    return adminFetch<AdminIntegration>(
      `/api/v1/admin/script-integrations/${id}/disable`,
      { method: "POST", body: "{}" }
    );
  },
  enable(id: string) {
    return adminFetch<AdminIntegration>(
      `/api/v1/admin/script-integrations/${id}/enable`,
      { method: "POST", body: "{}" }
    );
  },
  deleteIntegration(id: string) {
    return adminFetch<AdminIntegration>(
      `/api/v1/admin/script-integrations/${id}`,
      { method: "DELETE" }
    );
  },
  registerManualAd(
    id: string,
    input: {
      googleCampaignId: string;
      campaignName?: string;
      googleAdGroupId: string;
      adGroupName?: string;
      googleAdId: string;
      adName: string;
    }
  ) {
    return adminFetch<{ id: string; name: string; googleAdId: string; adGroupId: string }>(
      `/api/v1/admin/script-integrations/${id}/manual-ads`,
      { method: "POST", body: JSON.stringify(input) }
    );
  },
  listTargets(id: string) {
    return adminFetch<{ items: AdminTarget[] }>(
      `/api/v1/admin/script-integrations/${id}/targets`
    );
  },
  attachTarget(id: string, input: { entityType: "AD"; entityId: string }) {
    return adminFetch<AdminTarget>(
      `/api/v1/admin/script-integrations/${id}/targets`,
      { method: "POST", body: JSON.stringify(input) }
    );
  },
  detachTarget(id: string, targetId: string) {
    return adminFetch<{ ok: true; targetId: string }>(
      `/api/v1/admin/script-integrations/${id}/targets/${targetId}`,
      { method: "DELETE" }
    );
  },
  generateScript(id: string, input: { token: string; baseUrl?: string }) {
    return adminFetch<GenerateScriptResult>(
      `/api/v1/admin/script-integrations/${id}/generate-script`,
      { method: "POST", body: JSON.stringify(input) }
    );
  },
  listGoogleAccounts() {
    return adminFetch<{ items: Array<{ id: string; name: string; customerId?: string }> }>(
      "/api/v1/google-accounts"
    );
  },
  listAds() {
    return adminFetch<{ items: Array<{ id: string; name: string; googleAdId: string; adGroupId: string }> }>(
      "/api/v1/ads"
    );
  },
};
