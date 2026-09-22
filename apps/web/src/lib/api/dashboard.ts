/**
 * Phase 8.4.7.2 — Dashboard API client (GET only).
 * Runs on the server (Server Components / Server Actions).
 * Never logs Authorization headers or tokens.
 */

import {
  DashboardApiError,
  getApiBaseUrl,
  getDashboardIntegrationToken,
} from "./dashboard-config";
import type {
  DashboardIntegrationDetail,
  DashboardIntegrationsResponse,
  DashboardLogsPage,
  DashboardSummary,
  DashboardTargetsResponse,
} from "./dashboard-types";

export interface DashboardFetchDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

async function dashboardGet<T>(
  path: string,
  deps: DashboardFetchDeps = {}
): Promise<T> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const base = getApiBaseUrl(env);
  const token = getDashboardIntegrationToken(env);
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch {
    throw new DashboardApiError(0, "network failure", "NETWORK_ERROR");
  }

  if (!response.ok) {
    throw new DashboardApiError(
      response.status,
      "dashboard request failed",
      "HTTP_ERROR"
    );
  }

  return (await response.json()) as T;
}

export const dashboardApi = {
  getSummary(deps?: DashboardFetchDeps): Promise<DashboardSummary> {
    return dashboardGet<DashboardSummary>("/api/v1/dashboard/summary", deps);
  },

  getIntegrations(
    deps?: DashboardFetchDeps
  ): Promise<DashboardIntegrationsResponse> {
    return dashboardGet<DashboardIntegrationsResponse>(
      "/api/v1/dashboard/integrations",
      deps
    );
  },

  getIntegration(
    integrationId: string,
    deps?: DashboardFetchDeps
  ): Promise<DashboardIntegrationDetail> {
    return dashboardGet<DashboardIntegrationDetail>(
      `/api/v1/dashboard/integrations/${encodeURIComponent(integrationId)}`,
      deps
    );
  },

  getTargets(
    integrationId: string,
    deps?: DashboardFetchDeps
  ): Promise<DashboardTargetsResponse> {
    return dashboardGet<DashboardTargetsResponse>(
      `/api/v1/dashboard/integrations/${encodeURIComponent(integrationId)}/targets`,
      deps
    );
  },

  getLogs(
    integrationId: string,
    pagination: { page?: number; pageSize?: number } = {},
    deps?: DashboardFetchDeps
  ): Promise<DashboardLogsPage> {
    const page = pagination.page ?? 1;
    const pageSize = Math.min(100, Math.max(1, pagination.pageSize ?? 20));
    const qs = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    return dashboardGet<DashboardLogsPage>(
      `/api/v1/dashboard/integrations/${encodeURIComponent(integrationId)}/logs?${qs}`,
      deps
    );
  },
};
