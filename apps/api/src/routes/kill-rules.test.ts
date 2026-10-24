/**
 * 清单 #6 — 砍线规则引擎路由测试。
 * In-memory fake Prisma + Fastify inject. Auth: requireTenant in "disabled"
 * mode reads the tenant from the x-tenant-id header (existing test-compat
 * path, same as budget-rules.test.ts); tenant isolation is asserted with a
 * second tenant header.
 *
 * 覆盖：创建/列表隔离、幂等默认规则、阈值判定（全局 + offer 专属）、
 * 0 转化条件、disabled 命中写 SKIPPED_DISABLED、事件列表与 offerId 过滤、
 * PATCH 关闭自动执行、DELETE 与跨租户 404、非法输入 400。
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import { registerKillRuleRoutes } from "./kill-rules.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const OFFER_A = "22222222-2222-4222-8222-222222222222";
const OFFER_B = "33333333-3333-4333-8333-333333333333";

interface Ctx {
  rules: any[];
  events: any[];
}

function matchesWhere(row: any, where: any): boolean {
  if (!where) return true;
  for (const [key, value] of Object.entries(where)) {
    if (key === "OR") {
      const clauses = value as any[];
      if (!clauses.some((c) => matchesWhere(row, c))) return false;
    } else if (row[key] !== value) {
      return false;
    }
  }
  return true;
}

function buildApp(ctx: Ctx) {
  let seq = 0;
  const fake = {
    killRule: {
      create: async (args: any) => {
        const row = {
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
          _seq: ++seq,
        };
        ctx.rules.push(row);
        return row;
      },
      findFirst: async (args: any) =>
        ctx.rules.find((r) => matchesWhere(r, args.where)) ?? null,
      findMany: async (args: any) =>
        ctx.rules
          .filter((r) => matchesWhere(r, args.where))
          .sort((a, b) =>
            args.orderBy?.createdAt === "asc" ? a._seq - b._seq : b._seq - a._seq
          ),
      update: async (args: any) => {
        const row = ctx.rules.find((r) => r.id === args.where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, args.data);
        return row;
      },
      delete: async (args: any) => {
        const idx = ctx.rules.findIndex((r) => r.id === args.where.id);
        if (idx === -1) throw new Error("not found");
        return ctx.rules.splice(idx, 1)[0];
      },
    },
    killRuleEvent: {
      create: async (args: any) => {
        const row = { ...args.data, createdAt: new Date(), _seq: ++seq };
        ctx.events.push(row);
        return row;
      },
      findMany: async (args: any) =>
        ctx.events
          .filter((e) => matchesWhere(e, args.where))
          .sort((a, b) => b._seq - a._seq),
    },
  };

  const app = Fastify({ logger: false });
  const services = { prisma: fake as unknown as PrismaClient };
  const auth = { mode: "disabled" as const, registry: [] };
  return registerKillRuleRoutes(app, services, auth).then(() => app);
}

function headers(tenant = TENANT) {
  return { "content-type": "application/json", "x-tenant-id": tenant };
}

async function seed(app: any) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/kill-rules/seed-defaults",
    headers: headers(),
    payload: {},
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

describe("kill-rules routes", () => {
  it("POST creates a rule; GET lists only own tenant's rules", async () => {
    const ctx: Ctx = { rules: [], events: [] };
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/kill-rules",
      headers: headers(),
      payload: {
        name: "Offer A 300 warn",
        offerId: OFFER_A,
        clicksThreshold: 300,
        action: "WARN",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().rule).toMatchObject({
      name: "Offer A 300 warn",
      offerId: OFFER_A,
      clicksThreshold: 300,
      requireZeroConv: true,
      action: "WARN",
      enabled: true,
    });

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/kill-rules",
      headers: headers(),
    });
    expect(list.json().rules).toHaveLength(1);

    const other = await app.inject({
      method: "GET",
      url: "/api/v1/kill-rules",
      headers: headers(OTHER_TENANT),
    });
    expect(other.json().rules).toHaveLength(0);
  });

  it("seed-defaults is idempotent: second call returns existing rules without duplicating", async () => {
    const ctx: Ctx = { rules: [], events: [] };
    const app = await buildApp(ctx);

    const first = await seed(app);
    expect(first.created).toBe(true);
    expect(first.rules).toHaveLength(2);
    expect(first.rules.map((r: any) => r.action).sort()).toEqual([
      "PAUSE",
      "WARN",
    ]);
    expect(first.rules.map((r: any) => r.clicksThreshold).sort()).toEqual([
      300, 500,
    ]);
    expect(first.rules.every((r: any) => r.offerId === null)).toBe(true);
    expect(first.rules.every((r: any) => r.enabled === true)).toBe(true);

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/kill-rules/seed-defaults",
      headers: headers(),
      payload: {},
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().created).toBe(false);
    expect(second.json().rules).toHaveLength(2);
    expect(ctx.rules).toHaveLength(2);
  });

  it("evaluate hits only reached thresholds; conversions break requireZeroConv; no events for misses", async () => {
    const ctx: Ctx = { rules: [], events: [] };
    const app = await buildApp(ctx);
    await seed(app);

    // 350 clicks, 0 conversions: only the 300 WARN rule hits.
    const hit = await app.inject({
      method: "POST",
      url: "/api/v1/kill-rules/evaluate",
      headers: headers(),
      payload: { offerId: OFFER_A, clicks: 350, conversions: 0 },
    });
    expect(hit.statusCode).toBe(200);
    expect(hit.json().hits).toHaveLength(1);
    expect(hit.json().hits[0].event.actionTaken).toBe("WARN");
    expect(hit.json().hits[0].event.snapshot.rule.clicksThreshold).toBe(300);
    expect(hit.json().hits[0].event.snapshot.evaluation).toMatchObject({
      offerId: OFFER_A,
      clicks: 350,
      conversions: 0,
    });
    expect(ctx.events).toHaveLength(1);

    // 600 clicks, 1 conversion: requireZeroConv blocks both rules.
    const blocked = await app.inject({
      method: "POST",
      url: "/api/v1/kill-rules/evaluate",
      headers: headers(),
      payload: { offerId: OFFER_A, clicks: 600, conversions: 1 },
    });
    expect(blocked.json().hits).toHaveLength(0);
    expect(ctx.events).toHaveLength(1);

    // 600 clicks, 0 conversions: both default rules hit.
    const both = await app.inject({
      method: "POST",
      url: "/api/v1/kill-rules/evaluate",
      headers: headers(),
      payload: { offerId: OFFER_A, clicks: 600, conversions: 0 },
    });
    expect(both.json().hits).toHaveLength(2);
    expect(
      both.json().hits.map((h: any) => h.event.actionTaken).sort()
    ).toEqual(["PAUSE", "WARN"]);
    expect(ctx.events).toHaveLength(3);
  });

  it("evaluate: offer-specific rules only apply to their offer; disabled hits audit as SKIPPED_DISABLED", async () => {
    const ctx: Ctx = { rules: [], events: [] };
    const app = await buildApp(ctx);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/kill-rules",
      headers: headers(),
      payload: {
        name: "A-only lower bid",
        offerId: OFFER_A,
        clicksThreshold: 100,
        action: "LOWER_BID",
        enabled: false,
      },
    });
    expect(created.statusCode).toBe(201);

    // Offer B: the A-only rule does not apply, no events at all.
    const otherOffer = await app.inject({
      method: "POST",
      url: "/api/v1/kill-rules/evaluate",
      headers: headers(),
      payload: { offerId: OFFER_B, clicks: 500, conversions: 0 },
    });
    expect(otherOffer.json().hits).toHaveLength(0);
    expect(ctx.events).toHaveLength(0);

    // Offer A: rule hits but is disabled -> SKIPPED_DISABLED audit event.
    const skipped = await app.inject({
      method: "POST",
      url: "/api/v1/kill-rules/evaluate",
      headers: headers(),
      payload: { offerId: OFFER_A, clicks: 150, conversions: 0 },
    });
    expect(skipped.json().hits).toHaveLength(1);
    expect(skipped.json().hits[0].event.actionTaken).toBe("SKIPPED_DISABLED");
    expect(skipped.json().hits[0].event.snapshot.rule.enabled).toBe(false);
    expect(ctx.events).toHaveLength(1);
  });

  it("PATCH can disable auto-execution; events list is newest-first and filterable by offerId", async () => {
    const ctx: Ctx = { rules: [], events: [] };
    const app = await buildApp(ctx);
    await seed(app);

    await app.inject({
      method: "POST",
      url: "/api/v1/kill-rules/evaluate",
      headers: headers(),
      payload: { offerId: OFFER_A, clicks: 600, conversions: 0 },
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/kill-rules/evaluate",
      headers: headers(),
      payload: { offerId: OFFER_B, clicks: 350, conversions: 0 },
    });

    const events = await app.inject({
      method: "GET",
      url: "/api/v1/kill-rules/events",
      headers: headers(),
    });
    expect(events.json().events).toHaveLength(3);
    // Newest first: the last evaluate (OFFER_B, WARN) comes first.
    expect(events.json().events[0].offerId).toBe(OFFER_B);

    const filtered = await app.inject({
      method: "GET",
      url: `/api/v1/kill-rules/events?offerId=${OFFER_A}`,
      headers: headers(),
    });
    expect(filtered.json().events).toHaveLength(2);
    expect(
      filtered.json().events.every((e: any) => e.offerId === OFFER_A)
    ).toBe(true);

    const ruleId = ctx.rules[0].id;
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/kill-rules/${ruleId}`,
      headers: headers(),
      payload: { enabled: false },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().rule.enabled).toBe(false);
  });

  it("DELETE removes own rule; other tenant gets 404; invalid create input rejected", async () => {
    const id = randomUUID();
    const ctx: Ctx = {
      rules: [
        {
          id,
          tenantId: TENANT,
          offerId: null,
          name: "to delete",
          clicksThreshold: 300,
          requireZeroConv: true,
          action: "WARN",
          enabled: true,
        },
      ],
      events: [],
    };
    const app = await buildApp(ctx);

    const forbidden = await app.inject({
      method: "DELETE",
      url: `/api/v1/kill-rules/${id}`,
      headers: headers(OTHER_TENANT),
      payload: {},
    });
    expect(forbidden.statusCode).toBe(404);
    expect(ctx.rules).toHaveLength(1);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/kill-rules/${id}`,
      headers: headers(),
      payload: {},
    });
    expect(deleted.statusCode).toBe(200);
    expect(ctx.rules).toHaveLength(0);

    const badAction = await app.inject({
      method: "POST",
      url: "/api/v1/kill-rules",
      headers: headers(),
      payload: { name: "x", clicksThreshold: 100, action: "BAN" },
    });
    expect(badAction.statusCode).toBe(400);

    const badThreshold = await app.inject({
      method: "POST",
      url: "/api/v1/kill-rules",
      headers: headers(),
      payload: { name: "x", clicksThreshold: 0, action: "WARN" },
    });
    expect(badThreshold.statusCode).toBe(400);

    const badEvaluate = await app.inject({
      method: "POST",
      url: "/api/v1/kill-rules/evaluate",
      headers: headers(),
      payload: { offerId: OFFER_A, clicks: -1, conversions: 0 },
    });
    expect(badEvaluate.statusCode).toBe(400);
  });
});
