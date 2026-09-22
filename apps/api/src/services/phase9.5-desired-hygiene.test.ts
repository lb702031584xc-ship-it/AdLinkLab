/**
 * Phase 9.5 — Desired Version Hygiene.
 * ACTIVE UrlVersion is sole Desired Authority; ScriptSyncTarget.desiredVersion is non-authority.
 */
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSeededMemoryRepositories,
  TenantA,
} from "@adlinklab/database";
import { ScriptSyncConflictCodes } from "@adlinklab/domain";
import { AppError } from "@adlinklab/shared";
import { registerScriptRoutes } from "../routes/script.js";
import { registerDashboardRoutes } from "../routes/dashboard.js";
import type { AppServices } from "../routes/index.js";
import { TEST_INTEGRATION_TOKEN_PEPPER } from "../auth/integration-token-crypto.js";
import { ScriptIntegrationService } from "./script-integration-service.js";
import { ScriptConfigService } from "./script-config-service.js";
import { ScriptSyncResultService } from "./script-sync-result-service.js";
import { DashboardQueryService } from "./dashboard-query-service.js";
import { AuditService, UrlVersionService } from "./index.js";

const ENV = {
  VITEST: "1",
  INTEGRATION_TOKEN_PEPPER: TEST_INTEGRATION_TOKEN_PEPPER,
} as NodeJS.ProcessEnv;

const CONFIG_PATH = "/api/v1/script/config";
const SYNC_PATH = "/api/v1/script/sync-result";

function createHarness() {
  const repos = createSeededMemoryRepositories();
  const audit = new AuditService(repos.auditLogs);
  const integrationService = new ScriptIntegrationService(
    repos.scriptIntegrations,
    repos.googleAccounts,
    audit,
    ENV
  );
  const urlVersions = new UrlVersionService(
    repos.urlVersions,
    repos.ads,
    repos.unitOfWork
  );
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
  return {
    repos,
    audit,
    integrationService,
    urlVersions,
    scriptConfig,
    scriptSyncResult,
    dashboardQuery,
    services,
  };
}

async function buildApp(
  services: Pick<
    AppServices,
    | "scriptIntegrations"
    | "scriptConfig"
    | "scriptSyncResult"
    | "dashboardQuery"
    | "audit"
  >
) {
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

async function createIntegration(
  h: ReturnType<typeof createHarness>,
  name: string
) {
  return h.integrationService.create({
    tenantId: TenantA.id,
    googleAccountId: TenantA.account,
    name,
  });
}

async function addTarget(
  h: ReturnType<typeof createHarness>,
  integrationId: string,
  entityId: string,
  extra?: Partial<{
    appliedVersion: number;
    desiredVersion: number;
    syncState: "SYNCED" | "OUT_OF_SYNC" | "NEVER_APPLIED";
  }>
) {
  return h.repos.scriptSyncTargets.create({
    id: randomUUID(),
    tenantId: TenantA.id,
    integrationId,
    entityType: "AD",
    entityId,
    appliedVersion: extra?.appliedVersion,
    desiredVersion: extra?.desiredVersion,
    syncState: extra?.syncState ?? "NEVER_APPLIED",
    connectionHealth: "STALE",
  });
}

describe("Phase 9.5 Desired Version Hygiene", () => {
  const apps: Array<{ close: () => Promise<void> }> = [];
  afterEach(async () => {
    while (apps.length) {
      const a = apps.pop();
      await a?.close();
    }
  });

  it("1. Active V2 (fixture) → Config desired=2", async () => {
    const h = createHarness();
    const { integration, token } = await createIntegration(h, "T1");
    await addTarget(h, integration.id, TenantA.adA1);
    const app = await buildApp(h.services);
    apps.push(app);
    const res = await app.inject({
      method: "GET",
      url: CONFIG_PATH,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().targets[0].desiredVersion).toBe(2);
  });

  it("2. Activate V3 → Config desired=3 without touching target.desiredVersion", async () => {
    const h = createHarness();
    const { integration, token } = await createIntegration(h, "T2");
    const target = await addTarget(h, integration.id, TenantA.adA1, {
      desiredVersion: 2,
      appliedVersion: 2,
      syncState: "SYNCED",
    });
    const draft = await h.urlVersions.createVersion({
      tenantId: TenantA.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      finalUrl: "https://example.com/landing-v3",
      status: "DRAFT",
    });
    expect(draft.version).toBe(3);
    await h.urlVersions.activateVersion({
      tenantId: TenantA.id,
      versionId: draft.id,
    });

    const shadow = await h.repos.scriptSyncTargets.findById(target.id);
    expect(shadow?.desiredVersion).toBe(2);

    const app = await buildApp(h.services);
    apps.push(app);
    const res = await app.inject({
      method: "GET",
      url: CONFIG_PATH,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json().targets[0].desiredVersion).toBe(3);
    expect(res.json().targets[0].appliedVersion).toBe(2);
    expect(res.json().targets[0].syncState).toBe("OUT_OF_SYNC");
  });

  it("3. Stale target.desiredVersion=1 + ACTIVE=2 → Config desired=2", async () => {
    const h = createHarness();
    const { integration, token } = await createIntegration(h, "T3");
    await addTarget(h, integration.id, TenantA.adA1, {
      desiredVersion: 1,
      appliedVersion: 1,
      syncState: "SYNCED",
    });
    const app = await buildApp(h.services);
    apps.push(app);
    const res = await app.inject({
      method: "GET",
      url: CONFIG_PATH,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json().targets[0].desiredVersion).toBe(2);
    expect(res.json().targets[0].desiredVersion).not.toBe(1);
    expect(res.json().targets[0].syncState).toBe("OUT_OF_SYNC");
  });

  it("4. Dashboard desired from ACTIVE, not target shadow", async () => {
    const h = createHarness();
    const { integration, token } = await createIntegration(h, "T4");
    await addTarget(h, integration.id, TenantA.adA1, {
      desiredVersion: 1,
      appliedVersion: 1,
      syncState: "SYNCED",
    });
    const app = await buildApp(h.services);
    apps.push(app);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/dashboard/integrations/${integration.id}/targets`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items[0].desiredVersion).toBe(2);
    expect(res.json().items[0].appliedVersion).toBe(1);
    expect(res.json().items[0].syncState).toBe("OUT_OF_SYNC");
  });

  it("5. No ACTIVE → NEVER_CONFIGURED / null desired (existing NO_ACTIVE semantics)", async () => {
    const h = createHarness();
    const { integration, token } = await createIntegration(h, "T5");
    await addTarget(h, integration.id, TenantA.adA2, {
      desiredVersion: 99,
    });
    const app = await buildApp(h.services);
    apps.push(app);
    const res = await app.inject({
      method: "GET",
      url: CONFIG_PATH,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json().targets[0].desiredVersion).toBeNull();
    expect(res.json().targets[0].configurationState).toBe("NEVER_CONFIGURED");
  });

  it("6. ACTIVE=2 reported=1 → STALE_DESIRED; applied must not become 1", async () => {
    const h = createHarness();
    const { integration, token } = await createIntegration(h, "T6");
    const target = await addTarget(h, integration.id, TenantA.adA1, {
      desiredVersion: 1,
      appliedVersion: 2,
      syncState: "SYNCED",
    });
    const app = await buildApp(h.services);
    apps.push(app);
    const res = await app.inject({
      method: "POST",
      url: SYNC_PATH,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        targetId: target.id,
        desiredVersion: 1,
        result: "SUCCESS",
        idempotencyKey: `stale-${randomUUID()}`,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe(ScriptSyncConflictCodes.STALE_DESIRED);
    const after = await h.repos.scriptSyncTargets.findById(target.id);
    expect(after?.appliedVersion).toBe(2);
  });

  it("7. ACTIVE=2 reported=2 → accepted applied=2", async () => {
    const h = createHarness();
    const { integration, token } = await createIntegration(h, "T7");
    const target = await addTarget(h, integration.id, TenantA.adA1, {
      desiredVersion: 99,
      appliedVersion: 1,
      syncState: "OUT_OF_SYNC",
    });
    const app = await buildApp(h.services);
    apps.push(app);
    const res = await app.inject({
      method: "POST",
      url: SYNC_PATH,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        targetId: target.id,
        desiredVersion: 2,
        result: "SUCCESS",
        idempotencyKey: `ok-${randomUUID()}`,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().appliedVersion).toBe(2);
    expect(res.json().status).toBe("APPLIED");
    const after = await h.repos.scriptSyncTargets.findById(target.id);
    expect(after?.appliedVersion).toBe(2);
    // Shadow column must not be rewritten by sync-result to "balance"
    expect(after?.desiredVersion).toBe(99);
  });

  it("8. ACTIVE=3 applied=2 → desired=3 applied=2 OUT_OF_SYNC", async () => {
    const h = createHarness();
    const { integration, token } = await createIntegration(h, "T8");
    await addTarget(h, integration.id, TenantA.adA1, {
      desiredVersion: 2,
      appliedVersion: 2,
      syncState: "SYNCED",
    });
    const draft = await h.urlVersions.createVersion({
      tenantId: TenantA.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      finalUrl: "https://example.com/landing-v3-out",
      status: "DRAFT",
    });
    await h.urlVersions.activateVersion({
      tenantId: TenantA.id,
      versionId: draft.id,
    });
    const app = await buildApp(h.services);
    apps.push(app);
    const cfg = await app.inject({
      method: "GET",
      url: CONFIG_PATH,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(cfg.json().targets[0]).toMatchObject({
      desiredVersion: 3,
      appliedVersion: 2,
      syncState: "OUT_OF_SYNC",
    });
    const dash = await app.inject({
      method: "GET",
      url: `/api/v1/dashboard/integrations/${integration.id}/targets`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(dash.json().items[0]).toMatchObject({
      desiredVersion: 3,
      appliedVersion: 2,
      syncState: "OUT_OF_SYNC",
    });
  });

  it("9-10. Multiple integrations: same desired=ACTIVE; different applied → A OUT B SYNCED", async () => {
    const h = createHarness();
    const a = await createIntegration(h, "IntA");
    const b = await createIntegration(h, "IntB");
    await addTarget(h, a.integration.id, TenantA.adA1, {
      desiredVersion: 1,
      appliedVersion: 1,
      syncState: "SYNCED",
    });
    await addTarget(h, b.integration.id, TenantA.adA1, {
      desiredVersion: 1,
      appliedVersion: 2,
      syncState: "SYNCED",
    });
    const app = await buildApp(h.services);
    apps.push(app);

    const cfgA = await app.inject({
      method: "GET",
      url: CONFIG_PATH,
      headers: { authorization: `Bearer ${a.token}` },
    });
    const cfgB = await app.inject({
      method: "GET",
      url: CONFIG_PATH,
      headers: { authorization: `Bearer ${b.token}` },
    });
    expect(cfgA.json().targets[0].desiredVersion).toBe(2);
    expect(cfgB.json().targets[0].desiredVersion).toBe(2);
    expect(cfgA.json().targets[0].appliedVersion).toBe(1);
    expect(cfgB.json().targets[0].appliedVersion).toBe(2);
    expect(cfgA.json().targets[0].syncState).toBe("OUT_OF_SYNC");
    expect(cfgB.json().targets[0].syncState).toBe("SYNCED");
  });

  it("11. Sync Result cannot modify ACTIVE UrlVersion", async () => {
    const h = createHarness();
    const { integration, token } = await createIntegration(h, "T11");
    const target = await addTarget(h, integration.id, TenantA.adA1, {
      appliedVersion: 1,
    });
    const before = await h.repos.urlVersions.findActiveByEntity(
      "AD",
      TenantA.adA1
    );
    const app = await buildApp(h.services);
    apps.push(app);
    await app.inject({
      method: "POST",
      url: SYNC_PATH,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        targetId: target.id,
        desiredVersion: 2,
        result: "SUCCESS",
        idempotencyKey: `active-safe-${randomUUID()}`,
      },
    });
    const after = await h.repos.urlVersions.findActiveByEntity(
      "AD",
      TenantA.adA1
    );
    expect(after?.id).toBe(before?.id);
    expect(after?.version).toBe(before?.version);
    expect(after?.finalUrl).toBe(before?.finalUrl);
  });

  it("12. Stale target desiredVersion cannot make sync succeed against ACTIVE", async () => {
    const h = createHarness();
    const { integration, token } = await createIntegration(h, "T12");
    const target = await addTarget(h, integration.id, TenantA.adA1, {
      desiredVersion: 2,
      appliedVersion: 1,
    });
    const draft = await h.urlVersions.createVersion({
      tenantId: TenantA.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      finalUrl: "https://example.com/landing-v3-stale-sync",
      status: "DRAFT",
    });
    await h.urlVersions.activateVersion({
      tenantId: TenantA.id,
      versionId: draft.id,
    });
    const app = await buildApp(h.services);
    apps.push(app);
    const res = await app.inject({
      method: "POST",
      url: SYNC_PATH,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        targetId: target.id,
        desiredVersion: 2,
        result: "SUCCESS",
        idempotencyKey: `shadow-fail-${randomUUID()}`,
      },
    });
    expect(res.json().error).toBe(ScriptSyncConflictCodes.STALE_DESIRED);
    const after = await h.repos.scriptSyncTargets.findById(target.id);
    expect(after?.appliedVersion).toBe(1);
  });

  it("13. target.desiredVersion update is ignored (non-authority)", async () => {
    const h = createHarness();
    const { integration } = await createIntegration(h, "T13");
    const target = await addTarget(h, integration.id, TenantA.adA1, {
      desiredVersion: 1,
    });
    await h.repos.scriptSyncTargets.update(target.id, {
      desiredVersion: 999,
      appliedVersion: 1,
    });
    const after = await h.repos.scriptSyncTargets.findById(target.id);
    expect(after?.desiredVersion).toBe(1);
    expect(after?.appliedVersion).toBe(1);
  });

  it("14. Concurrent activation + sync-result: ACTIVE remains authority", async () => {
    const h = createHarness();
    const { integration, token } = await createIntegration(h, "T14");
    const target = await addTarget(h, integration.id, TenantA.adA1, {
      appliedVersion: 1,
      desiredVersion: 2,
    });
    const draft = await h.urlVersions.createVersion({
      tenantId: TenantA.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      finalUrl: "https://example.com/landing-v3-race",
      status: "DRAFT",
    });

    const app = await buildApp(h.services);
    apps.push(app);

    const [activateSettled, syncSettled] = await Promise.allSettled([
      h.urlVersions.activateVersion({
        tenantId: TenantA.id,
        versionId: draft.id,
      }),
      app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          targetId: target.id,
          desiredVersion: 2,
          result: "SUCCESS",
          idempotencyKey: `race-${randomUUID()}`,
        },
      }),
    ]);

    expect(activateSettled.status).toBe("fulfilled");
    const active = await h.repos.urlVersions.findActiveByEntity(
      "AD",
      TenantA.adA1
    );
    expect(active?.version).toBe(3);

    if (syncSettled.status === "fulfilled") {
      const body = syncSettled.value.json();
      if (syncSettled.value.statusCode === 200) {
        // Won the race before activate committed — applied may be 2, then OUT_OF_SYNC vs ACTIVE=3
        expect(body.appliedVersion).toBe(2);
      } else {
        expect(body.error).toBe(ScriptSyncConflictCodes.STALE_DESIRED);
        const after = await h.repos.scriptSyncTargets.findById(target.id);
        expect(after?.appliedVersion).not.toBe(3);
      }
    }

    const cfg = await app.inject({
      method: "GET",
      url: CONFIG_PATH,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(cfg.json().targets[0].desiredVersion).toBe(3);
  });
});
