/**
 * P0-4 routes — GET/POST /api/v1/admin/ip-bans, revoke, + enforcement hook.
 * In-memory fake Prisma (no live DB) + Fastify inject.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { registerAuthRoutes } from "./auth.js";
import { registerIpBanRoutes } from "./ip-bans.js";
import { registerIpBanHooks } from "../auth/ip-ban.js";
import { createObservabilityErrorHandler } from "../observability/index.js";

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
  const ipBans: Row[] = [];
  const tokenRevocations: Row[] = [];
  return {
    tenant: makeDelegate(tenants),
    user: makeDelegate(users),
    session: makeDelegate(sessions, users),
    ipBan: makeDelegate(ipBans),
    tokenRevocation: makeDelegate(tokenRevocations),
    _stores: { tenants, users, sessions, ipBans, tokenRevocations },
  };
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

async function buildTestApp(fake: FakePrisma) {
  const app = Fastify({ logger: false });
  app.setErrorHandler(createObservabilityErrorHandler());
  registerIpBanHooks(app, fake as unknown as PrismaClient, { autoEnabled: false });
  await registerAuthRoutes(app, { prisma: fake as unknown as PrismaClient });
  await registerIpBanRoutes(app, { prisma: fake as unknown as PrismaClient });
  app.get("/ping", async () => ({ ok: true }));
  return app;
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function registerViaRoute(app: Awaited<ReturnType<typeof buildTestApp>>, email: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email, name: "Test", password: "password123" },
  });
  const body = res.json() as { token: string; user: { id: string } };
  return { token: body.token, user: body.user };
}

describe("IP ban management routes", () => {
  let fake: FakePrisma;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let adminToken: string;

  beforeEach(async () => {
    fake = makeFakePrisma();
    app = await buildTestApp(fake);
    const admin = await registerViaRoute(app, "boss@example.com");
    adminToken = admin.token;
    await registerViaRoute(app, "member@example.com");
  });

  it("admin creates/lists/revokes; duplicate active ban → 409", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/ip-bans",
      headers: bearer(adminToken),
      payload: { ip: "203.0.113.9", reason: "abuse" },
    });
    expect(created.statusCode).toBe(201);
    const ban = (created.json() as { ipBan: any }).ipBan;
    expect(ban.level).toBe("manual");
    expect(ban.active).toBe(true);

    const dup = await app.inject({
      method: "POST",
      url: "/api/v1/admin/ip-bans",
      headers: bearer(adminToken),
      payload: { ip: "203.0.113.9", reason: "again" },
    });
    expect(dup.statusCode).toBe(409);

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/admin/ip-bans",
      headers: bearer(adminToken),
    });
    expect((list.json() as { ipBans: any[] }).ipBans).toHaveLength(1);

    const revoked = await app.inject({
      method: "POST",
      url: `/api/v1/admin/ip-bans/${ban.id}/revoke`,
      headers: bearer(adminToken),
    });
    expect(revoked.statusCode).toBe(200);
    const again = await app.inject({
      method: "POST",
      url: `/api/v1/admin/ip-bans/${ban.id}/revoke`,
      headers: bearer(adminToken),
    });
    expect((again.json() as { alreadyRevoked: boolean }).alreadyRevoked).toBe(true);
  });

  it("validation: bad IP / missing reason → 400; non-admin → 403; unknown id → 404", async () => {
    const memberLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "member@example.com", password: "password123" },
    });
    const memberToken = (memberLogin.json() as { token: string }).token;

    const badIp = await app.inject({
      method: "POST",
      url: "/api/v1/admin/ip-bans",
      headers: bearer(adminToken),
      payload: { ip: "nope", reason: "x" },
    });
    expect(badIp.statusCode).toBe(400);
    const noReason = await app.inject({
      method: "POST",
      url: "/api/v1/admin/ip-bans",
      headers: bearer(adminToken),
      payload: { ip: "203.0.113.9", reason: "" },
    });
    expect(noReason.statusCode).toBe(400);
    const forbidden = await app.inject({
      method: "POST",
      url: "/api/v1/admin/ip-bans",
      headers: bearer(memberToken),
      payload: { ip: "203.0.113.9", reason: "x" },
    });
    expect(forbidden.statusCode).toBe(403);
    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/admin/ip-bans/nonexistent/revoke",
      headers: bearer(adminToken),
    });
    expect(missing.statusCode).toBe(404);
  });

  it("ban takes effect immediately; revoke lifts it", async () => {
    const ip = "203.0.113.9";
    const before = await app.inject({ method: "GET", url: "/ping", remoteAddress: ip });
    expect(before.statusCode).toBe(200);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/ip-bans",
      headers: bearer(adminToken),
      payload: { ip, reason: "abuse" },
    });
    const ban = (created.json() as { ipBan: { id: string } }).ipBan;

    const blocked = await app.inject({ method: "GET", url: "/ping", remoteAddress: ip });
    expect(blocked.statusCode).toBe(403);

    await app.inject({
      method: "POST",
      url: `/api/v1/admin/ip-bans/${ban.id}/revoke`,
      headers: bearer(adminToken),
    });
    const after = await app.inject({ method: "GET", url: "/ping", remoteAddress: ip });
    expect(after.statusCode).toBe(200);
    expect(fake._stores.ipBans[0].revokedAt).not.toBeNull();
  });
});
