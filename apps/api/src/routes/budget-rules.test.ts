/**
 * Automation pack 4/5 — budget rule route tests.
 * In-memory fake Prisma + Fastify inject. Auth: requireTenant in "disabled"
 * mode reads the tenant from the x-tenant-id header (existing test-compat
 * path); tenant isolation is asserted by using a second tenant header.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import { registerBudgetRuleRoutes } from "./budget-rules.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const ACCOUNT = "22222222-2222-4222-8222-222222222222";

interface Ctx {
  rules: any[];
  accounts: any[];
}

function buildApp(ctx: Ctx) {
  const fake = {
    budgetRule: {
      create: async (args: any) => {
        const row = {
          ...args.data,
          lastEvaluatedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        ctx.rules.push(row);
        return row;
      },
      findFirst: async (args: any) =>
        ctx.rules.find(
          (r) =>
            (!args.where.id || r.id === args.where.id) &&
            (!args.where.tenantId || r.tenantId === args.where.tenantId)
        ) ?? null,
      findMany: async (args: any) =>
        ctx.rules.filter(
          (r) => !args.where.tenantId || r.tenantId === args.where.tenantId
        ),
      update: async (args: any) => {
        const row = ctx.rules.find((r) => r.id === args.where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, args.data);
        return row;
      },
    },
    googleAccount: {
      findFirst: async (args: any) =>
        ctx.accounts.find((a) => a.id === args.where.id) ?? null,
    },
    campaign: { findFirst: async () => null, findMany: async () => [] },
    click: { count: async () => 0 },
    conversion: {
      aggregate: async () => ({ _sum: { value: null }, _count: 0 }),
    },
    syncJob: { findUnique: async () => null, create: async (a: any) => a.data },
    auditLog: { create: async (a: any) => a.data, findFirst: async () => null },
    alert: { findMany: async () => [], create: async (a: any) => a.data },
  };

  const app = Fastify({ logger: false });
  const services = { prisma: fake as unknown as PrismaClient };
  const auth = { mode: "disabled" as const, registry: [] };
  return registerBudgetRuleRoutes(app, services, auth).then(() => app);
}

function headers(tenant = TENANT) {
  return { "content-type": "application/json", "x-tenant-id": tenant };
}

describe("budget-rules routes", () => {
  it("POST creates a disabled rule; GET lists only own tenant's rules", async () => {
    const ctx: Ctx = {
      rules: [],
      accounts: [{ id: ACCOUNT, tenantId: TENANT }],
    };
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/budget-rules",
      headers: headers(),
      payload: {
        googleAccountId: ACCOUNT,
        campaignName: "Cashback US",
        targetRoas: 3,
        minDailyBudget: 10,
        maxDailyBudget: 100,
        initialBudget: 50,
      },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json().rule;
    expect(created.enabled).toBe(false);
    expect(created.lastAction).toMatchObject({
      action: "init",
      newBudget: 50,
    });

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/budget-rules",
      headers: headers(),
    });
    expect(list.json().rules).toHaveLength(1);

    const other = await app.inject({
      method: "GET",
      url: "/api/v1/budget-rules",
      headers: headers(OTHER_TENANT),
    });
    expect(other.json().rules).toHaveLength(0);
  });

  it("POST rejects invalid params (min >= max)", async () => {
    const ctx: Ctx = {
      rules: [],
      accounts: [{ id: ACCOUNT, tenantId: TENANT }],
    };
    const app = await buildApp(ctx);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/budget-rules",
      headers: headers(),
      payload: {
        googleAccountId: ACCOUNT,
        campaignName: "X",
        targetRoas: 3,
        minDailyBudget: 100,
        maxDailyBudget: 50,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH enables a rule; GET history returns the lastAction entry", async () => {
    const id = randomUUID();
    const ctx: Ctx = {
      rules: [
        {
          id,
          tenantId: TENANT,
          googleAccountId: ACCOUNT,
          campaignName: "Cashback US",
          campaignId: null,
          targetRoas: 3,
          minDailyBudget: 10,
          maxDailyBudget: 100,
          increasePct: 20,
          decreasePct: 20,
          checkIntervalDays: 7,
          enabled: false,
          lastEvaluatedAt: null,
          lastAction: { action: "up", reason: "r", at: "t", newBudget: 60 },
        },
      ],
      accounts: [{ id: ACCOUNT, tenantId: TENANT }],
    };
    const app = await buildApp(ctx);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/budget-rules/${id}`,
      headers: headers(),
      payload: { enabled: true },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().rule.enabled).toBe(true);

    const history = await app.inject({
      method: "GET",
      url: `/api/v1/budget-rules/${id}/history`,
      headers: headers(),
    });
    expect(history.json().history).toHaveLength(1);
    expect(history.json().history[0].action).toBe("up");

    // Other tenant cannot see it
    const forbidden = await app.inject({
      method: "GET",
      url: `/api/v1/budget-rules/${id}/history`,
      headers: headers(OTHER_TENANT),
    });
    expect(forbidden.statusCode).toBe(400);
  });

  it("P0-9: POST accepts maxSpendCap + autoPauseOnBreach; PATCH clears the cap with null; negative cap rejected", async () => {
    const ctx: Ctx = {
      rules: [],
      accounts: [{ id: ACCOUNT, tenantId: TENANT }],
    };
    const app = await buildApp(ctx);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/budget-rules",
      headers: headers(),
      payload: {
        googleAccountId: ACCOUNT,
        campaignName: "Cashback US",
        targetRoas: 3,
        minDailyBudget: 10,
        maxDailyBudget: 100,
        maxSpendCap: 500,
        autoPauseOnBreach: true,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().rule.maxSpendCap).toBe(500);
    expect(created.json().rule.autoPauseOnBreach).toBe(true);
    const id = created.json().rule.id;

    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/v1/budget-rules/${id}`,
      headers: headers(),
      payload: { maxSpendCap: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().rule.maxSpendCap).toBeNull();
    expect(cleared.json().rule.autoPauseOnBreach).toBe(true);

    const bad = await app.inject({
      method: "PATCH",
      url: `/api/v1/budget-rules/${id}`,
      headers: headers(),
      payload: { maxSpendCap: -5 },
    });
    expect(bad.statusCode).toBe(400);
  });
});
