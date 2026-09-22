/**
 * Phase 8.4.7.2 — Dashboard API config (server-side secrets only).
 * Token must NEVER use NEXT_PUBLIC_* — never ship to the browser bundle.
 */

export function getApiBaseUrl(
  env: NodeJS.ProcessEnv = process.env
): string {
  const raw = (env.NEXT_PUBLIC_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!raw) {
    throw new DashboardConfigError(
      "NEXT_PUBLIC_API_BASE_URL is not configured"
    );
  }
  return raw;
}

/**
 * Server-only Integration Token for Dashboard GET calls.
 * Prefer ADLINKLAB_INTEGRATION_TOKEN; never NEXT_PUBLIC_*.
 */
export function getDashboardIntegrationToken(
  env: NodeJS.ProcessEnv = process.env
): string {
  const token = (env.ADLINKLAB_INTEGRATION_TOKEN ?? "").trim();
  if (!token) {
    throw new DashboardConfigError(
      "ADLINKLAB_INTEGRATION_TOKEN is not configured"
    );
  }
  return token;
}

export class DashboardConfigError extends Error {
  readonly code = "DASHBOARD_CONFIG";
  constructor(message: string) {
    super(message);
    this.name = "DashboardConfigError";
  }
}

export class DashboardApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = "DASHBOARD_API_ERROR") {
    super(message);
    this.name = "DashboardApiError";
    this.status = status;
    this.code = code;
  }
}

/** Map HTTP status to safe user-facing message (no secrets / stack). */
export function mapDashboardErrorMessage(error: unknown): string {
  if (error instanceof DashboardConfigError) {
    return "Dashboard is not configured. Set API base URL and integration token on the server.";
  }
  if (error instanceof DashboardApiError) {
    if (error.status === 401) return "Authentication required.";
    if (error.status === 403) {
      return "You do not have access to this integration.";
    }
    if (error.status === 404) return "Dashboard resource was not found.";
    if (error.status >= 500) return "Unable to load dashboard data.";
    return "Unable to load dashboard data.";
  }
  return "Unable to load dashboard data.";
}
