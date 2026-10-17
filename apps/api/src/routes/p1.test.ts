/**
 * P1 — route contracts: brand-check, offer-performance stats,
 * monitoring rules/alerts/run. In-memory fake Prisma + Fastify inject.
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
import { registerAiRoutes } from "./ai.js";
import { registerMonitoringRoutes } from "./monitoring.js";
import { registerStatsRoutes } from "./stats.js";

type Row = Record<string, any>;

function flatMatches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      // Range / set filters on scalar fields.
      const rv = row[k];
      if ("gte" in v && !(rv >= (v as any).gte)) return false;
      if ("gt" in v && !(rv > (v as any).gt)) return false;
      if ("lt" in v && !(rv < (v as any).lt)) return false;
      if ("lte" in v && !(rv <= (v as any).lte)) return false;
      if ("notIn" in v && ((v as any).notIn as any[]).includes(rv)) return false;
      // Nested relation filters (e.g. click: {...}) are ignored by fakes.
      return true;
    }
    return row[k] === v;
  });
}

function makeFakePrisma() {
  const tenants: Row[] = [];
  const users: Row[] = [];
  const sessions: Row[] = [];
  const offers: Row[] = [];
  const clicks: Row[] = [];
  const conversions: Row[] = [];
  const orders: Row[] = [];
  const alertRules: Row[] = [];
  const alerts: Row[] = [];
  const trackingLinks: Row[] = [];

  const user = {
    findFirst: async ({ where }: any) =>
      users.find((r) => flatMatches(r, where)) ?? null,
    create: async ({ data }: any) => {
      const row = { ...data };
      users.push(row);
      return { ...row };
    },
  };
  const tenant = {
    findUnique: async ({ where }: any) =>
      tenants.find((r) => flatMatches(r, where)) ?? null,
    create: async ({ data }: any) => {
      const row = { ...data };
      tenants.push(row);
      return { ...row };
    },
  };
  const session = {
    create: async ({ data }: any) => {
      const row = { createdAt: new Date(), ...data };
      sessions.push(row);
      return { ...row };
    },
    findUnique: async ({ where, include }: any) => {
      const row = sessions.find((r) => flatMatches(r, where)) ?? null;
      if (!row) return null;
      const out = { ...row };
      if (include?.user) {
        out.user = users.find((u) => u.id === row.userId) ?? null;
      }
      return out;
    },
  };
  const offer = {
    findFirst: async ({ where }: any) =>
      offers.find((r) => flatMatches(r, where)) ?? null,
  };
  const click = {
    count: async ({ where }: any) =>
      clicks.filter((r) => flatMatches(r, where)).length,
    groupBy: async ({ where, _count }: any) => {
      const rows = clicks.filter((r) => flatMatches(r, where));
      if (_count?._all) {
        const byCountry = new Map<string | null, number>();
        for (const r of rows) {
          byCountry.set(r.country ?? null, (byCountry.get(r.country ?? null) ?? 0) + 1);
        }
        return [...byCountry.entries()].map(([country, n]) => ({
          country,
          _count: { _all: n },
        }));
      }
      return [];
    },
  };
  const conversion = {
    count: async ({ where }: any) =>
      conversions.filter((r) => flatMatches(r, where)).length,
    aggregate: async ({ where, _sum }: any) => {
      if (_sum?.value) {
        const total = conversions
          .filter((r) => flatMatches(r, where))
          .reduce((s, r) => s + (r.value ?? 0), 0);
        return { _sum: { value: total } };
      }
      return { _sum: {} };
    },
    groupBy: async ({ where }: any) => {
      const rows = conversions.filter((r) => flatMatches(r, where));
      const byCur = new Map<string | null, number>();
      for (const r of rows) {
        byCur.set(r.currency ?? null, (byCur.get(r.currency ?? null) ?? 0) + 1);
      }
      return [...byCur.entries()].map(([currency, n]) => ({
        currency,
        _count: { currency: n },
      }));
    },
  };
  const order = {
    groupBy: async ({ where }: any) => {
      const rows = orders.filter((r) => flatMatches(r, where));
      const byStatus = new Map<string, number>();
      for (const r of rows) {
        byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
      }
      return [...byStatus.entries()].map(([status, n]) => ({
        status,
        _count: { _all: n },
      }));
    },
  };
  const alertRule = {
    findMany: async ({ where, orderBy }: any) => {
      let rows = alertRules.filter((r) => flatMatches(r, where));
      if (orderBy?.createdAt === "asc")
        rows = [...rows].sort((a, b) => a.createdAt - b.createdAt);
      return rows.map((r) => ({ ...r }));
    },
    findFirst: async ({ where }: any) =>
      alertRules.find((r) => flatMatches(r, where)) ?? null,
    create: async ({ data }: any) => {
      const row = { createdAt: new Date(), updatedAt: new Date(), ...data };
      alertRules.push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const row = alertRules.find((r) => r.id === where.id)!;
      Object.assign(row, data, { updatedAt: new Date() });
      return { ...row };
    },
    delete: async ({ where }: any) => {
      const i = alertRules.findIndex((r) => r.id === where.id);
      if (i >= 0) alertRules.splice(i, 1);
      return {};
    },
  };
  const alert = {
    findMany: async ({ where, orderBy, take }: any) => {
      let rows = alerts.filter((r) => flatMatches(r, where));
      if (orderBy?.createdAt === "desc")
        rows = [...rows].sort((a, b) => b.createdAt - a.createdAt);
      if (typeof take === "number") rows = rows.slice(0, take);
      return rows.map((r) => ({ ...r }));
    },
    findFirst: async ({ where }: any) =>
      alerts.find((r) => flatMatches(r, where)) ?? null,
    create: async ({ data }: any) => {
      const row = { createdAt: new Date(), updatedAt: new Date(), ...data };
      alerts.push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const row = alerts.find((r) => r.id === where.id)!;
      Object.assign(row, data, { updatedAt: new Date() });
      return { ...row };
    },
  };
  const trackingLink = {
    findMany: async ({ where, take }: any) => {
      let rows = trackingLinks.filter((r) => flatMatches(r, where));
      if (typeof take === "number") rows = rows.slice(0, take);
      return rows.map((r) => ({ ...r }));
    },
    update: async ({ where, data }: any) => {
      const row = trackingLinks.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return { ...row };
    },
  };
  // P0-8 — error_reports fake.
  const errorReports: Row[] = [];
  const errorReport = {
    findMany: async ({ where, orderBy, take }: any) => {
      let rows = errorReports.filter((r) => flatMatches(r, where));
      if (orderBy?.lastSeenAt === "desc")
        rows = [...rows].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
      if (typeof take === "number") rows = rows.slice(0, take);
      return rows.map((r) => ({ ...r }));
    },
  };
  // P0-6 — ai_usage_daily fake (aggregate only)。
  // 注意：date 是 Date 对象，flatMatches 的 === 比较对 Date 恒为 false，
  // 这里用 getTime() 比较日期相等，范围用 >= / <=。
  const aiUsageDailyRows: Row[] = [];
  const aiUsageDaily = {
    aggregate: async ({ where }: any) => {
      const rows = aiUsageDailyRows.filter((r) => {
        if (where?.tenantId && r.tenantId !== where.tenantId) return false;
        const d = where?.date;
        if (d instanceof Date) {
          return r.date instanceof Date && r.date.getTime() === d.getTime();
        }
        if (d && typeof d === "object") {
          if (d.gte && !(r.date >= d.gte)) return false;
          if (d.lte && !(r.date <= d.lte)) return false;
        }
        return true;
      });
      const sum = (k: string) => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
      return {
        _sum: {
          tokensIn: sum("tokensIn"),
          tokensOut: sum("tokensOut"),
          costCents: sum("costCents"),
          calls: sum("calls"),
        },
      };
    },
  };

  return {
    user,
    tenant,
    session,
    offer,
    click,
    conversion,
    order,
    alertRule,
    alert,
    trackingLink,
    errorReport,
    aiUsageDaily,
    _stores: { tenants, users, sessions, offers, clicks, conversions, orders, alertRules, alerts, trackingLinks, errorReports, aiUsageDailyRows },
  };
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

function cookie(token: string) {
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

async function seedAuth(fake: FakePrisma, role: "admin" | "member" = "member") {
  const tenantId = randomUUID();
  await (fake as any).tenant.create({
    data: { id: tenantId, name: `${role}@t`, slug: `u-${role}`, status: "ACTIVE" },
  });
  const user = await (fake as any).user.create({
    data: {
      id: randomUUID(),
      tenantId,
      email: `${role}@example.com`,
      name: role,
      role,
      status: "ACTIVE",
    },
  });
  const session = await createSession(fake as unknown as PrismaClient, user.id);
  return { tenantId, user, token: session.token };
}

async function buildApps(fake: FakePrisma) {
  const mk = async (register: (app: any, deps: any) => Promise<void>) => {
    const app = Fastify({ logger: false });
    app.setErrorHandler(createObservabilityErrorHandler());
    await register(app, { prisma: fake as unknown as PrismaClient });
    return app;
  };
  return {
    ai: await mk(registerAiRoutes),
    monitoring: await mk(registerMonitoringRoutes),
    stats: await mk(registerStatsRoutes),
  };
}

describe("P1 brand-check route", () => {
  let fake: FakePrisma;
  let token: string;
  let ai: any;
  beforeEach(async () => {
    fake = makeFakePrisma();
    ({ token } = await seedAuth(fake));
    ({ ai } = await buildApps(fake));
  });

  it("returns conflicts + negatives", async () => {
    const res = await ai.inject({
      method: "POST",
      url: "/api/v1/ai/brand-check",
      headers: cookie(token),
      payload: {
        keywords: ["Nike shoes", "cheap socks"],
        brandTerms: ["nike"],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stats).toEqual({ total: 2, conflicts: 1 });
    expect(body.results[0]).toEqual({
      keyword: "nike shoes",
      conflict: true,
      matchedTerms: ["nike"],
    });
    expect(body.negatives).toEqual({
      exact: ["[nike shoes]"],
      phrase: ['"nike shoes"'],
    });
  });

  it("400 on empty / oversized inputs", async () => {
    for (const payload of [
      { keywords: [], brandTerms: ["nike"] },
      { keywords: ["a"], brandTerms: [] },
      { keywords: new Array(501).fill("a"), brandTerms: ["nike"] },
      { keywords: ["a"], brandTerms: new Array(51).fill("nike") },
      {},
    ]) {
      const res = await ai.inject({
        method: "POST",
        url: "/api/v1/ai/brand-check",
        headers: cookie(token),
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it("401 without session", async () => {
    const res = await ai.inject({
      method: "POST",
      url: "/api/v1/ai/brand-check",
      payload: { keywords: ["a"], brandTerms: ["b"] },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("P1 offer-performance route", () => {
  let fake: FakePrisma;
  let token: string;
  let tenantId: string;
  let stats: any;
  const offerId = randomUUID();

  beforeEach(async () => {
    fake = makeFakePrisma();
    ({ token, tenantId } = await seedAuth(fake));
    ({ stats } = await buildApps(fake));
    fake._stores.offers.push({ id: offerId, tenantId });
    // 100 clicks, 5 conversions @ $10 USD, 1 refunded / 4 confirmed orders
    for (let i = 0; i < 100; i++) {
      fake._stores.clicks.push({
        id: randomUUID(),
        tenantId,
        offerId,
        occurredAt: new Date(),
        country: i < 60 ? "US" : "GB",
      });
    }
    for (let i = 0; i < 5; i++) {
      fake._stores.conversions.push({
        id: randomUUID(),
        tenantId,
        status: "ATTRIBUTED",
        value: 10,
        currency: "USD",
        conversionTime: new Date(),
      });
    }
    fake._stores.conversions.push({
      id: randomUUID(),
      tenantId,
      status: "FAILED",
      value: 99,
      currency: "USD",
      conversionTime: new Date(),
    });
    for (let i = 0; i < 4; i++) {
      fake._stores.orders.push({ id: randomUUID(), tenantId, status: "CONFIRMED", createdAt: new Date() });
    }
    fake._stores.orders.push({ id: randomUUID(), tenantId, status: "REFUNDED", createdAt: new Date() });
  });

  it("returns aggregated performance", async () => {
    const res = await stats.inject({
      method: "GET",
      url: `/api/v1/stats/offer-performance?offerId=${offerId}&days=30`,
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      offerId,
      days: 30,
      clicks: 100,
      conversions: 5,
      cvrPct: 5,
      revenue: 50,
      revenueCurrency: "USD",
      epc: 0.5,
      ordersConfirmed: 4,
      ordersRefunded: 1,
      refundRatePct: 20,
    });
  });

  it("400 on bad offerId / days; 404 on foreign offer", async () => {
    const bad1 = await stats.inject({
      method: "GET",
      url: "/api/v1/stats/offer-performance?offerId=nope",
      headers: cookie(token),
    });
    expect(bad1.statusCode).toBe(400);
    const bad2 = await stats.inject({
      method: "GET",
      url: `/api/v1/stats/offer-performance?offerId=${offerId}&days=999`,
      headers: cookie(token),
    });
    expect(bad2.statusCode).toBe(400);
    const missing = await stats.inject({
      method: "GET",
      url: `/api/v1/stats/offer-performance?offerId=${randomUUID()}`,
      headers: cookie(token),
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe("P1 monitoring routes", () => {
  let fake: FakePrisma;
  let token: string;
  let tenantId: string;
  let monitoring: any;

  beforeEach(async () => {
    fake = makeFakePrisma();
    ({ token, tenantId } = await seedAuth(fake));
    ({ monitoring } = await buildApps(fake));
  });

  it("CRUD rules + validation", async () => {
    const create = await monitoring.inject({
      method: "POST",
      url: "/api/v1/monitoring/rules",
      headers: cookie(token),
      payload: { name: "CVR guard", metric: "cvr_drop", thresholdPct: 50 },
    });
    expect(create.statusCode).toBe(200);
    const rule = create.json().rule;
    expect(rule).toMatchObject({
      name: "CVR guard",
      metric: "cvr_drop",
      thresholdPct: 50,
      windowHours: 24,
      baselineHours: 168,
      minClicks: 50,
      autoPause: false,
      enabled: true,
    });

    const bad = await monitoring.inject({
      method: "POST",
      url: "/api/v1/monitoring/rules",
      headers: cookie(token),
      payload: { name: "x", metric: "bogus", thresholdPct: 50 },
    });
    expect(bad.statusCode).toBe(400);

    const list = await monitoring.inject({
      method: "GET",
      url: "/api/v1/monitoring/rules",
      headers: cookie(token),
    });
    expect(list.json().rules).toHaveLength(1);

    const patch = await monitoring.inject({
      method: "PATCH",
      url: `/api/v1/monitoring/rules/${rule.id}`,
      headers: cookie(token),
      payload: { enabled: false, thresholdPct: 60 },
    });
    expect(patch.json().rule).toMatchObject({ enabled: false, thresholdPct: 60 });

    const del = await monitoring.inject({
      method: "DELETE",
      url: `/api/v1/monitoring/rules/${rule.id}`,
      headers: cookie(token),
    });
    expect(del.statusCode).toBe(200);
    const list2 = await monitoring.inject({
      method: "GET",
      url: "/api/v1/monitoring/rules",
      headers: cookie(token),
    });
    expect(list2.json().rules).toHaveLength(0);
  });

  it("defaults seeds seven guards once", async () => {
    const first = await monitoring.inject({
      method: "POST",
      url: "/api/v1/monitoring/rules/defaults",
      headers: cookie(token),
    });
    const b1 = first.json();
    expect(b1.created).toBe(true);
    expect(b1.rules).toHaveLength(7);
    expect(b1.rules.map((r: any) => r.metric)).toEqual([
      "cvr_drop",
      "refund_spike",
      "geo_shift",
      "duplicate_clicks",
      "click_burst",
      "ctr_anomaly",
      "device_anomaly",
    ]);

    const second = await monitoring.inject({
      method: "POST",
      url: "/api/v1/monitoring/rules/defaults",
      headers: cookie(token),
    });
    const b2 = second.json();
    expect(b2.created).toBe(false);
    expect(b2.rules).toHaveLength(7);
  });

  it("alerts list + ack are tenant-scoped", async () => {
    fake._stores.alerts.push({
      id: randomUUID(),
      tenantId,
      ruleId: null,
      trackingLinkId: null,
      metric: "cvr_drop",
      severity: "medium",
      message: "m",
      data: null,
      status: "open",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    fake._stores.alerts.push({
      id: randomUUID(),
      tenantId: randomUUID(), // other tenant
      ruleId: null,
      trackingLinkId: null,
      metric: "cvr_drop",
      severity: "medium",
      message: "other",
      data: null,
      status: "open",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const list = await monitoring.inject({
      method: "GET",
      url: "/api/v1/monitoring/alerts",
      headers: cookie(token),
    });
    expect(list.json().alerts).toHaveLength(1);

    const alertId = list.json().alerts[0].id;
    const ack = await monitoring.inject({
      method: "POST",
      url: `/api/v1/monitoring/alerts/${alertId}/ack`,
      headers: cookie(token),
    });
    expect(ack.statusCode).toBe(200);

    const open = await monitoring.inject({
      method: "GET",
      url: "/api/v1/monitoring/alerts?status=open",
      headers: cookie(token),
    });
    expect(open.json().alerts).toHaveLength(0);
    const acked = await monitoring.inject({
      method: "GET",
      url: "/api/v1/monitoring/alerts?status=acknowledged",
      headers: cookie(token),
    });
    expect(acked.json().alerts).toHaveLength(1);

    const foreign = await monitoring.inject({
      method: "POST",
      url: `/api/v1/monitoring/alerts/${randomUUID()}/ack`,
      headers: cookie(token),
    });
    expect(foreign.statusCode).toBe(404);
  });

  it("run detects cvr_drop breach and auto-pauses", async () => {
    const linkId = randomUUID();
    fake._stores.trackingLinks.push({
      id: linkId,
      tenantId,
      publicId: "t1",
      status: "ACTIVE",
      deletedAt: null,
      createdAt: new Date(),
    });
    const now = Date.now();
    const hourAgo = new Date(now - 3600 * 1000);
    const twoDaysAgo = new Date(now - 48 * 3600 * 1000);
    // Window (last 24h): 100 clicks, 1 conversion -> 1% CVR
    for (let i = 0; i < 100; i++) {
      fake._stores.clicks.push({
        id: randomUUID(),
        tenantId,
        trackingLinkId: linkId,
        occurredAt: hourAgo,
        country: "US",
      });
    }
    fake._stores.conversions.push({
      id: randomUUID(),
      tenantId,
      status: "ATTRIBUTED",
      value: 5,
      currency: "USD",
      conversionTime: hourAgo,
    });
    // Baseline (24h-192h ago): 100 clicks, 10 conversions -> 10% CVR
    for (let i = 0; i < 100; i++) {
      fake._stores.clicks.push({
        id: randomUUID(),
        tenantId,
        trackingLinkId: linkId,
        occurredAt: twoDaysAgo,
        country: "US",
      });
    }
    for (let i = 0; i < 10; i++) {
      fake._stores.conversions.push({
        id: randomUUID(),
        tenantId,
        status: "ATTRIBUTED",
        value: 5,
        currency: "USD",
        conversionTime: twoDaysAgo,
      });
    }
    const ruleId = randomUUID();
    fake._stores.alertRules.push({
      id: ruleId,
      tenantId,
      name: "CVR guard",
      metric: "cvr_drop",
      thresholdPct: 50,
      windowHours: 24,
      baselineHours: 168,
      minClicks: 50,
      autoPause: true,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const run = await monitoring.inject({
      method: "POST",
      url: "/api/v1/monitoring/run",
      headers: cookie(token),
    });
    expect(run.statusCode).toBe(200);
    // 90% relative CVR drop (10% -> 1%) breaches the 50% threshold.
    expect(run.json()).toEqual({ checked: 1, alertsCreated: 1 });

    const stored = fake._stores.alerts[0];
    expect(stored.severity).toBe("high"); // autoPause -> high
    expect(stored.message).toContain("cvr_drop");
    expect(stored.data.autoPaused).toBe(true);
    expect(fake._stores.trackingLinks[0].status).toBe("PAUSED");

    // Second run dedupes: no new alert within 24h.
    const run2 = await monitoring.inject({
      method: "POST",
      url: "/api/v1/monitoring/run",
      headers: cookie(token),
    });
    expect(run2.json()).toEqual({ checked: 0, alertsCreated: 0 });
  });
});

describe("P0-8 monitoring errors + P0-6 admin ai-usage summary", () => {
  let fake: FakePrisma;
  let token: string;
  let tenantId: string;
  let monitoring: any;
  let ai: any;

  beforeEach(async () => {
    fake = makeFakePrisma();
    ({ token, tenantId } = await seedAuth(fake));
    ({ monitoring, ai } = await buildApps(fake));
  });

  function pushError(overrides: Record<string, unknown> = {}) {
    const now = Date.now();
    const row = {
      id: randomUUID(),
      tenantId,
      level: "error",
      message: "boom",
      requestId: "r1",
      path: "/api/v1/ai/analyze",
      method: "POST",
      statusCode: 500,
      count: 1,
      firstSeenAt: new Date(now - 1000),
      lastSeenAt: new Date(now - 1000),
      ...overrides,
    };
    fake._stores.errorReports.push(row);
    return row;
  }

  it("errors: tenant-scoped, lastSeenAt desc, 24h window, limit validation", async () => {
    const old = pushError({
      id: randomUUID(),
      message: "stale",
      lastSeenAt: new Date(Date.now() - 25 * 3600 * 1000),
      firstSeenAt: new Date(Date.now() - 25 * 3600 * 1000),
    });
    void old;
    const otherTenant = pushError({
      id: randomUUID(),
      tenantId: randomUUID(),
      message: "other tenant",
    });
    void otherTenant;
    const recent = pushError({ message: "recent" });
    const newer = pushError({
      message: "newer",
      lastSeenAt: new Date(),
      firstSeenAt: new Date(),
    });

    const res = await monitoring.inject({
      method: "GET",
      url: "/api/v1/monitoring/errors",
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(200);
    const errors = res.json().errors as Array<{ message: string; count: number }>;
    // 24h 外的 stale 与他租户的 other tenant 被排除；按 lastSeenAt 倒序。
    expect(errors.map((e) => e.message)).toEqual(["newer", "recent"]);
    expect(errors[0].count).toBe(1);

    const limited = await monitoring.inject({
      method: "GET",
      url: "/api/v1/monitoring/errors?limit=1",
      headers: cookie(token),
    });
    expect(limited.json().errors).toHaveLength(1);
    expect(limited.json().errors[0].message).toBe("newer");

    const bad = await monitoring.inject({
      method: "GET",
      url: "/api/v1/monitoring/errors?limit=0",
      headers: cookie(token),
    });
    expect(bad.statusCode).toBe(400);

    const unauthed = await monitoring.inject({
      method: "GET",
      url: "/api/v1/monitoring/errors",
    });
    expect(unauthed.statusCode).toBe(401);
    void recent;
  });

  it("admin ai-usage summary: admin 可见，member 403；今日/本月聚合", async () => {
    const { token: adminToken, tenantId: adminTenant } =
      await seedAuth(fake, "admin");
    const today = new Date();
    const todayStart = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    );
    const monthStart = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
    );
    fake._stores.aiUsageDailyRows.push(
      {
        tenantId: adminTenant,
        date: todayStart,
        tokensIn: 100,
        tokensOut: 50,
        costCents: 7,
        calls: 2,
      },
      {
        tenantId: adminTenant,
        date: monthStart,
        tokensIn: 1000,
        tokensOut: 500,
        costCents: 70,
        calls: 20,
      },
      {
        tenantId: randomUUID(), // 他租户不计入
        date: todayStart,
        tokensIn: 9999,
        tokensOut: 9999,
        costCents: 9999,
        calls: 999,
      }
    );

    const res = await ai.inject({
      method: "GET",
      url: "/api/v1/admin/ai-usage/summary",
      headers: cookie(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tenantId).toBe(adminTenant);
    expect(body.today).toEqual({
      tokensIn: 100,
      tokensOut: 50,
      costCents: 7,
      calls: 2,
    });
    expect(body.month).toEqual({
      tokensIn: 1100,
      tokensOut: 550,
      costCents: 77,
      calls: 22,
    });

    const memberRes = await ai.inject({
      method: "GET",
      url: "/api/v1/admin/ai-usage/summary",
      headers: cookie(token),
    });
    expect(memberRes.statusCode).toBe(403);
  });
});
