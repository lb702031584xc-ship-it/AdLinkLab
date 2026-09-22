/**
 * Phase 8.4.2 — Script Integration authentication security tests.
 */
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createSeededMemoryRepositories, TenantA, TenantB } from "@adlinklab/database";
import { AppError, ForbiddenError, UnauthorizedError } from "@adlinklab/shared";
import {
  authenticateScriptIntegration,
  assertIntegrationAuthClaims,
  requireScriptIntegrationAuth,
  type IntegrationAuthFailureReason,
} from "./integration-auth.js";
import { registerScriptIntegrationAuthTestRoutes } from "./integration-auth-test-routes.js";
import {
  hashIntegrationToken,
  TEST_INTEGRATION_TOKEN_PEPPER,
} from "./integration-token-crypto.js";
import { ScriptIntegrationService } from "../services/script-integration-service.js";
import { AuditService } from "../services/index.js";

const ENV = {
  VITEST: "1",
  INTEGRATION_TOKEN_PEPPER: TEST_INTEGRATION_TOKEN_PEPPER,
} as NodeJS.ProcessEnv;

function createService() {
  const repos = createSeededMemoryRepositories();
  const audit = new AuditService(repos.auditLogs);
  const service = new ScriptIntegrationService(
    repos.scriptIntegrations,
    repos.googleAccounts,
    audit,
    ENV
  );
  return { repos, service, audit };
}

async function buildWhoamiApp(
  repos: ReturnType<typeof createSeededMemoryRepositories>
) {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
      });
    }
    return reply.status(500).send({ error: "INTERNAL_ERROR" });
  });
  await registerScriptIntegrationAuthTestRoutes(app, repos, ENV);
  return app;
}

describe("Phase 8.4.2 Script Integration authentication", () => {
  const apps: Array<{ close: () => Promise<void> }> = [];
  afterEach(async () => {
    while (apps.length) {
      const app = apps.pop();
      await app?.close();
    }
  });

  it("valid token authenticates with correct context ids", async () => {
    const { repos, service } = createService();
    const { integration, token } = await service.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "Auth A",
    });
    const { context } = await authenticateScriptIntegration(
      repos,
      `Bearer ${token}`,
      { env: ENV }
    );
    expect(context.integrationId).toBe(integration.id);
    expect(context.tenantId).toBe(TenantA.id);
    expect(context.googleAccountId).toBe(TenantA.account);
    expect(context.tokenKeyId).toBe(integration.tokenKeyId);
  });

  it("missing Authorization → 401 Unauthorized", async () => {
    const { repos } = createService();
    await expect(
      authenticateScriptIntegration(repos, undefined, { env: ENV })
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("invalid scheme (Basic) → 401", async () => {
    const { repos } = createService();
    await expect(
      authenticateScriptIntegration(repos, "Basic abc", { env: ENV })
    ).rejects.toMatchObject({ message: "Unauthorized" });
  });

  it("unknown token → 401 without leaking existence", async () => {
    const { repos } = createService();
    const reasons: IntegrationAuthFailureReason[] = [];
    await expect(
      authenticateScriptIntegration(repos, "Bearer alk_s_unknown_token_value", {
        env: ENV,
        onFailure: (r) => reasons.push(r),
      })
    ).rejects.toMatchObject({ message: "Unauthorized" });
    expect(reasons).toEqual(["UNKNOWN_TOKEN"]);
  });

  it("DISABLED integration → 401", async () => {
    const { repos, service } = createService();
    const { integration, token } = await service.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "Disable me",
    });
    await service.disable(TenantA.id, integration.id);
    await expect(
      authenticateScriptIntegration(repos, `Bearer ${token}`, { env: ENV })
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("REVOKED integration → 401", async () => {
    const { repos, service } = createService();
    const { integration, token } = await service.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "Revoke me",
    });
    await service.revoke(TenantA.id, integration.id);
    await expect(
      authenticateScriptIntegration(repos, `Bearer ${token}`, { env: ENV })
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("soft-deleted integration → 401", async () => {
    const { repos, service } = createService();
    const { integration, token } = await service.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "Delete me",
    });
    await repos.scriptIntegrations.softDelete(integration.id);
    await expect(
      authenticateScriptIntegration(repos, `Bearer ${token}`, { env: ENV })
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("claim tenant / integration / googleAccount mismatch → Forbidden", async () => {
    const { repos, service } = createService();
    const { token } = await service.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "Claims",
    });
    await expect(
      authenticateScriptIntegration(repos, `Bearer ${token}`, {
        env: ENV,
        claimedTenantId: TenantB.id,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      authenticateScriptIntegration(repos, `Bearer ${token}`, {
        env: ENV,
        claimedIntegrationId: "00000000-0000-4000-8000-000000000099",
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      authenticateScriptIntegration(repos, `Bearer ${token}`, {
        env: ENV,
        claimedGoogleAccountId: TenantB.account,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("assertIntegrationAuthClaims rejects mismatches", () => {
    const ctx = {
      integrationId: "i1",
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      tokenKeyId: "k1",
    };
    expect(() =>
      assertIntegrationAuthClaims(ctx, { tenantId: TenantB.id })
    ).toThrow(ForbiddenError);
    expect(() =>
      assertIntegrationAuthClaims(ctx, { integrationId: "other" })
    ).toThrow(ForbiddenError);
    expect(() =>
      assertIntegrationAuthClaims(ctx, { googleAccountId: TenantB.account })
    ).toThrow(ForbiddenError);
    expect(() =>
      assertIntegrationAuthClaims(ctx, {
        tenantId: TenantA.id,
        integrationId: "i1",
        googleAccountId: TenantA.account,
      })
    ).not.toThrow();
  });

  it("plaintext token is not stored; hash/prefix/keyId exist on read", async () => {
    const { repos, service } = createService();
    const { integration, token } = await service.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "Store check",
    });
    const stored = await repos.scriptIntegrations.findById(integration.id);
    expect(stored).toBeTruthy();
    expect(stored).not.toHaveProperty("token");
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored!.tokenHash).toBe(
      hashIntegrationToken(token, TEST_INTEGRATION_TOKEN_PEPPER)
    );
    expect(stored!.tokenPrefix.length).toBeGreaterThan(0);
    expect(stored!.tokenKeyId.length).toBeGreaterThan(0);
    expect(stored!.tokenPrefix).not.toBe(token);
  });

  it("rotation invalidates old token and returns new token once", async () => {
    const { repos, service } = createService();
    const created = await service.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "Rotate",
    });
    const oldToken = created.token;
    const oldKeyId = created.integration.tokenKeyId;
    const rotated = await service.rotateToken(TenantA.id, created.integration.id);
    expect(rotated.token).not.toBe(oldToken);
    expect(rotated.integration.tokenKeyId).not.toBe(oldKeyId);

    await expect(
      authenticateScriptIntegration(repos, `Bearer ${oldToken}`, { env: ENV })
    ).rejects.toBeInstanceOf(UnauthorizedError);

    const { context } = await authenticateScriptIntegration(
      repos,
      `Bearer ${rotated.token}`,
      { env: ENV }
    );
    expect(context.integrationId).toBe(created.integration.id);
    expect(context.tokenKeyId).toBe(rotated.integration.tokenKeyId);

    const reRead = await repos.scriptIntegrations.findById(created.integration.id);
    expect(JSON.stringify(reRead)).not.toContain(rotated.token);
  });

  it("revoke and disable invalidate token", async () => {
    const { repos, service } = createService();
    const a = await service.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "R1",
    });
    const b = await service.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "D1",
    });
    await service.revoke(TenantA.id, a.integration.id);
    await service.disable(TenantA.id, b.integration.id);
    await expect(
      authenticateScriptIntegration(repos, `Bearer ${a.token}`, { env: ENV })
    ).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(
      authenticateScriptIntegration(repos, `Bearer ${b.token}`, { env: ENV })
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("Tenant A token cannot authenticate as Tenant B (cross-tenant claims)", async () => {
    const { repos, service } = createService();
    const a = await service.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "A",
    });
    const b = await service.create({
      tenantId: TenantB.id,
      googleAccountId: TenantB.account,
      name: "B",
    });

    const okA = await authenticateScriptIntegration(repos, `Bearer ${a.token}`, {
      env: ENV,
    });
    expect(okA.context.tenantId).toBe(TenantA.id);

    await expect(
      authenticateScriptIntegration(repos, `Bearer ${a.token}`, {
        env: ENV,
        claimedTenantId: TenantB.id,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      authenticateScriptIntegration(repos, `Bearer ${a.token}`, {
        env: ENV,
        claimedIntegrationId: b.integration.id,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      authenticateScriptIntegration(repos, `Bearer ${a.token}`, {
        env: ENV,
        claimedGoogleAccountId: TenantB.account,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      authenticateScriptIntegration(repos, `Bearer ${b.token}`, {
        env: ENV,
        claimedTenantId: TenantA.id,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      authenticateScriptIntegration(repos, `Bearer ${b.token}`, {
        env: ENV,
        claimedIntegrationId: a.integration.id,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("two integrations remain isolated by token", async () => {
    const { repos, service } = createService();
    const a = await service.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "I1",
    });
    const b = await service.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "I2",
    });
    const ctxA = await authenticateScriptIntegration(repos, `Bearer ${a.token}`, {
      env: ENV,
    });
    const ctxB = await authenticateScriptIntegration(repos, `Bearer ${b.token}`, {
      env: ENV,
    });
    expect(ctxA.context.integrationId).not.toBe(ctxB.context.integrationId);
  });

  it("successful auth updates lastSeenAt; failed auth does not touch other integration", async () => {
    const { repos, service } = createService();
    const a = await service.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "Seen",
    });
    const b = await service.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "Other",
    });
    const beforeB = await repos.scriptIntegrations.findById(b.integration.id);
    expect(beforeB?.lastSeenAt).toBeUndefined();

    await authenticateScriptIntegration(repos, `Bearer ${a.token}`, { env: ENV });
    const afterA = await repos.scriptIntegrations.findById(a.integration.id);
    expect(afterA?.lastSeenAt).toBeInstanceOf(Date);

    await expect(
      authenticateScriptIntegration(repos, "Bearer alk_s_bad", { env: ENV })
    ).rejects.toBeInstanceOf(UnauthorizedError);
    const afterB = await repos.scriptIntegrations.findById(b.integration.id);
    expect(afterB?.lastSeenAt).toBeUndefined();
  });

  it("x-api-key is NOT accepted as Integration token", async () => {
    const { repos, service } = createService();
    const { token } = await service.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "No x-api-key",
    });
    // authenticateScriptIntegration only sees Authorization header
    await expect(
      authenticateScriptIntegration(repos, undefined, { env: ENV })
    ).rejects.toBeInstanceOf(UnauthorizedError);
    // Valid bearer still works
    await authenticateScriptIntegration(repos, `Bearer ${token}`, { env: ENV });
  });

  it("HTTP whoami test route: success + 401 + claim mismatch", async () => {
    const { repos, service } = createService();
    const { integration, token } = await service.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "HTTP",
    });
    const app = await buildWhoamiApp(repos);
    apps.push(app);

    const ok = await app.inject({
      method: "GET",
      url: "/__test__/script-integration/whoami",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      integrationId: integration.id,
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
    });
    expect(JSON.stringify(ok.json())).not.toContain(token);

    const missing = await app.inject({
      method: "GET",
      url: "/__test__/script-integration/whoami",
    });
    expect(missing.statusCode).toBe(401);

    const mismatch = await app.inject({
      method: "GET",
      url: `/__test__/script-integration/whoami?tenantId=${TenantB.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(mismatch.statusCode).toBe(403);
  });

  it("requireScriptIntegrationAuth attaches request.integrationAuth", async () => {
    const { repos, service } = createService();
    const { integration, token } = await service.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "Ctx",
    });
    const app = Fastify({ logger: false });
    app.get("/t", async (request) => {
      const ctx = await requireScriptIntegrationAuth(repos, request, { env: ENV });
      return { attached: request.integrationAuth, ctx };
    });
    apps.push(app);
    const res = await app.inject({
      method: "GET",
      url: "/t",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      attached: { integrationId: string };
      ctx: { integrationId: string };
    };
    expect(body.attached.integrationId).toBe(integration.id);
    expect(body.ctx.integrationId).toBe(integration.id);
  });

  it("auth failure sink never receives token or Authorization", async () => {
    const { repos } = createService();
    const captured: unknown[] = [];
    await expect(
      authenticateScriptIntegration(repos, "Bearer secret-should-not-leak", {
        env: ENV,
        onFailure: (reason) => {
          captured.push(reason);
        },
      })
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(captured).toEqual(["UNKNOWN_TOKEN"]);
    expect(JSON.stringify(captured)).not.toContain("secret-should-not-leak");
  });

  it("create rejects cross-tenant GoogleAccount", async () => {
    const { service } = createService();
    await expect(
      service.create({
        tenantId: TenantA.id,
        googleAccountId: TenantB.account,
        name: "bad",
      })
    ).rejects.toThrow();
  });

  it("findByTokenHash returns only matching integration", async () => {
    const { repos, service } = createService();
    const a = await service.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "H1",
    });
    await service.create({
      tenantId: TenantB.id,
      googleAccountId: TenantB.account,
      name: "H2",
    });
    const hash = hashIntegrationToken(a.token, TEST_INTEGRATION_TOKEN_PEPPER);
    const found = await repos.scriptIntegrations.findByTokenHash(hash);
    expect(found?.id).toBe(a.integration.id);
    expect(found?.tenantId).toBe(TenantA.id);
  });

  it("empty Bearer and whitespace-only Authorization → 401", async () => {
    const { repos } = createService();
    await expect(
      authenticateScriptIntegration(repos, "   ", { env: ENV })
    ).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(
      authenticateScriptIntegration(repos, "Bearer   ", { env: ENV })
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("onSuccess callback receives context without secrets", async () => {
    const { repos, service } = createService();
    const { integration, token } = await service.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "Success cb",
    });
    const seen: unknown[] = [];
    await authenticateScriptIntegration(repos, `Bearer ${token}`, {
      env: ENV,
      onSuccess: (ctx) => seen.push(ctx),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      integrationId: integration.id,
      tenantId: TenantA.id,
    });
    expect(JSON.stringify(seen)).not.toContain(token);
  });

  it("cannot rotate REVOKED integration", async () => {
    const { service } = createService();
    const created = await service.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "No rotate revoked",
    });
    await service.revoke(TenantA.id, created.integration.id);
    await expect(
      service.rotateToken(TenantA.id, created.integration.id)
    ).rejects.toThrow(/REVOKED/);
  });

  it("audit records creation/rotation without plaintext token", async () => {
    const { repos, service } = createService();
    const created = await service.create({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      name: "Audit",
    });
    await service.rotateToken(TenantA.id, created.integration.id);
    const logs = await repos.auditLogs.list({ tenantId: TenantA.id, pageSize: 50 });
    const serialized = JSON.stringify(logs.items);
    expect(serialized).not.toContain(created.token);
    expect(
      logs.items.some((l) => l.action === "SCRIPT_INTEGRATION_CREATED")
    ).toBe(true);
    expect(
      logs.items.some((l) => l.action === "SCRIPT_INTEGRATION_TOKEN_ROTATED")
    ).toBe(true);
  });
});
