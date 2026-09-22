/**
 * Phase 8.4.9 — Script Integration Admin API tests.
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
import { FIXTURE_API_KEYS } from "../auth/api-keys.js";
import { createAuthContext } from "../auth/tenant.js";
import { TEST_INTEGRATION_TOKEN_PEPPER } from "../auth/integration-token-crypto.js";
import { registerAdminScriptIntegrationRoutes } from "../routes/admin-script-integrations.js";
import { registerScriptRoutes } from "../routes/script.js";
import type { AppServices } from "../routes/index.js";
import { ScriptIntegrationService } from "./script-integration-service.js";
import { ScriptIntegrationAdminService } from "./script-integration-admin-service.js";
import { ScriptConfigService } from "./script-config-service.js";
import { ScriptSyncResultService } from "./script-sync-result-service.js";
import { ScriptGeneratorService } from "./script-generator-service.js";
import { AuditService } from "./index.js";

const ENV = {
  VITEST: "1",
  NODE_ENV: "test",
  AUTH_MODE: "api_key",
  INTEGRATION_TOKEN_PEPPER: TEST_INTEGRATION_TOKEN_PEPPER,
  SCRIPT_API_BASE_URL: "https://simulator.adlinklab.test",
} as NodeJS.ProcessEnv;

const ADMIN = "/api/v1/admin/script-integrations";
const KEY_A = FIXTURE_API_KEYS.tenantA.key;
const KEY_B = FIXTURE_API_KEYS.tenantB.key;

function createHarness() {
  const repos = createSeededMemoryRepositories();
  const audit = new AuditService(repos.auditLogs);
  const lifecycle = new ScriptIntegrationService(
    repos.scriptIntegrations,
    repos.googleAccounts,
    audit,
    ENV
  );
  const scriptGenerator = new ScriptGeneratorService(ENV);
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
    scriptGenerator,
    scriptIntegrationAdmin,
    audit,
  } as Pick<
    AppServices,
    | "scriptIntegrations"
    | "scriptConfig"
    | "scriptSyncResult"
    | "scriptGenerator"
    | "scriptIntegrationAdmin"
    | "audit"
  >;
  return { repos, audit, lifecycle, scriptIntegrationAdmin, services };
}

async function buildApp(services: ReturnType<typeof createHarness>["services"]) {
  const app = Fastify({ logger: false });
  const auth = createAuthContext(ENV);
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
        details: error.details,
      });
    }
    return reply.status(500).send({ error: "INTERNAL_ERROR", message: String(error) });
  });
  await registerAdminScriptIntegrationRoutes(app, services as AppServices, auth);
  await registerScriptRoutes(app, services as AppServices);
  return app;
}

function authHeaders(key: string) {
  return { "x-api-key": key };
}

describe("Phase 8.4.9 Script Integration Admin API", () => {
  const apps: Array<{ close: () => Promise<void> }> = [];
  afterEach(async () => {
    while (apps.length) await apps.pop()?.close();
  });

  describe("Integration Admin lifecycle", () => {
    it("1. create returns token once with prefix", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "POST",
        url: ADMIN,
        headers: authHeaders(KEY_A),
        payload: { name: "Admin Int", googleAccountId: TenantA.account },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        integrationId: string;
        token: string;
        tokenPrefix: string;
        status: string;
      };
      expect(body.token).toMatch(/^alk_s_/);
      expect(body.tokenPrefix).toBeTruthy();
      expect(body.status).toBe("ACTIVE");
      expect(body).not.toHaveProperty("tokenHash");
    });

    it("2. GET never returns token or tokenHash", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = await app.inject({
        method: "POST",
        url: ADMIN,
        headers: authHeaders(KEY_A),
        payload: { name: "G", googleAccountId: TenantA.account },
      });
      const id = created.json().integrationId as string;
      const get = await app.inject({
        method: "GET",
        url: `${ADMIN}/${id}`,
        headers: authHeaders(KEY_A),
      });
      expect(get.statusCode).toBe(200);
      const body = get.json();
      expect(body.token).toBeUndefined();
      expect(body.tokenHash).toBeUndefined();
      expect(body.tokenKeyId).toBeUndefined();
      expect(body.tokenPrefix).toBeTruthy();
    });

    it("3. list integrations for tenant", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      await app.inject({
        method: "POST",
        url: ADMIN,
        headers: authHeaders(KEY_A),
        payload: { name: "L1", googleAccountId: TenantA.account },
      });
      const list = await app.inject({
        method: "GET",
        url: ADMIN,
        headers: authHeaders(KEY_A),
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().items.length).toBeGreaterThanOrEqual(1);
      for (const item of list.json().items) {
        expect(item.token).toBeUndefined();
        expect(item.tokenHash).toBeUndefined();
      }
    });

    it("4. rotate invalidates old token; new token works on config", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "Rot", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string; token: string };
      const rotated = (
        await app.inject({
          method: "POST",
          url: `${ADMIN}/${created.integrationId}/rotate-token`,
          headers: authHeaders(KEY_A),
        })
      ).json() as { token: string };
      expect(rotated.token).not.toBe(created.token);

      const oldCfg = await app.inject({
        method: "GET",
        url: "/api/v1/script/config",
        headers: { authorization: `Bearer ${created.token}` },
      });
      expect(oldCfg.statusCode).toBe(401);

      const newCfg = await app.inject({
        method: "GET",
        url: "/api/v1/script/config",
        headers: { authorization: `Bearer ${rotated.token}` },
      });
      expect(newCfg.statusCode).toBe(200);
    });

    it("5. revoke → 401 on script config", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "Rev", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string; token: string };
      await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/revoke`,
        headers: authHeaders(KEY_A),
      });
      const cfg = await app.inject({
        method: "GET",
        url: "/api/v1/script/config",
        headers: { authorization: `Bearer ${created.token}` },
      });
      expect(cfg.statusCode).toBe(401);
    });

    it("6. disable → 401; enable restores", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "Dis", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string; token: string };
      await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/disable`,
        headers: authHeaders(KEY_A),
      });
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/api/v1/script/config",
            headers: { authorization: `Bearer ${created.token}` },
          })
        ).statusCode
      ).toBe(401);

      await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/enable`,
        headers: authHeaders(KEY_A),
      });
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/api/v1/script/config",
            headers: { authorization: `Bearer ${created.token}` },
          })
        ).statusCode
      ).toBe(200);
    });

    it("7. enable REVOKED rejected", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "RvEn", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string };
      await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/revoke`,
        headers: authHeaders(KEY_A),
      });
      const en = await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/enable`,
        headers: authHeaders(KEY_A),
      });
      expect(en.statusCode).toBe(400);
    });

    it("8. missing name rejected", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "POST",
        url: ADMIN,
        headers: authHeaders(KEY_A),
        payload: { name: "  ", googleAccountId: TenantA.account },
      });
      expect(res.statusCode).toBe(400);
    });

    it("9. missing api key → 401", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: ADMIN,
      });
      expect(res.statusCode).toBe(401);
    });

    it("10. create with wrong google account tenant rejected", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "POST",
        url: ADMIN,
        headers: authHeaders(KEY_A),
        payload: { name: "X", googleAccountId: TenantB.account },
      });
      expect([400, 403, 404]).toContain(res.statusCode);
    });

    it("11. rotate REVOKED rejected", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "RotR", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string };
      await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/revoke`,
        headers: authHeaders(KEY_A),
      });
      const rot = await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/rotate-token`,
        headers: authHeaders(KEY_A),
      });
      expect(rot.statusCode).toBe(400);
    });

    it("12. GET unknown integration → 404", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: `${ADMIN}/${randomUUID()}`,
        headers: authHeaders(KEY_A),
      });
      expect(res.statusCode).toBe(404);
    });

    it("13. create audit has no plaintext token", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "Aud", googleAccountId: TenantA.account },
        })
      ).json() as { token: string; integrationId: string };
      const logs = await h.repos.auditLogs.list({
        page: 1,
        pageSize: 50,
        tenantId: TenantA.id,
      });
      const blob = JSON.stringify(logs.items);
      expect(blob).not.toContain(created.token);
      expect(blob.toLowerCase()).not.toContain("pepper");
    });

    it("14. list response never includes Authorization secrets", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      await app.inject({
        method: "POST",
        url: ADMIN,
        headers: authHeaders(KEY_A),
        payload: { name: "Sec", googleAccountId: TenantA.account },
      });
      const list = await app.inject({
        method: "GET",
        url: ADMIN,
        headers: authHeaders(KEY_A),
      });
      const text = list.body;
      expect(text).not.toMatch(/tokenHash/);
      expect(text).not.toMatch(/Bearer /);
      expect(text).not.toMatch(/"token":/);
    });

    it("15. disable REVOKED rejected", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "DisR", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string };
      await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/revoke`,
        headers: authHeaders(KEY_A),
      });
      const dis = await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/disable`,
        headers: authHeaders(KEY_A),
      });
      expect(dis.statusCode).toBe(400);
    });
  });

  describe("Token rotate/revoke extras", () => {
    it("16. rotate returns new prefix", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "Pfx", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string; tokenPrefix: string };
      const rot = (
        await app.inject({
          method: "POST",
          url: `${ADMIN}/${created.integrationId}/rotate-token`,
          headers: authHeaders(KEY_A),
        })
      ).json() as { tokenPrefix: string; token: string };
      expect(rot.tokenPrefix).toBeTruthy();
      expect(rot.token).toMatch(/^alk_s_/);
    });

    it("17. GET after rotate still has no token", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "G2", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string };
      await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/rotate-token`,
        headers: authHeaders(KEY_A),
      });
      const get = await app.inject({
        method: "GET",
        url: `${ADMIN}/${created.integrationId}`,
        headers: authHeaders(KEY_A),
      });
      expect(get.json().token).toBeUndefined();
    });

    it("18. revoke status is REVOKED on GET", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "St", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string };
      await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/revoke`,
        headers: authHeaders(KEY_A),
      });
      const get = await app.inject({
        method: "GET",
        url: `${ADMIN}/${created.integrationId}`,
        headers: authHeaders(KEY_A),
      });
      expect(get.json().status).toBe("REVOKED");
      expect(get.json().tokenStatus).toBe("REVOKED");
    });

    it("19. disable status DISABLED on GET", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "Ds", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string };
      await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/disable`,
        headers: authHeaders(KEY_A),
      });
      expect(
        (
          await app.inject({
            method: "GET",
            url: `${ADMIN}/${created.integrationId}`,
            headers: authHeaders(KEY_A),
          })
        ).json().status
      ).toBe("DISABLED");
    });

    it("20. double enable is idempotent ACTIVE", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "En2", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string };
      await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/disable`,
        headers: authHeaders(KEY_A),
      });
      await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/enable`,
        headers: authHeaders(KEY_A),
      });
      const again = await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/enable`,
        headers: authHeaders(KEY_A),
      });
      expect(again.statusCode).toBe(200);
      expect(again.json().status).toBe("ACTIVE");
    });

    it("21. rotate audit redacts secrets", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "Ra", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string; token: string };
      const rot = (
        await app.inject({
          method: "POST",
          url: `${ADMIN}/${created.integrationId}/rotate-token`,
          headers: authHeaders(KEY_A),
        })
      ).json() as { token: string };
      const logs = await h.repos.auditLogs.list({
        page: 1,
        pageSize: 100,
        tenantId: TenantA.id,
      });
      const blob = JSON.stringify(logs.items);
      expect(blob).not.toContain(created.token);
      expect(blob).not.toContain(rot.token);
    });

    it("22. Bearer Authorization also works for admin list", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: ADMIN,
        headers: { authorization: `Bearer ${KEY_A}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("23. invalid api key → 401", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "GET",
        url: ADMIN,
        headers: { "x-api-key": "alk_dev_invalid" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("24. create requires googleAccountId", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "POST",
        url: ADMIN,
        headers: authHeaders(KEY_A),
        payload: { name: "NoGA" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("25. revoke unknown → 404", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "POST",
        url: `${ADMIN}/${randomUUID()}/revoke`,
        headers: authHeaders(KEY_A),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("Target attach/detach", () => {
    it("26. attach AD derives googleAdId server-side", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "Tgt", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string };
      const att = await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/targets`,
        headers: authHeaders(KEY_A),
        payload: { entityType: "AD", entityId: TenantA.adA1 },
      });
      expect(att.statusCode).toBe(200);
      const body = att.json();
      expect(body.googleAdId).toBe("ad-3001");
      expect(body.entityId).toBe(TenantA.adA1);
      expect(body.desiredVersion).toBe(2);
    });

    it("27. client cannot set googleAdId as authority", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "NoGad", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string };
      const att = await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/targets`,
        headers: authHeaders(KEY_A),
        payload: {
          entityType: "AD",
          entityId: TenantA.adA1,
          googleAdId: "forged-id",
        },
      });
      expect(att.statusCode).toBe(200);
      expect(att.json().googleAdId).toBe("ad-3001");
      expect(att.json().googleAdId).not.toBe("forged-id");
    });

    it("28. non-AD entityType rejected", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "Camp", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string };
      const att = await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/targets`,
        headers: authHeaders(KEY_A),
        payload: { entityType: "CAMPAIGN", entityId: TenantA.campaignA },
      });
      expect(att.statusCode).toBe(400);
    });

    it("29. duplicate attach → conflict", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "Dup", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string };
      await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/targets`,
        headers: authHeaders(KEY_A),
        payload: { entityType: "AD", entityId: TenantA.adA1 },
      });
      const again = await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/targets`,
        headers: authHeaders(KEY_A),
        payload: { entityType: "AD", entityId: TenantA.adA1 },
      });
      expect(again.statusCode).toBe(409);
    });

    it("30. detach then list excludes target", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "Det", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string };
      const att = (
        await app.inject({
          method: "POST",
          url: `${ADMIN}/${created.integrationId}/targets`,
          headers: authHeaders(KEY_A),
          payload: { entityType: "AD", entityId: TenantA.adA1 },
        })
      ).json() as { targetId: string };
      await app.inject({
        method: "DELETE",
        url: `${ADMIN}/${created.integrationId}/targets/${att.targetId}`,
        headers: authHeaders(KEY_A),
      });
      const list = await app.inject({
        method: "GET",
        url: `${ADMIN}/${created.integrationId}/targets`,
        headers: authHeaders(KEY_A),
      });
      expect(
        list.json().items.find((t: { targetId: string }) => t.targetId === att.targetId)
      ).toBeUndefined();
    });

    it("31. desiredVersion from ACTIVE UrlVersion only", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "Des", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string };
      const att = await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/targets`,
        headers: authHeaders(KEY_A),
        payload: {
          entityType: "AD",
          entityId: TenantA.adA1,
          desiredVersion: 999,
        },
      });
      expect(att.json().desiredVersion).toBe(2);
      expect(att.json().desiredVersion).not.toBe(999);
    });

    it("32. list targets after attach", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "Lst", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string };
      await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/targets`,
        headers: authHeaders(KEY_A),
        payload: { entityType: "AD", entityId: TenantA.adA1 },
      });
      const list = await app.inject({
        method: "GET",
        url: `${ADMIN}/${created.integrationId}/targets`,
        headers: authHeaders(KEY_A),
      });
      expect(list.json().items.length).toBe(1);
    });

    it("33. attach unknown ad → 404", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "Unk", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string };
      const att = await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/targets`,
        headers: authHeaders(KEY_A),
        payload: { entityType: "AD", entityId: randomUUID() },
      });
      expect(att.statusCode).toBe(404);
    });

    it("34. detach unknown → 404", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "Du", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string };
      const res = await app.inject({
        method: "DELETE",
        url: `${ADMIN}/${created.integrationId}/targets/${randomUUID()}`,
        headers: authHeaders(KEY_A),
      });
      expect(res.statusCode).toBe(404);
    });

    it("35. re-attach after detach succeeds", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "Re", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string };
      const att = (
        await app.inject({
          method: "POST",
          url: `${ADMIN}/${created.integrationId}/targets`,
          headers: authHeaders(KEY_A),
          payload: { entityType: "AD", entityId: TenantA.adA1 },
        })
      ).json() as { targetId: string };
      await app.inject({
        method: "DELETE",
        url: `${ADMIN}/${created.integrationId}/targets/${att.targetId}`,
        headers: authHeaders(KEY_A),
      });
      const again = await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/targets`,
        headers: authHeaders(KEY_A),
        payload: { entityType: "AD", entityId: TenantA.adA1 },
      });
      expect(again.statusCode).toBe(200);
    });
  });

  describe("Tenant isolation", () => {
    it("36. Tenant B cannot GET Tenant A integration", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "Iso", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string };
      const get = await app.inject({
        method: "GET",
        url: `${ADMIN}/${created.integrationId}`,
        headers: authHeaders(KEY_B),
      });
      expect(get.statusCode).toBe(404);
    });

    it("37. Tenant B cannot attach Tenant A ad to own integration", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_B),
          payload: { name: "BInt", googleAccountId: TenantB.account },
        })
      ).json() as { integrationId: string };
      const att = await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/targets`,
        headers: authHeaders(KEY_B),
        payload: { entityType: "AD", entityId: TenantA.adA1 },
      });
      expect([403, 404]).toContain(att.statusCode);
    });

    it("38. Tenant B cannot rotate Tenant A token", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "RotIso", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string };
      const rot = await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/rotate-token`,
        headers: authHeaders(KEY_B),
      });
      expect(rot.statusCode).toBe(404);
    });

    it("39. Tenant B list does not include Tenant A", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "OnlyA", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string };
      const list = await app.inject({
        method: "GET",
        url: ADMIN,
        headers: authHeaders(KEY_B),
      });
      expect(
        list
          .json()
          .items.find(
            (i: { integrationId: string }) =>
              i.integrationId === created.integrationId
          )
      ).toBeUndefined();
    });

    it("40. claimed tenant mismatch → 403", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const res = await app.inject({
        method: "POST",
        url: ADMIN,
        headers: { ...authHeaders(KEY_A), "x-tenant-id": TenantB.id },
        payload: { name: "Mis", googleAccountId: TenantA.account },
      });
      expect(res.statusCode).toBe(403);
    });

    it("41. Tenant B cannot detach Tenant A target", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "DetIso", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string };
      const att = (
        await app.inject({
          method: "POST",
          url: `${ADMIN}/${created.integrationId}/targets`,
          headers: authHeaders(KEY_A),
          payload: { entityType: "AD", entityId: TenantA.adA1 },
        })
      ).json() as { targetId: string };
      const del = await app.inject({
        method: "DELETE",
        url: `${ADMIN}/${created.integrationId}/targets/${att.targetId}`,
        headers: authHeaders(KEY_B),
      });
      expect(del.statusCode).toBe(404);
    });

    it("42. cross-tenant generate-script rejected", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "GenIso", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string; token: string };
      const gen = await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/generate-script`,
        headers: authHeaders(KEY_B),
        payload: { token: created.token },
      });
      expect(gen.statusCode).toBe(404);
    });

    it("43. Ad on wrong Google Account rejected", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "WrongGA", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string };
      const att = await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/targets`,
        headers: authHeaders(KEY_A),
        payload: { entityType: "AD", entityId: TenantB.ad },
      });
      expect([403, 404]).toContain(att.statusCode);
    });
  });

  describe("Generate script + redaction", () => {
    it("44. generate-script with valid token returns source", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "Gen", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string; token: string };
      const gen = await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/generate-script`,
        headers: authHeaders(KEY_A),
        payload: { token: created.token },
      });
      expect(gen.statusCode).toBe(200);
      const body = gen.json();
      expect(body.source).toContain("UrlFetchApp");
      expect(body.source).toContain(created.token);
      expect(body.scriptVersion).toBeTruthy();
    });

    it("45. generate-script wrong token → 403", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "BadTok", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string };
      const gen = await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/generate-script`,
        headers: authHeaders(KEY_A),
        payload: { token: "alk_s_not_a_real_token_value_xxx" },
      });
      expect(gen.statusCode).toBe(403);
    });

    it("46. generate does not persist source entity", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "NoPers", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string; token: string };
      await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/generate-script`,
        headers: authHeaders(KEY_A),
        payload: { token: created.token },
      });
      expect(h.repos).not.toHaveProperty("generatedScripts");
    });

    it("47. generate on DISABLED rejected", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "GenDis", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string; token: string };
      await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/disable`,
        headers: authHeaders(KEY_A),
      });
      const gen = await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/generate-script`,
        headers: authHeaders(KEY_A),
        payload: { token: created.token },
      });
      expect(gen.statusCode).toBe(400);
    });

    it("48. no Task model / apiAuthcode in admin responses", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const list = await app.inject({
        method: "GET",
        url: ADMIN,
        headers: authHeaders(KEY_A),
      });
      expect(list.body).not.toMatch(/apiAuthcode|gettemplate|TaskScheduler/i);
    });

    it("49. attach audit has no token", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "AudT", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string; token: string };
      await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/targets`,
        headers: authHeaders(KEY_A),
        payload: { entityType: "AD", entityId: TenantA.adA1 },
      });
      const logs = await h.repos.auditLogs.list({
        page: 1,
        pageSize: 100,
        tenantId: TenantA.id,
      });
      expect(JSON.stringify(logs.items)).not.toContain(created.token);
    });

    it("50. GET integration targetCount updates after attach", async () => {
      const h = createHarness();
      const app = await buildApp(h.services);
      apps.push(app);
      const created = (
        await app.inject({
          method: "POST",
          url: ADMIN,
          headers: authHeaders(KEY_A),
          payload: { name: "Cnt", googleAccountId: TenantA.account },
        })
      ).json() as { integrationId: string };
      expect(
        (
          await app.inject({
            method: "GET",
            url: `${ADMIN}/${created.integrationId}`,
            headers: authHeaders(KEY_A),
          })
        ).json().targetCount
      ).toBe(0);
      await app.inject({
        method: "POST",
        url: `${ADMIN}/${created.integrationId}/targets`,
        headers: authHeaders(KEY_A),
        payload: { entityType: "AD", entityId: TenantA.adA1 },
      });
      expect(
        (
          await app.inject({
            method: "GET",
            url: `${ADMIN}/${created.integrationId}`,
            headers: authHeaders(KEY_A),
          })
        ).json().targetCount
      ).toBe(1);
    });
  });
});
