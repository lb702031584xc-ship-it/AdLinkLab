/**
 * Admin user management — POST / DELETE / PATCH /api/v1/auth/admin/users.
 * In-memory fake Prisma (no live DB) + Fastify inject.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { registerAuthRoutes } from "./auth.js";
import { createObservabilityErrorHandler } from "../observability/index.js";

// ---------------------------------------------------------------------------
// Fake Prisma (in-memory, structural) — mirrors auth-session.test.ts
// ---------------------------------------------------------------------------

type Row = Record<string, any>;

function matchesWhere(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    if (value !== null && typeof value === "object") {
      // P2-5：countActiveAdmins 用 role: { in: ["owner", "admin"] }。
      if ("in" in (value as Record<string, unknown>)) {
        return ((value as Record<string, unknown>).in as unknown[]).includes(row[key]);
      }
      return false;
    }
    return row[key] === value;
  });
}

function makeDelegate(store: Row[], users: Row[]) {
  return {
    create: async ({ data }: any) => {
      const row = { createdAt: new Date(), ...data };
      store.push(row);
      return { ...row };
    },
    findUnique: async ({ where, include }: any) => {
      const row = store.find((r) => matchesWhere(r, where)) ?? null;
      if (!row) return null;
      const out = { ...row };
      if (include?.user) {
        const user = users.find((u) => u.id === row.userId) ?? null;
        (out as Row).user = user ? { ...user } : null;
      }
      return out;
    },
    findFirst: async ({ where }: any) => {
      const row = store.find((r) => matchesWhere(r, where)) ?? null;
      return row ? { ...row } : null;
    },
    findMany: async ({ where }: any) =>
      store.filter((r) => matchesWhere(r, where)).map((r) => ({ ...r })),
    update: async ({ where, data }: any) => {
      const row = store.find((r) => matchesWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return { ...row };
    },
    count: async ({ where }: any) =>
      store.filter((r) => matchesWhere(r, where)).length,
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
  return {
    tenant: makeDelegate(tenants, users),
    user: makeDelegate(users, users),
    session: makeDelegate(sessions, users),
    _stores: { tenants, users, sessions },
  };
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

async function buildTestApp(fake: FakePrisma) {
  const app = Fastify({ logger: false });
  app.setErrorHandler(createObservabilityErrorHandler());
  await registerAuthRoutes(app, { prisma: fake as unknown as PrismaClient });
  return app;
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

/** Register via the public endpoint; first user becomes admin. */
async function registerViaRoute(
  app: Awaited<ReturnType<typeof buildTestApp>>,
  email: string,
  password = "password123",
  name = "Test User"
) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email, name, password },
  });
  const body = res.json() as {
    token: string;
    user: { id: string; email: string; role: string; tenantId: string };
  };
  return { res, token: body.token, user: body.user };
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("admin user management routes", () => {
  let fake: FakePrisma;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let adminToken: string;
  let adminId: string;
  let memberToken: string;
  let memberId: string;

  beforeEach(async () => {
    fake = makeFakePrisma();
    app = await buildTestApp(fake);
    const admin = await registerViaRoute(app, "boss@example.com");
    adminToken = admin.token;
    adminId = admin.user.id;
    const member = await registerViaRoute(app, "worker@example.com");
    memberToken = member.token;
    memberId = member.user.id;
  });

  it("1. non-admin is forbidden (403) on POST/DELETE/PATCH", async () => {
    const headers = bearer(memberToken);
    const post = await app.inject({
      method: "POST",
      url: "/api/v1/auth/admin/users",
      headers,
      payload: { email: "x@example.com", password: "password123", role: "member" },
    });
    expect(post.statusCode).toBe(403);
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/auth/admin/users/${memberId}`,
      headers,
    });
    expect(del.statusCode).toBe(403);
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/auth/admin/users/${memberId}`,
      headers,
      payload: { role: "admin" },
    });
    expect(patch.statusCode).toBe(403);
  });

  it("2. anonymous requests are unauthorized (401)", async () => {
    for (const [method, url, payload] of [
      ["POST", "/api/v1/auth/admin/users", { email: "x@example.com" }],
      ["DELETE", `/api/v1/auth/admin/users/${memberId}`, undefined],
      ["PATCH", `/api/v1/auth/admin/users/${memberId}`, { role: "admin" }],
    ] as const) {
      const res = await app.inject({ method, url, payload });
      expect(res.statusCode).toBe(401);
    }
  });

  it("3. admin creates a user → 201, own tenant, no password hash leaked", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/admin/users",
      headers: bearer(adminToken),
      payload: {
        email: "new@example.com",
        name: "New Hire",
        password: "s3cretpw!",
        role: "researcher",
      },
    });
    expect(res.statusCode).toBe(201);
    const user = (res.json() as { user: Record<string, unknown> }).user;
    expect(user).toMatchObject({
      email: "new@example.com",
      name: "New Hire",
      role: "researcher",
    });
    expect(typeof user.id).toBe("string");
    expect(typeof user.tenantId).toBe("string");
    expect(user).not.toHaveProperty("passwordHash");
    expect(user).not.toHaveProperty("password");
    // Own tenant, distinct from the admin's tenant.
    expect(fake._stores.tenants.some((t) => t.id === user.tenantId)).toBe(true);
    expect(user.tenantId).not.toBe(
      fake._stores.users.find((u) => u.id === adminId)?.tenantId
    );
    // The new user can log in (password was hashed, not stored plain).
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "new@example.com", password: "s3cretpw!" },
    });
    expect(login.statusCode).toBe(200);
  });

  it("4. create validation → 400 (bad email, short password, invalid role)", async () => {
    const headers = bearer(adminToken);
    for (const payload of [
      { email: "not-an-email", password: "password123", role: "member" },
      { email: "ok@example.com", password: "short", role: "member" },
      { email: "ok@example.com", password: "password123", role: "superuser" },
      { email: "ok@example.com", password: "password123" },
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/admin/users",
        headers,
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it("5. duplicate email → 409", async () => {
    const headers = bearer(adminToken);
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/auth/admin/users",
      headers,
      payload: { email: "dupe@example.com", password: "password123", role: "member" },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/auth/admin/users",
      headers,
      payload: { email: "Dupe@Example.com", password: "password123", role: "member" },
    });
    expect(second.statusCode).toBe(409);
  });

  it("6. admin cannot delete themselves → 400", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/auth/admin/users/${adminId}`,
      headers: bearer(adminToken),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { message: string }).message).toMatch(/own/i);
  });

  it("7. deleting an admin while others remain → 200", async () => {
    const headers = bearer(adminToken);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/auth/admin/users",
      headers,
      payload: { email: "coadmin@example.com", password: "password123", role: "admin" },
    });
    expect(created.statusCode).toBe(201);
    const coadminId = (created.json() as { user: { id: string } }).user.id;
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/auth/admin/users/${coadminId}`,
      headers,
    });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ ok: true });
    // The acting admin is untouched and still the sole admin.
    expect(
      fake._stores.users.filter(
        (u) => u.role === "admin" && u.status === "ACTIVE"
      ).map((u) => u.id)
    ).toEqual([adminId]);
  });

  it("8. deleting the last active admin → 409 (concurrent-delete race guard)", async () => {
    const headers = bearer(adminToken);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/auth/admin/users",
      headers,
      payload: { email: "victim@example.com", password: "password123", role: "admin" },
    });
    const victimId = (created.json() as { user: { id: string } }).user.id;
    // Simulate the race this guard protects against: between the auth check
    // and this request a concurrent deletion left a single active admin.
    const origCount = fake.user.count;
    fake.user.count = (async () => 1) as typeof fake.user.count;
    try {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/auth/admin/users/${victimId}`,
        headers,
      });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { message: string }).message).toMatch(
        /last active admin/i
      );
      // The victim was NOT deleted.
      expect(
        fake._stores.users.find((u) => u.id === victimId)?.status
      ).toBe("ACTIVE");
    } finally {
      fake.user.count = origCount;
    }
  });

  it("9. admin delete succeeds → soft-deleted and sessions revoked", async () => {
    const headers = bearer(adminToken);
    // Give the member a live session first.
    const memberLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "worker@example.com", password: "password123" },
    });
    const memberSessionToken = (memberLogin.json() as { token: string }).token;
    expect(memberSessionToken).toBeTruthy();
    expect(
      fake._stores.sessions.some((s) => s.userId === memberId)
    ).toBe(true);

    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/auth/admin/users/${memberId}`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const row = fake._stores.users.find((u) => u.id === memberId);
    expect(row?.status).toBe("DISABLED");
    expect(row?.deletedAt).toBeInstanceOf(Date);
    // Sessions revoked.
    expect(
      fake._stores.sessions.some((s) => s.userId === memberId)
    ).toBe(false);
    // Deleted user can no longer log in (generic message, no enumeration).
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "worker@example.com", password: "password123" },
    });
    expect(login.statusCode).toBe(401);
    expect((login.json() as { message: string }).message).toBe(
      "Invalid email or password"
    );
    // Deleted user no longer appears in the admin list.
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/auth/admin/users",
      headers,
    });
    expect(
      (list.json() as { users: Array<{ id: string }> }).users.map((u) => u.id)
    ).not.toContain(memberId);
  });

  it("10. deleting an unknown user → 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/auth/admin/users/00000000-0000-4000-8000-000000000000",
      headers: bearer(adminToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it("11. patch role: member → admin works and returns the user", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/auth/admin/users/${memberId}`,
      headers: bearer(adminToken),
      payload: { role: "admin" },
    });
    expect(res.statusCode).toBe(200);
    const user = (res.json() as { user: Record<string, unknown> }).user;
    expect(user).toMatchObject({ id: memberId, role: "admin" });
    expect(user).not.toHaveProperty("passwordHash");
  });

  it("12. admin cannot change their own role → 400", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/auth/admin/users/${adminId}`,
      headers: bearer(adminToken),
      payload: { role: "member" },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { message: string }).message).toMatch(/own/i);
  });

  it("13. demoting the last active admin → 409 (concurrent-demote race guard)", async () => {
    const headers = bearer(adminToken);
    // Honest flow: two admins exist, so demoting the co-admin is allowed...
    const promoted = await app.inject({
      method: "PATCH",
      url: `/api/v1/auth/admin/users/${memberId}`,
      headers,
      payload: { role: "admin" },
    });
    expect(promoted.statusCode).toBe(200);
    const demoteOk = await app.inject({
      method: "PATCH",
      url: `/api/v1/auth/admin/users/${memberId}`,
      headers,
      payload: { role: "researcher" },
    });
    expect(demoteOk.statusCode).toBe(200);
    // ...but the guard fires when the count drops to a single active admin,
    // e.g. a concurrent demotion removed the other admin mid-flight.
    const repromote = await app.inject({
      method: "PATCH",
      url: `/api/v1/auth/admin/users/${memberId}`,
      headers,
      payload: { role: "admin" },
    });
    expect(repromote.statusCode).toBe(200);
    const origCount = fake.user.count;
    fake.user.count = (async () => 1) as typeof fake.user.count;
    try {
      const guarded = await app.inject({
        method: "PATCH",
        url: `/api/v1/auth/admin/users/${memberId}`,
        headers,
        payload: { role: "member" },
      });
      expect(guarded.statusCode).toBe(409);
      expect((guarded.json() as { message: string }).message).toMatch(
        /last active admin/i
      );
      expect(
        fake._stores.users.find((u) => u.id === memberId)?.role
      ).toBe("admin");
    } finally {
      fake.user.count = origCount;
    }
  });

  it("15. invariant: the system always retains at least one active admin", async () => {
    const headers = bearer(adminToken);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/auth/admin/users",
      headers,
      payload: { email: "temp@example.com", password: "password123", role: "admin" },
    });
    const tempId = (created.json() as { user: { id: string } }).user.id;
    // Delete every other admin; the last one (self) is protected.
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/auth/admin/users/${tempId}`,
      headers,
    });
    expect(del.statusCode).toBe(200);
    const selfDel = await app.inject({
      method: "DELETE",
      url: `/api/v1/auth/admin/users/${adminId}`,
      headers,
    });
    expect(selfDel.statusCode).toBe(400);
    const selfDemote = await app.inject({
      method: "PATCH",
      url: `/api/v1/auth/admin/users/${adminId}`,
      headers,
      payload: { role: "member" },
    });
    expect(selfDemote.statusCode).toBe(400);
    expect(
      fake._stores.users.filter(
        (u) => u.role === "admin" && u.status === "ACTIVE"
      ).length
    ).toBeGreaterThanOrEqual(1);
  });

  it("14. patch validation: invalid role and bad id → 400, unknown user → 404", async () => {
    const headers = bearer(adminToken);
    const badRole = await app.inject({
      method: "PATCH",
      url: `/api/v1/auth/admin/users/${memberId}`,
      headers,
      payload: { role: "superuser" },
    });
    expect(badRole.statusCode).toBe(400);
    const badId = await app.inject({
      method: "PATCH",
      url: "/api/v1/auth/admin/users/not-a-uuid",
      headers,
      payload: { role: "member" },
    });
    expect(badId.statusCode).toBe(400);
    const unknown = await app.inject({
      method: "PATCH",
      url: "/api/v1/auth/admin/users/00000000-0000-4000-8000-000000000000",
      headers,
      payload: { role: "member" },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it("14b. P2-5: admin assigning owner → 403 (only owner may assign owner)", async () => {
    const headers = bearer(adminToken);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/auth/admin/users/${memberId}`,
      headers,
      payload: { role: "owner" },
    });
    expect(res.statusCode).toBe(403);
  });
});
