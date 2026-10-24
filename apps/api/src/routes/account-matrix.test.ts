/**
 * 账号矩阵（清单 #4）路由测试。
 * In-memory fake Prisma + Fastify inject。Auth：requireTenant 在 "disabled"
 * 模式下读 x-tenant-id（budget-rules.test.ts 同款）；跨租户一律 404。
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import { registerAccountMatrixRoutes } from "./account-matrix.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const OFFER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OFFER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

interface Ctx {
  slots: any[];
  banEvents: any[];
}

function sortNewest(rows: any[], args: any) {
  if (args?.orderBy?.createdAt === "desc") {
    return [...rows].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }
  return rows;
}

function buildApp(ctx: Ctx) {
  const fake = {
    accountSlot: {
      findMany: async (args: any) => {
        let rows = ctx.slots.filter(
          (r) =>
            (!args.where?.tenantId || r.tenantId === args.where.tenantId) &&
            (!args.where?.network || r.network === args.where.network)
        );
        return sortNewest(rows, args);
      },
      findFirst: async (args: any) =>
        ctx.slots.find(
          (r) =>
            (!args.where?.id || r.id === args.where.id) &&
            (!args.where?.tenantId || r.tenantId === args.where.tenantId)
        ) ?? null,
      create: async (args: any) => {
        const row = {
          ...args.data,
          offer: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        ctx.slots.push(row);
        return row;
      },
      update: async (args: any) => {
        const row = ctx.slots.find((r) => r.id === args.where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, args.data);
        return row;
      },
    },
    banEvent: {
      create: async (args: any) => {
        const row = { ...args.data, createdAt: new Date() };
        ctx.banEvents.push(row);
        return row;
      },
    },
  };
  const app = Fastify({ logger: false });
  const services = { prisma: fake as unknown as PrismaClient };
  const auth = { mode: "disabled" as const, registry: [] };
  return registerAccountMatrixRoutes(app, services, auth).then(() => app);
}

function headers(tenant = TENANT) {
  return { "content-type": "application/json", "x-tenant-id": tenant };
}

describe("account-matrix routes", () => {
  it("POST template creates 10 EMPTY slots labelled -01..-10; second template for same network is 409", async () => {
    const ctx: Ctx = { slots: [], banEvents: [] };
    const app = await buildApp(ctx);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/account-matrix/slots/template",
      headers: headers(),
      payload: { network: "PopAds", labelPrefix: "POP" },
    });
    expect(res.statusCode).toBe(201);
    const slots = res.json().slots;
    expect(slots).toHaveLength(10);
    expect(slots[0].accountLabel).toBe("POP-01");
    expect(slots[9].accountLabel).toBe("POP-10");
    expect(slots.every((s: any) => s.status === "EMPTY")).toBe(true);
    expect(slots.map((s: any) => s.slotIndex)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);

    const dup = await app.inject({
      method: "POST",
      url: "/api/v1/account-matrix/slots/template",
      headers: headers(),
      payload: { network: "PopAds", labelPrefix: "POP2" },
    });
    expect(dup.statusCode).toBe(409);

    // Other network is fine; other tenant sees nothing.
    const otherNet = await app.inject({
      method: "POST",
      url: "/api/v1/account-matrix/slots/template",
      headers: headers(),
      payload: { network: "GG", labelPrefix: "GG" },
    });
    expect(otherNet.statusCode).toBe(201);
    const otherTenant = await app.inject({
      method: "GET",
      url: "/api/v1/account-matrix/slots",
      headers: headers(OTHER_TENANT),
    });
    expect(otherTenant.json().slots).toHaveLength(0);
  });

  it("PATCH edits only own tenant's slot; assign warns (not blocks) on 1-offer-1-slot conflicts", async () => {
    const slotA = {
      id: randomUUID(),
      tenantId: TENANT,
      slotIndex: 1,
      accountLabel: "POP-01",
      network: "PopAds",
      offerId: OFFER_A,
      status: "ACTIVE",
      balanceUsd: 0,
      pendingUsd: 0,
      investedUsd: 0,
      earnedUsd: 0,
      offer: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const slotB = {
      ...slotA,
      id: randomUUID(),
      slotIndex: 2,
      accountLabel: "POP-02",
      offerId: null,
      status: "EMPTY",
    };
    const ctx: Ctx = { slots: [slotA, slotB], banEvents: [] };
    const app = await buildApp(ctx);

    // Cross-tenant PATCH -> 404, not a leak.
    const forbidden = await app.inject({
      method: "PATCH",
      url: `/api/v1/account-matrix/slots/${slotA.id}`,
      headers: headers(OTHER_TENANT),
      payload: { balanceUsd: 5 },
    });
    expect(forbidden.statusCode).toBe(404);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/account-matrix/slots/${slotA.id}`,
      headers: headers(),
      payload: { balanceUsd: 120, pendingUsd: 70, status: "PAUSED" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().slot.balanceUsd).toBe(120);
    expect(patched.json().slot.status).toBe("PAUSED");

    const bad = await app.inject({
      method: "PATCH",
      url: `/api/v1/account-matrix/slots/${slotA.id}`,
      headers: headers(),
      payload: { status: "NOPE" },
    });
    expect(bad.statusCode).toBe(400);

    // Re-activate slot A (the PATCH above paused it) so the ACTIVE clash fires.
    const reactivated = await app.inject({
      method: "PATCH",
      url: `/api/v1/account-matrix/slots/${slotA.id}`,
      headers: headers(),
      payload: { status: "ACTIVE" },
    });
    expect(reactivated.json().slot.status).toBe("ACTIVE");

    // Assign OFFER_A to empty slot B: warns about slot A, still succeeds.
    const assigned = await app.inject({
      method: "POST",
      url: `/api/v1/account-matrix/slots/${slotB.id}/assign`,
      headers: headers(),
      payload: { offerId: OFFER_A },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().slot.offerId).toBe(OFFER_A);
    expect(assigned.json().warnings.length).toBeGreaterThan(0);
    expect(assigned.json().warnings[0]).toMatch(/already assigned/);

    // Assign a different offer to ACTIVE slot A: warns about replacement.
    const replaced = await app.inject({
      method: "POST",
      url: `/api/v1/account-matrix/slots/${slotA.id}/assign`,
      headers: headers(),
      payload: { offerId: OFFER_B },
    });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json().warnings.length).toBeGreaterThan(0);
  });

  it("mark-banned writes a BanEvent, bans the slot, and auto-refills slotIndex max+1", async () => {
    const slot = {
      id: randomUUID(),
      tenantId: TENANT,
      slotIndex: 3,
      accountLabel: "POP-03",
      network: "PopAds",
      offerId: OFFER_A,
      status: "ACTIVE",
      balanceUsd: 40,
      pendingUsd: 10,
      investedUsd: 100,
      earnedUsd: 0,
      offer: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const ctx: Ctx = { slots: [slot], banEvents: [] };
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/account-matrix/slots/${slot.id}/mark-banned`,
      headers: headers(),
      payload: {
        operationType: "DIRECT_LINK",
        lostBalanceUsd: 40,
        lostPendingUsd: 10,
        note: "direct link flagged",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.slot.status).toBe("BANNED");
    expect(body.banEvent.network).toBe("PopAds");
    expect(body.banEvent.lostBalanceUsd).toBe(40);
    expect(body.banEvent.lostPendingUsd).toBe(10);
    expect(body.refillSlot.status).toBe("EMPTY");
    expect(body.refillSlot.slotIndex).toBe(4);
    expect(body.refillSlot.offerId).toBeNull();
    expect(ctx.banEvents).toHaveLength(1);

    const badOp = await app.inject({
      method: "POST",
      url: `/api/v1/account-matrix/slots/${slot.id}/mark-banned`,
      headers: headers(),
      payload: { operationType: "SPAM" },
    });
    expect(badOp.statusCode).toBe(400);
  });

  it("portfolio sums, ROI, withdraw alerts (>=180), and budget formula (cap = survivors x commission, /10)", async () => {
    const mk = (over: any) => ({
      id: randomUUID(),
      tenantId: TENANT,
      accountLabel: "POP",
      network: "PopAds",
      offerId: null,
      status: "ACTIVE",
      balanceUsd: 0,
      pendingUsd: 0,
      investedUsd: 0,
      earnedUsd: 0,
      offer: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    });
    const ctx: Ctx = {
      slots: [
        mk({ slotIndex: 1, balanceUsd: 100, pendingUsd: 90, investedUsd: 100, earnedUsd: 150 }),
        mk({ slotIndex: 2, balanceUsd: 150, pendingUsd: 60, investedUsd: 50, earnedUsd: 0 }),
        mk({ slotIndex: 3, status: "BANNED", balanceUsd: 999, pendingUsd: 0, investedUsd: 200, earnedUsd: 0 }),
      ],
      banEvents: [],
    };
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/account-matrix/portfolio?expectedSurvivors=2&perSlotCommissionUsd=50",
      headers: headers(),
    });
    const p = res.json().portfolio;
    expect(p.totalInvested).toBe(350);
    expect(p.totalEarned).toBe(150);
    expect(p.liveSlots).toBe(2);
    expect(p.bannedSlots).toBe(1);
    // Only ACTIVE slots count toward at-risk (banned slot's 999 excluded).
    expect(p.totalAtRisk).toBe(400);
    expect(p.withdrawAlerts).toHaveLength(2);
    expect(p.portfolioRoi).toBeCloseTo((150 - 350) / 350);
    expect(p.totalBudgetCap).toBe(100);
    expect(p.perSlotBudget).toBe(10);

    // No commission param -> caps are null, not 0.
    const noParam = await app.inject({
      method: "GET",
      url: "/api/v1/account-matrix/portfolio",
      headers: headers(),
    });
    expect(noParam.json().portfolio.totalBudgetCap).toBeNull();
    expect(noParam.json().portfolio.perSlotBudget).toBeNull();
    expect(noParam.json().portfolio.expectedSurvivors).toBe(2);
  });
});
