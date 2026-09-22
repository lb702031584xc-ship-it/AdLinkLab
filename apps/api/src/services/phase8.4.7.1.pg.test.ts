/**
 * Phase 8.4.7.1 — PostgreSQL Dashboard Read API (TEST-ONLY).
 * Opt-in: PHASE8471_PG=1
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
import { registerDashboardRoutes } from "../routes/dashboard.js";
import type { AppServices } from "../routes/index.js";
import {
  hashIntegrationToken,
  TEST_INTEGRATION_TOKEN_PEPPER,
} from "../auth/integration-token-crypto.js";
import { DashboardQueryService } from "./dashboard-query-service.js";
import { AuditService } from "./index.js";

const ROOT = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "database"
);
const RUN_PG = process.env.PHASE8471_PG === "1";
const PEPPER = TEST_INTEGRATION_TOKEN_PEPPER;

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
  await prisma.urlVersion.create({
    data: {
      id: randomUUID(),
      tenantId,
      entityType: "AD",
      entityId: adId,
      finalUrl: `https://example.com/${label}/v2`,
      customParameters: {},
      version: 2,
      status: "ACTIVE",
      effectiveAt: new Date(),
      createdBy: userId,
    },
  });
  return { tenantId, accountId, adId };
}

describe.skipIf(!RUN_PG)("Phase 8.4.7.1 PostgreSQL Dashboard", () => {
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
      dashboardQuery: new DashboardQueryService(
        repos.scriptIntegrations,
        repos.scriptSyncTargets,
        repos.scriptSyncLogs,
        repos.ads,
        repos.adGroups,
        repos.urlVersions
      ),
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
    await registerDashboardRoutes(app, services);
    return app;
  }

  it("integration / targets / logs / isolation / pagination / redaction", async () => {
    const graph = await seedGraph(prisma, "pg8471");
    const token = `alk_s_pg8471_${randomUUID().slice(0, 8)}`;
    const integrationId = randomUUID();
    const otherIntegrationId = randomUUID();
    const targetId = randomUUID();

    await repos.scriptIntegrations.create({
      id: integrationId,
      tenantId: graph.tenantId,
      googleAccountId: graph.accountId,
      name: "PG Dash",
      status: "ACTIVE",
      tokenKeyId: "itk_pg8471",
      tokenPrefix: token.slice(0, 12),
      tokenHash: hashIntegrationToken(token, PEPPER),
      configGeneration: 1,
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
      lastExecution: "SUCCESS",
    });

    for (let i = 0; i < 3; i++) {
      await repos.scriptSyncLogs.create({
        id: randomUUID(),
        tenantId: graph.tenantId,
        integrationId,
        targetId,
        desiredVersion: 2,
        reportedAppliedVersion: 2,
        result: "SUCCESS",
        idempotencyScope: "SCRIPT_SYNC_RESULT",
        idempotencyKey: `${integrationId}:pg8471-${i}`,
      });
    }

    const beforeApplied = (
      await repos.scriptSyncTargets.findById(targetId)
    )?.appliedVersion;
    const beforeLogs = await repos.scriptSyncLogs.findByIntegration(
      graph.tenantId,
      integrationId
    );

    const app = await buildApp();
    try {
      const headers = { authorization: `Bearer ${token}` };
      const list = await app.inject({
        method: "GET",
        url: "/api/v1/dashboard/integrations",
        headers,
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().items[0].integrationId).toBe(integrationId);
      expect(JSON.stringify(list.json())).not.toContain("tokenHash");
      expect(JSON.stringify(list.json())).not.toContain(PEPPER);

      const targets = await app.inject({
        method: "GET",
        url: `/api/v1/dashboard/integrations/${integrationId}/targets`,
        headers,
      });
      expect(targets.statusCode).toBe(200);
      expect(targets.json().items[0].desiredVersion).toBe(2);
      expect(targets.json().items[0].googleAdId).toBe(`gad-pg8471`);

      const logs = await app.inject({
        method: "GET",
        url: `/api/v1/dashboard/integrations/${integrationId}/logs?page=1&pageSize=2`,
        headers,
      });
      expect(logs.statusCode).toBe(200);
      expect(logs.json().total).toBe(3);
      expect(logs.json().hasNext).toBe(true);
      expect(logs.json().items).toHaveLength(2);

      const forbidden = await app.inject({
        method: "GET",
        url: `/api/v1/dashboard/integrations/${otherIntegrationId}`,
        headers,
      });
      expect(forbidden.statusCode).toBe(403);

      const summary = await app.inject({
        method: "GET",
        url: "/api/v1/dashboard/summary",
        headers,
      });
      expect(summary.statusCode).toBe(200);
      expect(summary.json().targets.total).toBe(1);
    } finally {
      await app.close();
    }

    expect(
      (await repos.scriptSyncTargets.findById(targetId))?.appliedVersion
    ).toBe(beforeApplied);
    expect(
      (
        await repos.scriptSyncLogs.findByIntegration(
          graph.tenantId,
          integrationId
        )
      ).total
    ).toBe(beforeLogs.total);
  });
});
