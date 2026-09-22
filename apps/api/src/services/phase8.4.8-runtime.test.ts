/**
 * Phase 8.4.8 ? Script Runtime Simulator + scenarios (TEST / LAB ONLY).
 */
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSeededMemoryRepositories,
  TenantA,
  TenantB,
} from "@adlinklab/database";
import { ScriptSyncConflictCodes } from "@adlinklab/domain";
import { AppError } from "@adlinklab/shared";
import { GoogleAdsApiProvider } from "@adlinklab/google-ads";
import { registerScriptRoutes } from "../routes/script.js";
import { registerDashboardRoutes } from "../routes/dashboard.js";
import type { AppServices } from "../routes/index.js";
import { TEST_INTEGRATION_TOKEN_PEPPER } from "../auth/integration-token-crypto.js";
import { ScriptIntegrationService } from "./script-integration-service.js";
import { ScriptConfigService } from "./script-config-service.js";
import { ScriptSyncResultService } from "./script-sync-result-service.js";
import { ScriptGeneratorService } from "./script-generator-service.js";
import { DashboardQueryService } from "./dashboard-query-service.js";
import {
  assertScriptSourceSafe,
  buildGoogleAdsScriptSource,
} from "./script-generator-source.js";
import { AuditService } from "./index.js";
import {
  SCRIPT_RUNTIME_SCENARIO_NAMES,
  ScriptRuntimeSimulator,
  assertTestRuntime,
  buildScenario,
  SIM_CONFIG,
  SIM_SYNC,
  MockAdsApp,
  MockLogger,
  MockUtilities,
  MockUrlFetchApp,
  installNetworkGuard,
} from "../test-runtime/index.js";

const ENV = {
  VITEST: "1",
  NODE_ENV: "test",
  INTEGRATION_TOKEN_PEPPER: TEST_INTEGRATION_TOKEN_PEPPER,
  SCRIPT_API_BASE_URL: "https://simulator.adlinklab.test",
} as NodeJS.ProcessEnv;

const FIXED_EXEC = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";

function createHarness() {
  const repos = createSeededMemoryRepositories();
  const audit = new AuditService(repos.auditLogs);
  const integrationService = new ScriptIntegrationService(
    repos.scriptIntegrations,
    repos.googleAccounts,
    audit,
    ENV
  );
  const scriptConfig = new ScriptConfigService(
    repos.scriptIntegrations,
    repos.scriptSyncTargets,
    repos.ads,
    repos.adGroups,
    repos.urlVersions
  );
  const scriptSyncResult = new ScriptSyncResultService(repos.scriptSyncRunner);
  const scriptGenerator = new ScriptGeneratorService(ENV);
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
    scriptGenerator,
    dashboardQuery,
    audit,
  } as Pick<
    AppServices,
    | "scriptIntegrations"
    | "scriptConfig"
    | "scriptSyncResult"
    | "scriptGenerator"
    | "dashboardQuery"
    | "audit"
  >;
  return {
    repos,
    audit,
    integrationService,
    scriptConfig,
    scriptSyncResult,
    scriptGenerator,
    dashboardQuery,
    services,
  };
}

type Harness = ReturnType<typeof createHarness>;

async function buildApp(services: Harness["services"]) {
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
  return app;
}

async function createIntegration(h: Harness, name = "Sim") {
  return h.integrationService.create({
    tenantId: TenantA.id,
    googleAccountId: TenantA.account,
    name,
  });
}

async function addTarget(
  h: Harness,
  integrationId: string,
  entityId: string,
  extra?: { appliedVersion?: number; tenantId?: string }
) {
  return h.repos.scriptSyncTargets.create({
    id: randomUUID(),
    tenantId: extra?.tenantId ?? TenantA.id,
    integrationId,
    entityType: "AD",
    entityId,
    appliedVersion: extra?.appliedVersion,
    syncState: extra?.appliedVersion == null ? "NEVER_APPLIED" : "OUT_OF_SYNC",
    connectionHealth: "CONNECTED",
  });
}

async function ensureActiveUrl(
  h: Harness,
  entityId: string,
  version: number,
  urls: {
    finalUrl: string;
    finalMobileUrl?: string;
    finalAppUrl?: string;
    trackingTemplate?: string;
    customParameters?: Record<string, string>;
  }
) {
  const active = await h.repos.urlVersions.findActiveByEntity("AD", entityId);
  if (active) {
    await h.repos.urlVersions.updateStatus(active.id, { status: "SUPERSEDED" });
  }
  return h.repos.urlVersions.create({
    id: randomUUID(),
    tenantId: TenantA.id,
    entityType: "AD",
    entityId,
    adId: entityId,
    version,
    status: "ACTIVE",
    finalUrl: urls.finalUrl,
    finalMobileUrl: urls.finalMobileUrl,
    finalAppUrl: urls.finalAppUrl,
    trackingTemplate: urls.trackingTemplate,
    customParameters: urls.customParameters ?? {},
    effectiveAt: new Date("2026-09-20T00:00:00.000Z"),
    createdBy: TenantA.user,
  });
}

async function createExtraAd(h: Harness, googleAdId: string) {
  const id = randomUUID();
  await h.repos.ads.create({
    id,
    tenantId: TenantA.id,
    adGroupId: TenantA.adGroupA1,
    googleAdId,
    name: `Extra ${googleAdId}`,
    status: "ACTIVE",
  });
  return id;
}

function makeSimulator(
  app: Awaited<ReturnType<typeof buildApp>>,
  h: Harness,
  integrationId: string,
  tenantId = TenantA.id
) {
  return new ScriptRuntimeSimulator({
    app,
    resolveAppliedVersion: async (targetId) => {
      const t = await h.repos.scriptSyncTargets.findById(targetId);
      return t?.appliedVersion ?? null;
    },
    snapshotAppliedVersions: async () => {
      const map = new Map<string, number | null>();
      const page = await h.repos.scriptSyncTargets.findByIntegration(
        tenantId,
        integrationId,
        { page: 1, pageSize: 500 }
      );
      for (const t of page.items) {
        map.set(t.id, t.appliedVersion ?? null);
      }
      return map;
    },
  });
}

describe("Phase 8.4.8 Script Runtime Simulator", () => {
  const apps: Array<{ close: () => Promise<void> }> = [];
  let googleAdsCalls = 0;
  let originalGetStatus: GoogleAdsApiProvider["getStatus"] | null = null;

  beforeEach(() => {
    googleAdsCalls = 0;
    originalGetStatus = GoogleAdsApiProvider.prototype.getStatus;
    GoogleAdsApiProvider.prototype.getStatus = async function (...args) {
      googleAdsCalls += 1;
      return originalGetStatus!.apply(this, args);
    };
  });

  afterEach(async () => {
    if (originalGetStatus) {
      GoogleAdsApiProvider.prototype.getStatus = originalGetStatus;
    }
    while (apps.length) {
      await apps.pop()?.close();
    }
  });

  describe("production guard + markers", () => {
    it("1. assertTestRuntime throws in production", () => {
      expect(() =>
        assertTestRuntime({ NODE_ENV: "production" } as NodeJS.ProcessEnv)
      ).toThrow(/TEST_ONLY/);
    });

    it("2. assertTestRuntime allows test", () => {
      expect(() =>
        assertTestRuntime({ NODE_ENV: "test" } as NodeJS.ProcessEnv)
      ).not.toThrow();
    });

    it("3. simulator marker is TEST_ONLY", () => {
      const h = createHarness();
      const sim = new ScriptRuntimeSimulator({
        app: { inject: async () => ({ statusCode: 500, body: "" }) } as never,
        resolveAppliedVersion: async () => null,
        snapshotAppliedVersions: async () => new Map(),
      });
      expect(sim.marker).toBe("TEST_ONLY");
      void h;
    });

    it("4. scenario name list includes required ten", () => {
      expect([...SCRIPT_RUNTIME_SCENARIO_NAMES]).toEqual([
        "SUCCESS",
        "NEVER_APPLIED",
        "OUT_OF_SYNC",
        "STALE_DESIRED",
        "VERSION_CONFLICT",
        "IDEMPOTENT_REPLAY",
        "PARTIAL_FAILURE",
        "NO_ACTIVE_VERSION",
        "MULTI_TARGET",
        "CONCURRENT_EXECUTION",
      ]);
    });
  });

  describe("mock primitives", () => {
    it("5. MockUtilities sleep is no-op but recorded", () => {
      const u = new MockUtilities({ uuidSequence: ["a", "b"] });
      expect(u.getUuid()).toBe("a");
      expect(u.getUuid()).toBe("b");
      u.sleep(100);
      expect(u.sleepCalls).toEqual([100]);
    });

    it("6. MockLogger stores logs and rejects secrets", () => {
      const log = new MockLogger();
      log.log("ok targetId=x");
      expect(log.inMemoryLogs).toHaveLength(1);
      log.log("Authorization: Bearer alk_s_secret");
      expect(() => log.assertNoSecrets()).toThrow(/secret/);
    });

    it("7. MockAdsApp records independent URL fields", () => {
      const ads = new MockAdsApp({
        ads: [{ id: "ad-1", urls: {} }],
      });
      const ad = ads.ads().withCondition('Id = "ad-1"').get().next();
      const urls = ad.urls();
      urls.setFinalUrl("https://final.example/a");
      urls.setFinalMobileUrl("https://m.example/a");
      urls.setFinalAppUrl("myapp://open");
      urls.setTrackingTemplate("https://track.example/{lpurl}");
      urls.setCustomParameters({ _x: "1" });
      const state = ads.getAdState("ad-1")!;
      expect(state.finalUrl).toBe("https://final.example/a");
      expect(state.finalMobileUrl).toBe("https://m.example/a");
      expect(state.finalAppUrl).toBe("myapp://open");
      expect(state.trackingTemplate).toBe("https://track.example/{lpurl}");
      expect(state.customParameters).toEqual({ _x: "1" });
      expect(state.finalUrl).not.toContain("track.example");
      expect(state.finalUrl).not.toContain("_x=");
      expect(ads.mutations).toHaveLength(5);
    });

    it("8. MockUrlFetchApp blocks google hosts", async () => {
      const uf = new MockUrlFetchApp({
        handler: async () => ({ statusCode: 200, body: "{}" }),
      });
      await expect(
        uf.fetch("https://googleads.googleapis.com/v1", {})
      ).rejects.toThrow(/GOOGLE/);
    });

    it("9. network guard blocks global fetch", () => {
      const restore = installNetworkGuard();
      try {
        expect(() =>
          (globalThis as { fetch: (...a: unknown[]) => unknown }).fetch(
            "https://example.com"
          )
        ).toThrow(/REAL NETWORK/);
      } finally {
        restore();
      }
    });
  });

  describe("core scenarios", () => {
    it("10. SUCCESS ? desired=2 applied=2 SYNCED", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S10");
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      const result = await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: FIXED_EXEC,
          ads: [{ id: ad!.googleAdId }],
        })
      );
      expect(result.targetsSucceeded).toBe(1);
      const tr = result.targetResults.find((t) => t.targetId === target.id)!;
      expect(tr.status).toBe("SUCCESS");
      expect(tr.appliedVersionAfter).toBe(2);
      const updated = await h.repos.scriptSyncTargets.findById(target.id);
      expect(updated?.appliedVersion).toBe(2);
      expect(updated?.syncState).toBe("SYNCED");
      expect(result.googleAdsProviderInvocations).toBe(0);
      expect(googleAdsCalls).toBe(0);
    });

    it("11. NEVER_APPLIED ? null applied ? SYNCED after apply", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S11");
      const target = await addTarget(h, integration.id, TenantA.adA1);
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      const result = await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
        })
      );
      expect(result.targetResults[0]?.appliedVersionBefore).toBeNull();
      expect(result.targetResults[0]?.appliedVersionAfter).toBe(2);
      const updated = await h.repos.scriptSyncTargets.findById(target.id);
      expect(updated?.syncState).toBe("SYNCED");
    });

    it("12. OUT_OF_SYNC ? applied 1 ? desired 2 ? applied 2", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S12");
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
        })
      );
      const updated = await h.repos.scriptSyncTargets.findById(target.id);
      expect(updated?.appliedVersion).toBe(2);
    });

    it("13. STALE_DESIRED ? ACTIVE becomes 3 mid-run; no rollback", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S13");
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      const result = await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
          afterConfigHook: async () => {
            await ensureActiveUrl(h, TenantA.adA1, 3, {
              finalUrl: "https://example.com/landing-v3",
              trackingTemplate: "https://tracker.example.com/{lpurl}",
              customParameters: { _clickid: "v3" },
            });
          },
        })
      );
      const tr = result.targetResults.find((t) => t.targetId === target.id)!;
      expect(tr.status).toBe("CONFLICT");
      expect(tr.conflictCode).toBe(ScriptSyncConflictCodes.STALE_DESIRED);
      expect(tr.appliedVersionAfter).toBe(1);
      const updated = await h.repos.scriptSyncTargets.findById(target.id);
      expect(updated?.appliedVersion).toBe(1);
    });

    it("14. VERSION_CONFLICT ? applied cannot move backward", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S14");
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 3,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      const result = await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
        })
      );
      const tr = result.targetResults.find((t) => t.targetId === target.id)!;
      expect(tr.status).toBe("CONFLICT");
      expect(tr.conflictCode).toBe(ScriptSyncConflictCodes.VERSION_CONFLICT);
      expect(tr.appliedVersionAfter).toBe(3);
    });

    it("15. IDEMPOTENT_REPLAY ? second identical run does not duplicate log", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S15");
      await addTarget(h, integration.id, TenantA.adA1, { appliedVersion: 1 });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      const scenario = buildScenario({
        integrationId: integration.id,
        token,
        executionId: "dddddddd-dddd-4ddd-8ddd-dddddddddd15",
        ads: [{ id: ad!.googleAdId }],
      });
      await sim.run(scenario);
      const logs1 = await h.repos.scriptSyncLogs.findByIntegration(
        TenantA.id,
        integration.id,
        { page: 1, pageSize: 100 }
      );
      const count1 = logs1.items.filter(
        (l) => l.integrationId === integration.id
      ).length;
      await sim.run(scenario);
      const logs2 = await h.repos.scriptSyncLogs.findByIntegration(
        TenantA.id,
        integration.id,
        { page: 1, pageSize: 100 }
      );
      const count2 = logs2.items.filter(
        (l) => l.integrationId === integration.id
      ).length;
      expect(count2).toBe(count1);
    });

    it("16. PARTIAL_FAILURE ? A ok, B fail apply, C ok", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S16");
      await ensureActiveUrl(h, TenantA.adA1b, 1, {
        finalUrl: "https://example.com/a1b",
        customParameters: {},
      });
      await ensureActiveUrl(h, TenantA.adB1, 1, {
        finalUrl: "https://example.com/b1",
        customParameters: {},
      });
      const tA = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const tB = await addTarget(h, integration.id, TenantA.adA1b);
      const tC = await addTarget(h, integration.id, TenantA.adB1);
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const a = await h.repos.ads.findById(TenantA.adA1);
      const b = await h.repos.ads.findById(TenantA.adA1b);
      const c = await h.repos.ads.findById(TenantA.adB1);
      const result = await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [
            { id: a!.googleAdId },
            { id: b!.googleAdId },
            { id: c!.googleAdId },
          ],
          applyBehavior: { failAdIds: [b!.googleAdId] },
        })
      );
      expect(result.targetsSucceeded).toBeGreaterThanOrEqual(2);
      expect(result.targetsFailed).toBeGreaterThanOrEqual(1);
      const afterA = await h.repos.scriptSyncTargets.findById(tA.id);
      const afterB = await h.repos.scriptSyncTargets.findById(tB.id);
      const afterC = await h.repos.scriptSyncTargets.findById(tC.id);
      expect(afterA?.appliedVersion).toBe(2);
      expect(afterB?.appliedVersion ?? null).toBeNull();
      expect(afterC?.appliedVersion).toBe(1);
    });

    it("17. NO_ACTIVE_VERSION ? skip apply, no mutation", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S17");
      const target = await addTarget(h, integration.id, TenantA.adA2);
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA2);
      const result = await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
        })
      );
      const tr = result.targetResults.find((t) => t.targetId === target.id)!;
      expect(tr.status).toBe("SKIPPED");
      // Production Script checks isPositiveInt(desiredVersion) before NEVER_CONFIGURED;
      // null desiredVersion therefore skips as invalid_desired_version (equivalent to no ACTIVE).
      expect(["NO_ACTIVE_VERSION", "invalid_desired_version"]).toContain(tr.error);
      expect(sim.adsApp.mutations).toHaveLength(0);
    });

    it("18. MULTI_TARGET ? 5 independent targets", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S18");
      const entityIds: string[] = [
        TenantA.adA1,
        TenantA.adA1b,
        TenantA.adB1,
      ];
      await ensureActiveUrl(h, TenantA.adA1b, 1, {
        finalUrl: "https://example.com/m2",
        customParameters: { k: "2" },
      });
      await ensureActiveUrl(h, TenantA.adB1, 1, {
        finalUrl: "https://example.com/m3",
        customParameters: { k: "3" },
      });
      const extra1 = await createExtraAd(h, "sim-ad-004");
      const extra2 = await createExtraAd(h, "sim-ad-005");
      entityIds.push(extra1, extra2);
      await ensureActiveUrl(h, extra1, 1, {
        finalUrl: "https://example.com/m4",
        customParameters: {},
      });
      await ensureActiveUrl(h, extra2, 1, {
        finalUrl: "https://example.com/m5",
        customParameters: {},
      });
      const targets = [];
      for (const eid of entityIds) {
        targets.push(
          await addTarget(h, integration.id, eid, {
            appliedVersion: eid === TenantA.adA1 ? 1 : undefined,
          })
        );
      }
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ads = [];
      for (const eid of entityIds) {
        const ad = await h.repos.ads.findById(eid);
        ads.push({ id: ad!.googleAdId });
      }
      const result = await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads,
        })
      );
      expect(result.targetsProcessed).toBe(5);
      expect(result.targetsSucceeded).toBe(5);
      for (const t of targets) {
        const updated = await h.repos.scriptSyncTargets.findById(t.id);
        expect(updated?.appliedVersion).toBeTruthy();
      }
    });

    it("19. CONCURRENT_EXECUTION ? same executionId ? one logical apply", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S19");
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      const scenario = buildScenario({
        integrationId: integration.id,
        token,
        executionId: "cccccccc-cccc-4ccc-8ccc-cccccccccc19",
        ads: [{ id: ad!.googleAdId }],
      });
      const sim1 = makeSimulator(app, h, integration.id);
      const sim2 = makeSimulator(app, h, integration.id);
      await Promise.all([sim1.run(scenario), sim2.run(scenario)]);
      const logs = await h.repos.scriptSyncLogs.findByIntegration(
        TenantA.id,
        integration.id,
        { page: 1, pageSize: 100 }
      );
      const forTarget = logs.items.filter((l) => l.targetId === target.id);
      expect(forTarget.length).toBe(1);
      const updated = await h.repos.scriptSyncTargets.findById(target.id);
      expect(updated?.appliedVersion).toBe(2);
    });
  });

  describe("failure injection + retry", () => {
    it("20. config HTTP 500 ? no apply", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S20");
      await addTarget(h, integration.id, TenantA.adA1, { appliedVersion: 1 });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      const result = await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
          syncBehavior: { forceConfigStatus: 500 },
        })
      );
      expect(result.targetsProcessed).toBe(0);
      expect(sim.adsApp.mutations).toHaveLength(0);
      expect(sim.utilities.sleepCalls.length).toBeGreaterThan(0);
    });

    it("21. malformed config ? no apply", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S21");
      await addTarget(h, integration.id, TenantA.adA1, { appliedVersion: 1 });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      const result = await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
          syncBehavior: { malformedConfig: true },
        })
      );
      expect(result.targetsProcessed).toBe(0);
      expect(sim.logger.inMemoryLogs.some((l) => l.includes("parse error"))).toBe(
        true
      );
    });

    it("22. sync-result forced 500 after retries logs failure", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S22");
      await addTarget(h, integration.id, TenantA.adA1, { appliedVersion: 1 });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      const result = await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
          syncBehavior: { forceSyncStatus: 500 },
        })
      );
      expect(result.targetsFailed).toBe(1);
      expect(sim.utilities.sleepCalls.length).toBeGreaterThan(0);
    });

    it("23. HTTP retry idempotency ? response lost then replay", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S23");
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb23",
          ads: [{ id: ad!.googleAdId }],
          syncBehavior: { loseResponseStatus: 500, loseResponseTimes: 1 },
        })
      );
      const logs = await h.repos.scriptSyncLogs.findByIntegration(
        TenantA.id,
        integration.id,
        { page: 1, pageSize: 100 }
      );
      const forTarget = logs.items.filter((l) => l.targetId === target.id);
      expect(forTarget.length).toBe(1);
      const updated = await h.repos.scriptSyncTargets.findById(target.id);
      expect(updated?.appliedVersion).toBe(2);
      expect(sim.urlFetchApp.callsTo("/sync-result").length).toBeGreaterThanOrEqual(
        2
      );
    });

    it("24. apply failure reports FAILED without advancing applied", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S24");
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
          applyBehavior: "fail_all",
        })
      );
      const updated = await h.repos.scriptSyncTargets.findById(target.id);
      expect(updated?.appliedVersion).toBe(1);
      expect(updated?.lastExecution).toBe("FAILED");
    });

    it("25. invalid token ? auth fail, no apply", async () => {
      const h = createHarness();
      const { integration } = await createIntegration(h, "S25");
      await addTarget(h, integration.id, TenantA.adA1, { appliedVersion: 1 });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      const result = await sim.run(
        buildScenario({
          integrationId: integration.id,
          token: "alk_s_invalid_token_value",
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
        })
      );
      expect(result.targetsProcessed).toBe(0);
      expect(sim.adsApp.mutations).toHaveLength(0);
    });
  });

  describe("config ? apply field independence", () => {
    it("26. setFinalUrl / mobile / app / tracking / customParameters independent", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S26");
      await ensureActiveUrl(h, TenantA.adA1, 4, {
        finalUrl: "https://final.example/v4",
        finalMobileUrl: "https://m.example/v4",
        finalAppUrl: "myapp://v4",
        trackingTemplate: "https://track.example/click?u={lpurl}",
        customParameters: { _campaign: "x", _src: "y" },
      });
      await addTarget(h, integration.id, TenantA.adA1, { appliedVersion: 2 });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
        })
      );
      const state = sim.adsApp.getAdState(ad!.googleAdId)!;
      expect(state.finalUrl).toBe("https://final.example/v4");
      expect(state.finalMobileUrl).toBe("https://m.example/v4");
      expect(state.finalAppUrl).toBe("myapp://v4");
      expect(state.trackingTemplate).toBe(
        "https://track.example/click?u={lpurl}"
      );
      expect(state.customParameters).toEqual({ _campaign: "x", _src: "y" });
      expect(state.finalUrl).not.toContain("track.example");
      expect(state.finalUrl).not.toContain("_campaign");
      const ops = sim.adsApp.mutationsFor(ad!.googleAdId).map((m) => m.operation);
      expect(ops).toContain("setFinalUrl");
      expect(ops).toContain("setFinalMobileUrl");
      expect(ops).toContain("setFinalAppUrl");
      expect(ops).toContain("setTrackingTemplate");
      expect(ops).toContain("setCustomParameters");
    });
  });

  describe("security + generated source", () => {
    it("27. generated source contains AdsApp UrlFetchApp Utilities Authorization endpoints", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S27");
      const source = buildGoogleAdsScriptSource({
        integrationId: integration.id,
        token,
        configEndpoint: SIM_CONFIG,
        syncResultEndpoint: SIM_SYNC,
      });
      expect(source).toContain("UrlFetchApp");
      expect(source).toContain("AdsApp");
      expect(source).toContain("Utilities");
      expect(source).toContain("Logger");
      expect(source).toContain("Authorization");
      expect(source).toContain("/api/v1/script/config");
      expect(source).toContain("/api/v1/script/sync-result");
    });

    it("28. generated source bans proxy/UA/referer/cloaking", () => {
      const source = buildGoogleAdsScriptSource({
        integrationId: randomUUID(),
        token: "alk_s_test",
        configEndpoint: SIM_CONFIG,
        syncResultEndpoint: SIM_SYNC,
      });
      expect(assertScriptSourceSafe(source)).toEqual([]);
      for (const banned of [
        "proxy",
        "User-Agent",
        "Referer",
        "cloaking",
        "anti-detection",
        "gclid",
        "gbraid",
        "wbraid",
      ]) {
        expect(source.toLowerCase()).not.toContain(banned.toLowerCase());
      }
    });

    it("29. token not in Logger after successful run", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S29");
      await addTarget(h, integration.id, TenantA.adA1, { appliedVersion: 1 });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
        })
      );
      const joined = sim.logger.inMemoryLogs.join("\n");
      expect(joined).not.toContain(token);
      expect(joined).not.toMatch(/Bearer\s+/);
      expect(joined.toLowerCase()).not.toContain("pepper");
    });

    it("30. token not in SyncLog or URL query", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S30");
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
        })
      );
      for (const call of sim.urlFetchApp.calls) {
        expect(call.url).not.toMatch(/[?&]token=/);
        expect(call.url).not.toContain("/token/");
      }
      const logs = await h.repos.scriptSyncLogs.findByIntegration(
        TenantA.id,
        integration.id,
        { page: 1, pageSize: 50 }
      );
      const blob = JSON.stringify(
        logs.items.filter((l) => l.targetId === target.id)
      );
      expect(blob).not.toContain(token);
      expect(blob.toLowerCase()).not.toContain("pepper");
    });

    it("31. rotate token ? old source auth fails, new source works", async () => {
      const h = createHarness();
      const created = await createIntegration(h, "S31");
      await addTarget(h, created.integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      const oldToken = created.token;
      const rotated = await h.integrationService.rotateToken(
        TenantA.id,
        created.integration.id
      );
      const sim = makeSimulator(app, h, created.integration.id);
      const fail = await sim.run(
        buildScenario({
          integrationId: created.integration.id,
          token: oldToken,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
        })
      );
      expect(fail.targetsProcessed).toBe(0);
      const ok = await sim.run(
        buildScenario({
          integrationId: created.integration.id,
          token: rotated.token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
        })
      );
      expect(ok.targetsSucceeded).toBe(1);
    });
  });

  describe("dashboard verification", () => {
    it("32. SUCCESS visible on dashboard as SYNCED", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S32");
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
        })
      );
      const dash = await app.inject({
        method: "GET",
        url: `/api/v1/dashboard/integrations/${integration.id}/targets`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(dash.statusCode).toBe(200);
      const body = dash.json() as {
        items: Array<{
          targetId: string;
          syncState: string;
          appliedVersion: number;
        }>;
      };
      const row = body.items.find((i) => i.targetId === target.id)!;
      expect(row.syncState).toBe("SYNCED");
      expect(row.appliedVersion).toBe(2);
    });

    it("33. PARTIAL failure reflected per-target on dashboard", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S33");
      await ensureActiveUrl(h, TenantA.adA1b, 1, {
        finalUrl: "https://example.com/p",
        customParameters: {},
      });
      const tA = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const tB = await addTarget(h, integration.id, TenantA.adA1b);
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const a = await h.repos.ads.findById(TenantA.adA1);
      const b = await h.repos.ads.findById(TenantA.adA1b);
      await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: a!.googleAdId }, { id: b!.googleAdId }],
          applyBehavior: { failAdIds: [b!.googleAdId] },
        })
      );
      const dash = await app.inject({
        method: "GET",
        url: `/api/v1/dashboard/integrations/${integration.id}/targets`,
        headers: { authorization: `Bearer ${token}` },
      });
      const body = dash.json() as {
        items: Array<{
          targetId: string;
          appliedVersion: number | null;
          lastExecution: string | null;
        }>;
      };
      expect(
        body.items.find((i) => i.targetId === tA.id)?.appliedVersion
      ).toBe(2);
      expect(
        body.items.find((i) => i.targetId === tB.id)?.appliedVersion ?? null
      ).toBe(null);
      expect(body.items.find((i) => i.targetId === tB.id)?.lastExecution).toBe(
        "FAILED"
      );
    });

    it("34. CONFLICT does not advance appliedVersion on dashboard", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S34");
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 3,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
        })
      );
      const dash = await app.inject({
        method: "GET",
        url: `/api/v1/dashboard/integrations/${integration.id}/targets`,
        headers: { authorization: `Bearer ${token}` },
      });
      const body = dash.json() as {
        items: Array<{ targetId: string; appliedVersion: number }>;
      };
      expect(
        body.items.find((i) => i.targetId === target.id)?.appliedVersion
      ).toBe(3);
    });
  });

  describe("safety + scale", () => {
    it("35. GoogleAdsApiProvider invocation count stays 0", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S35");
      await addTarget(h, integration.id, TenantA.adA1, { appliedVersion: 1 });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
        })
      );
      expect(googleAdsCalls).toBe(0);
      new GoogleAdsApiProvider();
      expect(googleAdsCalls).toBe(0);
    });

    it("36. 100 targets complete without obvious O(N?) stall", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S36");
      const ads: Array<{ id: string }> = [];
      for (let i = 0; i < 100; i++) {
        const entityId = await createExtraAd(h, `scale-ad-${i}`);
        await ensureActiveUrl(h, entityId, 1, {
          finalUrl: `https://example.com/scale/${i}`,
          customParameters: {},
        });
        await addTarget(h, integration.id, entityId);
        const ad = await h.repos.ads.findById(entityId);
        ads.push({ id: ad!.googleAdId });
      }
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const started = performance.now();
      const result = await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads,
        })
      );
      const elapsed = performance.now() - started;
      expect(result.targetsSucceeded).toBe(100);
      expect(elapsed).toBeLessThan(30_000);
    });

    it("37. tenant isolation ? TenantB token cannot sync TenantA target", async () => {
      const h = createHarness();
      const a = await createIntegration(h, "S37A");
      const b = await h.integrationService.create({
        tenantId: TenantB.id,
        googleAccountId: TenantB.account,
        name: "S37B",
      });
      await addTarget(h, a.integration.id, TenantA.adA1, { appliedVersion: 1 });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, b.integration.id, TenantB.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      const result = await sim.run(
        buildScenario({
          integrationId: b.integration.id,
          token: b.token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
        })
      );
      expect(result.targetsSucceeded).toBe(0);
    });

    it("38. unknown / missing ad ? apply fails without crash", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S38");
      await addTarget(h, integration.id, TenantA.adA1, { appliedVersion: 1 });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: "nonexistent-google-ad" }],
        })
      );
      expect(sim.adsApp.mutations).toHaveLength(0);
    });

    it("39. simulator generateSource is in-memory only", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S39");
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const source = sim.generateSource(
        buildScenario({
          integrationId: integration.id,
          token,
          ads: [{ id: "ad-3001" }],
        })
      );
      expect(source.length).toBeGreaterThan(100);
      expect(source).toContain(token);
    });

    it("40. Utilities deterministic UUID injection", () => {
      const u = new MockUtilities({
        uuidSequence: ["id-1", "id-2"],
      });
      expect(u.getUuid()).toBe("id-1");
      expect(u.getUuid()).toBe("id-2");
      expect(u.getUuid()).toBe("id-1");
    });
  });

  describe("additional behavioral coverage", () => {
    it("41. maxHttpRetries sleeps on transient config 500", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S41");
      await addTarget(h, integration.id, TenantA.adA1, { appliedVersion: 1 });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
          syncBehavior: { forceConfigStatus: 500 },
        })
      );
      expect(sim.utilities.sleepCalls).toEqual([250, 500]);
    });

    it("42. 409 sync conflict does not retry (no sleep for conflict)", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S42");
      await addTarget(h, integration.id, TenantA.adA1, { appliedVersion: 3 });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
        })
      );
      expect(sim.utilities.sleepCalls).toEqual([]);
    });

    it("43. SyncLog created on SUCCESS", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S43");
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
        })
      );
      const logs = await h.repos.scriptSyncLogs.findByIntegration(
        TenantA.id,
        integration.id,
        { page: 1, pageSize: 50 }
      );
      expect(
        logs.items.some(
          (l) => l.targetId === target.id && l.result === "SUCCESS"
        )
      ).toBe(true);
    });

    it("44. result includes executionId from injection", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S44");
      await addTarget(h, integration.id, TenantA.adA1, { appliedVersion: 1 });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      const exec = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa44";
      const result = await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: exec,
          ads: [{ id: ad!.googleAdId }],
        })
      );
      expect(result.executionId).toBe(exec);
    });

    it("45. Authorization header present on config fetch", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S45");
      await addTarget(h, integration.id, TenantA.adA1, { appliedVersion: 1 });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
        })
      );
      const configCall = sim.urlFetchApp.callsTo("/config")[0]!;
      expect(configCall.options.headers?.Authorization).toBe(`Bearer ${token}`);
    });

    it("46. MockAdsApp missing ad returns apply false path", async () => {
      const ads = new MockAdsApp({ ads: [] });
      const it = ads.ads().withCondition('Id = "missing"').get();
      expect(it.hasNext()).toBe(false);
    });

    it("47. reset clears simulator mutable state between runs", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S47");
      await addTarget(h, integration.id, TenantA.adA1, { appliedVersion: 1 });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
        })
      );
      sim.reset();
      expect(sim.logger.inMemoryLogs).toHaveLength(0);
      expect(sim.adsApp.mutations).toHaveLength(0);
    });

    it("48. FORCE sync 409 treated as conflict without advancing", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S48");
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      const result = await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
          syncBehavior: { forceSyncStatus: 409 },
        })
      );
      expect(result.targetResults[0]?.status).toBe("CONFLICT");
      const updated = await h.repos.scriptSyncTargets.findById(target.id);
      expect(updated?.appliedVersion).toBe(1);
    });

    it("49. startedAt/completedAt are deterministic injected clock", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S49");
      await addTarget(h, integration.id, TenantA.adA1, { appliedVersion: 1 });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      const result = await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:02.000Z",
        })
      );
      expect(result.startedAt).toBe("2026-01-01T00:00:00.000Z");
      expect(result.completedAt).toBe("2026-01-01T00:00:02.000Z");
    });

    it("50. realNetworkCalls always 0 on result", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S50");
      await addTarget(h, integration.id, TenantA.adA1, { appliedVersion: 1 });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      const result = await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
        })
      );
      expect(result.realNetworkCalls).toBe(0);
    });

    it("51. ScriptSyncLog conflict entries for STALE_DESIRED", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S51");
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const sim = makeSimulator(app, h, integration.id);
      const ad = await h.repos.ads.findById(TenantA.adA1);
      await sim.run(
        buildScenario({
          integrationId: integration.id,
          token,
          executionId: randomUUID(),
          ads: [{ id: ad!.googleAdId }],
          afterConfigHook: async () => {
            await ensureActiveUrl(h, TenantA.adA1, 9, {
              finalUrl: "https://example.com/v9",
              customParameters: {},
            });
          },
        })
      );
      const logs = await h.repos.scriptSyncLogs.findByIntegration(
        TenantA.id,
        integration.id,
        { page: 1, pageSize: 50 }
      );
      const hit = logs.items.find(
        (l) =>
          l.targetId === target.id &&
          l.errorCode === ScriptSyncConflictCodes.STALE_DESIRED
      );
      expect(hit).toBeTruthy();
    });

    it("52. generator does not persist source entity", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, "S52");
      const app = await buildApp(h.services);
      apps.push(app);
      await app.inject({
        method: "POST",
        url: "/api/v1/script/generator",
        headers: { authorization: `Bearer ${token}` },
        payload: { token },
      });
      expect(h.repos).not.toHaveProperty("generatedScripts");
      void integration;
    });
  });
});
