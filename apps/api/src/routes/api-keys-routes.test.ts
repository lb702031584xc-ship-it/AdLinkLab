/**
 * P0-3 routes + P0-5 session integration — POST/GET /api/v1/auth/api-keys,
 * rotate/revoke, change-password, logout revocation, DB-key auth hook.
 * In-memory fake Prisma (no live DB) + Fastify inject.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { registerAuthRoutes } from "./auth.js";
import { registerApiKeyRoutes } from "./api-keys.js";
import { createObservabilityErrorHandler } from "../observability/index.js";
import { registerDbApiKeyAuthHook, registerSessionAuthHook, requireTenant } from "../auth/tenant.js";
import { authenticateDbApiKey } from "../auth/api-keys.js";
import { hashSessionToken } from "../auth/sessions.js";
import { revokeToken } from "../auth/token-revocation.js";

type Row = Record<string, any>;

function matchesWhere(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    if (value !== null && typeof value === "object") return false;
    return row[key] === value;
  });
}

function makeDelegate(store: Row[], users?: Row[]) {
  return {
    create: async ({ data }: any) => {
      const row = { createdAt: new Date(), updatedAt: new Date(), ...data };
      store.push(row);
      return { ...row };
    },
    findUnique: async ({ where, include }: any) => {
      const row = store.find((r) => matchesWhere(r, where)) ?? null;
      if (!row) return null;
      const out = { ...row };
      if (include?.user && users) {
        const user = users.find((u) => u.id === row.userId) ?? null;
        (out as Row).user = user ? { ...user } : null;
      }
      return out;
    },
    findFirst: async ({ where }: any) => {
      const row = store.find((r) => matchesWhere(r, where)) ?? null;
      return row ? { ...row } : null;
    },
    findMany: async ({ where, orderBy }: any) => {
      let rows = store.filter((r) => matchesWhere(r, where));
      if (orderBy?.createdAt === "desc") {
        rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      return rows.map((r) => ({ ...r }));
    },
    update: async ({ where, data }: any) => {
      const row = store.find((r) => matchesWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return { ...row };
    },
    count: async ({ where }: any) => store.filter((r) => matchesWhere(r, where)).length,
    delete: async ({ where }: any) => {
      const idx = store.findIndex((r) => matchesWhere(r, where));
      if (idx < 0) throw new Error("record not found");
      const [row] = store.splice(idx, 1);
      return { ...row };
    },
    deleteMany: async ({ where }: any) => {
      let count = 0;
      for (let i = store.length - 1; i >= 0; i--) {
        if (matchesWhere(store[i], where)) {
          store.splice(i, 1);
          count++;
        }
      }
      return { count };
    },
  };
}

function makeFakePrisma() {
  const tenants: Row[] = [];
  const users: Row[] = [];
  const sessions: Row[] = [];
  const apiKeys: Row[] = [];
  const tokenRevocations: Row[] = [];
  return {
    tenant: makeDelegate(tenants),
    user: makeDelegate(users),
    session: makeDelegate(sessions, users),
    apiKey: makeDelegate(apiKeys),
    tokenRevocation: makeDelegate(tokenRevocations),
    _stores: { tenants, users, sessions, apiKeys, tokenRevocations },
  };
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

async function buildTestApp(fake: FakePrisma) {
  const app = Fastify({ logger: false });
  app.setErrorHandler(createObservabilityErrorHandler());
  registerSessionAuthHook(app, fake as unknown as PrismaClient);
  registerDbApiKeyAuthHook(app, fake as unknown as PrismaClient);
  await registerAuthRoutes(app, { prisma: fake as unknown as PrismaClient });
  await registerApiKeyRoutes(app, { prisma: fake as unknown as PrismaClient });
  // Probe route exercising requireTenant in api_key mode.
  app.get("/probe", async (request) => ({
    tenantId: requireTenant(
      { mode: "api_key", registry: [] },
      request
    ),
  }));
  return app;
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function registerViaRoute(app: Awaited<ReturnType<typeof buildTestApp>>, email: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email, name: "Test", password: "password123" },
  });
  const body = res.json() as { token: string; user: { id: string; role: string; tenantId: string } };
  return { token: body.token, user: body.user };
}

async function loginViaRoute(app: Awaited<ReturnType<typeof buildTestApp>>, email: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password: "password123" },
  });
  const body = res.json() as { token: string; user: { id: string } };
  return { token: body.token, user: body.user };
}

describe("API key management routes", () => {
  let fake: FakePrisma;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let adminToken: string;
  let adminTenantId: string;

  beforeEach(async () => {
    fake = makeFakePrisma();
    app = await buildTestApp(fake);
    const admin = await registerViaRoute(app, "boss@example.com");
    adminToken = admin.token;
    adminTenantId = admin.user.tenantId;
    await registerViaRoute(app, "member@example.com");
  });

  it("non-admin cannot create; admin creates and list hides hash/plaintext", async () => {
    const member = await loginViaRoute(app, "member@example.com");
    const forbidden = await app.inject({
      method: "POST",
      url: "/api/v1/auth/api-keys",
      headers: bearer(member.token),
      payload: { name: "x" },
    });
    expect(forbidden.statusCode).toBe(403);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/auth/api-keys",
      headers: bearer(adminToken),
      payload: { name: "CI key", scopes: ["read"], ipWhitelist: ["203.0.113.9"] },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as { apiKey: any; key: string };
    expect(body.key).toMatch(/^alk_[0-9a-f]{64}$/);
    expect(body.apiKey.keyPrefix).toBe(body.key.slice(0, 8));
    expect(body.apiKey.status).toBe("active");
    expect(body.apiKey).not.toHaveProperty("keyHash");
    expect(body.apiKey).not.toHaveProperty("key");

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/auth/api-keys",
      headers: bearer(adminToken),
    });
    const listed = list.json() as { apiKeys: any[] };
    expect(listed.apiKeys).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(body.key);
    expect(listed.apiKeys[0]).not.toHaveProperty("keyHash");
  });

  it("create validation: bad IP whitelist / past expiry / missing name → 400", async () => {
    for (const payload of [
      { name: "x", ipWhitelist: ["not-an-ip"] },
      { name: "x", expiresAt: "2020-01-01T00:00:00Z" },
      { name: "" },
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/api-keys",
        headers: bearer(adminToken),
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it("rotate: new key returned once, old key in grace then revoked after revoke", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/auth/api-keys",
      headers: bearer(adminToken),
      payload: { name: "rot" },
    });
    const { apiKey, key: oldKey } = created.json() as { apiKey: { id: string }; key: string };

    const rotated = await app.inject({
      method: "POST",
      url: `/api/v1/auth/api-keys/${apiKey.id}/rotate`,
      headers: bearer(adminToken),
    });
    expect(rotated.statusCode).toBe(201);
    const rotatedBody = rotated.json() as { apiKey: { id: string }; key: string };
    expect(rotatedBody.key).not.toBe(oldKey);

    // Old key still authenticates inside the grace window.
    const graceCheck = await authenticateDbApiKey(fake as unknown as PrismaClient, oldKey, undefined);
    expect(graceCheck.status).toBe("ok");
    if (graceCheck.status === "ok") expect(graceCheck.inGrace).toBe(true);

    // Rotating an already-revoked key → 409.
    const again = await app.inject({
      method: "POST",
      url: `/api/v1/auth/api-keys/${apiKey.id}/rotate`,
      headers: bearer(adminToken),
    });
    expect(again.statusCode).toBe(409);

    // Revoking the new key kills it (grace cleared).
    const revoked = await app.inject({
      method: "POST",
      url: `/api/v1/auth/api-keys/${rotatedBody.apiKey.id}/revoke`,
      headers: bearer(adminToken),
    });
    expect(revoked.statusCode).toBe(200);
    expect(
      await authenticateDbApiKey(fake as unknown as PrismaClient, rotatedBody.key, undefined)
    ).toEqual({ status: "rejected", reason: "revoked" });
  });

  it("cross-tenant key ids → 404; other admin's list is empty", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/auth/api-keys",
      headers: bearer(adminToken),
      payload: { name: "mine" },
    });
    const { apiKey } = created.json() as { apiKey: { id: string } };

    // Admin creates a second admin (own tenant).
    const co = await app.inject({
      method: "POST",
      url: "/api/v1/auth/admin/users",
      headers: bearer(adminToken),
      payload: { email: "coadmin@example.com", password: "password123", role: "admin" },
    });
    expect(co.statusCode).toBe(201);
    const coLogin = await loginViaRoute(app, "coadmin@example.com");

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/auth/api-keys",
      headers: bearer(coLogin.token),
    });
    expect((list.json() as { apiKeys: unknown[] }).apiKeys).toHaveLength(0);
    const rotate = await app.inject({
      method: "POST",
      url: `/api/v1/auth/api-keys/${apiKey.id}/rotate`,
      headers: bearer(coLogin.token),
    });
    expect(rotate.statusCode).toBe(404);
  });

  it("DB key authenticates via the hook on a requireTenant route; revoked key → 401", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/auth/api-keys",
      headers: bearer(adminToken),
      payload: { name: "hook" },
    });
    const { apiKey, key } = created.json() as { apiKey: { id: string }; key: string };

    const probe = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { "x-api-key": key },
    });
    expect(probe.statusCode).toBe(200);
    expect((probe.json() as { tenantId: string }).tenantId).toBe(adminTenantId);

    await app.inject({
      method: "POST",
      url: `/api/v1/auth/api-keys/${apiKey.id}/revoke`,
      headers: bearer(adminToken),
    });
    const afterRevoke = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { "x-api-key": key },
    });
    expect(afterRevoke.statusCode).toBe(401);
  });

  it("change-password: wrong current → 401; correct → new token works, old token dead", async () => {
    const wrong = await app.inject({
      method: "POST",
      url: "/api/v1/auth/change-password",
      headers: bearer(adminToken),
      payload: { currentPassword: "nope-nope", newPassword: "newpassword123" },
    });
    expect(wrong.statusCode).toBe(401);

    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/auth/change-password",
      headers: bearer(adminToken),
      payload: { currentPassword: "password123", newPassword: "newpassword123" },
    });
    expect(ok.statusCode).toBe(200);
    const newToken = (ok.json() as { token: string }).token;
    expect(newToken).not.toBe(adminToken);

    const oldMe = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: bearer(adminToken) });
    expect(oldMe.statusCode).toBe(401);
    const newMe = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: bearer(newToken) });
    expect(newMe.statusCode).toBe(200);
    // A revocation row was written for the old session token.
    expect(fake._stores.tokenRevocations.length).toBeGreaterThan(0);
  });

  it("logout writes a revocation; a blacklisted token is rejected even with its row present", async () => {
    const login = await loginViaRoute(app, "boss@example.com");
    const out = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: bearer(login.token),
    });
    expect(out.statusCode).toBe(200);
    expect(fake._stores.tokenRevocations.length).toBeGreaterThan(0);

    // Fresh login, then blacklist without deleting the row.
    const login2 = await loginViaRoute(app, "boss@example.com");
    await revokeToken(
      fake as unknown as PrismaClient,
      {
        tokenHash: hashSessionToken(login2.token),
        type: "session",
        reason: "test",
        expiresAt: new Date(Date.now() + 3600_000),
      },
      { redis: null }
    );
    const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: bearer(login2.token) });
    expect(me.statusCode).toBe(401);
  });
});
