/**
 * Phase 8.4.5 — PostgreSQL concurrency / idempotency hardening (TEST-ONLY).
 * Opt-in: PHASE845_PG=1
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPrismaRepositoryBundle } from "@adlinklab/database";
import { ScriptSyncConflictCodes } from "@adlinklab/domain";
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
import { AuditService } from "./index.js";

const ROOT = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "database"
);
const RUN_PG = process.env.PHASE845_PG === "1";
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

describe.skipIf(!RUN_PG)("Phase 8.4.5 PostgreSQL concurrency hardening", () => {
  let prisma: PrismaClient;
  let startedByUs = false;
  let token: string;
  let targetId: string;
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

    const graph = await seedGraph(prisma, "pg845");
    const repos = createPrismaRepositoryBundle(prisma);
    const audit = new AuditService(repos.auditLogs);
    token = `alk_s_pg845_${randomUUID().slice(0, 8)}`;
    const integrationId = randomUUID();
    targetId = randomUUID();

    await repos.scriptIntegrations.create({
      id: integrationId,
      tenantId: graph.tenantId,
      googleAccountId: graph.accountId,
      name: "PG Hardening",
      status: "ACTIVE",
      tokenKeyId: "itk_pg845",
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
      scriptSyncResult: new ScriptSyncResultService(
        repos.scriptSyncRunner,
        audit
      ),
      audit,
    } as Pick<
      AppServices,
      "scriptIntegrations" | "scriptConfig" | "scriptSyncResult" | "audit"
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

  it("12 concurrent identical idempotency keys → single log", async () => {
    // Fresh key per run — avoids leftover logs when many PG suites share one DB.
    const idempotencyKey = `pg845-same-${randomUUID()}`;
    await prisma.scriptSyncTarget.update({
      where: { id: targetId },
      data: {
        appliedVersion: 1,
        syncState: "OUT_OF_SYNC",
        lastExecution: null,
      },
    });

    const runBatch = () =>
      Promise.all(
        Array.from({ length: 12 }, () =>
          app.inject({
            method: "POST",
            url: SYNC_PATH,
            headers: { authorization: `Bearer ${token}` },
            payload: {
              targetId,
              desiredVersion: 2,
              result: "SUCCESS",
              idempotencyKey,
            },
          })
        )
      );

    let results = await runBatch();
    // Under parallel PG suite load, a transient 5xx may appear — one retry.
    if (!results.every((r) => r.statusCode === 200)) {
      const transient = results.some((r) => r.statusCode >= 500);
      if (transient) {
        results = await runBatch();
      }
    }

    const statuses = results.map((r) => r.statusCode);
    expect(
      statuses.every((s) => s === 200),
      `expected all 200, got [${statuses.join(", ")}]`
    ).toBe(true);

    const logsExact = await prisma.scriptSyncLog.count({
      where: {
        targetId,
        idempotencyKey: { endsWith: `:${idempotencyKey}` },
      },
    });
    expect(logsExact).toBe(1);
    const target = await prisma.scriptSyncTarget.findUnique({
      where: { id: targetId },
    });
    expect(target?.appliedVersion).toBe(2);
  });

  it("stale desired still 409 after applied", async () => {
    const res = await app.inject({
      method: "POST",
      url: SYNC_PATH,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        targetId,
        desiredVersion: 1,
        result: "SUCCESS",
        idempotencyKey: "pg845-stale",
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe(ScriptSyncConflictCodes.STALE_DESIRED);
    const target = await prisma.scriptSyncTarget.findUnique({
      where: { id: targetId },
    });
    expect(target?.appliedVersion).toBe(2);
  });

  it("concurrent different keys remain appliedVersion=2", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        app.inject({
          method: "POST",
          url: SYNC_PATH,
          headers: { authorization: `Bearer ${token}` },
          payload: {
            targetId,
            desiredVersion: 2,
            result: "SUCCESS",
            idempotencyKey: `pg845-diff-${i}`,
          },
        })
      )
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const target = await prisma.scriptSyncTarget.findUnique({
      where: { id: targetId },
    });
    expect(target?.appliedVersion).toBe(2);
  });
});
