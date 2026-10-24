/**
 * 封号复盘库（清单 #5）路由测试。
 * In-memory fake Prisma + Fastify inject；disabled 模式读 x-tenant-id。
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import { registerBanLogRoutes } from "./ban-log.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const OFFER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

interface Ctx {
  banEvents: any[];
  slots: any[];
}

function buildApp(ctx: Ctx) {
  const fake = {
    banEvent: {
      findMany: async (args: any) => {
        const rows = ctx.banEvents.filter(
          (r) => !args.where?.tenantId || r.tenantId === args.where.tenantId
        );
        if (args?.orderBy?.createdAt === "desc") {
          return [...rows].sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
          );
        }
        return rows;
      },
      findFirst: async (args: any) =>
        ctx.banEvents.find(
          (r) =>
            (!args.where?.id || r.id === args.where.id) &&
            (!args.where?.tenantId || r.tenantId === args.where.tenantId)
        ) ?? null,
      create: async (args: any) => {
        const row = { ...args.data, createdAt: new Date() };
        ctx.banEvents.push(row);
        return row;
      },
      update: async (args: any) => {
        const row = ctx.banEvents.find((r) => r.id === args.where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, args.data);
        return row;
      },
    },
    accountSlot: {
      findMany: async (args: any) =>
        ctx.slots.filter(
          (r) => !args.where?.tenantId || r.tenantId === args.where.tenantId
        ),
    },
  };
  const app = Fastify({ logger: false });
  const services = { prisma: fake as unknown as PrismaClient };
  const auth = { mode: "disabled" as const, registry: [] };
  return registerBanLogRoutes(app, services, auth).then(() => app);
}

function headers(tenant = TENANT) {
  return { "content-type": "application/json", "x-tenant-id": tenant };
}

describe("ban-log routes", () => {
  it("POST creates a record; GET lists newest first and only own tenant's", async () => {
    const ctx: Ctx = { banEvents: [], slots: [] };
    const app = await buildApp(ctx);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ban-events",
      headers: headers(),
      payload: {
        network: "PopAds",
        offerId: OFFER_A,
        operationType: "BRAND_KEYWORD",
        lostBalanceUsd: 30,
        lostPendingUsd: 20,
        note: "brand term flagged",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().banEvent.recovered).toBe(false);
    expect(res.json().banEvent.lostBalanceUsd).toBe(30);

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/ban-events",
      headers: headers(),
    });
    expect(list.json().banEvents).toHaveLength(1);

    const other = await app.inject({
      method: "GET",
      url: "/api/v1/ban-events",
      headers: headers(OTHER_TENANT),
    });
    expect(other.json().banEvents).toHaveLength(0);

    const bad = await app.inject({
      method: "POST",
      url: "/api/v1/ban-events",
      headers: headers(),
      payload: { network: "PopAds", operationType: "SPAM" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("PATCH recovered marks recovery; cross-tenant is 404", async () => {
    const id = randomUUID();
    const ctx: Ctx = {
      banEvents: [
        {
          id,
          tenantId: TENANT,
          network: "PopAds",
          offerId: null,
          operationType: "DIRECT_LINK",
          lostBalanceUsd: 40,
          lostPendingUsd: 10,
          recovered: false,
          recoveredUsd: 0,
          note: null,
          occurredAt: new Date(),
          createdAt: new Date(),
        },
      ],
      slots: [],
    };
    const app = await buildApp(ctx);

    const forbidden = await app.inject({
      method: "PATCH",
      url: `/api/v1/ban-events/${id}/recovered`,
      headers: headers(OTHER_TENANT),
      payload: { recoveredUsd: 25 },
    });
    expect(forbidden.statusCode).toBe(404);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/ban-events/${id}/recovered`,
      headers: headers(),
      payload: { recoveredUsd: 25 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().banEvent.recovered).toBe(true);
    expect(res.json().banEvent.recoveredUsd).toBe(25);

    const missing = await app.inject({
      method: "PATCH",
      url: `/api/v1/ban-events/${id}/recovered`,
      headers: headers(),
      payload: {},
    });
    expect(missing.statusCode).toBe(400);
  });

  it("survival-stats groups by network x operationType with observed (not exact) ban share", async () => {
    const mkEvent = (over: any) => ({
      id: randomUUID(),
      tenantId: TENANT,
      offerId: null,
      lostBalanceUsd: 0,
      lostPendingUsd: 0,
      recovered: false,
      recoveredUsd: 0,
      note: null,
      occurredAt: new Date(),
      createdAt: new Date(),
      ...over,
    });
    const mkSlot = (over: any) => ({
      id: randomUUID(),
      tenantId: TENANT,
      network: "PopAds",
      status: "ACTIVE",
      ...over,
    });
    const ctx: Ctx = {
      banEvents: [
        mkEvent({ network: "PopAds", operationType: "DIRECT_LINK", lostBalanceUsd: 40, lostPendingUsd: 10, recoveredUsd: 25 }),
        mkEvent({ network: "PopAds", operationType: "DIRECT_LINK", lostBalanceUsd: 0, lostPendingUsd: 60 }),
        mkEvent({ network: "PopAds", operationType: "BRAND_KEYWORD", lostBalanceUsd: 5, lostPendingUsd: 0 }),
      ],
      slots: [
        mkSlot({}),
        mkSlot({ status: "PAUSED" }),
        mkSlot({ status: "BANNED" }),
        mkSlot({ network: "GG", status: "ACTIVE" }),
      ],
    };
    const app = await buildApp(ctx);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/ban-events/survival-stats",
      headers: headers(),
    });
    expect(res.statusCode).toBe(200);
    const stats = res.json().stats;
    const direct = stats.find(
      (s: any) =>
        s.network === "PopAds" && s.operationType === "DIRECT_LINK"
    );
    expect(direct.banCount).toBe(2);
    expect(direct.totalLostUsd).toBe(110);
    expect(direct.totalRecoveredUsd).toBe(25);
    // PopAds live = 1 ACTIVE + 1 PAUSED (BANNED excluded; GG slot not counted).
    expect(direct.activeSlotCount).toBe(2);
    expect(direct.observedBanShare).toBeCloseTo(2 / (2 + 2));
    expect(direct.observedBanShareDefinition).toMatch(/not an exact/);
    const brand = stats.find(
      (s: any) =>
        s.network === "PopAds" && s.operationType === "BRAND_KEYWORD"
    );
    expect(brand.banCount).toBe(1);
    expect(brand.observedBanShare).toBeCloseTo(1 / (1 + 2));
  });
});
