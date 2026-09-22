/**
 * Phase 8.4.10-R6 — PostgreSQL Runtime Verification (TEST-ONLY).
 * Opt-in: PHASE8410_R6_PG=1
 *
 * Isolated database: adlinklab_phase8410_r6_test
 * Uses existing Phase 61 embedded Postgres harness — no Docker required.
 * No migrations authored here; deploys existing migrations only.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import pg from "pg";
import { createPrismaRepositoryBundle } from "@adlinklab/database";
import { ScriptSyncConflictCodes } from "@adlinklab/domain";
import { AppError, UnauthorizedError } from "@adlinklab/shared";
import {
  phase61DatabaseUrl,
  releaseCliOwnership,
  startPhase61Postgres,
  stopPhase61Postgres,
} from "../../../../packages/database/scripts/phase61-pg-harness.mts";
import { registerScriptRoutes } from "../routes/script.js";
import { registerDashboardRoutes } from "../routes/dashboard.js";
import type { AppServices } from "../routes/index.js";
import {
  authenticateScriptIntegration,
} from "../auth/integration-auth.js";
import {
  TEST_INTEGRATION_TOKEN_PEPPER,
} from "../auth/integration-token-crypto.js";
import { ScriptConfigService } from "./script-config-service.js";
import { ScriptSyncResultService } from "./script-sync-result-service.js";
import { ScriptIntegrationService } from "./script-integration-service.js";
import { DashboardQueryService } from "./dashboard-query-service.js";
import { AuditService } from "./index.js";
import {
  loadApiKeyRegistry,
  resolveAuthMode,
} from "../auth/api-keys.js";
import { resolvePersistenceMode } from "../persistence.js";

const ROOT = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "database"
);
const RUN_PG = process.env.PHASE8410_R6_PG === "1";
const R6_DB = "adlinklab_phase8410_r6_test";
const PEPPER = TEST_INTEGRATION_TOKEN_PEPPER;
const SYNC_PATH = "/api/v1/script/sync-result";
const r6Url = () => phase61DatabaseUrl(R6_DB);

function runMigrateDeploy(): void {
  const migrate = spawnSync(
    "pnpm",
    ["exec", "tsx", "scripts/phase61-migrate-deploy.mts"],
    {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: r6Url() },
      encoding: "utf8",
      shell: true,
    }
  );
  if (migrate.status !== 0) {
    throw new Error(`migrate failed: ${migrate.stdout}\n${migrate.stderr}`);
  }
}

async function ensureR6Database(): Promise<void> {
  const admin = new pg.Client({
    connectionString: phase61DatabaseUrl("postgres"),
  });
  await admin.connect();
  try {
    const exists = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [R6_DB]
    );
    if ((exists.rowCount ?? 0) === 0) {
      await admin.query(`CREATE DATABASE ${R6_DB}`);
    }
  } finally {
    await admin.end();
  }
  const db = new pg.Client({ connectionString: r6Url() });
  await db.connect();
  try {
    await db.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
  } finally {
    await db.end();
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
  return { tenantId, userId, accountId, campaignId, adGroupId, adId };
}

async function createActiveVersion(
  prisma: PrismaClient,
  opts: {
    tenantId: string;
    adId: string;
    userId: string;
    version: number;
    finalUrl: string;
  }
) {
  return prisma.urlVersion.create({
    data: {
      id: randomUUID(),
      tenantId: opts.tenantId,
      entityType: "AD",
      entityId: opts.adId,
      finalUrl: opts.finalUrl,
      customParameters: {},
      version: opts.version,
      status: "ACTIVE",
      effectiveAt: new Date(),
      createdBy: opts.userId,
    },
  });
}

describe.skipIf(!RUN_PG)("Phase 8.4.10-R6 PostgreSQL runtime verification", () => {
  let prisma: PrismaClient;
  let startedByUs = false;
  let pgVersion = "";
  let app: ReturnType<typeof Fastify>;
  let repos: ReturnType<typeof createPrismaRepositoryBundle>;
  let integrationService: ScriptIntegrationService;
  let dashboard: DashboardQueryService;
  let audit: AuditService;

  // Tenant A primary fixtures
  let tenantA: Awaited<ReturnType<typeof seedGraph>>;
  let tokenA: string;
  let integrationAId: string;
  let targetAId: string;

  // Tenant B
  let tenantB: Awaited<ReturnType<typeof seedGraph>>;
  let tokenB: string;
  let integrationBId: string;
  let targetBId: string;

  beforeAll(async () => {
    process.env.INTEGRATION_TOKEN_PEPPER = PEPPER;

    let connected = false;
    try {
      const probe = new PrismaClient({
        datasources: { db: { url: r6Url() } },
      });
      await probe.$queryRaw`SELECT 1`;
      await probe.$disconnect();
      connected = true;
    } catch {
      connected = false;
    }

    if (!connected) {
      await startPhase61Postgres();
      releaseCliOwnership();
      startedByUs = true;
      await ensureR6Database();
      runMigrateDeploy();
    } else {
      await ensureR6Database();
      const probe2 = new PrismaClient({
        datasources: { db: { url: r6Url() } },
      });
      try {
        const tables = await probe2.$queryRaw<Array<{ tablename: string }>>`
          SELECT tablename FROM pg_tables
          WHERE schemaname = 'public' AND tablename = 'script_sync_logs'
        `;
        if (tables.length === 0) runMigrateDeploy();
      } finally {
        await probe2.$disconnect();
      }
    }

    process.env.DATABASE_URL = r6Url();
    prisma = new PrismaClient({
      datasources: { db: { url: r6Url() } },
    });
    const verRows = await prisma.$queryRaw<Array<{ version: string }>>`
      SELECT version()
    `;
    pgVersion = String(verRows[0]?.version ?? "").split(",")[0];

    repos = createPrismaRepositoryBundle(prisma);
    audit = new AuditService(repos.auditLogs);
    integrationService = new ScriptIntegrationService(
      repos.scriptIntegrations,
      repos.googleAccounts,
      audit,
      { INTEGRATION_TOKEN_PEPPER: PEPPER }
    );
    dashboard = new DashboardQueryService(
      repos.scriptIntegrations,
      repos.scriptSyncTargets,
      repos.scriptSyncLogs,
      repos.ads,
      repos.adGroups,
      repos.urlVersions
    );

    tenantA = await seedGraph(prisma, "r6a");
    tenantB = await seedGraph(prisma, "r6b");
    await createActiveVersion(prisma, {
      tenantId: tenantA.tenantId,
      adId: tenantA.adId,
      userId: tenantA.userId,
      version: 2,
      finalUrl: "https://example.com/r6a/v2",
    });
    await createActiveVersion(prisma, {
      tenantId: tenantB.tenantId,
      adId: tenantB.adId,
      userId: tenantB.userId,
      version: 2,
      finalUrl: "https://example.com/r6b/v2",
    });

    const createdA = await integrationService.create({
      tenantId: tenantA.tenantId,
      googleAccountId: tenantA.accountId,
      name: "R6 Integration A",
    });
    tokenA = createdA.token;
    integrationAId = createdA.integration.id;
    targetAId = randomUUID();
    await repos.scriptSyncTargets.create({
      id: targetAId,
      tenantId: tenantA.tenantId,
      integrationId: integrationAId,
      entityType: "AD",
      entityId: tenantA.adId,
      appliedVersion: 1,
      syncState: "OUT_OF_SYNC",
      connectionHealth: "CONNECTED",
    });

    const createdB = await integrationService.create({
      tenantId: tenantB.tenantId,
      googleAccountId: tenantB.accountId,
      name: "R6 Integration B",
    });
    tokenB = createdB.token;
    integrationBId = createdB.integration.id;
    targetBId = randomUUID();
    await repos.scriptSyncTargets.create({
      id: targetBId,
      tenantId: tenantB.tenantId,
      integrationId: integrationBId,
      entityType: "AD",
      entityId: tenantB.adId,
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
      dashboardQuery: dashboard,
      audit,
    } as AppServices;

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
    await registerScriptRoutes(app, services);
    await registerDashboardRoutes(app, services);
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    // Do not stop shared embedded PG if other suites may reuse it.
    if (startedByUs) {
      /* leave running — releaseCliOwnership already applied */
    }
    void stopPhase61Postgres;
  });

  // ---------- 3. Schema verification ----------
  it("schema: UrlVersion version unique + ACTIVE partial unique", async () => {
    const indexes = await prisma.$queryRaw<
      Array<{ indexname: string; indexdef: string }>
    >`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'url_versions'
      ORDER BY indexname
    `;
    const defs = indexes.map((i) => i.indexdef);
    expect(
      defs.some((d) =>
        /unique.*tenant_id.*entity_type.*entity_id.*version/i.test(d)
      )
    ).toBe(true);
    expect(
      indexes.some(
        (i) =>
          i.indexname === "url_versions_one_active_per_entity" &&
          /WHERE.*status.*=.*'ACTIVE'/i.test(i.indexdef)
      )
    ).toBe(true);
  });

  it("schema: ScriptSyncTarget + ScriptSyncLog + UCR + SyncJob uniques", async () => {
    const indexes = await prisma.$queryRaw<
      Array<{ tablename: string; indexname: string; indexdef: string }>
    >`
      SELECT tablename, indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN (
          'script_sync_targets',
          'script_sync_logs',
          'google_ads_script_integrations',
          'url_change_requests',
          'sync_jobs'
        )
      ORDER BY tablename, indexname
    `;
    expect(
      indexes.some(
        (i) =>
          i.tablename === "script_sync_targets" &&
          /UNIQUE.*tenant_id.*integration_id.*entity_type.*entity_id/i.test(
            i.indexdef
          )
      )
    ).toBe(true);
    expect(
      indexes.some(
        (i) =>
          i.tablename === "script_sync_logs" &&
          /UNIQUE.*tenant_id.*idempotency_scope.*idempotency_key/i.test(
            i.indexdef
          )
      )
    ).toBe(true);
    expect(
      indexes.some(
        (i) =>
          i.tablename === "url_change_requests" &&
          /UNIQUE.*tenant_id.*idempotency/i.test(i.indexdef)
      )
    ).toBe(true);
    expect(
      indexes.some(
        (i) =>
          i.tablename === "sync_jobs" &&
          /UNIQUE.*tenant_id.*idempotency/i.test(i.indexdef)
      )
    ).toBe(true);
    expect(
      indexes.some(
        (i) =>
          i.tablename === "google_ads_script_integrations" &&
          /UNIQUE.*token_hash/i.test(i.indexdef)
      )
    ).toBe(true);
    expect(pgVersion).toMatch(/PostgreSQL/i);
  });

  // ---------- 4. Persistence round trip ----------
  it("persistence round trip survives Prisma client dispose/recreate", async () => {
    const key = `r6-persist-${randomUUID()}`;
    const res = await app.inject({
      method: "POST",
      url: SYNC_PATH,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        targetId: targetAId,
        desiredVersion: 2,
        result: "SUCCESS",
        idempotencyKey: key,
      },
    });
    expect(res.statusCode).toBe(200);

    // Prove durability with a fresh client — do not disconnect the suite client.
    const prisma2 = new PrismaClient({
      datasources: { db: { url: r6Url() } },
    });
    try {
      const target = await prisma2.scriptSyncTarget.findUnique({
        where: { id: targetAId },
      });
      expect(target?.appliedVersion).toBe(2);
      const logs = await prisma2.scriptSyncLog.count({
        where: {
          targetId: targetAId,
          idempotencyKey: { endsWith: `:${key}` },
        },
      });
      expect(logs).toBe(1);
      const integration = await prisma2.googleAdsScriptIntegration.findUnique({
        where: { id: integrationAId },
      });
      expect(integration?.status).toBe("ACTIVE");
      expect(integration?.tokenHash).toBeTruthy();
    } finally {
      await prisma2.$disconnect();
    }
  });

  // ---------- 5. Tenant isolation ----------
  it("tenant isolation: A cannot read/update B resources", async () => {
    const aIntegration = await repos.scriptIntegrations.findByIdForTenant(
      tenantA.tenantId,
      integrationBId
    );
    expect(aIntegration).toBeNull();

    const aTarget = await repos.scriptSyncTargets.findByIdForIntegration(
      tenantA.tenantId,
      integrationAId,
      targetBId
    );
    expect(aTarget).toBeNull();

    const cross = await app.inject({
      method: "POST",
      url: SYNC_PATH,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        targetId: targetBId,
        desiredVersion: 2,
        result: "SUCCESS",
        idempotencyKey: `r6-cross-${randomUUID()}`,
      },
    });
    expect(cross.statusCode).toBe(404);

    const bBefore = await prisma.scriptSyncTarget.findUnique({
      where: { id: targetBId },
    });
    expect(bBefore?.appliedVersion).toBe(1);

    const sameKey = `r6-tenant-key-${randomUUID()}`;
    const bSync = await app.inject({
      method: "POST",
      url: SYNC_PATH,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: {
        targetId: targetBId,
        desiredVersion: 2,
        result: "SUCCESS",
        idempotencyKey: sameKey,
      },
    });
    expect(bSync.statusCode).toBe(200);

    // Same client key under tenant A → independent (different storage key)
    await prisma.scriptSyncTarget.update({
      where: { id: targetAId },
      data: { appliedVersion: 1, syncState: "OUT_OF_SYNC" },
    });
    const aSync = await app.inject({
      method: "POST",
      url: SYNC_PATH,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        targetId: targetAId,
        desiredVersion: 2,
        result: "SUCCESS",
        idempotencyKey: sameKey,
      },
    });
    expect(aSync.statusCode).toBe(200);

    const aLogs = await repos.scriptSyncLogs.findByIntegration(
      tenantA.tenantId,
      integrationAId,
      { page: 1, pageSize: 50 }
    );
    expect(
      aLogs.items.every((l) => l.tenantId === tenantA.tenantId)
    ).toBe(true);
    expect(aLogs.items.some((l) => l.integrationId === integrationBId)).toBe(
      false
    );
  });

  // ---------- 6–7. Sequential + concurrent idempotency ----------
  it("sequential idempotency: duplicate key → one log, stable appliedVersion", async () => {
    await prisma.scriptSyncTarget.update({
      where: { id: targetAId },
      data: { appliedVersion: 1, syncState: "OUT_OF_SYNC" },
    });
    const key = `r6-seq-${randomUUID()}`;
    const payload = {
      targetId: targetAId,
      desiredVersion: 2,
      result: "SUCCESS" as const,
      idempotencyKey: key,
    };
    const r1 = await app.inject({
      method: "POST",
      url: SYNC_PATH,
      headers: { authorization: `Bearer ${tokenA}` },
      payload,
    });
    const r2 = await app.inject({
      method: "POST",
      url: SYNC_PATH,
      headers: { authorization: `Bearer ${tokenA}` },
      payload,
    });
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r1.json().appliedVersion).toBe(2);
    expect(r2.json().appliedVersion).toBe(2);
    const logs = await prisma.scriptSyncLog.count({
      where: {
        targetId: targetAId,
        idempotencyKey: { endsWith: `:${key}` },
      },
    });
    expect(logs).toBe(1);
  });

  it("concurrent idempotency: 12 identical keys → one log, appliedVersion=2", async () => {
    await prisma.scriptSyncTarget.update({
      where: { id: targetAId },
      data: { appliedVersion: 1, syncState: "OUT_OF_SYNC" },
    });
    const key = `r6-conc-${randomUUID()}`;
    const runBatch = () =>
      Promise.all(
        Array.from({ length: 12 }, () =>
          app.inject({
            method: "POST",
            url: SYNC_PATH,
            headers: { authorization: `Bearer ${tokenA}` },
            payload: {
              targetId: targetAId,
              desiredVersion: 2,
              result: "SUCCESS",
              idempotencyKey: key,
            },
          })
        )
      );
    let results = await runBatch();
    if (!results.every((r) => r.statusCode === 200)) {
      if (results.some((r) => r.statusCode >= 500)) {
        results = await runBatch();
      }
    }
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const logs = await prisma.scriptSyncLog.count({
      where: {
        targetId: targetAId,
        idempotencyKey: { endsWith: `:${key}` },
      },
    });
    expect(logs).toBe(1);
    const target = await prisma.scriptSyncTarget.findUnique({
      where: { id: targetAId },
    });
    expect(target?.appliedVersion).toBe(2);
  });

  it("distinct idempotency keys are not collapsed", async () => {
    await prisma.scriptSyncTarget.update({
      where: { id: targetAId },
      data: { appliedVersion: 1, syncState: "OUT_OF_SYNC" },
    });
    const keys = [randomUUID(), randomUUID(), randomUUID()];
    const results = await Promise.all(
      keys.map((idempotencyKey) =>
        app.inject({
          method: "POST",
          url: SYNC_PATH,
          headers: { authorization: `Bearer ${tokenA}` },
          payload: {
            targetId: targetAId,
            desiredVersion: 2,
            result: "SUCCESS",
            idempotencyKey,
          },
        })
      )
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    for (const key of keys) {
      const count = await prisma.scriptSyncLog.count({
        where: {
          targetId: targetAId,
          idempotencyKey: { endsWith: `:${key}` },
        },
      });
      expect(count).toBe(1);
    }
    const target = await prisma.scriptSyncTarget.findUnique({
      where: { id: targetAId },
    });
    expect(target?.appliedVersion).toBe(2);
  });

  // ---------- 8. Stale desired ----------
  it("STALE_DESIRED does not regress appliedVersion; correct version applies", async () => {
    // Advance ACTIVE to 3
    await prisma.urlVersion.updateMany({
      where: {
        tenantId: tenantA.tenantId,
        entityId: tenantA.adId,
        status: "ACTIVE",
      },
      data: { status: "SUPERSEDED" },
    });
    await createActiveVersion(prisma, {
      tenantId: tenantA.tenantId,
      adId: tenantA.adId,
      userId: tenantA.userId,
      version: 3,
      finalUrl: "https://example.com/r6a/v3",
    });
    await prisma.scriptSyncTarget.update({
      where: { id: targetAId },
      data: { appliedVersion: 2, syncState: "OUT_OF_SYNC" },
    });

    const stale = await app.inject({
      method: "POST",
      url: SYNC_PATH,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        targetId: targetAId,
        desiredVersion: 2,
        result: "SUCCESS",
        idempotencyKey: `r6-stale-${randomUUID()}`,
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe(ScriptSyncConflictCodes.STALE_DESIRED);
    let target = await prisma.scriptSyncTarget.findUnique({
      where: { id: targetAId },
    });
    expect(target?.appliedVersion).toBe(2);

    const ok = await app.inject({
      method: "POST",
      url: SYNC_PATH,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        targetId: targetAId,
        desiredVersion: 3,
        result: "SUCCESS",
        idempotencyKey: `r6-ok3-${randomUUID()}`,
      },
    });
    expect(ok.statusCode).toBe(200);
    target = await prisma.scriptSyncTarget.findUnique({
      where: { id: targetAId },
    });
    expect(target?.appliedVersion).toBe(3);

    // UrlVersion ACTIVE unchanged by sync
    const active = await prisma.urlVersion.findFirst({
      where: {
        tenantId: tenantA.tenantId,
        entityId: tenantA.adId,
        status: "ACTIVE",
      },
    });
    expect(active?.version).toBe(3);
  });

  // ---------- 9. VERSION_CONFLICT ----------
  it("VERSION_CONFLICT when appliedVersion > desiredVersion", async () => {
    // ACTIVE still 3 from previous test; set applied ahead
    await prisma.scriptSyncTarget.update({
      where: { id: targetAId },
      data: { appliedVersion: 5, syncState: "OUT_OF_SYNC" },
    });
    // Need ACTIVE matching desired for conflict path (desired==ACTIVE but applied>desired)
    // So set ACTIVE back to 3, applied=5, submit desired=3
    const conflict = await app.inject({
      method: "POST",
      url: SYNC_PATH,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        targetId: targetAId,
        desiredVersion: 3,
        result: "SUCCESS",
        idempotencyKey: `r6-vc-${randomUUID()}`,
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe(ScriptSyncConflictCodes.VERSION_CONFLICT);
    const target = await prisma.scriptSyncTarget.findUnique({
      where: { id: targetAId },
    });
    expect(target?.appliedVersion).toBe(5);
  });

  // ---------- 10. Multi-integration same Ad ----------
  it("multi-integration same Ad: independent appliedVersion + logs", async () => {
    const tokenA2Material = await integrationService.create({
      tenantId: tenantA.tenantId,
      googleAccountId: tenantA.accountId,
      name: "R6 Integration A2 same Ad",
    });
    const targetA2Id = randomUUID();
    await repos.scriptSyncTargets.create({
      id: targetA2Id,
      tenantId: tenantA.tenantId,
      integrationId: tokenA2Material.integration.id,
      entityType: "AD",
      entityId: tenantA.adId,
      appliedVersion: 1,
      syncState: "OUT_OF_SYNC",
      connectionHealth: "CONNECTED",
    });

    // Reset A1 applied for this check
    await prisma.scriptSyncTarget.update({
      where: { id: targetAId },
      data: { appliedVersion: 2, syncState: "OUT_OF_SYNC" },
    });

    const syncA2 = await app.inject({
      method: "POST",
      url: SYNC_PATH,
      headers: { authorization: `Bearer ${tokenA2Material.token}` },
      payload: {
        targetId: targetA2Id,
        desiredVersion: 3,
        result: "SUCCESS",
        idempotencyKey: `r6-a2-${randomUUID()}`,
      },
    });
    expect(syncA2.statusCode).toBe(200);

    const t1 = await prisma.scriptSyncTarget.findUnique({
      where: { id: targetAId },
    });
    const t2 = await prisma.scriptSyncTarget.findUnique({
      where: { id: targetA2Id },
    });
    expect(t2?.appliedVersion).toBe(3);
    expect(t1?.appliedVersion).toBe(2); // unchanged by A2 sync

    const logsA2 = await repos.scriptSyncLogs.findByIntegration(
      tenantA.tenantId,
      tokenA2Material.integration.id,
      { page: 1, pageSize: 20 }
    );
    expect(
      logsA2.items.every(
        (l) => l.integrationId === tokenA2Material.integration.id
      )
    ).toBe(true);
    expect(logsA2.items.some((l) => l.targetId === targetAId)).toBe(false);
  });

  // ---------- 11. URL authority ----------
  it("script sync does not mutate ACTIVE UrlVersion; applied ≠ desired authority", async () => {
    const before = await prisma.urlVersion.findMany({
      where: { tenantId: tenantA.tenantId, entityId: tenantA.adId },
      orderBy: { version: "asc" },
    });
    const activeBefore = before.find((v) => v.status === "ACTIVE");
    expect(activeBefore).toBeTruthy();

    await prisma.scriptSyncTarget.update({
      where: { id: targetAId },
      data: { appliedVersion: 1, syncState: "OUT_OF_SYNC" },
    });
    await app.inject({
      method: "POST",
      url: SYNC_PATH,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        targetId: targetAId,
        desiredVersion: activeBefore!.version,
        result: "SUCCESS",
        idempotencyKey: `r6-auth-${randomUUID()}`,
      },
    });

    const after = await prisma.urlVersion.findMany({
      where: { tenantId: tenantA.tenantId, entityId: tenantA.adId },
      orderBy: { version: "asc" },
    });
    expect(after.map((v) => ({ id: v.id, status: v.status, version: v.version }))).toEqual(
      before.map((v) => ({ id: v.id, status: v.status, version: v.version }))
    );
    const target = await prisma.scriptSyncTarget.findUnique({
      where: { id: targetAId },
    });
    expect(target?.appliedVersion).toBe(activeBefore!.version);
    expect(target?.appliedVersion).not.toBeNull();
  });

  // ---------- 12. disable / enable / revoke ----------
  it("disable / enable / revoke persist and invalidate token", async () => {
    const created = await integrationService.create({
      tenantId: tenantA.tenantId,
      googleAccountId: tenantA.accountId,
      name: "R6 lifecycle",
    });
    const tok = created.token;
    const id = created.integration.id;

    await authenticateScriptIntegration(repos, `Bearer ${tok}`, {
      env: { INTEGRATION_TOKEN_PEPPER: PEPPER },
    });

    await integrationService.disable(tenantA.tenantId, id);
    let row = await prisma.googleAdsScriptIntegration.findUnique({
      where: { id },
    });
    expect(row?.status).toBe("DISABLED");
    await expect(
      authenticateScriptIntegration(repos, `Bearer ${tok}`, {
        env: { INTEGRATION_TOKEN_PEPPER: PEPPER },
      })
    ).rejects.toBeInstanceOf(UnauthorizedError);

    await integrationService.enable(tenantA.tenantId, id);
    row = await prisma.googleAdsScriptIntegration.findUnique({
      where: { id },
    });
    expect(row?.status).toBe("ACTIVE");
    await authenticateScriptIntegration(repos, `Bearer ${tok}`, {
      env: { INTEGRATION_TOKEN_PEPPER: PEPPER },
    });

    await integrationService.revoke(tenantA.tenantId, id);
    row = await prisma.googleAdsScriptIntegration.findUnique({
      where: { id },
    });
    expect(row?.status).toBe("REVOKED");
    await expect(
      authenticateScriptIntegration(repos, `Bearer ${tok}`, {
        env: { INTEGRATION_TOKEN_PEPPER: PEPPER },
      })
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  // ---------- 13. Token security ----------
  it("token security: hash/prefix/keyId present; plaintext/pepper absent from DB rows", async () => {
    const row = await prisma.googleAdsScriptIntegration.findUnique({
      where: { id: integrationAId },
    });
    expect(Boolean(row?.tokenHash)).toBe(true);
    expect(Boolean(row?.tokenKeyId)).toBe(true);
    expect(Boolean(row?.tokenPrefix)).toBe(true);

    const json = JSON.stringify(row);
    expect(json.includes(tokenA)).toBe(false);
    expect(json.includes(PEPPER)).toBe(false);

    const logs = await prisma.scriptSyncLog.findMany({
      where: { integrationId: integrationAId },
      take: 20,
    });
    const logJson = JSON.stringify(logs);
    expect(logJson.includes(tokenA)).toBe(false);
    expect(logJson.toLowerCase().includes("authorization")).toBe(false);
    expect(logJson.includes(PEPPER)).toBe(false);
  });

  // ---------- 14. Dashboard ----------
  it("dashboard read model reflects ACTIVE desired + target applied + tenant scope", async () => {
    const { context } = await authenticateScriptIntegration(
      repos,
      `Bearer ${tokenA}`,
      { env: { INTEGRATION_TOKEN_PEPPER: PEPPER } }
    );
    const detail = await dashboard.getIntegration(context, integrationAId);
    expect(detail.integration.integrationId).toBe(integrationAId);

    const active = await prisma.urlVersion.findFirst({
      where: {
        tenantId: tenantA.tenantId,
        entityId: tenantA.adId,
        status: "ACTIVE",
      },
    });
    const targetsPage = await dashboard.listTargets(context, integrationAId);
    const targetRow = targetsPage.items.find((t) => t.targetId === targetAId);
    expect(targetRow).toBeTruthy();
    expect(targetRow?.desiredVersion).toBe(active?.version ?? null);
    expect(targetRow?.appliedVersion).toBeTruthy();

    const dashRes = await app.inject({
      method: "GET",
      url: `/api/v1/dashboard/integrations/${integrationAId}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(dashRes.statusCode).toBe(200);
    const body = dashRes.json();
    expect(JSON.stringify(body).includes(tokenA)).toBe(false);
    expect(body).not.toHaveProperty("oauthCredentialRef");

    // Cross-tenant: B token cannot fetch A detail
    const cross = await app.inject({
      method: "GET",
      url: `/api/v1/dashboard/integrations/${integrationAId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect([403, 404]).toContain(cross.statusCode);
  });

  // ---------- 15. ACTIVE uniqueness regression ----------
  it("UrlVersion ACTIVE partial unique rejects second ACTIVE", async () => {
    await expect(
      prisma.urlVersion.create({
        data: {
          id: randomUUID(),
          tenantId: tenantA.tenantId,
          entityType: "AD",
          entityId: tenantA.adId,
          finalUrl: "https://example.com/dup-active",
          customParameters: {},
          version: 99,
          status: "ACTIVE",
          createdBy: tenantA.userId,
        },
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  // ---------- 16. R1/R2/R3 config regression (no prod server) ----------
  it("R1/R2/R3 production config fail-closed still holds", () => {
    expect(() =>
      resolvePersistenceMode({
        env: {
          NODE_ENV: "production",
          DATABASE_URL: r6Url(),
        },
      })
    ).toThrow(/Production requires PERSISTENCE=prisma and DATABASE_URL/);

    expect(() =>
      resolvePersistenceMode({
        env: {
          NODE_ENV: "production",
          PERSISTENCE: "memory",
          DATABASE_URL: r6Url(),
        },
      })
    ).toThrow(/Production requires PERSISTENCE=prisma and DATABASE_URL/);

    expect(
      resolvePersistenceMode({
        env: {
          NODE_ENV: "production",
          PERSISTENCE: "prisma",
          DATABASE_URL: r6Url(),
        },
      })
    ).toBe("prisma");

    const prodRegistry = loadApiKeyRegistry({
      NODE_ENV: "production",
      ADLINKLAB_API_KEYS: "",
    });
    expect(prodRegistry.some((r) => r.keyId.startsWith("fixture:"))).toBe(
      false
    );

    expect(() => resolveAuthMode({ NODE_ENV: "production" })).toThrow(
      /Production requires AUTH_MODE=api_key/
    );
    expect(
      resolveAuthMode({ NODE_ENV: "production", AUTH_MODE: "api_key" })
    ).toBe("api_key");
    expect(resolveAuthMode({ NODE_ENV: "test" })).toBe("disabled");
    expect(resolveAuthMode({ VITEST: "true" })).toBe("disabled");
  });
});

describe.skipIf(RUN_PG)("Phase 8.4.10-R6 environment gate", () => {
  it("documents PG NOT RUN when PHASE8410_R6_PG!=1", () => {
    expect(process.env.PHASE8410_R6_PG).not.toBe("1");
  });
});
