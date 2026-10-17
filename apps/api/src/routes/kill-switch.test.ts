/**
 * Phase 3 — kill-switch route tests. In-memory fake Prisma + Fastify inject.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import {
  SESSION_COOKIE_NAME,
  createSession,
} from "../auth/sessions.js";
import { createObservabilityErrorHandler } from "../observability/index.js";
import { registerKillSwitchRoutes } from "./kill-switch.js";

type Row = Record<string, any>;

interface Ctx {
  tenants: Row[];
  users: Row[];
  sessions: Row[];
  offers: Row[];
  configs: Row[];
  events: Row[];
  auditLogs: Row[];
}

function baseCtx(): Ctx {
  return {
    tenants: [],
    users: [],
    sessions: [],
    offers: [],
    configs: [],
    events: [],
    auditLogs: [],
  };
}

function makeFake(ctx: Ctx) {
  return {
    tenant: {
      create: async (args: any) => {
        const row = { ...args.data };
        ctx.tenants.push(row);
        return row;
      },
    },
    user: {
      create: async (args: any) => {
        const row = { ...args.data };
        ctx.users.push(row);
        return row;
      },
      findUnique: async (args: any) =>
        ctx.users.find((u) => u.id === args.where.id) ?? null,
    },
    session: {
      create: async (args: any) => {
        const row = { ...args.data };
        ctx.sessions.push(row);
        return row;
      },
      findUnique: async (args: any) => {
        const row =
          ctx.sessions.find((s) => s.tokenHash === args.where.tokenHash) ??
          null;
        if (!row) return null;
        return {
          ...row,
          user: ctx.users.find((u) => u.id === row.userId) ?? null,
        };
      },
      findFirst: async (args: any) => {
        const rows = ctx.sessions.filter((s) =>
          Object.entries(args.where ?? {}).every(([k, v]) => s[k] === v)
        );
        return rows[0] ?? null;
      },
      update: async (args: any) => {
        const row = ctx.sessions.find((s) => s.id === args.where.id);
        if (row) Object.assign(row, args.data);
        return row ?? null;
      },
    },
    offer: {
      findFirst: async (args: any) =>
        ctx.offers.find((o) =>
          Object.entries(args.where ?? {}).every(([k, v]) =>
            v === null ? o[k] == null : o[k] === v
          )
        ) ?? null,
    },
    killSwitchConfig: {
      findUnique: async (args: any) =>
        ctx.configs.find((c) => c.offerId === args.where.offerId) ?? null,
      upsert: async (args: any) => {
        let row = ctx.configs.find((c) => c.offerId === args.where.offerId);
        if (row) Object.assign(row, args.update);
        else {
          row = { ...args.create, createdAt: new Date(), updatedAt: new Date() };
          ctx.configs.push(row);
        }
        return row;
      },
    },
    killSwitchEvent: {
      count: async (args: any) =>
        ctx.events.filter((e) =>
          Object.entries(args.where ?? {}).every(([k, v]) =>
            v === null ? e[k] == null : e[k] === v
          )
        ).length,
      findMany: async (args: any) => {
        let rows = ctx.events.filter((e) =>
          Object.entries(args.where ?? {}).every(([k, v]) =>
            v === null ? e[k] == null : e[k] === v
          )
        );
        rows = [...rows].sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        const skip = args.skip ?? 0;
        return rows.slice(skip, skip + (args.take ?? rows.length));
      },
    },
    auditLog: {
      create: async (args: any) => {
        const row = { ...args.data };
        ctx.auditLogs.push(row);
        return row;
      },
    },
  } as unknown as PrismaClient;
}

type FakePrisma = ReturnType<typeof makeFake>;

function cookie(token: string) {
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

async function seedAuth(fake: FakePrisma, ctx: Ctx) {
  const tenantId = randomUUID();
  await (fake as any).tenant.create({
    data: { id: tenantId, name: "t", slug: `t-${tenantId.slice(0, 8)}`, status: "ACTIVE" },
  });
  const user = await (fake as any).user.create({
    data: {
      id: randomUUID(),
      tenantId,
      email: "member@example.com",
      name: "member",
      role: "member",
      status: "ACTIVE",
    },
  });
  const session = await createSession(fake as unknown as PrismaClient, user.id);
  return { tenantId, user, token: session.token };
}

async function buildApp(fake: FakePrisma) {
  const app = Fastify({ logger: false });
  app.setErrorHandler(createObservabilityErrorHandler());
  await registerKillSwitchRoutes(app, { prisma: fake as unknown as PrismaClient });
  return app;
}

describe("kill-switch routes", () => {
  let ctx: Ctx;
  let fake: FakePrisma;
  let app: any;
  let auth: { tenantId: string; token: string };
  let offerId: string;

  beforeEach(async () => {
    ctx = baseCtx();
    fake = makeFake(ctx);
    app = await buildApp(fake);
    auth = await seedAuth(fake, ctx);
    offerId = randomUUID();
    ctx.offers.push({
      id: offerId,
      tenantId: auth.tenantId,
      name: "Offer A",
      deletedAt: null,
    });
  });

  it("GET config returns safe defaults when unconfigured", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/offers/${offerId}/kill-switch`,
      headers: cookie(auth.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.configured).toBe(false);
    expect(body.enabled).toBe(false);
    expect(body.maxSpend).toBeNull();
    expect(body.pauseOnMerchantTerminated).toBe(true);
  });

  it("PUT config upserts thresholds and writes an audit log", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/offers/${offerId}/kill-switch`,
      headers: cookie(auth.token),
      payload: {
        enabled: true,
        maxSpend: 500,
        minExpectedProfit: 100,
        minCvr: 0.02,
        maxPolicyRisk: 70,
        reason: "arming for Q4 push",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.configured).toBe(true);
    expect(body.enabled).toBe(true);
    expect(body.maxSpend).toBe(500);
    expect(body.minExpectedProfit).toBe(100);
    expect(body.minCvr).toBe(0.02);
    expect(body.maxPolicyRisk).toBe(70);
    expect(ctx.auditLogs).toHaveLength(1);
    expect(ctx.auditLogs[0].action).toBe("KILL_SWITCH_CONFIG_UPDATE");
    expect(ctx.auditLogs[0].reason).toBe("arming for Q4 push");

    // GET now returns the persisted config.
    const get = await app.inject({
      method: "GET",
      url: `/api/v1/offers/${offerId}/kill-switch`,
      headers: cookie(auth.token),
    });
    expect(get.json().configured).toBe(true);
    expect(get.json().enabled).toBe(true);
  });

  it("PUT rejects invalid thresholds", async () => {
    const bad = await app.inject({
      method: "PUT",
      url: `/api/v1/offers/${offerId}/kill-switch`,
      headers: cookie(auth.token),
      payload: { minCvr: 2 },
    });
    expect(bad.statusCode).toBe(400);

    const bad2 = await app.inject({
      method: "PUT",
      url: `/api/v1/offers/${offerId}/kill-switch`,
      headers: cookie(auth.token),
      payload: { maxPolicyRisk: 101 },
    });
    expect(bad2.statusCode).toBe(400);
  });

  it("PUT on another tenant's offer returns 404", async () => {
    const otherId = randomUUID();
    ctx.offers.push({
      id: otherId,
      tenantId: randomUUID(),
      name: "Other",
      deletedAt: null,
    });
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/offers/${otherId}/kill-switch`,
      headers: cookie(auth.token),
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(404);
  });

  it("requires authentication", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/offers/${offerId}/kill-switch`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET events lists firing history with pagination", async () => {
    for (let i = 0; i < 3; i++) {
      ctx.events.push({
        id: randomUUID(),
        tenantId: auth.tenantId,
        offerId,
        triggeredBy: "CVR_FLOOR",
        conditionSnapshot: {},
        actionTaken: "ALERT_ONLY",
        linksPaused: 0,
        autoExecute: false,
        createdAt: new Date(Date.now() - i * 1000),
      });
    }
    // An event from another tenant must not leak.
    ctx.events.push({
      id: randomUUID(),
      tenantId: randomUUID(),
      offerId: randomUUID(),
      triggeredBy: "CVR_FLOOR",
      conditionSnapshot: {},
      actionTaken: "ALERT_ONLY",
      linksPaused: 0,
      autoExecute: false,
      createdAt: new Date(),
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/kill-switch/events?offerId=${offerId}&page=1&pageSize=2`,
      headers: cookie(auth.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(2);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(2);
    // Newest first.
    expect(
      new Date(body.items[0].createdAt).getTime() >=
        new Date(body.items[1].createdAt).getTime()
    ).toBe(true);
  });

  it("GET events rejects a non-UUID offerId", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/kill-switch/events?offerId=nope",
      headers: cookie(auth.token),
    });
    expect(res.statusCode).toBe(400);
  });

  it("P0-10: PUT accepts pauseGoogleAdsToo (default false) and persists it", async () => {
    const getBefore = await app.inject({
      method: "GET",
      url: `/api/v1/offers/${offerId}/kill-switch`,
      headers: cookie(auth.token),
    });
    expect(getBefore.json().pauseGoogleAdsToo).toBe(false);

    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/offers/${offerId}/kill-switch`,
      headers: cookie(auth.token),
      payload: { enabled: true, pauseGoogleAdsToo: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().pauseGoogleAdsToo).toBe(true);

    const getAfter = await app.inject({
      method: "GET",
      url: `/api/v1/offers/${offerId}/kill-switch`,
      headers: cookie(auth.token),
    });
    expect(getAfter.json().pauseGoogleAdsToo).toBe(true);
  });
});
