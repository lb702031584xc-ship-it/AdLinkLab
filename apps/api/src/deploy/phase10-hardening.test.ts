/**
 * Phase 10 — Production hardening tests (CORS, rate limit, compose, phase stamp).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import {
  resolveCorsOrigin,
  assertProductionCorsConfig,
} from "./cors-config.js";
import {
  assertProductionDeployConfig,
  ProductionDeployConfigError,
} from "./production-config.js";
import {
  isRateLimitExemptPath,
  isScriptApiPath,
  resolveRateLimitThresholds,
} from "./rate-limit-config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../../");

const TENANT_A = "00000000-0000-4000-8000-000000000001";
const PROD_BASE: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  PERSISTENCE: "prisma",
  DATABASE_URL: "postgresql://u:p@postgres:5432/adlinklab?schema=public",
  REDIS_URL: "redis://redis:6379",
  AUTH_MODE: "api_key",
  ADLINKLAB_API_KEYS: `ops_key:${TENANT_A}`,
  INTEGRATION_TOKEN_PEPPER: "phase91-test-pepper-not-for-real-use-32c",
  QUEUE_MODE: "redis",
  CORS_ORIGINS: "https://app.example.com,https://admin.example.com",
};

describe("Phase 10 CORS", () => {
  afterEach(() => {
    delete process.env.CORS_ORIGINS;
    delete process.env.NODE_ENV;
  });

  it("1. production + missing CORS_ORIGINS → fail closed", () => {
    expect(() =>
      assertProductionDeployConfig({
        env: { ...PROD_BASE, CORS_ORIGINS: "" },
      })
    ).toThrow(ProductionDeployConfigError);
    expect(() =>
      resolveCorsOrigin({ NODE_ENV: "production", CORS_ORIGINS: "" })
    ).toThrow(ProductionDeployConfigError);
  });

  it("2. production + CORS_ORIGINS=* → fail closed", () => {
    expect(() =>
      resolveCorsOrigin({ NODE_ENV: "production", CORS_ORIGINS: "*" })
    ).toThrow(/fail closed|\*/i);
  });

  it("3. production allowlist returns explicit origins", () => {
    expect(
      resolveCorsOrigin({
        NODE_ENV: "production",
        CORS_ORIGINS: "https://a.example, https://b.example",
      })
    ).toEqual(["https://a.example", "https://b.example"]);
  });

  it("4. non-production defaults to reflect origin", () => {
    expect(resolveCorsOrigin({ NODE_ENV: "test" })).toBe(true);
    expect(resolveCorsOrigin({ NODE_ENV: "development" })).toBe(true);
  });

  it("5. allowlist match / mismatch via inject", async () => {
    process.env.NODE_ENV = "test";
    process.env.CORS_ORIGINS = "https://allowed.example";
    const app = await buildApp();
    const ok = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://allowed.example" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["access-control-allow-origin"]).toBe(
      "https://allowed.example"
    );

    const denied = await app.inject({
      method: "OPTIONS",
      url: "/health",
      headers: {
        origin: "https://evil.example",
        "access-control-request-method": "GET",
      },
    });
    // Non-allowlisted origin must not be reflected
    expect(denied.headers["access-control-allow-origin"]).not.toBe(
      "https://evil.example"
    );
    await app.close();
    delete process.env.CORS_ORIGINS;
  });

  it("6. assertProductionCorsConfig no-op outside production", () => {
    expect(() =>
      assertProductionCorsConfig({ NODE_ENV: "test", CORS_ORIGINS: "" })
    ).not.toThrow();
  });
});

describe("Phase 10 rate limiting", () => {
  it("1. script vs api thresholds differ", () => {
    const t = resolveRateLimitThresholds({
      NODE_ENV: "production",
      RATE_LIMIT_API_MAX: "50",
      RATE_LIMIT_SCRIPT_MAX: "10",
    });
    expect(t.apiMax).toBe(50);
    expect(t.scriptMax).toBe(10);
    expect(isScriptApiPath("/api/v1/script/config")).toBe(true);
    expect(isScriptApiPath("/api/v1/campaigns")).toBe(false);
    expect(isRateLimitExemptPath("/health/ready")).toBe(true);
  });

  it("2. exceeding limit returns 429", async () => {
    process.env.RATE_LIMIT_API_MAX = "2";
    process.env.RATE_LIMIT_SCRIPT_MAX = "2";
    process.env.RATE_LIMIT_WINDOW = "1 minute";
    const app = await buildApp();
    const a = await app.inject({ method: "GET", url: "/api/v1/campaigns" });
    const b = await app.inject({ method: "GET", url: "/api/v1/campaigns" });
    const c = await app.inject({ method: "GET", url: "/api/v1/campaigns" });
    expect(a.statusCode).not.toBe(429);
    expect(b.statusCode).not.toBe(429);
    expect(c.statusCode).toBe(429);
    const body = c.json() as { message?: string; statusCode?: number };
    expect(JSON.stringify(body)).not.toMatch(/api.key|pepper|password|secret/i);
    await app.close();
    delete process.env.RATE_LIMIT_API_MAX;
    delete process.env.RATE_LIMIT_SCRIPT_MAX;
    delete process.env.RATE_LIMIT_WINDOW;
  });

  it("3. health routes are not rate-limited destructively", async () => {
    process.env.RATE_LIMIT_API_MAX = "1";
    process.env.RATE_LIMIT_WINDOW = "1 minute";
    const app = await buildApp();
    await app.inject({ method: "GET", url: "/api/v1/campaigns" });
    const blocked = await app.inject({
      method: "GET",
      url: "/api/v1/campaigns",
    });
    expect(blocked.statusCode).toBe(429);
    const health = await app.inject({ method: "GET", url: "/health" });
    const ready = await app.inject({ method: "GET", url: "/health/ready" });
    expect(health.statusCode).toBe(200);
    expect(ready.statusCode).toBe(200);
    await app.close();
    delete process.env.RATE_LIMIT_API_MAX;
    delete process.env.RATE_LIMIT_WINDOW;
  });
});

describe("Phase 10 compose / health phase", () => {
  const compose = () =>
    readFileSync(join(REPO_ROOT, "docker-compose.yml"), "utf8");

  it("1. api healthcheck uses /health/ready", () => {
    expect(compose()).toMatch(/health\/ready/);
    expect(compose()).not.toMatch(
      /fetch\('http:\/\/127\.0\.0\.1:3001\/health'\)/
    );
  });

  it("2. traefik insecure gated by TRAEFIK_DASHBOARD", () => {
    const text = compose();
    expect(text).toMatch(/TRAEFIK_DASHBOARD/);
    expect(text).not.toMatch(/--api\.insecure=true/);
  });

  it("3. worker healthcheck verifies dist/worker.js", () => {
    expect(compose()).toMatch(/dist\/worker\.js/);
  });

  it("4. /health phase stamp is 10", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.json()).toMatchObject({ phase: "10" });
    await app.close();
  });
});
