/**
 * Phase 8.4.6 — PostgreSQL Script Generator (TEST-ONLY).
 * Opt-in: PHASE846_PG=1
 * No migration required.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPrismaRepositoryBundle } from "@adlinklab/database";
import { AppError } from "@adlinklab/shared";
import {
  phase61DatabaseUrl,
  startPhase61Postgres,
  stopPhase61Postgres,
} from "../../../../packages/database/scripts/phase61-pg-harness.mts";
import { registerScriptRoutes } from "../routes/script.js";
import type { AppServices } from "../routes/index.js";
import {
  hashIntegrationToken,
  TEST_INTEGRATION_TOKEN_PEPPER,
} from "../auth/integration-token-crypto.js";
import { ScriptConfigService } from "./script-config-service.js";
import { ScriptSyncResultService } from "./script-sync-result-service.js";
import { ScriptGeneratorService } from "./script-generator-service.js";
import { SCRIPT_GENERATOR_VERSION } from "./script-generator-source.js";
import { AuditService } from "./index.js";

const ROOT = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "database"
);
const RUN_PG = process.env.PHASE846_PG === "1";
const PEPPER = TEST_INTEGRATION_TOKEN_PEPPER;
const GEN_PATH = "/api/v1/script/generator";
const BASE = "https://staging.validateidea.org";

function runMigrateDeploy(): void {
  const migrate = spawnSync(
    "pnpm",
    ["exec", "tsx", "scripts/phase61-migrate-deploy.mts"],
    {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: phase61DatabaseUrl() },
      encoding: "utf8",
      shell: true,
    }
  );
  if (migrate.status !== 0) {
    throw new Error(`migrate failed: ${migrate.stdout}\n${migrate.stderr}`);
  }
}

async function seedGraph(prisma: PrismaClient, label: string) {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const accountId = randomUUID();
  const campaignId = randomUUID();
  const adGroupId = randomUUID();
  const adId = randomUUID();
  await prisma.tenant.create({
    data: {
      id: tenantId,
      name: label,
      slug: `${label}-${tenantId.slice(0, 8)}`,
      status: "ACTIVE",
    },
  });
  await prisma.user.create({
    data: {
      id: userId,
      tenantId,
      email: `${label}-${tenantId.slice(0, 8)}@example.com`,
      name: label,
      status: "ACTIVE",
    },
  });
  await prisma.googleAccount.create({
    data: {
      id: accountId,
      tenantId,
      userId,
      customerId: `cust-${label}-${accountId.slice(0, 8)}`,
      name: `${label}-account`,
      currency: "USD",
      timezone: "UTC",
      status: "ACTIVE",
    },
  });
  await prisma.campaign.create({
    data: {
      id: campaignId,
      tenantId,
      googleAccountId: accountId,
      googleCampaignId: `gc-${label}`,
      name: `${label}-campaign`,
      status: "ACTIVE",
    },
  });
  await prisma.adGroup.create({
    data: {
      id: adGroupId,
      tenantId,
      campaignId,
      googleAdGroupId: `gag-${label}`,
      name: `${label}-adgroup`,
      status: "ACTIVE",
    },
  });
  await prisma.ad.create({
    data: {
      id: adId,
      tenantId,
      adGroupId,
      googleAdId: `gad-${label}`,
      name: `${label}-ad`,
      status: "ACTIVE",
    },
  });
  return { tenantId, accountId, adId };
}

describe.skipIf(!RUN_PG)("Phase 8.4.6 PostgreSQL Script Generator", () => {
  let prisma: PrismaClient;
  let startedByUs = false;
  let repos: ReturnType<typeof createPrismaRepositoryBundle>;

  beforeAll(async () => {
    process.env.DATABASE_URL = phase61DatabaseUrl();
    process.env.INTEGRATION_TOKEN_PEPPER = PEPPER;
    prisma = new PrismaClient({
      datasources: { db: { url: phase61DatabaseUrl() } },
    });

    let connected = false;
    let schemaReady = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      connected = true;
      const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'script_sync_logs'
      `;
      schemaReady = tables.length > 0;
    } catch {
      connected = false;
    }

    if (!connected) {
      await startPhase61Postgres();
      startedByUs = true;
      runMigrateDeploy();
    } else if (!schemaReady) {
      runMigrateDeploy();
    }

    repos = createPrismaRepositoryBundle(prisma);
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (startedByUs) await stopPhase61Postgres();
  });

  async function buildApp() {
    const audit = new AuditService(repos.auditLogs);
    const services = {
      scriptIntegrations: repos.scriptIntegrations,
      scriptConfig: new ScriptConfigService(
        repos.scriptIntegrations,
        repos.scriptSyncTargets,
        repos.ads,
        repos.adGroups,
        repos.urlVersions
      ),
      scriptSyncResult: new ScriptSyncResultService(
        repos.scriptSyncRunner,
        audit
      ),
      scriptGenerator: new ScriptGeneratorService({
        VITEST: "1",
        SCRIPT_API_BASE_URL: BASE,
      } as NodeJS.ProcessEnv),
      audit,
    } as AppServices;
    const app = Fastify({ logger: false });
    app.setErrorHandler((error, _req, reply) => {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send({
          error: error.code,
          message: error.message,
          details: error.details,
        });
      }
      return reply.status(500).send({ error: "INTERNAL_ERROR" });
    });
    await registerScriptRoutes(app, services);
    return app;
  }

  it("authenticated generator — correct integration/tenant, no mutation, deterministic", async () => {
    const graph = await seedGraph(prisma, "pg846");
    const token = `alk_s_pg846_${randomUUID().slice(0, 8)}`;
    const integrationId = randomUUID();
    const targetId = randomUUID();

    await repos.scriptIntegrations.create({
      id: integrationId,
      tenantId: graph.tenantId,
      googleAccountId: graph.accountId,
      name: "PG Gen",
      status: "ACTIVE",
      tokenKeyId: "itk_pg846",
      tokenPrefix: token.slice(0, 12),
      tokenHash: hashIntegrationToken(token, PEPPER),
      configGeneration: 0,
    });

    await repos.scriptSyncTargets.create({
      id: targetId,
      tenantId: graph.tenantId,
      integrationId,
      entityType: "AD",
      entityId: graph.adId,
      appliedVersion: 2,
      desiredVersion: 2,
      syncState: "SYNCED",
      connectionHealth: "CONNECTED",
    });

    const beforeTarget = await repos.scriptSyncTargets.findById(targetId);
    const beforeLogs = await repos.scriptSyncLogs.findByIntegration(
      graph.tenantId,
      integrationId
    );
    const beforeJobs = await repos.syncJobs.list({
      tenantId: graph.tenantId,
    });

    const app = await buildApp();
    try {
      const opts = {
        method: "POST" as const,
        url: GEN_PATH,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        payload: { baseUrl: BASE },
      };
      const res1 = await app.inject(opts);
      const res2 = await app.inject(opts);
      expect(res1.statusCode).toBe(200);
      expect(res2.statusCode).toBe(200);
      const body = res1.json();
      expect(body.integrationId).toBe(integrationId);
      expect(body.scriptVersion).toBe(SCRIPT_GENERATOR_VERSION);
      expect(body.source).toContain(integrationId);
      expect(body.source).toContain(`${BASE}/api/v1/script/config`);
      expect(body.source).not.toContain(targetId);
      expect(res1.json().source).toBe(res2.json().source);
      expect(body.tokenHash).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain(PEPPER);
    } finally {
      await app.close();
    }

    const afterTarget = await repos.scriptSyncTargets.findById(targetId);
    const afterLogs = await repos.scriptSyncLogs.findByIntegration(
      graph.tenantId,
      integrationId
    );
    const afterJobs = await repos.syncJobs.list({
      tenantId: graph.tenantId,
    });
    expect(afterTarget?.appliedVersion).toBe(beforeTarget?.appliedVersion);
    expect(afterTarget?.desiredVersion).toBe(beforeTarget?.desiredVersion);
    expect(afterLogs.total).toBe(beforeLogs.total);
    expect(afterJobs.total).toBe(beforeJobs.total);
  });
});
