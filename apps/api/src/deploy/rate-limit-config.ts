/**
 * Phase 10 — Minimal HTTP rate-limit thresholds (env-configurable).
 */
export interface RateLimitThresholds {
  /** Max requests per window for general / management API. */
  apiMax: number;
  /** Max requests per window for `/api/v1/script/*`. */
  scriptMax: number;
  /** Fastify rate-limit timeWindow (ms number or string like "1 minute"). */
  timeWindow: string | number;
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

/**
 * Resolve rate-limit thresholds.
 * Dev/test defaults are high so existing inject suites are not disrupted.
 */
export function resolveRateLimitThresholds(
  env: NodeJS.ProcessEnv = process.env
): RateLimitThresholds {
  const isProduction = (env.NODE_ENV ?? "").trim() === "production";
  const apiDefault = isProduction ? 120 : 10_000;
  const scriptDefault = isProduction ? 60 : 10_000;
  const windowRaw = (env.RATE_LIMIT_WINDOW ?? "").trim();

  return {
    apiMax: parsePositiveInt(env.RATE_LIMIT_API_MAX, apiDefault),
    scriptMax: parsePositiveInt(env.RATE_LIMIT_SCRIPT_MAX, scriptDefault),
    timeWindow: windowRaw || "1 minute",
  };
}

export function isRateLimitExemptPath(url: string): boolean {
  const path = url.split("?")[0] ?? "";
  return (
    path === "/health" ||
    path.startsWith("/health/") ||
    path === "/metrics"
  );
}

export function isScriptApiPath(url: string): boolean {
  const path = url.split("?")[0] ?? "";
  return path === "/api/v1/script" || path.startsWith("/api/v1/script/");
}
