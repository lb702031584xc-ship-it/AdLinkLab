/**
 * Phase 8.4.9 — Script Integration Admin config (server-side only).
 * Uses Tenant API Key — never Integration Token for admin mutations.
 * Never NEXT_PUBLIC_* for secrets.
 */

export function getApiBaseUrl(
  env: NodeJS.ProcessEnv = process.env
): string {
  const raw = (env.NEXT_PUBLIC_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!raw) {
    throw new AdminScriptConfigError(
      "NEXT_PUBLIC_API_BASE_URL is not configured"
    );
  }
  return raw;
}

/**
 * Server-only Tenant API Key for Admin Script Integration APIs.
 */
export function getAdminApiKey(
  env: NodeJS.ProcessEnv = process.env
): string {
  const key = (env.ADLINKLAB_API_KEY ?? "").trim();
  if (!key) {
    throw new AdminScriptConfigError("ADLINKLAB_API_KEY is not configured");
  }
  if (key.startsWith("NEXT_PUBLIC_")) {
    throw new AdminScriptConfigError(
      "ADLINKLAB_API_KEY must not use NEXT_PUBLIC_ prefix"
    );
  }
  return key;
}

export class AdminScriptConfigError extends Error {
  readonly code = "ADMIN_SCRIPT_CONFIG";
  constructor(message: string) {
    super(message);
    this.name = "AdminScriptConfigError";
  }
}

export function mapAdminErrorMessage(error: unknown): string {
  if (error instanceof AdminScriptConfigError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unexpected admin API error";
}
