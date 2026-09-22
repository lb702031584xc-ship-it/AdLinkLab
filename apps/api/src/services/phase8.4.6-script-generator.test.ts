/**
 * Phase 8.4.6 — Google Ads Script Generator (API ONLY).
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
import {
  ScriptGeneratorService,
  resolveScriptApiBaseUrl,
} from "./script-generator-service.js";
import {
  SCRIPT_GENERATOR_VERSION,
  assertScriptSourceSafe,
  buildGoogleAdsScriptSource,
  jsStringLiteral,
} from "./script-generator-source.js";
import { AuditService } from "./index.js";

const ENV = {
  VITEST: "1",
  INTEGRATION_TOKEN_PEPPER: TEST_INTEGRATION_TOKEN_PEPPER,
  SCRIPT_API_BASE_URL: "https://staging.validateidea.org",
} as NodeJS.ProcessEnv;

const GEN_PATH = "/api/v1/script/generator";
const BASE = "https://staging.validateidea.org";

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
  const services = {
    scriptIntegrations: repos.scriptIntegrations,
    scriptConfig,
    scriptSyncResult,
    scriptGenerator,
    audit,
  } as Pick<
    AppServices,
    | "scriptIntegrations"
    | "scriptConfig"
    | "scriptSyncResult"
    | "scriptGenerator"
    | "audit"
  >;
  return {
    repos,
    audit,
    integrationService,
    scriptConfig,
    scriptSyncResult,
    scriptGenerator,
    services,
  };
}

async function buildApp(
  services: Pick<
    AppServices,
    | "scriptIntegrations"
    | "scriptConfig"
    | "scriptSyncResult"
    | "scriptGenerator"
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
  return app;
}

async function createIntegration(
  h: ReturnType<typeof createHarness>,
  tenantId = TenantA.id,
  googleAccountId = TenantA.account,
  name = "Gen"
) {
  return h.integrationService.create({ tenantId, googleAccountId, name });
}

type Built = {
  h: ReturnType<typeof createHarness>;
  app: Awaited<ReturnType<typeof buildApp>>;
  token: string;
  integrationId: string;
};

async function withGenApp(
  apps: Array<{ close: () => Promise<void> }>,
  name = "Gen"
): Promise<Built> {
  const h = createHarness();
  const { integration, token } = await createIntegration(
    h,
    TenantA.id,
    TenantA.account,
    name
  );
  const app = await buildApp(h.services);
  apps.push(app);
  return { h, app, token, integrationId: integration.id };
}

async function postGen(
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  payload: Record<string, unknown> = { baseUrl: BASE }
) {
  return app.inject({
    method: "POST",
    url: GEN_PATH,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload,
  });
}

describe("Phase 8.4.6 Script Generator", () => {
  const apps: Array<{ close: () => Promise<void> }> = [];
  afterEach(async () => {
    while (apps.length) {
      const a = apps.pop();
      await a?.close();
    }
  });

  it("1. valid authenticated generator request", async () => {
    const { app, token, integrationId } = await withGenApp(apps, "Valid");
    const res = await postGen(app, token);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    const body = res.json();
    expect(body.integrationId).toBe(integrationId);
    expect(body.scriptVersion).toBe(SCRIPT_GENERATOR_VERSION);
    expect(body.apiVersion).toBe("v1");
    expect(body.configEndpoint).toBe(`${BASE}/api/v1/script/config`);
    expect(body.syncResultEndpoint).toBe(`${BASE}/api/v1/script/sync-result`);
    expect(typeof body.source).toBe("string");
    expect(body.source.length).toBeGreaterThan(100);
    expect(body.token).toBeUndefined();
  });

  it("2. missing auth → 401", async () => {
    const h = createHarness();
    const app = await buildApp(h.services);
    apps.push(app);
    const res = await app.inject({
      method: "POST",
      url: GEN_PATH,
      headers: { "content-type": "application/json" },
      payload: { baseUrl: BASE },
    });
    expect(res.statusCode).toBe(401);
  });

  it("3. invalid token → 401", async () => {
    const h = createHarness();
    const app = await buildApp(h.services);
    apps.push(app);
    const res = await app.inject({
      method: "POST",
      url: GEN_PATH,
      headers: {
        authorization: "Bearer alk_s_not_a_real_token",
        "content-type": "application/json",
      },
      payload: { baseUrl: BASE },
    });
    expect(res.statusCode).toBe(401);
  });

  it("4. disabled integration → 401", async () => {
    const h = createHarness();
    const { integration, token } = await createIntegration(h, TenantA.id, TenantA.account, "Dis");
    await h.integrationService.disable(TenantA.id, integration.id);
    const app = await buildApp(h.services);
    apps.push(app);
    expect((await postGen(app, token)).statusCode).toBe(401);
  });

  it("5. revoked integration → 401", async () => {
    const h = createHarness();
    const { integration, token } = await createIntegration(h, TenantA.id, TenantA.account, "Rev");
    await h.integrationService.revoke(TenantA.id, integration.id);
    const app = await buildApp(h.services);
    apps.push(app);
    expect((await postGen(app, token)).statusCode).toBe(401);
  });

  it("6. deleted integration → 401", async () => {
    const h = createHarness();
    const { integration, token } = await createIntegration(h, TenantA.id, TenantA.account, "Del");
    await h.repos.scriptIntegrations.softDelete(integration.id);
    const app = await buildApp(h.services);
    apps.push(app);
    expect((await postGen(app, token)).statusCode).toBe(401);
  });

  it("7. generated source contains config endpoint", async () => {
    const { app, token } = await withGenApp(apps, "Cfg");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).toContain(`${BASE}/api/v1/script/config`);
  });

  it("8. generated source contains sync-result endpoint", async () => {
    const { app, token } = await withGenApp(apps, "Sync");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).toContain(`${BASE}/api/v1/script/sync-result`);
  });

  it("9. source uses Bearer Authorization", async () => {
    const { app, token } = await withGenApp(apps, "Bearer");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).toContain('Authorization: "Bearer "');
    expect(source).toContain("ADLINKLAB.token");
  });

  it("10. token is not query parameter", async () => {
    const { app, token } = await withGenApp(apps, "NoQ");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).not.toMatch(/[?&]token=/);
    expect(source).not.toMatch(/\/token\//);
  });

  it("11. source does not contain token in logs", async () => {
    const { app, token } = await withGenApp(apps, "Log");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).not.toMatch(/Logger\.log\([^)]*token/i);
    expect(source).not.toMatch(/Logger\.log\([^)]*Authorization/i);
    expect(source).not.toMatch(/Logger\.log\([^)]*ADLINKLAB\.token/);
  });

  it("12. response does not expose tokenHash", async () => {
    const { app, token } = await withGenApp(apps, "Hash");
    const body = (await postGen(app, token)).json();
    expect(body.tokenHash).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("tokenHash");
  });

  it("13. response does not expose pepper", async () => {
    const { app, token } = await withGenApp(apps, "Pep");
    const body = (await postGen(app, token)).json();
    expect(JSON.stringify(body)).not.toContain("pepper");
    expect(JSON.stringify(body)).not.toContain(TEST_INTEGRATION_TOKEN_PEPPER);
  });

  it("14. response does not expose oauthCredentialRef", async () => {
    const { app, token } = await withGenApp(apps, "Oauth");
    const body = (await postGen(app, token)).json();
    expect(JSON.stringify(body)).not.toContain("oauthCredentialRef");
    expect(body.tokenPrefix).toBeUndefined();
    expect(body.tokenKeyId).toBeUndefined();
  });

  it("15. body token mismatch → 403", async () => {
    const { app, token } = await withGenApp(apps, "Mis");
    const res = await postGen(app, token, {
      baseUrl: BASE,
      token: "alk_s_different_token_value",
    });
    expect(res.statusCode).toBe(403);
  });

  it("16. cross-integration mismatch → 403", async () => {
    const h = createHarness();
    const a = await createIntegration(h, TenantA.id, TenantA.account, "A");
    const b = await createIntegration(h, TenantA.id, TenantA.account, "B");
    const app = await buildApp(h.services);
    apps.push(app);
    const res = await postGen(app, a.token, { baseUrl: BASE, token: b.token });
    expect(res.statusCode).toBe(403);
    expect(res.json().source).toBeUndefined();
  });

  it("17. tenant isolation", async () => {
    const h = createHarness();
    const a = await createIntegration(h, TenantA.id, TenantA.account, "TA");
    const b = await createIntegration(h, TenantB.id, TenantB.account, "TB");
    const app = await buildApp(h.services);
    apps.push(app);
    const resA = await postGen(app, a.token);
    const resB = await postGen(app, b.token);
    expect(resA.json().integrationId).toBe(a.integration.id);
    expect(resB.json().integrationId).toBe(b.integration.id);
    expect(resA.json().source).toContain(a.integration.id);
    expect(resB.json().source).toContain(b.integration.id);
    expect(resA.json().source).not.toContain(b.integration.id);
  });

  it("18. generated source does not hardcode target IDs", async () => {
    const { h, app, token, integrationId } = await withGenApp(apps, "Tgt");
    const targetId = randomUUID();
    await h.repos.scriptSyncTargets.create({
      id: targetId,
      tenantId: TenantA.id,
      integrationId,
      entityType: "AD",
      entityId: TenantA.adA1,
      syncState: "NEVER_APPLIED",
      connectionHealth: "STALE",
    });
    const source = (await postGen(app, token)).json().source as string;
    expect(source).not.toContain(targetId);
  });

  it("19. generated source does not hardcode final URLs", async () => {
    const { app, token } = await withGenApp(apps, "Url");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).not.toContain("https://example.com/landing");
    expect(source).toContain("target.finalUrl");
  });

  it("20. generated source polls config", async () => {
    const { app, token } = await withGenApp(apps, "Poll");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).toContain("fetchConfig_");
    expect(source).toContain("ADLINKLAB.configEndpoint");
  });

  it("21. generated source uses desiredVersion", async () => {
    const { app, token } = await withGenApp(apps, "DV");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).toContain("desiredVersion");
    expect(source).toContain("target.desiredVersion");
  });

  it("22. generated source reports sync-result", async () => {
    const { app, token } = await withGenApp(apps, "Rep");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).toContain("syncResultEndpoint");
    expect(source).toContain("reportResult_");
  });

  it("23. success result", async () => {
    const { app, token } = await withGenApp(apps, "Ok");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).toContain('"SUCCESS"');
  });

  it("24. failed result", async () => {
    const { app, token } = await withGenApp(apps, "Fail");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).toContain('"FAILED"');
  });

  it("25. stale result handling", async () => {
    const { app, token } = await withGenApp(apps, "Stale");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).toContain("statusCode === 409");
    expect(source).toContain("conflict");
    expect(source).not.toContain("rollback");
  });

  it("26. multiple target support", async () => {
    const { app, token } = await withGenApp(apps, "Multi");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).toContain("for (var i = 0; i < targets.length; i++)");
    expect(source).toContain("processTarget_");
  });

  it("27. AD-only validation", async () => {
    const { app, token } = await withGenApp(apps, "AD");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).toContain('entityType !== "AD"');
  });

  it("28. invalid target ignored/rejected", async () => {
    const { app, token } = await withGenApp(apps, "Inv");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).toContain("!target.targetId");
    expect(source).toContain("isPositiveInt_");
  });

  it("29. trackingTemplate preserved", async () => {
    const { app, token } = await withGenApp(apps, "TT");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).toContain("setTrackingTemplate");
    expect(source).toContain("target.trackingTemplate");
  });

  it("30. customParameters preserved", async () => {
    const { app, token } = await withGenApp(apps, "CP");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).toContain("setCustomParameters");
    expect(source).toContain("target.customParameters");
  });

  it("31. finalUrl preserved", async () => {
    const { app, token } = await withGenApp(apps, "FU");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).toContain("setFinalUrl");
    expect(source).toContain("target.finalUrl");
    expect(source).not.toMatch(/setFinalUrl\([^)]*trackingTemplate/);
  });

  it("32. mobile URL preserved", async () => {
    const { app, token } = await withGenApp(apps, "MU");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).toContain("setFinalMobileUrl");
    expect(source).toContain("target.finalMobileUrl");
  });

  it("33. app URL preserved", async () => {
    const { app, token } = await withGenApp(apps, "AU");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).toContain("setFinalAppUrl");
    expect(source).toContain("target.finalAppUrl");
  });

  it("34. generator is read-only (integration + target)", async () => {
    const { h, app, token, integrationId } = await withGenApp(apps, "RO");
    const target = await h.repos.scriptSyncTargets.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      integrationId,
      entityType: "AD",
      entityId: TenantA.adA1,
      appliedVersion: 3,
      desiredVersion: 3,
      syncState: "SYNCED",
      connectionHealth: "CONNECTED",
    });
    const beforeI = await h.repos.scriptIntegrations.findById(integrationId);
    const beforeT = await h.repos.scriptSyncTargets.findById(target.id);
    expect((await postGen(app, token)).statusCode).toBe(200);
    const afterI = await h.repos.scriptIntegrations.findById(integrationId);
    const afterT = await h.repos.scriptSyncTargets.findById(target.id);
    expect(afterI?.tokenHash).toBe(beforeI?.tokenHash);
    expect(afterI?.configGeneration).toBe(beforeI?.configGeneration);
    expect(afterT?.appliedVersion).toBe(beforeT?.appliedVersion);
    expect(afterT?.desiredVersion).toBe(beforeT?.desiredVersion);
  });

  it("35. no SyncJob from generation", async () => {
    const { h, app, token } = await withGenApp(apps, "Job");
    const before = await h.repos.syncJobs.list({ tenantId: TenantA.id });
    await postGen(app, token);
    const after = await h.repos.syncJobs.list({ tenantId: TenantA.id });
    expect(after.total).toBe(before.total);
  });

  it("36. no UCR from generation", async () => {
    const { h, app, token } = await withGenApp(apps, "UCR");
    const before = await h.repos.urlChangeRequests.list({
      tenantId: TenantA.id,
    });
    await postGen(app, token);
    const after = await h.repos.urlChangeRequests.list({
      tenantId: TenantA.id,
    });
    expect(after.total).toBe(before.total);
  });

  it("37. no ScriptSyncLog from generation", async () => {
    const { h, app, token, integrationId } = await withGenApp(apps, "Log2");
    const before = await h.repos.scriptSyncLogs.findByIntegration(
      TenantA.id,
      integrationId
    );
    await postGen(app, token);
    const after = await h.repos.scriptSyncLogs.findByIntegration(
      TenantA.id,
      integrationId
    );
    expect(after.total).toBe(before.total);
  });

  it("38. no appliedVersion mutation", async () => {
    const { h, app, token, integrationId } = await withGenApp(apps, "AV");
    const target = await h.repos.scriptSyncTargets.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      integrationId,
      entityType: "AD",
      entityId: TenantA.adA1,
      appliedVersion: 7,
      desiredVersion: 7,
      syncState: "SYNCED",
      connectionHealth: "CONNECTED",
    });
    await postGen(app, token);
    const after = await h.repos.scriptSyncTargets.findById(target.id);
    expect(after?.appliedVersion).toBe(7);
  });

  it("39. deterministic source", async () => {
    const { app, token } = await withGenApp(apps, "Det");
    const a = (await postGen(app, token)).json().source;
    const b = (await postGen(app, token)).json().source;
    expect(a).toBe(b);
  });

  it("40. generator version present", async () => {
    const { app, token } = await withGenApp(apps, "Ver");
    const body = (await postGen(app, token)).json();
    expect(body.scriptVersion).toBe("8.4.6");
    expect(body.source).toContain("Generator version: 8.4.6");
    expect(body.source).toContain("API version: v1");
  });

  it("41. 5xx retry bounded", async () => {
    const { app, token } = await withGenApp(apps, "R5");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).toContain("maxHttpRetries: 3");
    expect(source).toContain("statusCode >= 500");
  });

  it("42. 401 stops", async () => {
    const { app, token } = await withGenApp(apps, "S401");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).toContain("statusCode === 401");
  });

  it("43. 403 stops", async () => {
    const { app, token } = await withGenApp(apps, "S403");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).toContain("statusCode === 403");
  });

  it("44. 409 stops stale target", async () => {
    const { app, token } = await withGenApp(apps, "S409");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).toContain("statusCode === 409");
    expect(source).not.toContain("forced retry");
  });

  it("45. same target execution uses stable idempotency key", async () => {
    const { app, token } = await withGenApp(apps, "Idem");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).toContain("idempotencyKey");
    expect(source).toContain("executionId");
    expect(source).toContain("Utilities.getUuid()");
    expect(source).toMatch(
      /idempotencyKey[\s\S]*httpJson_\("POST", ADLINKLAB\.syncResultEndpoint/
    );
  });

  it("46. banned cloaking / proxy / UA / referer patterns absent", async () => {
    const { app, token } = await withGenApp(apps, "Sec");
    const source = (await postGen(app, token)).json().source as string;
    expect(assertScriptSourceSafe(source)).toEqual([]);
    expect(source).not.toMatch(/\bgclid\b/);
    expect(source).not.toMatch(/\bgbraid\b/);
    expect(source).not.toMatch(/\bwbraid\b/);
  });

  it("47. no Node / browser runtime APIs in source", async () => {
    const { app, token } = await withGenApp(apps, "Node");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).not.toContain("require(");
    expect(source).not.toContain("module.exports");
    expect(source).not.toContain("process.");
    expect(source).not.toContain("document.");
    expect(source).not.toContain("window.");
    expect(source).toContain("UrlFetchApp.fetch");
    expect(source).toContain("AdsApp.ads");
  });

  it("48. token / URL injection escaped", () => {
    const evilToken = 'alk_s_");evil();//';
    const evilUrl = 'https://x.example/");evil();//';
    const source = buildGoogleAdsScriptSource({
      integrationId: "int-1",
      token: evilToken,
      configEndpoint: `${evilUrl}/api/v1/script/config`,
      syncResultEndpoint: `${evilUrl}/api/v1/script/sync-result`,
    });
    expect(source).toContain(jsStringLiteral(evilToken));
    expect(source).not.toContain('token: "alk_s_");evil');
    expect(assertScriptSourceSafe(source)).toEqual([]);
  });

  it("49. matching body token accepted", async () => {
    const { app, token } = await withGenApp(apps, "Match");
    const res = await postGen(app, token, { baseUrl: BASE, token });
    expect(res.statusCode).toBe(200);
    expect(res.json().source).toContain(jsStringLiteral(token));
  });

  it("50. GET generator works with SCRIPT_API_BASE_URL", async () => {
    const { app, token } = await withGenApp(apps, "GET");
    const res = await app.inject({
      method: "GET",
      url: GEN_PATH,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().configEndpoint).toBe(`${BASE}/api/v1/script/config`);
  });

  it("51. missing SCRIPT_API_BASE_URL → configuration error", () => {
    const svc = new ScriptGeneratorService({
      VITEST: "1",
    } as NodeJS.ProcessEnv);
    expect(() =>
      svc.generate(
        {
          integrationId: "i",
          tenantId: TenantA.id,
          googleAccountId: TenantA.account,
          tokenKeyId: "k",
        },
        "alk_s_x",
        {}
      )
    ).toThrow(/SCRIPT_API_BASE_URL/);
  });

  it("52. loopback base URL rejected outside test", () => {
    expect(() =>
      resolveScriptApiBaseUrl(
        { baseUrl: "http://localhost:3001" },
        { NODE_ENV: "production" } as NodeJS.ProcessEnv
      )
    ).toThrow(/localhost/);
  });

  it("53. loopback allowed in test env", () => {
    const url = resolveScriptApiBaseUrl(
      { baseUrl: "http://127.0.0.1:3001" },
      { VITEST: "1" } as NodeJS.ProcessEnv
    );
    expect(url).toBe("http://127.0.0.1:3001");
  });

  it("54. no Google Ads API REST / OAuth in source", async () => {
    const { app, token } = await withGenApp(apps, "NoRest");
    const source = (await postGen(app, token)).json().source as string;
    expect(source).toContain("function main()");
    expect(source).not.toContain("googleads.googleapis.com");
    expect(source).not.toContain("OAuth");
  });

  it("55. no UrlVersion mutation from generation", async () => {
    const { h, app, token } = await withGenApp(apps, "UV");
    const before = await h.repos.urlVersions.list({ tenantId: TenantA.id });
    await postGen(app, token);
    const after = await h.repos.urlVersions.list({ tenantId: TenantA.id });
    expect(after.total).toBe(before.total);
  });
});
