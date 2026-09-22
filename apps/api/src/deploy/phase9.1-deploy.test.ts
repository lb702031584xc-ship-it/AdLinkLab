/**
 * Phase 9.1 — Production Deployment Foundation tests.
 * Static + unit verification (no live Google Ads; Docker smoke is separate).
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { UnauthorizedError } from "@adlinklab/shared";
import {
  assertProductionDeployConfig,
  ProductionDeployConfigError,
} from "./production-config.js";
import {
  resolveIntegrationTokenPepper,
  assertIntegrationTokenPepperConfigured,
} from "../auth/integration-token-crypto.js";
import { resolvePersistenceMode } from "../persistence.js";
import { createAuthContext, assertAuthConfigured } from "../auth/tenant.js";
import { startWorkerProcess } from "../worker.js";
import { createWorkerRuntime } from "../queue/runtime.js";

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
  CORS_ORIGINS: "https://app.example.com",
};

function readRepo(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

describe("Phase 9.1 production deploy config", () => {
  it("1. valid production env passes", () => {
    expect(() =>
      assertProductionDeployConfig({ env: { ...PROD_BASE } })
    ).not.toThrow();
  });

  it("2. missing DATABASE_URL → fail", () => {
    expect(() =>
      assertProductionDeployConfig({
        env: { ...PROD_BASE, DATABASE_URL: "" },
      })
    ).toThrow(ProductionDeployConfigError);
    expect(() =>
      resolvePersistenceMode({
        env: {
          NODE_ENV: "production",
          PERSISTENCE: "prisma",
          DATABASE_URL: "",
        },
      })
    ).toThrow(/DATABASE_URL|Production requires/);
  });

  it("3. production memory persistence → fail", () => {
    expect(() =>
      assertProductionDeployConfig({
        env: { ...PROD_BASE, PERSISTENCE: "memory" },
      })
    ).toThrow(ProductionDeployConfigError);
    expect(() =>
      resolvePersistenceMode({
        env: {
          NODE_ENV: "production",
          PERSISTENCE: "memory",
          DATABASE_URL: PROD_BASE.DATABASE_URL,
        },
      })
    ).toThrow(/Production requires/);
  });

  it("4. missing INTEGRATION_TOKEN_PEPPER → fail", () => {
    expect(() =>
      assertProductionDeployConfig({
        env: { ...PROD_BASE, INTEGRATION_TOKEN_PEPPER: "" },
      })
    ).toThrow(/INTEGRATION_TOKEN_PEPPER/);

    expect(() =>
      resolveIntegrationTokenPepper({
        NODE_ENV: "production",
        INTEGRATION_TOKEN_PEPPER: "",
      })
    ).toThrow(UnauthorizedError);

    expect(() =>
      assertIntegrationTokenPepperConfigured({
        NODE_ENV: "production",
        INTEGRATION_TOKEN_PEPPER: "",
      })
    ).toThrow(/INTEGRATION_TOKEN_PEPPER/);
  });

  it("5. missing API key registry → fail", () => {
    expect(() =>
      assertProductionDeployConfig({
        env: { ...PROD_BASE, ADLINKLAB_API_KEYS: "" },
      })
    ).toThrow(/ADLINKLAB_API_KEYS/);

    const auth = createAuthContext({
      NODE_ENV: "production",
      AUTH_MODE: "api_key",
      ADLINKLAB_API_KEYS: "",
    });
    expect(() => assertAuthConfigured(auth)).toThrow(UnauthorizedError);
  });

  it("6. non-production env is no-op for deploy assert", () => {
    expect(() =>
      assertProductionDeployConfig({
        env: { NODE_ENV: "development" },
      })
    ).not.toThrow();
  });

  it("7. AUTH_MODE=disabled fails in production (Phase 9.2)", () => {
    expect(() =>
      assertProductionDeployConfig({
        env: {
          ...PROD_BASE,
          AUTH_MODE: "disabled",
          ADLINKLAB_API_KEYS: "",
        },
      })
    ).toThrow(/Production requires AUTH_MODE=api_key/);
  });

  it("8. worker requireWorkerQueue fails when queue off", () => {
    expect(() =>
      assertProductionDeployConfig({
        env: { ...PROD_BASE, QUEUE_MODE: "off" },
        requireWorkerQueue: true,
      })
    ).toThrow(/Worker requires QUEUE_MODE=redis/);
  });

  it("9. redis mode without REDIS_URL → fail", () => {
    expect(() =>
      assertProductionDeployConfig({
        env: { ...PROD_BASE, REDIS_URL: "" },
      })
    ).toThrow(/REDIS_URL/);
  });
});

describe("Phase 9.1 worker command / config smoke", () => {
  it("10. package.json exposes worker and worker:start", () => {
    const pkg = JSON.parse(readRepo("apps/api/package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.worker).toMatch(/worker\.ts/);
    expect(pkg.scripts["worker:start"]).toBe("node dist/worker.js");
  });

  it("11. Dockerfile default CMD is API server; worker uses compiled entry", () => {
    const dockerfile = readRepo("apps/api/Dockerfile");
    expect(dockerfile).toMatch(/CMD \["node", "dist\/server\.js"\]/);
    expect(dockerfile).toMatch(/corepack/);
    const compose = readRepo("docker-compose.yml");
    expect(compose).toMatch(/command:\s*\["node", "dist\/worker\.js"\]/);
  });

  it("12. startWorkerProcess rejects non-redis queue mode", async () => {
    const prevQueue = process.env.QUEUE_MODE;
    const prevNoAuto = process.env.ADLINKLAB_WORKER_NO_AUTOSTART;
    process.env.QUEUE_MODE = "off";
    process.env.ADLINKLAB_WORKER_NO_AUTOSTART = "1";
    try {
      await expect(startWorkerProcess()).rejects.toThrow(/QUEUE_MODE=redis/);
    } finally {
      if (prevQueue === undefined) delete process.env.QUEUE_MODE;
      else process.env.QUEUE_MODE = prevQueue;
      if (prevNoAuto === undefined) delete process.env.ADLINKLAB_WORKER_NO_AUTOSTART;
      else process.env.ADLINKLAB_WORKER_NO_AUTOSTART = prevNoAuto;
    }
  });
});

describe("Phase 9.1 migration command availability", () => {
  it("13. database package has migrate:deploy (prisma migrate deploy)", () => {
    const pkg = JSON.parse(readRepo("packages/database/package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["migrate:deploy"]).toBe("prisma migrate deploy");
  });

  it("14. root exposes db:migrate:deploy; compose migrate uses it", () => {
    const root = JSON.parse(readRepo("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(root.scripts["db:migrate:deploy"]).toContain("migrate:deploy");
    const compose = readRepo("docker-compose.yml");
    expect(compose).toMatch(/migrate:deploy/);
    expect(compose).not.toMatch(/prisma db push/);
  });

  it("15. migration count unchanged (no new Phase 9.1 schema migration)", () => {
    const migrationsDir = join(
      REPO_ROOT,
      "packages/database/prisma/migrations"
    );
    expect(existsSync(migrationsDir)).toBe(true);
    const names = readdirSync(migrationsDir).filter((n) =>
      existsSync(join(migrationsDir, n, "migration.sql"))
    );
    expect(names.length).toBe(6);
  });
});

describe("Phase 9.1 compose configuration", () => {
  const compose = () => readRepo("docker-compose.yml");

  it("16. includes postgres redis api worker web (+ traefik retained)", () => {
    const text = compose();
    for (const svc of [
      "postgres:",
      "redis:",
      "api:",
      "worker:",
      "web:",
      "migrate:",
      "traefik:",
    ]) {
      expect(text).toContain(svc);
    }
  });

  it("17. api and worker depend on migrate success", () => {
    expect(compose()).toMatch(
      /migrate:\s*\n\s*condition: service_completed_successfully/
    );
  });

  it("18. secrets are env-substituted, not hardcoded production passwords", () => {
    const text = compose();
    expect(text).not.toMatch(/POSTGRES_PASSWORD:\s*adlinklab\b/);
    expect(text).not.toMatch(
      /DATABASE_URL:\s*postgresql:\/\/adlinklab:adlinklab@/
    );
    expect(text).toMatch(
      /INTEGRATION_TOKEN_PEPPER:\s*\$\{INTEGRATION_TOKEN_PEPPER/
    );
    expect(text).toMatch(/ADLINKLAB_API_KEYS:\s*\$\{ADLINKLAB_API_KEYS/);
    expect(text).toMatch(/env_file:/);
  });

  it("19. Traefik dashboard bound to loopback", () => {
    expect(compose()).toMatch(/127\.0\.0\.1:8080:8080/);
  });

  it("20. worker queues remain urlChange + conversionUpload only", () => {
    const runtime = readRepo("apps/api/src/queue/runtime.ts");
    expect(runtime).toMatch(/QUEUE_NAMES\.urlChange/);
    expect(runtime).toMatch(/QUEUE_NAMES\.conversionUpload/);
    expect(compose()).not.toMatch(/clickProcessing|analyticsAggregation/);
  });
});

describe("Phase 9.1 web API URL + secret isolation", () => {
  it("21. web config requires NEXT_PUBLIC_API_BASE_URL; tokens are server-only", () => {
    const dash = readRepo("apps/web/src/lib/api/dashboard-config.ts");
    const admin = readRepo("apps/web/src/lib/api/admin-script-config.ts");
    expect(dash).toMatch(/NEXT_PUBLIC_API_BASE_URL/);
    expect(dash).toMatch(/ADLINKLAB_INTEGRATION_TOKEN/);
    expect(dash).toMatch(/never NEXT_PUBLIC_/i);
    expect(admin).toMatch(/ADLINKLAB_API_KEY/);
    expect(admin).toMatch(/must not use NEXT_PUBLIC_/);
  });

  it("22. compose wires web API URL and does not put pepper/keys in NEXT_PUBLIC_", () => {
    const text = compose();
    expect(text).toMatch(/NEXT_PUBLIC_API_BASE_URL/);
    expect(text).not.toMatch(/NEXT_PUBLIC_.*PEPPER/);
    expect(text).not.toMatch(/NEXT_PUBLIC_ADLINKLAB_API_KEYS/);
    expect(text).not.toMatch(/NEXT_PUBLIC_ADLINKLAB_INTEGRATION_TOKEN/);
    expect(text).not.toMatch(/NEXT_PUBLIC_ADLINKLAB_API_KEY/);
  });

  it("23. Dockerfile passes NEXT_PUBLIC_API_BASE_URL build arg", () => {
    const dockerfile = readRepo("apps/web/Dockerfile");
    expect(dockerfile).toMatch(/ARG NEXT_PUBLIC_API_BASE_URL/);
    expect(dockerfile).toMatch(/ENV NEXT_PUBLIC_API_BASE_URL/);
  });

  it("24. .env.example has placeholders only (no live secrets)", () => {
    const example = readRepo(".env.example");
    expect(example).toMatch(/INTEGRATION_TOKEN_PEPPER=replace-me/);
    expect(example).toMatch(/ADLINKLAB_API_KEYS=replace-me/);
    expect(example).toMatch(/POSTGRES_PASSWORD=replace-with-strong-password/);
    expect(example).not.toMatch(/alk_s_[A-Za-z0-9]{20,}/);
  });
});

function compose(): string {
  return readRepo("docker-compose.yml");
}

describe("Phase 9.1 graceful worker shutdown", () => {
  it("25. WorkerRuntime.close stops workers within timeout", async () => {
    const closed: string[] = [];
    const runtime = createWorkerRuntime(
      {
        syncJobs: {} as never,
        urlChangeRequests: {} as never,
        orderConversions: {} as never,
        log: { info: () => undefined, error: () => undefined },
      },
      {
        closeTimeoutMs: 5_000,
        createWorkers: () => [
          {
            close: async () => {
              closed.push("urlChange");
            },
          },
          {
            close: async () => {
              closed.push("conversionUpload");
            },
          },
        ],
      }
    );

    await runtime.start();
    expect(runtime.getStatus()).toBe("running");
    await runtime.close();
    expect(runtime.getStatus()).toBe("stopped");
    expect(closed).toEqual(["urlChange", "conversionUpload"]);
  });

  it("26. worker.ts registers SIGINT/SIGTERM shutdown", () => {
    const src = readRepo("apps/api/src/worker.ts");
    expect(src).toMatch(/SIGINT/);
    expect(src).toMatch(/SIGTERM/);
    expect(src).toMatch(/runtime\.close/);
    expect(src).toMatch(/services\.dispose/);
    expect(src).toMatch(/assertProductionDeployConfig/);
  });

  it("27. server.ts registers SIGINT/SIGTERM and production assert", () => {
    const src = readRepo("apps/api/src/server.ts");
    expect(src).toMatch(/SIGINT/);
    expect(src).toMatch(/SIGTERM/);
    expect(src).toMatch(/assertProductionDeployConfig/);
    expect(src).toMatch(/app\.close/);
  });
});

describe("Phase 9.1 security static scan (deploy files)", () => {
  it("28. no hardcoded OAuth / pepper / private key material in compose or Dockerfiles", () => {
    const files = [
      "docker-compose.yml",
      "apps/api/Dockerfile",
      "apps/web/Dockerfile",
      ".env.example",
    ];
    for (const f of files) {
      const text = readRepo(f);
      expect(text).not.toMatch(/BEGIN (RSA |OPENSSH )?PRIVATE KEY/);
      expect(text).not.toMatch(/GOOGLE_ADS_REFRESH_TOKEN=\S{20,}/);
      expect(text).not.toMatch(/INTEGRATION_TOKEN_PEPPER=[a-f0-9]{32,}/i);
      expect(text).not.toMatch(/tokenHash:\s*["'][a-f0-9]{40,}/);
    }
  });
});

describe("Phase 9.1 architecture preservation smoke", () => {
  it("29. GoogleAdsApiProvider still forbids mutations", () => {
    const src = readRepo("packages/google-ads/src/api-provider.ts");
    expect(src).toMatch(/mutationForbidden/);
    expect(src).toMatch(/mutationsEnabled: false/);
  });

  it("30. Script config still derives desired from ACTIVE UrlVersion", () => {
    const src = readRepo("apps/api/src/services/script-config-service.ts");
    expect(src).toMatch(/ACTIVE/i);
    expect(src.toLowerCase()).toMatch(/desired/);
  });
});
