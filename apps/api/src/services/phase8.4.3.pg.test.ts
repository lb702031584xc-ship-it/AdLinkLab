/**
 * Phase 8.4.3 — PostgreSQL Script Config API (TEST-ONLY).
 * Opt-in: PHASE843_PG=1
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
import { registerScriptRoutes } from "../routes/script.js";
import type { AppServices } from "../routes/index.js";
import {
  hashIntegrationToken,
  TEST_INTEGRATION_TOKEN_PEPPER,
} from "../auth/integration-token-crypto.js";
import { ScriptConfigService } from "./script-config-service.js";
import {
  phase61DatabaseUrl,
  startPhase61Postgres,
  stopPhase61Postgres,
} from "../../../../packages/database/scripts/phase61-pg-harness.mts";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)), "..", "..", "..", "packages", "database");
const RUN_PG = process.env.PHASE843_PG === "1";
const PEPPER = TEST_INTEGRATION_TOKEN_PEPPER;
const CONFIG_PATH = "/api/v1/script/config";

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

async function seedAdGraph(prisma: PrismaClient, label: string) {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const accountId = randomUUID();
  const campaignId = randomUUID();
  const adGroupId = randomUUID();
  const adId = randomUUID();
  const urlVersionId = randomUUID();
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
      email: `${label}@example.com`,
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
      id: urlVersionId,
      tenantId,
      entityType: "AD",
      entityId: adId,
      finalUrl: `https://example.com/${label}/landing-v2`,
      finalMobileUrl: `https://m.example.com/${label}/landing-v2`,
      trackingTemplate: "https://tracker.example.com/click?url={lpurl}",
      customParameters: { _clickid: label },
      version: 2,
      status: "ACTIVE",
      effectiveAt: new Date("2026-01-01T01:00:00.000Z"),
      createdBy: userId,
    },
  });
  return { tenantId, accountId, adId, urlVersionId };
}

describe.skipIf(!RUN_PG)("Phase 8.4.3 PostgreSQL Script Config API", () => {
  let prisma: PrismaClient;
  let startedByUs = false;
  let token: string;
  let integrationId: string;
  let targetId: string;
  let urlVersionId: string;
  let app: ReturnType<typeof Fastify>;

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
        WHERE schemaname = 'public' AND tablename = 'google_ads_script_integrations'
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

    const graph = await seedAdGraph(prisma, "pg843");
    urlVersionId = graph.urlVersionId;

    const repos = createPrismaRepositoryBundle(prisma);
    token = `alk_s_pg843_${randomUUID().slice(0, 8)}`;
    integrationId = randomUUID();
    targetId = randomUUID();

    await repos.scriptIntegrations.create({
      id: integrationId,
      tenantId: graph.tenantId,
      googleAccountId: graph.accountId,
      name: "PG Config Integration",
      status: "ACTIVE",
      tokenKeyId: "itk_pg843",
      tokenPrefix: token.slice(0, 12),
      tokenHash: hashIntegrationToken(token, PEPPER),
      configGeneration: 5,
    });

    await repos.scriptSyncTargets.create({
      id: targetId,
      tenantId: graph.tenantId,
      integrationId,
      entityType: "AD",
      entityId: graph.adId,
      appliedVersion: 1,
      syncState: "OUT_OF_SYNC",
      connectionHealth: "CONNECTED",
    });

    const scriptConfig = new ScriptConfigService(
      repos.scriptIntegrations,
      repos.scriptSyncTargets,
      repos.ads,
      repos.adGroups,
      repos.urlVersions
    );

    app = Fastify({ logger: false });
    app.setErrorHandler((error, _req, reply) => {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send({
          error: error.code,
          message: error.message,
        });
      }
      return reply.status(500).send({ error: "INTERNAL_ERROR" });
    });
    const services = {
      scriptIntegrations: repos.scriptIntegrations,
      scriptConfig,
    } as Pick<AppServices, "scriptIntegrations" | "scriptConfig">;
    await registerScriptRoutes(app, services as AppServices);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    if (startedByUs) await stopPhase61Postgres();
  });

  it("GET /api/v1/script/config returns ACTIVE UrlVersion via Prisma", async () => {
    const res = await app.inject({
      method: "GET",
      url: CONFIG_PATH,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.configGeneration).toBe(5);
    expect(body.targets).toHaveLength(1);
    expect(body.targets[0].targetId).toBe(targetId);
    expect(body.targets[0].desiredVersion).toBe(2);
    expect(body.targets[0].appliedVersion).toBe(1);
    expect(body.targets[0].finalUrl).toContain("landing-v2");
  });

  it("GET config is read-only in PostgreSQL", async () => {
    const targetBefore = await prisma.scriptSyncTarget.findUnique({
      where: { id: targetId },
    });
    const versionBefore = await prisma.urlVersion.findUnique({
      where: { id: urlVersionId },
    });
    const jobCountBefore = await prisma.syncJob.count();
    await app.inject({
      method: "GET",
      url: CONFIG_PATH,
      headers: { authorization: `Bearer ${token}` },
    });
    const targetAfter = await prisma.scriptSyncTarget.findUnique({
      where: { id: targetId },
    });
    const versionAfter = await prisma.urlVersion.findUnique({
      where: { id: urlVersionId },
    });
    const jobCountAfter = await prisma.syncJob.count();
    expect(targetAfter?.appliedVersion).toBe(targetBefore?.appliedVersion);
    expect(versionAfter?.status).toBe(versionBefore?.status);
    expect(jobCountAfter).toBe(jobCountBefore);
  });
});
