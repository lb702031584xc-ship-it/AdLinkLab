/**
 * Phase 8.4.3 — Script Config API (READ ONLY).
 */
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createSeededMemoryRepositories, TenantA, TenantB } from "@adlinklab/database";
import { AppError } from "@adlinklab/shared";
import { registerScriptRoutes } from "../routes/script.js";
import type { AppServices } from "../routes/index.js";
import {
  hashIntegrationToken,
  TEST_INTEGRATION_TOKEN_PEPPER,
} from "../auth/integration-token-crypto.js";
import { ScriptIntegrationService } from "./script-integration-service.js";
import { ScriptConfigService } from "./script-config-service.js";
import { AuditService } from "./index.js";

const ENV = {
  VITEST: "1",
  INTEGRATION_TOKEN_PEPPER: TEST_INTEGRATION_TOKEN_PEPPER,
} as NodeJS.ProcessEnv;

const CONFIG_PATH = "/api/v1/script/config";

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
  const services: Pick<
    AppServices,
    "scriptIntegrations" | "scriptConfig"
  > = {
    scriptIntegrations: repos.scriptIntegrations,
    scriptConfig,
  };
  return { repos, audit, integrationService, scriptConfig, services };
}

async function buildConfigApp(
  services: Pick<AppServices, "scriptIntegrations" | "scriptConfig">
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
  return app;
}

async function createIntegrationWithToken(
  harness: ReturnType<typeof createHarness>,
  tenantId: string,
  googleAccountId: string,
  name: string
) {
  return harness.integrationService.create({ tenantId, googleAccountId, name });
}

async function addTarget(
  harness: ReturnType<typeof createHarness>,
  integrationId: string,
  tenantId: string,
  entityId: string,
  extra?: Partial<{
    appliedVersion: number;
    desiredVersion: number;
    syncState: string;
    connectionHealth: string;
    lastExecution: string;
    googleAdId: string;
  }>
) {
  return harness.repos.scriptSyncTargets.create({
    id: randomUUID(),
    tenantId,
    integrationId,
    entityType: "AD",
    entityId,
    appliedVersion: extra?.appliedVersion,
    desiredVersion: extra?.desiredVersion,
    syncState: (extra?.syncState as "NEVER_APPLIED") ?? "NEVER_APPLIED",
    connectionHealth: (extra?.connectionHealth as "STALE") ?? "STALE",
    lastExecution: extra?.lastExecution as "SUCCESS" | undefined,
    googleAdId: extra?.googleAdId,
  });
}

describe("Phase 8.4.3 Script Config API", () => {
  const apps: Array<{ close: () => Promise<void> }> = [];
  afterEach(async () => {
    while (apps.length) {
      const a = apps.pop();
      await a?.close();
    }
  });

  describe("authentication", () => {
    it("1. valid token → 200", async () => {
      const h = createHarness();
      const { token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Valid"
      );
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        integration: { configGeneration: 0 },
        configGeneration: 0,
        targets: [],
      });
    });

    it("2. missing token → 401", async () => {
      const h = createHarness();
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({ method: "GET", url: CONFIG_PATH });
      expect(res.statusCode).toBe(401);
    });

    it("3. invalid token → 401", async () => {
      const h = createHarness();
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: "Bearer alk_s_totally_invalid" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("4. disabled integration → 401", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Disabled"
      );
      await h.integrationService.disable(TenantA.id, integration.id);
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(401);
    });

    it("5. revoked integration → 401", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Revoked"
      );
      await h.integrationService.revoke(TenantA.id, integration.id);
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(401);
    });

    it("6. deleted integration → 401", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Deleted"
      );
      await h.repos.scriptIntegrations.update(integration.id, {
        deletedAt: new Date(),
      });
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("claim conflicts", () => {
    it("9. client tenantId mismatch → 403", async () => {
      const h = createHarness();
      const { token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Tenant claim"
      );
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: `${CONFIG_PATH}?tenantId=${TenantB.id}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it("10. client integrationId mismatch → 403", async () => {
      const h = createHarness();
      const { token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Integration claim"
      );
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: `${CONFIG_PATH}?integrationId=${randomUUID()}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it("11. client googleAccountId mismatch → 403", async () => {
      const h = createHarness();
      const { token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Account claim"
      );
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: `${CONFIG_PATH}?googleAccountId=${TenantB.account}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("tenant and integration isolation", () => {
    it("7. Tenant A token returns only Tenant A targets", async () => {
      const h = createHarness();
      const { integration: iA, token: tokenA } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "A"
      );
      const { integration: iB } = await createIntegrationWithToken(
        h,
        TenantB.id,
        TenantB.account,
        "B"
      );
      await addTarget(h, iA.id, TenantA.id, TenantA.adA1);
      await addTarget(h, iB.id, TenantB.id, TenantB.ad);
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.targets).toHaveLength(1);
      expect(body.targets[0].entityId).toBe(TenantA.adA1);
    });

    it("8. Tenant A token cannot access Tenant B target via shared integration query", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Iso"
      );
      await addTarget(h, integration.id, TenantA.id, TenantA.adA1);
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      const ids = res.json().targets.map((t: { entityId: string }) => t.entityId);
      expect(ids).not.toContain(TenantB.ad);
    });

    it("15. target belonging to another integration is not returned", async () => {
      const h = createHarness();
      const { integration: i1, token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "I1"
      );
      const { integration: i2 } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "I2"
      );
      await addTarget(h, i1.id, TenantA.id, TenantA.adA1);
      await addTarget(h, i2.id, TenantA.id, TenantA.adA2);
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.json().targets).toHaveLength(1);
      expect(res.json().targets[0].entityId).toBe(TenantA.adA1);
    });

    it("16. target whose Ad is not visible to tenant is excluded from config", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Orphan target"
      );
      const adId = randomUUID();
      await h.repos.ads.create({
        id: adId,
        tenantId: TenantA.id,
        adGroupId: TenantA.adGroupA1,
        googleAdId: "ad-orphan-test",
        name: "Orphan Ad",
        status: "ACTIVE",
      });
      await h.repos.scriptSyncTargets.create({
        id: randomUUID(),
        tenantId: TenantA.id,
        integrationId: integration.id,
        entityType: "AD",
        entityId: adId,
        syncState: "NEVER_APPLIED",
        connectionHealth: "STALE",
      });
      await h.repos.ads.update(adId, { tenantId: TenantB.id });
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().targets).toHaveLength(0);
    });

    it("16b. repository blocks cross-tenant Ad at target create (8.4.1 guard)", async () => {
      const h = createHarness();
      const integration = await h.repos.scriptIntegrations.create({
        id: randomUUID(),
        tenantId: TenantA.id,
        googleAccountId: TenantA.account,
        name: "Cross tenant",
        status: "ACTIVE",
        tokenKeyId: "key_xtenant",
        tokenPrefix: "alk_s_xtenant",
        tokenHash: hashIntegrationToken("alk_s_xtenant", TEST_INTEGRATION_TOKEN_PEPPER),
        configGeneration: 0,
      });
      await expect(
        h.repos.scriptSyncTargets.create({
          id: randomUUID(),
          tenantId: TenantA.id,
          integrationId: integration.id,
          entityType: "AD",
          entityId: TenantB.ad,
          syncState: "NEVER_APPLIED",
          connectionHealth: "STALE",
        })
      ).rejects.toThrow(/Ad not found/);
    });
  });

  describe("targets and url versions", () => {
    it("12. integration with zero targets → 200 + []", async () => {
      const h = createHarness();
      const { token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Empty"
      );
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().targets).toEqual([]);
    });

    it("13. AD target with ACTIVE UrlVersion is returned", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Ad active"
      );
      await addTarget(h, integration.id, TenantA.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      const target = res.json().targets[0];
      expect(target.entityType).toBe("AD");
      expect(target.desiredVersion).toBe(2);
      expect(target.configurationState).toBe("CONFIGURED");
    });

    it("17. ACTIVE UrlVersion fields returned (finalUrl, trackingTemplate, customParameters)", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Fields"
      );
      await addTarget(h, integration.id, TenantA.id, TenantA.adA1);
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      const t = res.json().targets[0];
      expect(t.finalUrl).toBe("https://example.com/landing-v2");
      expect(t.trackingTemplate).toContain("tracker.example.com");
      expect(t.customParameters).toEqual({ _clickid: "v2" });
      expect(t.finalMobileUrl).toBe("https://m.example.com/landing-v2");
    });

    it("18. Ad without ACTIVE UrlVersion → desiredVersion null + NEVER_CONFIGURED", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "No active"
      );
      await addTarget(h, integration.id, TenantA.id, TenantA.adA2);
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      const t = res.json().targets[0];
      expect(t.desiredVersion).toBeNull();
      expect(t.configurationState).toBe("NEVER_CONFIGURED");
      expect(t.finalUrl).toBeNull();
    });

    it("19. SUPERSEDED UrlVersion is not returned as desired", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Superseded only"
      );
      const adId = randomUUID();
      await h.repos.ads.create({
        id: adId,
        tenantId: TenantA.id,
        adGroupId: TenantA.adGroupA1,
        googleAdId: "ad-superseded-only",
        name: "Superseded Ad",
        status: "ACTIVE",
      });
      await h.repos.urlVersions.create({
        id: randomUUID(),
        tenantId: TenantA.id,
        entityType: "AD",
        entityId: adId,
        adId,
        finalUrl: "https://example.com/old",
        customParameters: {},
        version: 1,
        status: "SUPERSEDED",
        effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      });
      await addTarget(h, integration.id, TenantA.id, adId);
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      const t = res.json().targets[0];
      expect(t.desiredVersion).toBeNull();
      expect(t.finalUrl).toBeNull();
    });

    it("20. DRAFT UrlVersion is not returned as desired", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Draft only"
      );
      await addTarget(h, integration.id, TenantA.id, TenantA.adA2);
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.json().targets[0].desiredVersion).toBeNull();
    });

    it("21. ROLLED_BACK UrlVersion is not returned as desired", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Rollback"
      );
      const adId = randomUUID();
      await h.repos.ads.create({
        id: adId,
        tenantId: TenantA.id,
        adGroupId: TenantA.adGroupA1,
        googleAdId: "ad-rolled-back",
        name: "Rollback Ad",
        status: "ACTIVE",
      });
      await h.repos.urlVersions.create({
        id: randomUUID(),
        tenantId: TenantA.id,
        entityType: "AD",
        entityId: adId,
        adId,
        finalUrl: "https://example.com/rolled",
        customParameters: {},
        version: 1,
        status: "ROLLED_BACK",
        effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      });
      await addTarget(h, integration.id, TenantA.id, adId);
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.json().targets[0].desiredVersion).toBeNull();
    });

    it("22. appliedVersion is returned from target", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Applied"
      );
      await addTarget(h, integration.id, TenantA.id, TenantA.adA1, {
        appliedVersion: 1,
        desiredVersion: 99,
      });
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      const t = res.json().targets[0];
      expect(t.appliedVersion).toBe(1);
      expect(t.desiredVersion).toBe(2);
    });

    it("34. effectiveAt returned from ACTIVE UrlVersion", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Effective"
      );
      await addTarget(h, integration.id, TenantA.id, TenantA.adA1);
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.json().targets[0].effectiveAt).toBe(
        "2026-01-01T01:00:00.000Z"
      );
    });

    it("33. configGeneration returned at integration and root", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Gen"
      );
      await h.repos.scriptIntegrations.update(integration.id, {
        configGeneration: 7,
      });
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      const body = res.json();
      expect(body.configGeneration).toBe(7);
      expect(body.integration.configGeneration).toBe(7);
    });
  });

  describe("Ad authority and Google IDs", () => {
    it("uses Ad googleAdId even when target cache differs", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Ad authority"
      );
      await addTarget(h, integration.id, TenantA.id, TenantA.adA1, {
        googleAdId: "stale-wrong-id",
      });
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.json().targets[0].googleAdId).toBe("ad-3001");
      expect(res.json().targets[0].adGroupId).toBe(TenantA.adGroupA1);
      expect(res.json().targets[0].campaignId).toBe(TenantA.campaignA);
    });
  });

  describe("two integrations same Ad", () => {
    it("39–40. appliedVersion is target-scoped per integration", async () => {
      const h = createHarness();
      const { integration: i1, token: t1 } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Same ad A"
      );
      const { integration: i2, token: t2 } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Same ad B"
      );
      await addTarget(h, i1.id, TenantA.id, TenantA.adA1, { appliedVersion: 1 });
      await addTarget(h, i2.id, TenantA.id, TenantA.adA1, { appliedVersion: 2 });
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const r1 = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${t1}` },
      });
      const r2 = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${t2}` },
      });
      expect(r1.json().targets[0].appliedVersion).toBe(1);
      expect(r2.json().targets[0].appliedVersion).toBe(2);
    });
  });

  describe("determinism and ordering", () => {
    it("32. targets sorted by targetId ascending", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Sort"
      );
      const id1 = "11111111-1111-4111-8111-111111111201";
      const id2 = "11111111-1111-4111-8111-111111111202";
      await h.repos.scriptSyncTargets.create({
        id: id2,
        tenantId: TenantA.id,
        integrationId: integration.id,
        entityType: "AD",
        entityId: TenantA.adA2,
        syncState: "NEVER_APPLIED",
        connectionHealth: "STALE",
      });
      await h.repos.scriptSyncTargets.create({
        id: id1,
        tenantId: TenantA.id,
        integrationId: integration.id,
        entityType: "AD",
        entityId: TenantA.adA1,
        syncState: "NEVER_APPLIED",
        connectionHealth: "STALE",
      });
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      const ids = res.json().targets.map((t: { targetId: string }) => t.targetId);
      expect(ids).toEqual([id1, id2]);
    });

    it("38. same DB state → equivalent response on consecutive GET", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Deterministic"
      );
      await addTarget(h, integration.id, TenantA.id, TenantA.adA1);
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const r1 = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      const r2 = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(r1.json()).toEqual(r2.json());
    });
  });

  describe("read-only guarantees", () => {
    it("23. GET config does not modify appliedVersion", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "RO applied"
      );
      const target = await addTarget(h, integration.id, TenantA.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const app = await buildConfigApp(h.services);
      apps.push(app);
      await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      const after = await h.repos.scriptSyncTargets.findById(target.id);
      expect(after?.appliedVersion).toBe(1);
    });

    it("24–28. GET config does not create SyncLog / SyncJob / UCR or mutate UrlVersion / Target", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "RO all"
      );
      const target = await addTarget(h, integration.id, TenantA.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const versionBefore = await h.repos.urlVersions.findById(TenantA.urlAdV2);
      const jobsBefore = await h.repos.syncJobs.list({ page: 1, pageSize: 1000 });
      const logsBefore = await h.repos.scriptSyncLogs.findByIntegration(
        TenantA.id,
        integration.id,
        { page: 1, pageSize: 1000 }
      );
      const ucrsBefore = await h.repos.urlChangeRequests.list({
        page: 1,
        pageSize: 1000,
      });
      const app = await buildConfigApp(h.services);
      apps.push(app);
      await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      const versionAfter = await h.repos.urlVersions.findById(TenantA.urlAdV2);
      const jobsAfter = await h.repos.syncJobs.list({ page: 1, pageSize: 1000 });
      const logsAfter = await h.repos.scriptSyncLogs.findByIntegration(
        TenantA.id,
        integration.id,
        { page: 1, pageSize: 1000 }
      );
      const ucrsAfter = await h.repos.urlChangeRequests.list({
        page: 1,
        pageSize: 1000,
      });
      const targetAfter = await h.repos.scriptSyncTargets.findById(target.id);
      expect(versionAfter).toEqual(versionBefore);
      expect(jobsAfter.items.length).toBe(jobsBefore.items.length);
      expect(logsAfter.items.length).toBe(logsBefore.items.length);
      expect(ucrsAfter.items.length).toBe(ucrsBefore.items.length);
      expect(targetAfter?.appliedVersion).toBe(1);
      expect(targetAfter?.desiredVersion).toBe(target.desiredVersion);
    });

    it("25. GET config does not increment configGeneration", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "RO gen"
      );
      await h.repos.scriptIntegrations.update(integration.id, {
        configGeneration: 3,
      });
      const app = await buildConfigApp(h.services);
      apps.push(app);
      await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      const after = await h.repos.scriptIntegrations.findById(integration.id);
      expect(after?.configGeneration).toBe(3);
    });
  });

  describe("response security", () => {
    it("29–31. response does not leak token / hash / prefix / keyId / pepper / oauth", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Secrets"
      );
      await addTarget(h, integration.id, TenantA.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const app = await buildConfigApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      const body = res.json();
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain(token);
      expect(serialized).not.toContain(integration.tokenHash);
      expect(serialized).not.toContain(integration.tokenPrefix);
      expect(serialized).not.toContain(integration.tokenKeyId);
      expect(serialized).not.toContain(TEST_INTEGRATION_TOKEN_PEPPER);
      expect(serialized).not.toContain("oauthCredentialRef");
      expect(body).not.toHaveProperty("token");
      expect(body).not.toHaveProperty("tokenHash");
      expect(body).not.toHaveProperty("Authorization");
    });
  });

  describe("ScriptConfigService unit", () => {
    it("returns derived syncState + connectionHealth/lastExecution from target", async () => {
      const h = createHarness();
      const { integration } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Health"
      );
      await addTarget(h, integration.id, TenantA.id, TenantA.adA1, {
        appliedVersion: 1,
        // Shadow persisted syncState must not override ACTIVE-derived state
        syncState: "SYNCED",
        connectionHealth: "CONNECTED",
        lastExecution: "SUCCESS",
      });
      const config = await h.scriptConfig.getConfig({
        integrationId: integration.id,
        tenantId: TenantA.id,
        googleAccountId: TenantA.account,
        tokenKeyId: "x",
      });
      // ACTIVE=2, applied=1 → OUT_OF_SYNC (derived), not target.syncState=SYNCED
      expect(config.targets[0].syncState).toBe("OUT_OF_SYNC");
      expect(config.targets[0].desiredVersion).toBe(2);
      expect(config.targets[0].connectionHealth).toBe("CONNECTED");
      expect(config.targets[0].lastExecution).toBe("SUCCESS");
    });

    it("excludes deleted targets", async () => {
      const h = createHarness();
      const { integration } = await createIntegrationWithToken(
        h,
        TenantA.id,
        TenantA.account,
        "Deleted tgt"
      );
      const t = await addTarget(h, integration.id, TenantA.id, TenantA.adA1);
      await h.repos.scriptSyncTargets.update(t.id, { deletedAt: new Date() });
      const config = await h.scriptConfig.getConfig({
        integrationId: integration.id,
        tenantId: TenantA.id,
        googleAccountId: TenantA.account,
        tokenKeyId: "x",
      });
      expect(config.targets).toHaveLength(0);
    });
  });
});
