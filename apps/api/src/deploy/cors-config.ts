/**
 * Phase 10 — Configurable CORS allowlist (fail-closed in production).
 */
import { ProductionDeployConfigError } from "./production-config.js";

export type CorsOriginOption = boolean | string | string[];

/**
 * Resolve CORS origin policy from env.
 * - production: CORS_ORIGINS required (comma-separated); `*` / empty → fail closed
 * - non-production: missing / empty / `*` → reflect request origin (`true`) for tests/dev
 */
export function resolveCorsOrigin(
  env: NodeJS.ProcessEnv = process.env
): CorsOriginOption {
  const nodeEnv = (env.NODE_ENV ?? "").trim();
  const raw = (env.CORS_ORIGINS ?? "").trim();
  const isProduction = nodeEnv === "production";

  if (isProduction) {
    if (!raw || raw === "*") {
      throw new ProductionDeployConfigError([
        "CORS_ORIGINS must be an explicit comma-separated allowlist in production (fail closed; `*` forbidden)",
      ]);
    }
    const list = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length === 0) {
      throw new ProductionDeployConfigError([
        "CORS_ORIGINS must list at least one origin in production",
      ]);
    }
    return list;
  }

  if (!raw || raw === "*") {
    return true;
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Assert production CORS allowlist (no-op outside production). */
export function assertProductionCorsConfig(
  env: NodeJS.ProcessEnv = process.env
): void {
  if ((env.NODE_ENV ?? "").trim() !== "production") {
    return;
  }
  resolveCorsOrigin(env);
}
