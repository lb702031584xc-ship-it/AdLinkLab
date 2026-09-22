/**
 * Phase 8.4.7.1 — Dashboard Read Model + API (READ ONLY).
 */
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSeededMemoryRepositories,
  TenantA,
  TenantB,
} from "@adlinklab/database";
import { AppError } from "@adlinklab/shared";
import { registerDashboardRoutes } from "../routes/dashboard.js";
import type { AppServices } from "../routes/index.js";
import { TEST_INTEGRATION_TOKEN_PEPPER } from "../auth/integration-token-crypto.js";
import { ScriptIntegrationService } from "./script-integration-service.js";
import { DashboardQueryService } from "./dashboard-query-service.js";
import { AuditService } from "./index.js";

const ENV = {
  VITEST: "1",
  INTEGRATION_TOKEN_PEPPER: TEST_INTEGRATION_TOKEN_PEPPER,
} as NodeJS.ProcessEnv;

function createHarness() {
  const repos = createSeededMemoryRepositories();
  const audit = new AuditService(repos.auditLogs);
  const integrationService = new ScriptIntegrationService(
    repos.scriptIntegrations,
    repos.googleAccounts,
    audit,
    ENV
  );
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
    dashboardQuery,
    audit,
  } as Pick<AppServices, "scriptIntegrations" | "dashboardQuery" | "audit">;
  return { repos, audit, integrationService, dashboardQuery, services };
}

async function buildApp(
  services: Pick<AppServices, "scriptIntegrations" | "dashboardQuery" | "audit">
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
  await registerDashboardRoutes(app, services as AppServices);
  return app;
}

async function createIntegration(
  h: ReturnType<typeof createHarness>,
  tenantId = TenantA.id,
  googleAccountId = TenantA.account,
  name = "Dash"
) {
  return h.integrationService.create({ tenantId, googleAccountId, name });
}

async function addTarget(
  h: ReturnType<typeof createHarness>,
  integrationId: string,
  entityId: string,
  extra?: Partial<{
    appliedVersion: number;
    desiredVersion: number;
    syncState: "SYNCED" | "OUT_OF_SYNC" | "NEVER_APPLIED";
    connectionHealth: "CONNECTED" | "STALE" | "DISABLED";
    lastExecution: "SUCCESS" | "FAILED" | "PARTIAL" | "NO_CHANGE";
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
    connectionHealth: extra?.connectionHealth ?? "STALE",
    lastExecution: extra?.lastExecution,
  });
}

async function addLog(
  h: ReturnType<typeof createHarness>,
  integrationId: string,
  targetId: string,
  opts?: Partial<{
    desiredVersion: number;
    result: "SUCCESS" | "FAILED" | "PARTIAL" | "NO_CHANGE";
    errorCode: string;
    errorMessage: string;
    createdAt: Date;
    idempotencyKey: string;
    requestId: string;
    reportedAppliedVersion: number;
  }>
) {
  return h.repos.scriptSyncLogs.create({
    id: randomUUID(),
    tenantId: TenantA.id,
    integrationId,
    targetId,
    desiredVersion: opts?.desiredVersion ?? 1,
    reportedAppliedVersion: opts?.reportedAppliedVersion,
    result: opts?.result ?? "SUCCESS",
    errorCode: opts?.errorCode,
    errorMessage: opts?.errorMessage,
    requestId: opts?.requestId,
    idempotencyScope: "SCRIPT_SYNC_RESULT",
    idempotencyKey: opts?.idempotencyKey ?? randomUUID(),
    createdAt: opts?.createdAt,
  });
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

function assertNoSecrets(body: unknown) {
  const s = JSON.stringify(body);
  expect(s).not.toContain("tokenHash");
  expect(s).not.toContain("tokenPrefix");
  expect(s).not.toContain("tokenKeyId");
  expect(s).not.toContain("pepper");
  expect(s).not.toContain(TEST_INTEGRATION_TOKEN_PEPPER);
  expect(s).not.toContain("oauthCredentialRef");
  expect(s).not.toMatch(/"token"\s*:/);
  expect(s).not.toContain("Authorization");
  expect(s).not.toContain("Bearer alk_s_");
}

describe("Phase 8.4.7.1 Dashboard Read API", () => {
  const apps: Array<{ close: () => Promise<void> }> = [];
  afterEach(async () => {
    while (apps.length) await apps.pop()?.close();
  });

  describe("A. Authentication", () => {
    it("1. valid token → 200 on integrations", async () => {
      const h = createHarness();
      const { token } = await createIntegration(h);
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/dashboard/integrations",
        headers: auth(token),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toHaveLength(1);
    });

    it("2. missing token → 401", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/dashboard/integrations",
      });
      expect(res.statusCode).toBe(401);
    });

    it("3. invalid token → 401", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/dashboard/integrations",
        headers: auth("alk_s_invalid"),
      });
      expect(res.statusCode).toBe(401);
    });

    it("4. disabled integration → 401", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, TenantA.id, TenantA.account, "Dis");
      await h.integrationService.disable(TenantA.id, integration.id);
      const app = await buildApp(h.services);
      apps.push(app);
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/api/v1/dashboard/summary",
            headers: auth(token),
          })
        ).statusCode
      ).toBe(401);
    });

    it("5. revoked integration → 401", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, TenantA.id, TenantA.account, "Rev");
      await h.integrationService.revoke(TenantA.id, integration.id);
      const app = await buildApp(h.services);
      apps.push(app);
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/api/v1/dashboard/summary",
            headers: auth(token),
          })
        ).statusCode
      ).toBe(401);
    });
  });

  describe("B. Tenant / Integration Isolation", () => {
    it("6. correct integration detail", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/dashboard/integrations/${integration.id}`,
        headers: auth(token),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().integration.integrationId).toBe(integration.id);
    });

    it("7. wrong integrationId → 403", async () => {
      const h = createHarness();
      const { token } = await createIntegration(h);
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/dashboard/integrations/${randomUUID()}`,
        headers: auth(token),
      });
      expect(res.statusCode).toBe(403);
    });

    it("8. tenant isolation — B cannot see A", async () => {
      const h = createHarness();
      const a = await createIntegration(h, TenantA.id, TenantA.account, "TA");
      const b = await createIntegration(h, TenantB.id, TenantB.account, "TB");
      const app = await buildApp(h.services);
      apps.push(app);
      const resB = await app.inject({
        method: "GET",
        url: `/api/v1/dashboard/integrations/${a.integration.id}`,
        headers: auth(b.token),
      });
      expect(resB.statusCode).toBe(403);
      const listB = await app.inject({
        method: "GET",
        url: "/api/v1/dashboard/integrations",
        headers: auth(b.token),
      });
      expect(listB.json().items[0].integrationId).toBe(b.integration.id);
      expect(listB.json().items[0].integrationId).not.toBe(a.integration.id);
    });

    it("9. googleAccount scoped to auth context", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/dashboard/integrations/${integration.id}`,
        headers: auth(token),
      });
      expect(res.json().integration.googleAccountId).toBe(TenantA.account);
    });

    it("10. cannot enumerate another integration via targets", async () => {
      const h = createHarness();
      const a = await createIntegration(h, TenantA.id, TenantA.account, "A2");
      const b = await createIntegration(h, TenantA.id, TenantA.account, "B2");
      await addTarget(h, a.integration.id, TenantA.adA1);
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/dashboard/integrations/${a.integration.id}/targets`,
        headers: auth(b.token),
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("C. Integration DTO", () => {
    it("11–15. status, counts, health, lastSeenAt, secret redaction", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const active = await h.repos.urlVersions.findActiveByEntity("AD", TenantA.adA1);
      await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: active?.version,
        syncState: "SYNCED",
        connectionHealth: "CONNECTED",
        lastExecution: "SUCCESS",
      });
      await addTarget(h, integration.id, TenantA.adA2, {
        appliedVersion: 1,
        syncState: "OUT_OF_SYNC",
        connectionHealth: "STALE",
        lastExecution: "FAILED",
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/dashboard/integrations",
        headers: auth(token),
      });
      const item = res.json().items[0];
      expect(item.status).toBe("ACTIVE");
      expect(item.targetCount).toBe(2);
      expect(item.syncStateSummary.SYNCED).toBeGreaterThanOrEqual(1);
      expect(item.connectionHealth).toBeDefined();
      expect(item.lastExecutionSummary.SUCCESS).toBe(1);
      expect(item.lastExecutionSummary.FAILED).toBe(1);
      expect(item).toHaveProperty("lastSeenAt");
      expect(item).toHaveProperty("createdAt");
      assertNoSecrets(res.json());
    });
  });

  describe("D. Target DTO", () => {
    it("16–23. AD fields + desired ACTIVE URL", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const active = await h.repos.urlVersions.findActiveByEntity("AD", TenantA.adA1);
      expect(active).toBeTruthy();
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: active!.version,
        syncState: "SYNCED",
        connectionHealth: "CONNECTED",
        lastExecution: "SUCCESS",
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/dashboard/integrations/${integration.id}/targets`,
        headers: auth(token),
      });
      expect(res.statusCode).toBe(200);
      const item = res.json().items.find((t: { targetId: string }) => t.targetId === target.id);
      expect(item.entityType).toBe("AD");
      expect(item.googleAdId).toBeTruthy();
      expect(item.campaignId).toBeTruthy();
      expect(item.adGroupId).toBeTruthy();
      expect(item.desiredVersion).toBe(active!.version);
      expect(item.appliedVersion).toBe(active!.version);
      expect(item.syncState).toBe("SYNCED");
      expect(item.desired.finalUrl).toBe(active!.finalUrl);
      expect(item.desired.trackingTemplate).toBe(active!.trackingTemplate ?? null);
      expect(item.desired.customParameters).toEqual(active!.customParameters ?? {});
      assertNoSecrets(res.json());
    });

    it("24. no ACTIVE URL → desiredVersion null", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      // Fixture adA2 only has DRAFT UrlVersion — no ACTIVE
      const active = await h.repos.urlVersions.findActiveByEntity("AD", TenantA.adA2);
      expect(active).toBeNull();
      await addTarget(h, integration.id, TenantA.adA2, {
        syncState: "NEVER_APPLIED",
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/dashboard/integrations/${integration.id}/targets`,
        headers: auth(token),
      });
      const item = res.json().items[0];
      expect(item.desiredVersion).toBeNull();
      expect(item.desired.finalUrl).toBeNull();
      expect(item.syncState).toBe("NEVER_APPLIED");
    });
  });

  describe("C2. Integration fields split", () => {
    it("11. status ACTIVE", async () => {
      const h = createHarness();
      const { token } = await createIntegration(h);
      const app = await buildApp(h.services);
      apps.push(app);
      const item = (
        await app.inject({
          method: "GET",
          url: "/api/v1/dashboard/integrations",
          headers: auth(token),
        })
      ).json().items[0];
      expect(item.status).toBe("ACTIVE");
    });

    it("12. target count", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      await addTarget(h, integration.id, TenantA.adA1);
      const app = await buildApp(h.services);
      apps.push(app);
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/api/v1/dashboard/integrations",
            headers: auth(token),
          })
        ).json().items[0].targetCount
      ).toBe(1);
    });

    it("13. health summary present", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const app = await buildApp(h.services);
      apps.push(app);
      const detail = (
        await app.inject({
          method: "GET",
          url: `/api/v1/dashboard/integrations/${integration.id}`,
          headers: auth(token),
        })
      ).json();
      expect(detail.health).toHaveProperty("syncState");
      expect(detail.health).toHaveProperty("connectionHealth");
      expect(detail.health).toHaveProperty("lastExecution");
    });

    it("14. lastSeenAt field present", async () => {
      const h = createHarness();
      const { token } = await createIntegration(h);
      const app = await buildApp(h.services);
      apps.push(app);
      const item = (
        await app.inject({
          method: "GET",
          url: "/api/v1/dashboard/integrations",
          headers: auth(token),
        })
      ).json().items[0];
      expect(item).toHaveProperty("lastSeenAt");
    });

    it("15. secret redaction on detail", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/dashboard/integrations/${integration.id}`,
        headers: auth(token),
      });
      assertNoSecrets(res.json());
    });
  });

  describe("E2. Logs split", () => {
    it("25. pagination works", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1);
      for (let i = 0; i < 3; i++) {
        await addLog(h, integration.id, target.id, {
          idempotencyKey: `p-${i}`,
        });
      }
      const app = await buildApp(h.services);
      apps.push(app);
      const body = (
        await app.inject({
          method: "GET",
          url: `/api/v1/dashboard/integrations/${integration.id}/logs?page=1&pageSize=2`,
          headers: auth(token),
        })
      ).json();
      expect(body.items).toHaveLength(2);
      expect(body.hasNext).toBe(true);
    });

    it("26. page=0 rejected", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const app = await buildApp(h.services);
      apps.push(app);
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/v1/dashboard/integrations/${integration.id}/logs?page=0`,
            headers: auth(token),
          })
        ).statusCode
      ).toBe(400);
    });

    it("27. pageSize max 100", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const app = await buildApp(h.services);
      apps.push(app);
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/v1/dashboard/integrations/${integration.id}/logs?pageSize=101`,
            headers: auth(token),
          })
        ).statusCode
      ).toBe(400);
    });

    it("28. pageSize=0 rejected", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const app = await buildApp(h.services);
      apps.push(app);
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/v1/dashboard/integrations/${integration.id}/logs?pageSize=0`,
            headers: auth(token),
          })
        ).statusCode
      ).toBe(400);
    });

    it("30. hasNext false on last page", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1);
      await addLog(h, integration.id, target.id, { idempotencyKey: "hn1" });
      const app = await buildApp(h.services);
      apps.push(app);
      const body = (
        await app.inject({
          method: "GET",
          url: `/api/v1/dashboard/integrations/${integration.id}/logs?page=1&pageSize=20`,
          headers: auth(token),
        })
      ).json();
      expect(body.total).toBe(1);
      expect(body.hasNext).toBe(false);
    });

    it("29. total reflected", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1);
      await addLog(h, integration.id, target.id, { idempotencyKey: "t1" });
      await addLog(h, integration.id, target.id, { idempotencyKey: "t2" });
      const app = await buildApp(h.services);
      apps.push(app);
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/v1/dashboard/integrations/${integration.id}/logs`,
            headers: auth(token),
          })
        ).json().total
      ).toBe(2);
    });

    it("31. log DTO whitelist fields only", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1);
      await addLog(h, integration.id, target.id, {
        idempotencyKey: "wl",
        errorCode: "STALE_DESIRED",
        errorMessage: "conflict",
        requestId: "exec-1",
        reportedAppliedVersion: 2,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const log = (
        await app.inject({
          method: "GET",
          url: `/api/v1/dashboard/integrations/${integration.id}/logs`,
          headers: auth(token),
        })
      ).json().items[0];
      expect(Object.keys(log).sort()).toEqual(
        [
          "appliedVersionAfter",
          "appliedVersionBefore",
          "conflictCode",
          "createdAt",
          "desiredVersion",
          "executionId",
          "idempotencyKey",
          "logId",
          "message",
          "reportedVersion",
          "status",
          "targetId",
        ].sort()
      );
    });

    it("32. secret/raw payload redaction on logs", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1);
      await addLog(h, integration.id, target.id, { idempotencyKey: "sec" });
      const app = await buildApp(h.services);
      apps.push(app);
      assertNoSecrets(
        (
          await app.inject({
            method: "GET",
            url: `/api/v1/dashboard/integrations/${integration.id}/logs`,
            headers: auth(token),
          })
        ).json()
      );
    });
  });

  describe("Mutation safety split", () => {
    it("36. GET does not change appliedVersion", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 5,
        syncState: "OUT_OF_SYNC",
      });
      const app = await buildApp(h.services);
      apps.push(app);
      await app.inject({
        method: "GET",
        url: "/api/v1/dashboard/summary",
        headers: auth(token),
      });
      expect(
        (await h.repos.scriptSyncTargets.findById(target.id))?.appliedVersion
      ).toBe(5);
    });

    it("37. GET does not create SyncLog", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const before = await h.repos.scriptSyncLogs.findByIntegration(
        TenantA.id,
        integration.id
      );
      const app = await buildApp(h.services);
      apps.push(app);
      await app.inject({
        method: "GET",
        url: `/api/v1/dashboard/integrations/${integration.id}/logs`,
        headers: auth(token),
      });
      const after = await h.repos.scriptSyncLogs.findByIntegration(
        TenantA.id,
        integration.id
      );
      expect(after.total).toBe(before.total);
    });

    it("38. GET does not modify UrlVersion", async () => {
      const h = createHarness();
      const { token } = await createIntegration(h);
      const active = await h.repos.urlVersions.findActiveByEntity(
        "AD",
        TenantA.adA1
      );
      expect(active).toBeTruthy();
      const app = await buildApp(h.services);
      apps.push(app);
      await app.inject({
        method: "GET",
        url: "/api/v1/dashboard/integrations",
        headers: auth(token),
      });
      const after = await h.repos.urlVersions.findById(active!.id);
      expect(after?.status).toBe(active!.status);
      expect(after?.finalUrl).toBe(active!.finalUrl);
    });

    it("39. GET does not create SyncJob", async () => {
      const h = createHarness();
      const { token } = await createIntegration(h);
      const before = await h.repos.syncJobs.list({ tenantId: TenantA.id });
      const app = await buildApp(h.services);
      apps.push(app);
      await app.inject({
        method: "GET",
        url: "/api/v1/dashboard/summary",
        headers: auth(token),
      });
      const after = await h.repos.syncJobs.list({ tenantId: TenantA.id });
      expect(after.total).toBe(before.total);
    });

    it("40. GET does not modify UCR", async () => {
      const h = createHarness();
      const { token } = await createIntegration(h);
      const before = await h.repos.urlChangeRequests.list({
        tenantId: TenantA.id,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      await app.inject({
        method: "GET",
        url: "/api/v1/dashboard/summary",
        headers: auth(token),
      });
      const after = await h.repos.urlChangeRequests.list({
        tenantId: TenantA.id,
      });
      expect(after.total).toBe(before.total);
    });
  });

  describe("E. Logs", () => {
    it("25–32. pagination, validation, ordering, whitelist", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1);
      const t0 = new Date("2026-01-01T00:00:00.000Z");
      for (let i = 0; i < 5; i++) {
        await addLog(h, integration.id, target.id, {
          desiredVersion: i + 1,
          result: i % 2 === 0 ? "SUCCESS" : "FAILED",
          errorCode: i % 2 ? "STALE_DESIRED" : undefined,
          errorMessage: i % 2 ? "stale" : undefined,
          createdAt: new Date(t0.getTime() + i * 1000),
          idempotencyKey: `key-${i}`,
          requestId: `req-${i}`,
          reportedAppliedVersion: i + 1,
        });
      }
      const app = await buildApp(h.services);
      apps.push(app);
      const base = `/api/v1/dashboard/integrations/${integration.id}/logs`;

      const page1 = await app.inject({
        method: "GET",
        url: `${base}?page=1&pageSize=2`,
        headers: auth(token),
      });
      expect(page1.statusCode).toBe(200);
      const body = page1.json();
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(2);
      expect(body.total).toBe(5);
      expect(body.hasNext).toBe(true);
      expect(body.items).toHaveLength(2);
      expect(body.items[0].desiredVersion).toBeGreaterThan(
        body.items[1].desiredVersion
      );

      expect(
        (
          await app.inject({
            method: "GET",
            url: `${base}?page=0`,
            headers: auth(token),
          })
        ).statusCode
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: "GET",
            url: `${base}?pageSize=0`,
            headers: auth(token),
          })
        ).statusCode
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: "GET",
            url: `${base}?pageSize=101`,
            headers: auth(token),
          })
        ).statusCode
      ).toBe(400);

      const log = body.items[0];
      expect(log).toHaveProperty("logId");
      expect(log).toHaveProperty("status");
      expect(log).toHaveProperty("conflictCode");
      expect(log).toHaveProperty("idempotencyKey");
      expect(log).not.toHaveProperty("tokenHash");
      expect(log).not.toHaveProperty("idempotencyScope");
      assertNoSecrets(body);
    });

    it("42. deterministic ordering with duplicate timestamps", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1);
      const same = new Date("2026-06-01T12:00:00.000Z");
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const log = await addLog(h, integration.id, target.id, {
          createdAt: same,
          idempotencyKey: `dup-${i}`,
          desiredVersion: 1,
        });
        ids.push(log.id);
      }
      const app = await buildApp(h.services);
      apps.push(app);
      const a = (
        await app.inject({
          method: "GET",
          url: `/api/v1/dashboard/integrations/${integration.id}/logs?pageSize=10`,
          headers: auth(token),
        })
      ).json().items.map((x: { logId: string }) => x.logId);
      const b = (
        await app.inject({
          method: "GET",
          url: `/api/v1/dashboard/integrations/${integration.id}/logs?pageSize=10`,
          headers: auth(token),
        })
      ).json().items.map((x: { logId: string }) => x.logId);
      expect(a).toEqual(b);
      expect([...a].sort().reverse()).toEqual(
        [...ids].sort().reverse()
      );
    });
  });

  describe("F. Summary", () => {
    it("33–35. totals, health, recent logs max 10", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const active = await h.repos.urlVersions.findActiveByEntity("AD", TenantA.adA1);
      const t1 = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: active?.version,
        syncState: "SYNCED",
        connectionHealth: "CONNECTED",
        lastExecution: "SUCCESS",
      });
      await addTarget(h, integration.id, TenantA.adA2, {
        appliedVersion: 1,
        syncState: "OUT_OF_SYNC",
        connectionHealth: "STALE",
        lastExecution: "FAILED",
      });
      for (let i = 0; i < 12; i++) {
        await addLog(h, integration.id, t1.id, {
          idempotencyKey: `sum-${i}`,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
        });
      }
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/dashboard/summary",
        headers: auth(token),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.targets.total).toBe(2);
      expect(body.health.connection).toBeDefined();
      expect(body.recentLogs.length).toBeLessThanOrEqual(10);
      assertNoSecrets(body);
    });

    it("44–45. empty integration / empty logs", async () => {
      const h = createHarness();
      const { token } = await createIntegration(h, TenantA.id, TenantA.account, "Empty");
      const app = await buildApp(h.services);
      apps.push(app);
      const summary = (
        await app.inject({
          method: "GET",
          url: "/api/v1/dashboard/summary",
          headers: auth(token),
        })
      ).json();
      expect(summary.targets.total).toBe(0);
      expect(summary.recentLogs).toEqual([]);
      const list = (
        await app.inject({
          method: "GET",
          url: "/api/v1/dashboard/integrations",
          headers: auth(token),
        })
      ).json();
      expect(list.items[0].targetCount).toBe(0);
    });
  });

  describe("Mutation safety", () => {
    it("36–40. GET does not mutate business state", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const active = await h.repos.urlVersions.findActiveByEntity("AD", TenantA.adA1);
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: active?.version ?? 1,
        syncState: "SYNCED",
        connectionHealth: "CONNECTED",
      });
      const beforeTarget = await h.repos.scriptSyncTargets.findById(target.id);
      const beforeLogs = await h.repos.scriptSyncLogs.findByIntegration(
        TenantA.id,
        integration.id
      );
      const beforeJobs = await h.repos.syncJobs.list({ tenantId: TenantA.id });
      const beforeUcr = await h.repos.urlChangeRequests.list({
        tenantId: TenantA.id,
      });
      const beforeVersion = active
        ? await h.repos.urlVersions.findById(active.id)
        : null;

      const app = await buildApp(h.services);
      apps.push(app);
      const urls = [
        "/api/v1/dashboard/integrations",
        `/api/v1/dashboard/integrations/${integration.id}`,
        `/api/v1/dashboard/integrations/${integration.id}/targets`,
        `/api/v1/dashboard/integrations/${integration.id}/logs`,
        "/api/v1/dashboard/summary",
      ];
      for (const url of urls) {
        expect(
          (await app.inject({ method: "GET", url, headers: auth(token) }))
            .statusCode
        ).toBe(200);
      }

      const afterTarget = await h.repos.scriptSyncTargets.findById(target.id);
      const afterLogs = await h.repos.scriptSyncLogs.findByIntegration(
        TenantA.id,
        integration.id
      );
      const afterJobs = await h.repos.syncJobs.list({ tenantId: TenantA.id });
      const afterUcr = await h.repos.urlChangeRequests.list({
        tenantId: TenantA.id,
      });
      expect(afterTarget?.appliedVersion).toBe(beforeTarget?.appliedVersion);
      expect(afterLogs.total).toBe(beforeLogs.total);
      expect(afterJobs.total).toBe(beforeJobs.total);
      expect(afterUcr.total).toBe(beforeUcr.total);
      if (beforeVersion) {
        const afterVersion = await h.repos.urlVersions.findById(beforeVersion.id);
        expect(afterVersion?.status).toBe(beforeVersion.status);
        expect(afterVersion?.version).toBe(beforeVersion.version);
        expect(afterVersion?.finalUrl).toBe(beforeVersion.finalUrl);
      }
    });
  });
});
