/**
 * Phase 8.4.5 — Concurrency / Idempotency Hardening + Audit.
 */
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSeededMemoryRepositories,
  TenantA,
} from "@adlinklab/database";
import {
  AuditActions,
  ScriptSyncConflictCodes,
} from "@adlinklab/domain";
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
  const scriptSyncResult = new ScriptSyncResultService(
    repos.scriptSyncRunner,
    audit
  );
  const services = {
    scriptIntegrations: repos.scriptIntegrations,
    scriptConfig,
    scriptSyncResult,
    audit,
  } as Pick<
    AppServices,
    "scriptIntegrations" | "scriptConfig" | "scriptSyncResult" | "audit"
  >;
  return { repos, audit, integrationService, scriptSyncResult, services };
}

async function buildApp(
  services: Pick<
    AppServices,
    "scriptIntegrations" | "scriptConfig" | "scriptSyncResult" | "audit"
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

describe("Phase 8.4.5 Concurrency / Idempotency Hardening", () => {
  const apps: Array<{ close: () => Promise<void> }> = [];
  afterEach(async () => {
    while (apps.length) {
      await apps.pop()?.close();
    }
  });

  it("exports stable conflict codes", () => {
    expect(ScriptSyncConflictCodes.STALE_DESIRED).toBe("STALE_DESIRED");
    expect(ScriptSyncConflictCodes.VERSION_CONFLICT).toBe("VERSION_CONFLICT");
    expect(ScriptSyncConflictCodes.IDEMPOTENCY_CONFLICT).toBe(
      "IDEMPOTENCY_CONFLICT"
    );
    expect(ScriptSyncConflictCodes.NO_ACTIVE_VERSION).toBe("NO_ACTIVE_VERSION");
  });

  it("auth success writes SCRIPT_INTEGRATION_AUTH_SUCCESS without secrets", async () => {
    const h = createHarness();
    const { token } = await h.integrationService.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "Auth audit",
    });
    const app = await buildApp(h.services);
    apps.push(app);
    await app.inject({
      method: "GET",
      url: CONFIG_PATH,
      headers: { authorization: `Bearer ${token}` },
    });
    const logs = await h.repos.auditLogs.list({
      tenantId: TenantA.id,
      page: 1,
      pageSize: 100,
    });
    const authOk = logs.items.find(
      (l) => l.action === AuditActions.SCRIPT_INTEGRATION_AUTH_SUCCESS
    );
    expect(authOk).toBeTruthy();
    const serialized = JSON.stringify(authOk);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(TEST_INTEGRATION_TOKEN_PEPPER);
    expect(serialized).not.toContain("Authorization");
  });

  it("SUCCESS writes SCRIPT_SYNC_RESULT_APPLIED audit", async () => {
    const h = createHarness();
    const { integration, token } = await h.integrationService.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "Apply audit",
    });
    const target = await h.repos.scriptSyncTargets.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      integrationId: integration.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      appliedVersion: 1,
      syncState: "OUT_OF_SYNC",
      connectionHealth: "CONNECTED",
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
        idempotencyKey: "audit-apply",
      },
    });
    expect(res.statusCode).toBe(200);
    const logs = await h.repos.auditLogs.list({
      tenantId: TenantA.id,
      page: 1,
      pageSize: 200,
    });
    expect(
      logs.items.some((l) => l.action === AuditActions.SCRIPT_SYNC_RESULT_APPLIED)
    ).toBe(true);
    const applied = logs.items.find(
      (l) => l.action === AuditActions.SCRIPT_SYNC_RESULT_APPLIED
    );
    const s = JSON.stringify(applied);
    expect(s).not.toContain(token);
    expect(s).not.toContain(integration.tokenHash);
  });

  it("STALE writes SCRIPT_SYNC_RESULT_REJECTED with STALE_DESIRED code", async () => {
    const h = createHarness();
    const { integration, token } = await h.integrationService.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "Reject audit",
    });
    const target = await h.repos.scriptSyncTargets.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      integrationId: integration.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      appliedVersion: 1,
      syncState: "OUT_OF_SYNC",
      connectionHealth: "CONNECTED",
    });
    const app = await buildApp(h.services);
    apps.push(app);
    const res = await app.inject({
      method: "POST",
      url: SYNC_PATH,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        targetId: target.id,
        desiredVersion: 99,
        result: "SUCCESS",
        idempotencyKey: "audit-stale",
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe(ScriptSyncConflictCodes.STALE_DESIRED);
    const logs = await h.repos.auditLogs.list({
      tenantId: TenantA.id,
      page: 1,
      pageSize: 200,
    });
    const rejected = logs.items.find(
      (l) => l.action === AuditActions.SCRIPT_SYNC_RESULT_REJECTED
    );
    expect(rejected).toBeTruthy();
    expect(JSON.stringify(rejected?.after)).toContain("STALE_DESIRED");
  });

  it("idempotent replay writes SCRIPT_SYNC_RESULT_IDEMPOTENT_REPLAY", async () => {
    const h = createHarness();
    const { integration, token } = await h.integrationService.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "Replay audit",
    });
    const target = await h.repos.scriptSyncTargets.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      integrationId: integration.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      appliedVersion: 1,
      syncState: "OUT_OF_SYNC",
      connectionHealth: "CONNECTED",
    });
    const app = await buildApp(h.services);
    apps.push(app);
    const body = {
      targetId: target.id,
      desiredVersion: 2,
      result: "SUCCESS" as const,
      idempotencyKey: "audit-replay",
    };
    await app.inject({
      method: "POST",
      url: SYNC_PATH,
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    });
    await app.inject({
      method: "POST",
      url: SYNC_PATH,
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    });
    const logs = await h.repos.auditLogs.list({
      tenantId: TenantA.id,
      page: 1,
      pageSize: 200,
    });
    expect(
      logs.items.some(
        (l) => l.action === AuditActions.SCRIPT_SYNC_RESULT_IDEMPOTENT_REPLAY
      )
    ).toBe(true);
  });

  it("16 concurrent identical keys → one ScriptSyncLog + appliedVersion=2", async () => {
    const h = createHarness();
    const { integration, token } = await h.integrationService.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "Conc identical",
    });
    const target = await h.repos.scriptSyncTargets.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      integrationId: integration.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      appliedVersion: 1,
      syncState: "OUT_OF_SYNC",
      connectionHealth: "CONNECTED",
    });
    const app = await buildApp(h.services);
    apps.push(app);
    const body = {
      targetId: target.id,
      desiredVersion: 2,
      result: "SUCCESS" as const,
      idempotencyKey: "conc-16",
    };
    const results = await Promise.all(
      Array.from({ length: 16 }, () =>
        app.inject({
          method: "POST",
          url: SYNC_PATH,
          headers: { authorization: `Bearer ${token}` },
          payload: body,
        })
      )
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const logs = await h.repos.scriptSyncLogs.findByTarget(
      TenantA.id,
      target.id
    );
    expect(logs.items).toHaveLength(1);
    expect(
      (await h.repos.scriptSyncTargets.findById(target.id))?.appliedVersion
    ).toBe(2);
  });

  it("concurrent different keys: final appliedVersion=2, no regression", async () => {
    const h = createHarness();
    const { integration, token } = await h.integrationService.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "Conc keys",
    });
    const target = await h.repos.scriptSyncTargets.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      integrationId: integration.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      appliedVersion: 1,
      syncState: "OUT_OF_SYNC",
      connectionHealth: "CONNECTED",
    });
    const app = await buildApp(h.services);
    apps.push(app);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        app.inject({
          method: "POST",
          url: SYNC_PATH,
          headers: { authorization: `Bearer ${token}` },
          payload: {
            targetId: target.id,
            desiredVersion: 2,
            result: "SUCCESS",
            idempotencyKey: `conc-key-${i}`,
          },
        })
      )
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(
      (await h.repos.scriptSyncTargets.findById(target.id))?.appliedVersion
    ).toBe(2);
    const logs = await h.repos.scriptSyncLogs.findByTarget(
      TenantA.id,
      target.id
    );
    expect(logs.items.length).toBe(10);
  });

  it("FAILED records audit RECORDED and does not change appliedVersion", async () => {
    const h = createHarness();
    const { integration, token } = await h.integrationService.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "Fail audit",
    });
    const target = await h.repos.scriptSyncTargets.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      integrationId: integration.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      appliedVersion: 1,
      syncState: "OUT_OF_SYNC",
      connectionHealth: "CONNECTED",
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
        idempotencyKey: "audit-fail",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().appliedVersion).toBe(1);
    const logs = await h.repos.auditLogs.list({
      tenantId: TenantA.id,
      page: 1,
      pageSize: 200,
    });
    expect(
      logs.items.some(
        (l) => l.action === AuditActions.SCRIPT_SYNC_RESULT_RECORDED
      )
    ).toBe(true);
  });

  it("audit failure does not break successful sync-result", async () => {
    const h = createHarness();
    const { integration, token } = await h.integrationService.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "Audit fail soft",
    });
    const target = await h.repos.scriptSyncTargets.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      integrationId: integration.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      appliedVersion: 1,
      syncState: "OUT_OF_SYNC",
      connectionHealth: "CONNECTED",
    });
    const original = h.audit.record.bind(h.audit);
    h.audit.record = async () => {
      throw new Error("audit down");
    };
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
        idempotencyKey: "audit-down",
      },
    });
    h.audit.record = original;
    expect(res.statusCode).toBe(200);
    expect(res.json().appliedVersion).toBe(2);
  });
});
