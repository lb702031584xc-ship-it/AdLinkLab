/**
 * Phase 8.4.9 — PostgreSQL opt-in admin smoke (TEST-ONLY).
 * Opt-in: PHASE849_PG=1
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
import { createAuthContext } from "../auth/tenant.js";
import { TEST_INTEGRATION_TOKEN_PEPPER } from "../auth/integration-token-crypto.js";
import { registerAdminScriptIntegrationRoutes } from "../routes/admin-script-integrations.js";
import type { AppServices } from "../routes/index.js";
import { ScriptIntegrationService } from "./script-integration-service.js";
import { ScriptIntegrationAdminService } from "./script-integration-admin-service.js";
import { ScriptGeneratorService } from "./script-generator-service.js";
import { AuditService } from "./index.js";

const ROOT = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "database"
);
const RUN_PG = process.env.PHASE849_PG === "1";
const PEPPER = TEST_INTEGRATION_TOKEN_PEPPER;
const ADMIN = "/api/v1/admin/script-integrations";

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
      customerId: `cust-${label}`,
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
      name: `${label}-ag`,
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
      finalUrl: `https://example.com/${label}`,
      customParameters: {},
      version: 1,
      status: "ACTIVE",
      effectiveAt: new Date("2026-09-20T00:00:00.000Z"),
      createdBy: userId,
    },
  });
  return { tenantId, accountId, adId };
}

describe.skipIf(!RUN_PG)("Phase 8.4.9 PostgreSQL Admin", () => {
  let prisma: PrismaClient;
  let startedByUs = false;
  let app: ReturnType<typeof Fastify>;
  let graph: Awaited<ReturnType<typeof seedGraph>>;

  beforeAll(async () => {
    process.env.DATABASE_URL = phase61DatabaseUrl();
    process.env.INTEGRATION_TOKEN_PEPPER = PEPPER;
    process.env.AUTH_MODE = "api_key";
    process.env.SCRIPT_API_BASE_URL = "https://simulator.adlinklab.test";
    process.env.VITEST = "1";
    prisma = new PrismaClient({
      datasources: { db: { url: phase61DatabaseUrl() } },
    });

    let connected = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      connected = true;
    } catch {
      connected = false;
    }
    if (!connected) {
      await startPhase61Postgres();
      startedByUs = true;
      runMigrateDeploy();
    } else {
      runMigrateDeploy();
    }

    graph = await seedGraph(prisma, `pg849-${randomUUID().slice(0, 6)}`);
    // Override fixture key tenant by registering integration under fixture TenantA is hard —
    // use disabled auth mode for PG admin: inject x-tenant-id with graph.tenantId
    process.env.AUTH_MODE = "disabled";

    const repos = createPrismaRepositoryBundle(prisma);
    const audit = new AuditService(repos.auditLogs);
    const env = process.env;
    const lifecycle = new ScriptIntegrationService(
      repos.scriptIntegrations,
      repos.googleAccounts,
      audit,
      env
    );
    const scriptGenerator = new ScriptGeneratorService(env);
    const scriptIntegrationAdmin = new ScriptIntegrationAdminService(
      lifecycle,
      repos.scriptIntegrations,
      repos.scriptSyncTargets,
      repos.ads,
      repos.adGroups,
      repos.campaigns,
      repos.urlVersions,
      scriptGenerator,
      audit,
      env
    );
    const services = {
      scriptIntegrationAdmin,
      scriptIntegrations: repos.scriptIntegrations,
      scriptGenerator,
      audit,
    } as AppServices;

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
    await registerAdminScriptIntegrationRoutes(
      app,
      services,
      createAuthContext(process.env)
    );
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    if (startedByUs) await stopPhase61Postgres();
  });

  it("1. create + attach + get without token leak on PG", async () => {
    const created = await app.inject({
      method: "POST",
      url: ADMIN,
      headers: { "x-tenant-id": graph.tenantId },
      payload: {
        name: "PG Admin",
        googleAccountId: graph.accountId,
      },
    });
    expect(created.statusCode).toBe(200);
    const body = created.json() as {
      integrationId: string;
      token: string;
    };
    expect(body.token).toMatch(/^alk_s_/);

    const att = await app.inject({
      method: "POST",
      url: `${ADMIN}/${body.integrationId}/targets`,
      headers: { "x-tenant-id": graph.tenantId },
      payload: { entityType: "AD", entityId: graph.adId },
    });
    expect(att.statusCode).toBe(200);
    expect(att.json().desiredVersion).toBe(1);

    const get = await app.inject({
      method: "GET",
      url: `${ADMIN}/${body.integrationId}`,
      headers: { "x-tenant-id": graph.tenantId },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().token).toBeUndefined();
    expect(get.json().tokenHash).toBeUndefined();
    expect(get.json().targetCount).toBe(1);
  });
});
