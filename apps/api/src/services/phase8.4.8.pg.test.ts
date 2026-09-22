/**
 * Phase 8.4.8 — PostgreSQL runtime verification (TEST-ONLY).
 * Opt-in: PHASE848_PG=1
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
import { registerDashboardRoutes } from "../routes/dashboard.js";
import type { AppServices } from "../routes/index.js";
import {
  hashIntegrationToken,
  TEST_INTEGRATION_TOKEN_PEPPER,
} from "../auth/integration-token-crypto.js";
import { ScriptConfigService } from "./script-config-service.js";
import { ScriptSyncResultService } from "./script-sync-result-service.js";
import { DashboardQueryService } from "./dashboard-query-service.js";
import { AuditService } from "./index.js";
import {
  ScriptRuntimeSimulator,
  buildScenario,
} from "../test-runtime/index.js";

const ROOT = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "database"
);
const RUN_PG = process.env.PHASE848_PG === "1";
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
  const googleAdId = `gad-${label}-${adId.slice(0, 8)}`;
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
      googleAdId,
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
      finalMobileUrl: `https://m.example.com/${label}/v2`,
      trackingTemplate: `https://tracker.example.com/${label}?u={lpurl}`,
      customParameters: { _lab: label },
      version: 2,
      status: "ACTIVE",
      effectiveAt: new Date("2026-09-20T00:00:00.000Z"),
      createdBy: userId,
    },
  });
  return { tenantId, accountId, adId, googleAdId, userId };
}

describe.skipIf(!RUN_PG)("Phase 8.4.8 PostgreSQL runtime verification", () => {
  let prisma: PrismaClient;
  let startedByUs = false;

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
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (startedByUs) {
      await stopPhase61Postgres();
    }
  });

  async function buildRuntime(label: string) {
    const graph = await seedGraph(prisma, label);
    const repos = createPrismaRepositoryBundle(prisma);
    const audit = new AuditService(repos.auditLogs);
    const token = `alk_s_${label}_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const tokenKeyId = randomUUID();
    const integration = await repos.scriptIntegrations.create({
      id: randomUUID(),
      tenantId: graph.tenantId,
      googleAccountId: graph.accountId,
      name: label,
      status: "ACTIVE",
      tokenKeyId,
      tokenPrefix: token.slice(0, 12),
      tokenHash: hashIntegrationToken(token, PEPPER),
      configGeneration: 1,
    });
    const target = await repos.scriptSyncTargets.create({
      id: randomUUID(),
      tenantId: graph.tenantId,
      integrationId: integration.id,
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
    const scriptSyncResult = new ScriptSyncResultService(repos.scriptSyncRunner);
    const dashboardQuery = new DashboardQueryService(
      repos.scriptIntegrations,
      repos.scriptSyncTargets,
      repos.scriptSyncLogs,
      repos.ads,
      repos.adGroups,
      repos.urlVersions
    );
    const services = {
      scriptIntegrations: repos.scriptIntegrations,
      scriptConfig,
      scriptSyncResult,
      dashboardQuery,
      audit,
    } as Pick<
      AppServices,
      | "scriptIntegrations"
      | "scriptConfig"
      | "scriptSyncResult"
      | "dashboardQuery"
      | "audit"
    >;

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
    await registerScriptRoutes(app, services as AppServices);
    await registerDashboardRoutes(app, services as AppServices);

    const sim = new ScriptRuntimeSimulator({
      app,
      resolveAppliedVersion: async (targetId) => {
        const t = await repos.scriptSyncTargets.findById(targetId);
        return t?.appliedVersion ?? null;
      },
      snapshotAppliedVersions: async () => {
        const page = await repos.scriptSyncTargets.findByIntegration(
          graph.tenantId,
          integration.id,
          { page: 1, pageSize: 100 }
        );
        const map = new Map<string, number | null>();
        for (const t of page.items) {
          map.set(t.id, t.appliedVersion ?? null);
        }
        return map;
      },
    });

    return {
      graph,
      repos,
      integration,
      target,
      token,
      app,
      sim,
      cleanup: async () => {
        await app.close();
      },
    };
  }

  it("1. config read via simulator", async () => {
    const rt = await buildRuntime("pg848-cfg");
    try {
      const result = await rt.sim.run(
        buildScenario({
          integrationId: rt.integration.id,
          token: rt.token,
          executionId: randomUUID(),
          ads: [{ id: rt.graph.googleAdId }],
        })
      );
      expect(result.targetsProcessed).toBe(1);
      expect(rt.sim.urlFetchApp.callsTo("/config").length).toBeGreaterThan(0);
    } finally {
      await rt.cleanup();
    }
  });

  it("2. successful sync result + appliedVersion update", async () => {
    const rt = await buildRuntime("pg848-ok");
    try {
      const result = await rt.sim.run(
        buildScenario({
          integrationId: rt.integration.id,
          token: rt.token,
          executionId: randomUUID(),
          ads: [{ id: rt.graph.googleAdId }],
        })
      );
      expect(result.targetsSucceeded).toBe(1);
      const updated = await rt.repos.scriptSyncTargets.findById(rt.target.id);
      expect(updated?.appliedVersion).toBe(2);
      expect(updated?.syncState).toBe("SYNCED");
    } finally {
      await rt.cleanup();
    }
  });

  it("3. ScriptSyncLog creation", async () => {
    const rt = await buildRuntime("pg848-log");
    try {
      await rt.sim.run(
        buildScenario({
          integrationId: rt.integration.id,
          token: rt.token,
          executionId: randomUUID(),
          ads: [{ id: rt.graph.googleAdId }],
        })
      );
      const logs = await rt.repos.scriptSyncLogs.findByIntegration(
        rt.graph.tenantId,
        rt.integration.id,
        { page: 1, pageSize: 20 }
      );
      expect(logs.items.some((l) => l.targetId === rt.target.id)).toBe(true);
    } finally {
      await rt.cleanup();
    }
  });

  it("4. idempotency — same executionId does not duplicate log", async () => {
    const rt = await buildRuntime("pg848-idem");
    try {
      const scenario = buildScenario({
        integrationId: rt.integration.id,
        token: rt.token,
        executionId: "11111111-1111-4111-8111-11111111848a",
        ads: [{ id: rt.graph.googleAdId }],
      });
      await rt.sim.run(scenario);
      await rt.sim.run(scenario);
      const logs = await rt.repos.scriptSyncLogs.findByIntegration(
        rt.graph.tenantId,
        rt.integration.id,
        { page: 1, pageSize: 50 }
      );
      expect(logs.items.filter((l) => l.targetId === rt.target.id)).toHaveLength(
        1
      );
    } finally {
      await rt.cleanup();
    }
  });

  it("5. STALE_DESIRED mid-run does not advance appliedVersion", async () => {
    const rt = await buildRuntime("pg848-stale");
    try {
      const result = await rt.sim.run(
        buildScenario({
          integrationId: rt.integration.id,
          token: rt.token,
          executionId: randomUUID(),
          ads: [{ id: rt.graph.googleAdId }],
          afterConfigHook: async () => {
            await prisma.urlVersion.updateMany({
              where: {
                tenantId: rt.graph.tenantId,
                entityId: rt.graph.adId,
                status: "ACTIVE",
              },
              data: { status: "SUPERSEDED" },
            });
            await prisma.urlVersion.create({
              data: {
                id: randomUUID(),
                tenantId: rt.graph.tenantId,
                entityType: "AD",
                entityId: rt.graph.adId,
                finalUrl: "https://example.com/pg848/v3",
                customParameters: {},
                version: 3,
                status: "ACTIVE",
                effectiveAt: new Date("2026-09-20T01:00:00.000Z"),
                createdBy: rt.graph.userId,
              },
            });
          },
        })
      );
      const tr = result.targetResults.find((t) => t.targetId === rt.target.id)!;
      expect(tr.status).toBe("CONFLICT");
      expect(tr.conflictCode).toBe(ScriptSyncConflictCodes.STALE_DESIRED);
      const updated = await rt.repos.scriptSyncTargets.findById(rt.target.id);
      expect(updated?.appliedVersion).toBe(1);
    } finally {
      await rt.cleanup();
    }
  });

  it("6. VERSION_CONFLICT preserves higher appliedVersion", async () => {
    const rt = await buildRuntime("pg848-vc");
    try {
      await rt.repos.scriptSyncTargets.update(rt.target.id, {
        appliedVersion: 5,
      });
      const result = await rt.sim.run(
        buildScenario({
          integrationId: rt.integration.id,
          token: rt.token,
          executionId: randomUUID(),
          ads: [{ id: rt.graph.googleAdId }],
        })
      );
      expect(result.targetResults[0]?.conflictCode).toBe(
        ScriptSyncConflictCodes.VERSION_CONFLICT
      );
      const updated = await rt.repos.scriptSyncTargets.findById(rt.target.id);
      expect(updated?.appliedVersion).toBe(5);
    } finally {
      await rt.cleanup();
    }
  });

  it("7. tenant isolation — other tenant token cannot apply", async () => {
    const rtA = await buildRuntime("pg848-ta");
    const rtB = await buildRuntime("pg848-tb");
    try {
      const result = await rtB.sim.run(
        buildScenario({
          integrationId: rtB.integration.id,
          token: rtB.token,
          executionId: randomUUID(),
          ads: [{ id: rtA.graph.googleAdId }],
        })
      );
      // Config for B has no matching google ad apply target from A's ad id in MockAdsApp,
      // or config targets are B's only — either way A target must stay appliedVersion=1.
      const aTarget = await rtA.repos.scriptSyncTargets.findById(rtA.target.id);
      expect(aTarget?.appliedVersion).toBe(1);
      expect(result.targetsSucceeded).toBe(0);
    } finally {
      await rtA.cleanup();
      await rtB.cleanup();
    }
  });

  it("8. concurrent same target + executionId → single log", async () => {
    const rt = await buildRuntime("pg848-conc");
    try {
      const scenario = buildScenario({
        integrationId: rt.integration.id,
        token: rt.token,
        executionId: "22222222-2222-4222-8222-22222222848c",
        ads: [{ id: rt.graph.googleAdId }],
      });
      const sim2 = new ScriptRuntimeSimulator({
        app: rt.app,
        resolveAppliedVersion: async (targetId) => {
          const t = await rt.repos.scriptSyncTargets.findById(targetId);
          return t?.appliedVersion ?? null;
        },
        snapshotAppliedVersions: async () => {
          const page = await rt.repos.scriptSyncTargets.findByIntegration(
            rt.graph.tenantId,
            rt.integration.id,
            { page: 1, pageSize: 100 }
          );
          const map = new Map<string, number | null>();
          for (const t of page.items) {
            map.set(t.id, t.appliedVersion ?? null);
          }
          return map;
        },
      });
      await Promise.all([rt.sim.run(scenario), sim2.run(scenario)]);
      const logs = await rt.repos.scriptSyncLogs.findByIntegration(
        rt.graph.tenantId,
        rt.integration.id,
        { page: 1, pageSize: 50 }
      );
      expect(logs.items.filter((l) => l.targetId === rt.target.id)).toHaveLength(
        1
      );
      const updated = await rt.repos.scriptSyncTargets.findById(rt.target.id);
      expect(updated?.appliedVersion).toBe(2);
    } finally {
      await rt.cleanup();
    }
  });

  it("9. dashboard read model sees SYNCED after simulator SUCCESS", async () => {
    const rt = await buildRuntime("pg848-dash");
    try {
      await rt.sim.run(
        buildScenario({
          integrationId: rt.integration.id,
          token: rt.token,
          executionId: randomUUID(),
          ads: [{ id: rt.graph.googleAdId }],
        })
      );
      const dash = await rt.app.inject({
        method: "GET",
        url: `/api/v1/dashboard/integrations/${rt.integration.id}/targets`,
        headers: { authorization: `Bearer ${rt.token}` },
      });
      expect(dash.statusCode).toBe(200);
      const body = dash.json() as {
        items: Array<{
          targetId: string;
          syncState: string;
          appliedVersion: number;
        }>;
      };
      const row = body.items.find((i) => i.targetId === rt.target.id)!;
      expect(row.syncState).toBe("SYNCED");
      expect(row.appliedVersion).toBe(2);
    } finally {
      await rt.cleanup();
    }
  });

  it("10. HTTP response-lost retry stays idempotent on PG", async () => {
    const rt = await buildRuntime("pg848-retry");
    try {
      await rt.sim.run(
        buildScenario({
          integrationId: rt.integration.id,
          token: rt.token,
          executionId: "33333333-3333-4333-8333-33333333848r",
          ads: [{ id: rt.graph.googleAdId }],
          syncBehavior: { loseResponseStatus: 500, loseResponseTimes: 1 },
        })
      );
      const logs = await rt.repos.scriptSyncLogs.findByIntegration(
        rt.graph.tenantId,
        rt.integration.id,
        { page: 1, pageSize: 50 }
      );
      expect(logs.items.filter((l) => l.targetId === rt.target.id)).toHaveLength(
        1
      );
      const updated = await rt.repos.scriptSyncTargets.findById(rt.target.id);
      expect(updated?.appliedVersion).toBe(2);
    } finally {
      await rt.cleanup();
    }
  });
});
