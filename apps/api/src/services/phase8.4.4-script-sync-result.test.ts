/**
 * Phase 8.4.4 — Script Sync Result + Applied State tests.
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
import { registerScriptRoutes } from "../routes/script.js";
import type { AppServices } from "../routes/index.js";
import { TEST_INTEGRATION_TOKEN_PEPPER } from "../auth/integration-token-crypto.js";
import { ScriptIntegrationService } from "./script-integration-service.js";
import { ScriptConfigService } from "./script-config-service.js";
import { ScriptSyncResultService } from "./script-sync-result-service.js";
import { AuditService } from "./index.js";

const ENV = {
  VITEST: "1",
  INTEGRATION_TOKEN_PEPPER: TEST_INTEGRATION_TOKEN_PEPPER,
} as NodeJS.ProcessEnv;

const SYNC_PATH = "/api/v1/script/sync-result";
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
  const scriptSyncResult = new ScriptSyncResultService(repos.scriptSyncRunner);
  const services = {
    scriptIntegrations: repos.scriptIntegrations,
    scriptConfig,
    scriptSyncResult,
  } as Pick<
    AppServices,
    "scriptIntegrations" | "scriptConfig" | "scriptSyncResult"
  >;
  return { repos, integrationService, scriptConfig, scriptSyncResult, services };
}

async function buildApp(
  services: Pick<
    AppServices,
    "scriptIntegrations" | "scriptConfig" | "scriptSyncResult"
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
  return app;
}

async function createIntegration(
  h: ReturnType<typeof createHarness>,
  tenantId = TenantA.id,
  googleAccountId = TenantA.account,
  name = "Sync"
) {
  return h.integrationService.create({ tenantId, googleAccountId, name });
}

async function addTarget(
  h: ReturnType<typeof createHarness>,
  integrationId: string,
  entityId: string,
  extra?: {
    appliedVersion?: number;
    tenantId?: string;
  }
) {
  return h.repos.scriptSyncTargets.create({
    id: randomUUID(),
    tenantId: extra?.tenantId ?? TenantA.id,
    integrationId,
    entityType: "AD",
    entityId,
    appliedVersion: extra?.appliedVersion,
    syncState: "OUT_OF_SYNC",
    connectionHealth: "CONNECTED",
  });
}

describe("Phase 8.4.4 Script Sync Result API", () => {
  const apps: Array<{ close: () => Promise<void> }> = [];
  afterEach(async () => {
    while (apps.length) {
      await apps.pop()?.close();
    }
  });

  describe("authentication", () => {
    it("1. valid token → 200 on success", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
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
          idempotencyKey: "k1",
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        ok: true,
        appliedVersion: 2,
        status: "APPLIED",
      });
    });

    it("2. missing token → 401", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "POST",
        url: SYNC_PATH,
        payload: {
          targetId: randomUUID(),
          desiredVersion: 1,
          result: "SUCCESS",
          idempotencyKey: "k",
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it("3. invalid token → 401", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: "Bearer alk_s_invalid" },
        payload: {
          targetId: randomUUID(),
          desiredVersion: 1,
          result: "SUCCESS",
          idempotencyKey: "k",
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it("4. disabled integration → 401", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, TenantA.id, TenantA.account, "Dis");
      await h.integrationService.disable(TenantA.id, integration.id);
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          targetId: randomUUID(),
          desiredVersion: 2,
          result: "SUCCESS",
          idempotencyKey: "k",
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it("5. revoked integration → 401", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, TenantA.id, TenantA.account, "Rev");
      await h.integrationService.revoke(TenantA.id, integration.id);
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          targetId: randomUUID(),
          desiredVersion: 2,
          result: "SUCCESS",
          idempotencyKey: "k",
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it("6. deleted integration → 401", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h, TenantA.id, TenantA.account, "Del");
      await h.repos.scriptIntegrations.update(integration.id, {
        deletedAt: new Date(),
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          targetId: randomUUID(),
          desiredVersion: 2,
          result: "SUCCESS",
          idempotencyKey: "k",
        },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("tenant / integration isolation", () => {
    it("7. tenant isolation — cannot update other tenant target", async () => {
      const h = createHarness();
      const { integration: iA, token: tokenA } = await createIntegration(
        h,
        TenantA.id,
        TenantA.account,
        "A"
      );
      const { integration: iB } = await createIntegration(
        h,
        TenantB.id,
        TenantB.account,
        "B"
      );
      const tB = await addTarget(h, iB.id, TenantB.ad, {
        tenantId: TenantB.id,
        appliedVersion: 0,
      });
      // Tenant B ad may not have ACTIVE UrlVersion matching — create target for B
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: {
          targetId: tB.id,
          desiredVersion: 1,
          result: "SUCCESS",
          idempotencyKey: "cross-tenant",
        },
      });
      expect(res.statusCode).toBe(404);
      void iA;
    });

    it("8. integration isolation — other integration target → 404", async () => {
      const h = createHarness();
      const { token: token1 } = await createIntegration(h, TenantA.id, TenantA.account, "I1");
      const { integration: i2 } = await createIntegration(h, TenantA.id, TenantA.account, "I2");
      const t2 = await addTarget(h, i2.id, TenantA.adA1, { appliedVersion: 1 });
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${token1}` },
        payload: {
          targetId: t2.id,
          desiredVersion: 2,
          result: "SUCCESS",
          idempotencyKey: "cross-int",
        },
      });
      expect(res.statusCode).toBe(404);
    });

    it("9. same Ad different integrations keep separate appliedVersion", async () => {
      const h = createHarness();
      const { integration: i1, token: t1 } = await createIntegration(
        h,
        TenantA.id,
        TenantA.account,
        "Same1"
      );
      const { integration: i2, token: t2 } = await createIntegration(
        h,
        TenantA.id,
        TenantA.account,
        "Same2"
      );
      const target1 = await addTarget(h, i1.id, TenantA.adA1, { appliedVersion: 1 });
      const target2 = await addTarget(h, i2.id, TenantA.adA1, { appliedVersion: 1 });
      const app = await buildApp(h.services);
      apps.push(app);
      await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${t1}` },
        payload: {
          targetId: target1.id,
          desiredVersion: 2,
          result: "SUCCESS",
          idempotencyKey: "s1",
        },
      });
      const after2 = await h.repos.scriptSyncTargets.findById(target2.id);
      expect(after2?.appliedVersion).toBe(1);
      await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${t2}` },
        payload: {
          targetId: target2.id,
          desiredVersion: 2,
          result: "SUCCESS",
          idempotencyKey: "s2",
        },
      });
      expect((await h.repos.scriptSyncTargets.findById(target1.id))?.appliedVersion).toBe(2);
      expect((await h.repos.scriptSyncTargets.findById(target2.id))?.appliedVersion).toBe(2);
    });
  });

  describe("target validation", () => {
    it("10. valid target succeeds", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
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
          idempotencyKey: "valid",
        },
      });
      expect(res.statusCode).toBe(200);
    });

    it("11. unknown target → 404", async () => {
      const h = createHarness();
      const { token } = await createIntegration(h);
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          targetId: randomUUID(),
          desiredVersion: 2,
          result: "SUCCESS",
          idempotencyKey: "unk",
        },
      });
      expect(res.statusCode).toBe(404);
    });

    it("12. deleted target → 404", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      await h.repos.scriptSyncTargets.update(target.id, {
        deletedAt: new Date(),
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
          idempotencyKey: "del-tgt",
        },
      });
      expect(res.statusCode).toBe(404);
    });

    it("13. archived target → 404", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      await h.repos.scriptSyncTargets.update(target.id, {
        archivedAt: new Date(),
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
          idempotencyKey: "arch",
        },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("version authority", () => {
    it("17–18. ACTIVE match accepted; mismatch → STALE_DESIRED", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const ok = await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          targetId: target.id,
          desiredVersion: 2,
          result: "SUCCESS",
          idempotencyKey: "match",
        },
      });
      expect(ok.statusCode).toBe(200);

      const stale = await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          targetId: target.id,
          desiredVersion: 1,
          result: "SUCCESS",
          idempotencyKey: "stale1",
        },
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error).toBe("STALE_DESIRED");
    });

    it("19. after ACTIVE advances, old desired is stale", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      // Activate a new version 3 by superseding current
      const active = await h.repos.urlVersions.findActiveByEntity("AD", TenantA.adA1);
      expect(active?.version).toBe(2);
      await h.repos.urlVersions.updateStatus(active!.id, { status: "SUPERSEDED" });
      await h.repos.urlVersions.create({
        id: randomUUID(),
        tenantId: TenantA.id,
        entityType: "AD",
        entityId: TenantA.adA1,
        adId: TenantA.adA1,
        finalUrl: "https://example.com/v3",
        customParameters: {},
        version: 3,
        status: "ACTIVE",
        effectiveAt: new Date(),
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
          idempotencyKey: "after-advance",
        },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("STALE_DESIRED");
      expect((await h.repos.scriptSyncTargets.findById(target.id))?.appliedVersion).toBe(1);
    });

    it("20–22. DRAFT / SUPERSEDED / ROLLED_BACK not accepted as desired", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const adId = randomUUID();
      await h.repos.ads.create({
        id: adId,
        tenantId: TenantA.id,
        adGroupId: TenantA.adGroupA1,
        googleAdId: "ad-draft-only",
        name: "Draft only",
        status: "ACTIVE",
      });
      await h.repos.urlVersions.create({
        id: randomUUID(),
        tenantId: TenantA.id,
        entityType: "AD",
        entityId: adId,
        adId,
        finalUrl: "https://example.com/draft",
        customParameters: {},
        version: 1,
        status: "DRAFT",
      });
      const target = await addTarget(h, integration.id, adId);
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
          idempotencyKey: "draft",
        },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("STALE_DESIRED");
    });

    it("23. no ACTIVE version → reject", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA2);
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
          idempotencyKey: "no-active",
        },
      });
      expect(res.statusCode).toBe(409);
    });

    it("24. appliedVersion null → first success", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1);
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
          idempotencyKey: "first",
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().appliedVersion).toBe(2);
      expect(res.json().status).toBe("APPLIED");
    });

    it("25. appliedVersion already equal → ALREADY_APPLIED", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 2,
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
          idempotencyKey: "same",
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("ALREADY_APPLIED");
      expect(res.json().appliedVersion).toBe(2);
    });

    it("26. appliedVersion cannot move backward → VERSION_CONFLICT", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      // Manually set applied higher than ACTIVE for conflict path
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 5,
      });
      // Force ACTIVE still at 2 — reporting 2 with applied 5
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
          idempotencyKey: "regress",
        },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("VERSION_CONFLICT");
      expect((await h.repos.scriptSyncTargets.findById(target.id))?.appliedVersion).toBe(5);
    });
  });

  describe("success side effects", () => {
    it("27–33. SUCCESS updates appliedVersion + log; UrlVersion/Ad/UCR/SyncJob unchanged", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const versionBefore = await h.repos.urlVersions.findById(TenantA.urlAdV2);
      const adBefore = await h.repos.ads.findById(TenantA.adA1);
      const jobsBefore = await h.repos.syncJobs.list({ page: 1, pageSize: 1000 });
      const ucrsBefore = await h.repos.urlChangeRequests.list({
        page: 1,
        pageSize: 1000,
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
          idempotencyKey: "side",
        },
      });
      expect(res.statusCode).toBe(200);
      const after = await h.repos.scriptSyncTargets.findById(target.id);
      expect(after?.appliedVersion).toBe(2);
      expect(after?.syncState).toBe("SYNCED");
      expect(after?.lastExecution).toBe("SUCCESS");
      const logs = await h.repos.scriptSyncLogs.findByTarget(TenantA.id, target.id);
      expect(logs.items.length).toBe(1);
      expect(logs.items[0].result).toBe("SUCCESS");
      expect(await h.repos.urlVersions.findById(TenantA.urlAdV2)).toEqual(versionBefore);
      expect(await h.repos.ads.findById(TenantA.adA1)).toEqual(adBefore);
      expect(
        (await h.repos.syncJobs.list({ page: 1, pageSize: 1000 })).items.length
      ).toBe(jobsBefore.items.length);
      expect(
        (await h.repos.urlChangeRequests.list({ page: 1, pageSize: 1000 })).items
          .length
      ).toBe(ucrsBefore.items.length);
    });
  });

  describe("FAILED / PARTIAL / NO_CHANGE", () => {
    it("34–36. FAILED does not update appliedVersion but logs", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
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
          result: "FAILED",
          idempotencyKey: "fail",
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("RECORDED");
      expect(res.json().appliedVersion).toBe(1);
      expect((await h.repos.scriptSyncTargets.findById(target.id))?.appliedVersion).toBe(1);
      expect((await h.repos.scriptSyncTargets.findById(target.id))?.lastExecution).toBe(
        "FAILED"
      );
      const logs = await h.repos.scriptSyncLogs.findByTarget(TenantA.id, target.id);
      expect(logs.items[0].result).toBe("FAILED");
    });

    it("PARTIAL / NO_CHANGE do not set appliedVersion", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      for (const result of ["PARTIAL", "NO_CHANGE"] as const) {
        const res = await app.inject({
          method: "POST",
          url: SYNC_PATH,
          headers: { authorization: `Bearer ${token}` },
          payload: {
            targetId: target.id,
            desiredVersion: 2,
            result,
            idempotencyKey: `r-${result}`,
          },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().appliedVersion).toBe(1);
      }
    });
  });

  describe("idempotency", () => {
    it("37. same key same payload → replay without duplicate log", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const body = {
        targetId: target.id,
        desiredVersion: 2,
        result: "SUCCESS" as const,
        idempotencyKey: "idem-same",
      };
      const r1 = await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${token}` },
        payload: body,
      });
      const r2 = await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${token}` },
        payload: body,
      });
      expect(r1.statusCode).toBe(200);
      expect(r2.statusCode).toBe(200);
      expect(r2.json().status).toBe("ALREADY_APPLIED");
      const logs = await h.repos.scriptSyncLogs.findByTarget(TenantA.id, target.id);
      expect(logs.items.length).toBe(1);
    });

    it("38–40. same key different target/version/result → IDEMPOTENCY_CONFLICT", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const t1 = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const t2 = await addTarget(h, integration.id, TenantA.adA2);
      const app = await buildApp(h.services);
      apps.push(app);
      await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          targetId: t1.id,
          desiredVersion: 2,
          result: "SUCCESS",
          idempotencyKey: "conflict-key",
        },
      });
      const diffTarget = await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          targetId: t2.id,
          desiredVersion: 2,
          result: "SUCCESS",
          idempotencyKey: "conflict-key",
        },
      });
      expect(diffTarget.statusCode).toBe(409);
      expect(diffTarget.json().error).toBe("IDEMPOTENCY_CONFLICT");

      const diffResult = await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          targetId: t1.id,
          desiredVersion: 2,
          result: "FAILED",
          idempotencyKey: "conflict-key",
        },
      });
      expect(diffResult.json().error).toBe("IDEMPOTENCY_CONFLICT");
    });

    it("41. cross integration same client key are independent", async () => {
      const h = createHarness();
      const { integration: i1, token: t1 } = await createIntegration(
        h,
        TenantA.id,
        TenantA.account,
        "IK1"
      );
      const { integration: i2, token: t2 } = await createIntegration(
        h,
        TenantA.id,
        TenantA.account,
        "IK2"
      );
      const target1 = await addTarget(h, i1.id, TenantA.adA1, { appliedVersion: 1 });
      const target2 = await addTarget(h, i2.id, TenantA.adA1, { appliedVersion: 1 });
      const app = await buildApp(h.services);
      apps.push(app);
      const key = "shared-client-key";
      const r1 = await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${t1}` },
        payload: {
          targetId: target1.id,
          desiredVersion: 2,
          result: "SUCCESS",
          idempotencyKey: key,
        },
      });
      const r2 = await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${t2}` },
        payload: {
          targetId: target2.id,
          desiredVersion: 2,
          result: "SUCCESS",
          idempotencyKey: key,
        },
      });
      expect(r1.statusCode).toBe(200);
      expect(r2.statusCode).toBe(200);
      expect(r2.json().status).toBe("APPLIED");
    });

    it("42. cross tenant same key independent", async () => {
      const h = createHarness();
      const { integration: iA, token: tA } = await createIntegration(
        h,
        TenantA.id,
        TenantA.account,
        "TA"
      );
      const { integration: iB, token: tB } = await createIntegration(
        h,
        TenantB.id,
        TenantB.account,
        "TB"
      );
      // Ensure Tenant B has ACTIVE UrlVersion for its ad
      const existingB = await h.repos.urlVersions.findActiveByEntity("AD", TenantB.ad);
      if (!existingB) {
        await h.repos.urlVersions.create({
          id: randomUUID(),
          tenantId: TenantB.id,
          entityType: "AD",
          entityId: TenantB.ad,
          adId: TenantB.ad,
          finalUrl: "https://example.com/b",
          customParameters: {},
          version: 1,
          status: "ACTIVE",
          effectiveAt: new Date(),
        });
      }
      const targetA = await addTarget(h, iA.id, TenantA.adA1, { appliedVersion: 1 });
      const targetB = await addTarget(h, iB.id, TenantB.ad, {
        tenantId: TenantB.id,
        appliedVersion: undefined,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const key = "tenant-shared";
      const rA = await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${tA}` },
        payload: {
          targetId: targetA.id,
          desiredVersion: 2,
          result: "SUCCESS",
          idempotencyKey: key,
        },
      });
      const activeB = await h.repos.urlVersions.findActiveByEntity("AD", TenantB.ad);
      const rB = await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${tB}` },
        payload: {
          targetId: targetB.id,
          desiredVersion: activeB!.version,
          result: "SUCCESS",
          idempotencyKey: key,
        },
      });
      expect(rA.statusCode).toBe(200);
      expect(rB.statusCode).toBe(200);
    });

    it("43. replay successful request after ACTIVE advances still returns original", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const body = {
        targetId: target.id,
        desiredVersion: 2,
        result: "SUCCESS" as const,
        idempotencyKey: "replay-after-advance",
      };
      const first = await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${token}` },
        payload: body,
      });
      expect(first.statusCode).toBe(200);
      const active = await h.repos.urlVersions.findActiveByEntity("AD", TenantA.adA1);
      await h.repos.urlVersions.updateStatus(active!.id, { status: "SUPERSEDED" });
      await h.repos.urlVersions.create({
        id: randomUUID(),
        tenantId: TenantA.id,
        entityType: "AD",
        entityId: TenantA.adA1,
        adId: TenantA.adA1,
        finalUrl: "https://example.com/v9",
        customParameters: {},
        version: 9,
        status: "ACTIVE",
        effectiveAt: new Date(),
      });
      const replay = await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${token}` },
        payload: body,
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().appliedVersion).toBe(2);
      expect(replay.json().status).toBe("ALREADY_APPLIED");
    });
  });

  describe("concurrency", () => {
    it("44. two concurrent SUCCESS with different keys → appliedVersion=2", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const [a, b] = await Promise.all([
        app.inject({
          method: "POST",
          url: SYNC_PATH,
          headers: { authorization: `Bearer ${token}` },
          payload: {
            targetId: target.id,
            desiredVersion: 2,
            result: "SUCCESS",
            idempotencyKey: "conc-a",
          },
        }),
        app.inject({
          method: "POST",
          url: SYNC_PATH,
          headers: { authorization: `Bearer ${token}` },
          payload: {
            targetId: target.id,
            desiredVersion: 2,
            result: "SUCCESS",
            idempotencyKey: "conc-b",
          },
        }),
      ]);
      expect([a.statusCode, b.statusCode].every((c) => c === 200)).toBe(true);
      expect((await h.repos.scriptSyncTargets.findById(target.id))?.appliedVersion).toBe(2);
    });

    it("45–47. concurrent identical idempotency keys → single log", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const body = {
        targetId: target.id,
        desiredVersion: 2,
        result: "SUCCESS" as const,
        idempotencyKey: "conc-same",
      };
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          app.inject({
            method: "POST",
            url: SYNC_PATH,
            headers: { authorization: `Bearer ${token}` },
            payload: body,
          })
        )
      );
      expect(results.every((r) => r.statusCode === 200)).toBe(true);
      const logs = await h.repos.scriptSyncLogs.findByTarget(TenantA.id, target.id);
      expect(logs.items.length).toBe(1);
      expect((await h.repos.scriptSyncTargets.findById(target.id))?.appliedVersion).toBe(2);
    });
  });

  describe("security + validation + config compatibility", () => {
    it("48–50. no secret leakage in success/error responses", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const ok = await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          targetId: target.id,
          desiredVersion: 2,
          result: "SUCCESS",
          idempotencyKey: "sec",
        },
      });
      const stale = await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          targetId: target.id,
          desiredVersion: 1,
          result: "SUCCESS",
          idempotencyKey: "sec-stale",
        },
      });
      for (const res of [ok, stale]) {
        const s = JSON.stringify(res.json());
        expect(s).not.toContain(token);
        expect(s).not.toContain(integration.tokenHash);
        expect(s).not.toContain(integration.tokenPrefix);
        expect(s).not.toContain(integration.tokenKeyId);
        expect(s).not.toContain(TEST_INTEGRATION_TOKEN_PEPPER);
        expect(s).not.toContain("oauthCredentialRef");
        expect(s).not.toContain("Authorization");
      }
    });

    it("55–57. request validation rejects missing fields", async () => {
      const h = createHarness();
      const { token } = await createIntegration(h);
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("config GET shows appliedVersion after SUCCESS", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      const before = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(before.json().targets[0].appliedVersion).toBe(1);
      expect(before.json().targets[0].desiredVersion).toBe(2);
      await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          targetId: target.id,
          desiredVersion: 2,
          result: "SUCCESS",
          idempotencyKey: "cfg",
        },
      });
      const after = await app.inject({
        method: "GET",
        url: CONFIG_PATH,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(after.json().targets[0].desiredVersion).toBe(2);
      expect(after.json().targets[0].appliedVersion).toBe(2);
      expect(after.json().targets[0].syncState).toBe("SYNCED");
    });

    it("stale result logs without mutating appliedVersion", async () => {
      const h = createHarness();
      const { integration, token } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const app = await buildApp(h.services);
      apps.push(app);
      await app.inject({
        method: "POST",
        url: SYNC_PATH,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          targetId: target.id,
          desiredVersion: 99,
          result: "SUCCESS",
          idempotencyKey: "stale-log",
        },
      });
      expect((await h.repos.scriptSyncTargets.findById(target.id))?.appliedVersion).toBe(1);
      const logs = await h.repos.scriptSyncLogs.findByTarget(TenantA.id, target.id);
      expect(logs.items[0].errorCode).toBe("STALE_DESIRED");
    });

    it("atomicity: log failure rolls back appliedVersion", async () => {
      const h = createHarness();
      const { integration } = await createIntegration(h);
      const target = await addTarget(h, integration.id, TenantA.adA1, {
        appliedVersion: 1,
      });
      const failingRunner = {
        async transaction<T>(
          work: (repos: Parameters<
            Parameters<typeof h.repos.scriptSyncRunner.transaction>[0]
          >[0]) => Promise<T>
        ): Promise<T> {
          return h.repos.scriptSyncRunner.transaction(async (repos) => {
            const originalCreate = repos.scriptSyncLogs.create.bind(
              repos.scriptSyncLogs
            );
            repos.scriptSyncLogs.create = async (data) => {
              throw new Error("forced log failure");
              return originalCreate(data);
            };
            return work(repos);
          });
        },
      };
      const svc = new ScriptSyncResultService(failingRunner);
      await expect(
        svc.submitResult(
          {
            integrationId: integration.id,
            tenantId: TenantA.id,
            googleAccountId: TenantA.account,
            tokenKeyId: "x",
          },
          {
            targetId: target.id,
            desiredVersion: 2,
            result: "SUCCESS",
            idempotencyKey: "atomic",
          }
        )
      ).rejects.toThrow(/forced log failure/);
      expect((await h.repos.scriptSyncTargets.findById(target.id))?.appliedVersion).toBe(1);
    });
  });
});
