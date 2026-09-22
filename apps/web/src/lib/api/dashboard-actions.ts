/**
 * Phase 8.4.7.2 — Server Actions for Dashboard (GET-only revalidation).
 * Token stays server-side; browser never receives the Integration Token.
 */
"use server";

import { dashboardApi } from "@/lib/api/dashboard";
import { mapDashboardErrorMessage } from "@/lib/api/dashboard-config";
import type {
  DashboardIntegrationDetail,
  DashboardLogsPage,
  DashboardSummary,
  DashboardTargetsResponse,
} from "@/lib/api/dashboard-types";

export type DashboardActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

function wrap<T>(promise: Promise<T>): Promise<DashboardActionResult<T>> {
  return promise
    .then((data) => ({ ok: true as const, data }))
    .catch((error: unknown) => {
      const status =
        error && typeof error === "object" && "status" in error
          ? Number((error as { status: number }).status)
          : undefined;
      return {
        ok: false as const,
        error: mapDashboardErrorMessage(error),
        status: Number.isFinite(status) ? status : undefined,
      };
    });
}

export async function loadDashboardSummary(): Promise<
  DashboardActionResult<DashboardSummary>
> {
  return wrap(dashboardApi.getSummary());
}

export async function loadIntegrationDetail(
  integrationId: string
): Promise<DashboardActionResult<DashboardIntegrationDetail>> {
  return wrap(dashboardApi.getIntegration(integrationId));
}

export async function loadDashboardTargets(
  integrationId: string
): Promise<DashboardActionResult<DashboardTargetsResponse>> {
  return wrap(dashboardApi.getTargets(integrationId));
}

export async function loadDashboardLogs(
  integrationId: string,
  page: number,
  pageSize = 20
): Promise<DashboardActionResult<DashboardLogsPage>> {
  const safePage = Number.isInteger(page) && page >= 1 ? page : 1;
  const safeSize =
    Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 100
      ? pageSize
      : 20;
  return wrap(
    dashboardApi.getLogs(integrationId, { page: safePage, pageSize: safeSize })
  );
}
