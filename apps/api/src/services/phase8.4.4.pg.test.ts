/**
 * Phase 8.4.4 — PostgreSQL Script Sync Result (TEST-ONLY).
 * Opt-in: PHASE844_PG=1
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

const ROOT = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "database"
);
const RUN_PG = process.env.PHASE844_PG === "1";
const PEPPER = TEST_INTEGRATION_TOKEN_PEPPER;
const SYNC_PATH = "/api/v1/script/sync-result";

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
      finalUrl: `https://example.com/${label}/v2`,
      customParameters: { _x: label },
      version: 2,
      status: "ACTIVE",
      effectiveAt: new Date("2026-01-01T01:00:00.000Z"),
      createdBy: userId,
    },
  });
  return { tenantId, accountId, adId, urlVersionId };
}

describe.skipIf(!RUN_PG)("Phase 8.4.4 PostgreSQL Script Sync Result", () => {
  let prisma: PrismaClient;
  let startedByUs = false;
  let token: string;
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

    const graph = await seedGraph(prisma, "pg844");
    urlVersionId = graph.urlVersionId;
    const repos = createPrismaRepositoryBundle(prisma);
    token = `alk_s_pg844_${randomUUID().slice(0, 8)}`;
    const integrationId = randomUUID();
    targetId = randomUUID();

    await repos.scriptIntegrations.create({
      id: integrationId,
      tenantId: graph.tenantId,
      googleAccountId: graph.accountId,
      name: "PG Sync Result",
      status: "ACTIVE",
      tokenKeyId: "itk_pg844",
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
      appliedVersion: 1,
      syncState: "OUT_OF_SYNC",
      connectionHealth: "CONNECTED",
    });

    const services = {
      scriptIntegrations: repos.scriptIntegrations,
      scriptConfig: new ScriptConfigService(
        repos.scriptIntegrations,
        repos.scriptSyncTargets,
        repos.ads,
        repos.adGroups,
        repos.urlVersions
      ),
      scriptSyncResult: new ScriptSyncResultService(repos.scriptSyncRunner),
    } as Pick<
      AppServices,
      "scriptIntegrations" | "scriptConfig" | "scriptSyncResult"
    >;

    app = Fastify({ logger: false });
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
    await registerScriptRoutes(app, services as AppServices);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    if (startedByUs) await stopPhase61Postgres();
  });

  it("CAS success persists appliedVersion + ScriptSyncLog", async () => {
    const res = await app.inject({
      method: "POST",
      url: SYNC_PATH,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        targetId,
        desiredVersion: 2,
        result: "SUCCESS",
        idempotencyKey: "pg-success",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      appliedVersion: 2,
      status: "APPLIED",
    });
    const target = await prisma.scriptSyncTarget.findUnique({
      where: { id: targetId },
    });
    expect(target?.appliedVersion).toBe(2);
    expect(target?.syncState).toBe("SYNCED");
    const logs = await prisma.scriptSyncLog.findMany({
      where: { targetId },
    });
    expect(logs.length).toBe(1);
    expect(logs[0].result).toBe("SUCCESS");
  });

  it("idempotent replay does not duplicate log", async () => {
    const res = await app.inject({
      method: "POST",
      url: SYNC_PATH,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        targetId,
        desiredVersion: 2,
        result: "SUCCESS",
        idempotencyKey: "pg-success",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ALREADY_APPLIED");
    const logs = await prisma.scriptSyncLog.count({ where: { targetId } });
    expect(logs).toBe(1);
  });

  it("stale desired rejects without changing appliedVersion", async () => {
    const before = await prisma.scriptSyncTarget.findUnique({
      where: { id: targetId },
    });
    const res = await app.inject({
      method: "POST",
      url: SYNC_PATH,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        targetId,
        desiredVersion: 1,
        result: "SUCCESS",
        idempotencyKey: "pg-stale",
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("STALE_DESIRED");
    const after = await prisma.scriptSyncTarget.findUnique({
      where: { id: targetId },
    });
    expect(after?.appliedVersion).toBe(before?.appliedVersion);
    const version = await prisma.urlVersion.findUnique({
      where: { id: urlVersionId },
    });
    expect(version?.status).toBe("ACTIVE");
    expect(version?.version).toBe(2);
  });
});
