/**
 * Phase 9.1 — Production deployment startup safety.
 * Phase 9.2 — Production AUTH_MODE must be explicit api_key (via resolveAuthMode).
 */
import {
  loadApiKeyRegistry,
  resolveAuthMode,
} from "../auth/api-keys.js";
import { resolvePersistenceMode } from "../persistence.js";
import { resolveQueueMode } from "../queue/producer.js";

export class ProductionDeployConfigError extends Error {
  readonly code = "PRODUCTION_DEPLOY_CONFIG";
  readonly problems: string[];

  constructor(problems: string[]) {
    super(
      `Production deploy config invalid: ${problems.join("; ")}`
    );
    this.name = "ProductionDeployConfigError";
    this.problems = problems;
  }
}

export interface AssertProductionDeployOptions {
  env?: NodeJS.ProcessEnv;
  /** When true, require redis queue mode (worker process). */
  requireWorkerQueue?: boolean;
}

/**
 * Validate production deploy environment. No-op outside NODE_ENV=production.
 */
export function assertProductionDeployConfig(
  options: AssertProductionDeployOptions = {}
): void {
  const env = options.env ?? process.env;
  if ((env.NODE_ENV ?? "").trim() !== "production") {
    return;
  }

  const problems: string[] = [];

  try {
    const mode = resolvePersistenceMode({ env });
    if (mode !== "prisma") {
      problems.push("PERSISTENCE must resolve to prisma in production");
    }
  } catch (error) {
    problems.push(
      error instanceof Error
        ? error.message
        : "Production persistence configuration failed"
    );
  }

  const pepper = (env.INTEGRATION_TOKEN_PEPPER ?? "").trim();
  if (!pepper) {
    problems.push(
      "INTEGRATION_TOKEN_PEPPER is required in production (fail closed)"
    );
  }

  // Phase 9.2: resolveAuthMode throws when production AUTH_MODE is not api_key.
  try {
    const authMode = resolveAuthMode(env);
    if (authMode === "api_key") {
      const registry = loadApiKeyRegistry(env);
      if (registry.length === 0) {
        problems.push(
          "AUTH_MODE=api_key but no API keys configured (set ADLINKLAB_API_KEYS)"
        );
      }
    }
  } catch (error) {
    problems.push(
      error instanceof Error
        ? error.message
        : "Production requires AUTH_MODE=api_key"
    );
  }

  const queueMode = resolveQueueMode(env);
  if (options.requireWorkerQueue && queueMode !== "redis") {
    problems.push(
      `Worker requires QUEUE_MODE=redis (current mode=${queueMode})`
    );
  }
  if (queueMode === "redis" && !(env.REDIS_URL ?? "").trim()) {
    problems.push("REDIS_URL is required when queue mode is redis");
  }

  // Phase 10 — CORS allowlist required in production (fail closed).
  const corsRaw = (env.CORS_ORIGINS ?? "").trim();
  if (!corsRaw || corsRaw === "*") {
    problems.push(
      "CORS_ORIGINS must be an explicit comma-separated allowlist in production (fail closed; `*` forbidden)"
    );
  }

  if (problems.length > 0) {
    throw new ProductionDeployConfigError(problems);
  }
}
