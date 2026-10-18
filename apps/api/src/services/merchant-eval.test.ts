/**
 * 商家自动评估测试（in-memory fake Prisma）。
 *
 * 覆盖：连续 3 周期超阈值→进黑名单；单周期超阈值→不进（只记 signal）；
 * 超期未付款→non_payment；ROAS 过低→unprofitable_roas；
 * 无网络订单数据→insufficient_data 不判。
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { evaluateMerchants } from "./merchant-eval.js";
import {
  makeCatalogFakePrisma,
  TEST_TENANT,
  type CatalogFakeCtx,
} from "./catalog-fake-prisma.js";
import type { PrismaClient } from "@adlinklab/database";

const DAY = 86400 * 1000;

function setup(): {
  prisma: PrismaClient;
  ctx: CatalogFakeCtx;
  ids: { merchant: string; offer: string; click: string };
} {
  const { prisma, ctx } = makeCatalogFakePrisma();
  const merchant = randomUUID();
  const offer = randomUUID();
  const click = randomUUID();
  ctx.merchant.push({
    id: merchant,
    tenantId: TEST_TENANT,
    name: "Test Merchant",
    networkId: null,
    status: "ACTIVE",
    deletedAt: null,
  });
  ctx.offer.push({ id: offer, tenantId: TEST_TENANT, merchantId: merchant, deletedAt: null });
  ctx.click.push({ id: click, tenantId: TEST_TENANT, offerId: offer });
  return { prisma, ctx, ids: { merchant, offer, click } };
}

function addConversion(
  ctx: CatalogFakeCtx,
  clickId: string,
  conversionTime: Date,
  status = "ATTRIBUTED"
) {
  ctx.conversion.push({
    id: randomUUID(),
    tenantId: TEST_TENANT,
    clickId,
    conversionTime,
    status,
    value: 100,
  });
}

/** 网络侧同步订单（clickId/conversionId 为 null）——当前无写入链路，测试用 fake 注入。 */
function addNetworkOrder(ctx: CatalogFakeCtx, createdAt: Date) {
  ctx.order.push({
    id: randomUUID(),
    tenantId: TEST_TENANT,
    clickId: null,
    conversionId: null,
    orderId: `net-${randomUUID()}`,
    value: 100,
    currency: "USD",
    status: "CONFIRMED",
    createdAt,
  });
}

function periodStart(i: number, periodDays = 7): Date {
  return new Date(Date.now() - (i + 1) * periodDays * DAY);
}

describe("evaluateMerchants 扣量嫌疑", () => {
  it("连续 3 周期超阈值 → 进黑名单（shave_suspected）", async () => {
    const { prisma, ctx, ids } = setup();
    for (let i = 0; i < 3; i++) {
      const ps = periodStart(i);
      for (let k = 0; k < 10; k++) {
        addConversion(ctx, ids.click, new Date(ps.getTime() + 1000 + k));
      }
      // 网络订单 2 单 → shave = (10-2)/10 = 80% > 30%
      addNetworkOrder(ctx, new Date(ps.getTime() + 2000));
      addNetworkOrder(ctx, new Date(ps.getTime() + 3000));
    }
    const result = await evaluateMerchants({ prisma }, { tenantId: TEST_TENANT });
    expect(result.evaluated).toBe(1);
    expect(result.blacklisted).toHaveLength(1);
    expect(result.blacklisted[0].reason).toBe("shave_suspected");
    const bl = ctx.catalogBlacklist.find((r) => r.status === "active");
    expect(bl).toBeDefined();
    expect(bl!.entityType).toBe("merchant");
    expect(
      ctx.adminGrantAudit.some((a) => a.action === "MERCHANT_BLACKLIST_AUTO_ADDED")
    ).toBe(true);
    // 信号快照：两边数字并列
    const signals = ctx.catalogMerchantSignal.filter(
      (s) => s.merchantId === ids.merchant
    );
    expect(signals).toHaveLength(3);
    expect(signals.every((s) => s.ownConversions === 10)).toBe(true);
    expect(signals.every((s) => s.networkOrders === 2)).toBe(true);
  });

  it("单周期超阈值 → 不进黑名单（只记 signal）", async () => {
    const { prisma, ctx, ids } = setup();
    for (let i = 0; i < 3; i++) {
      const ps = periodStart(i);
      for (let k = 0; k < 10; k++) {
        addConversion(ctx, ids.click, new Date(ps.getTime() + 1000 + k));
      }
      if (i === 0) {
        addNetworkOrder(ctx, new Date(ps.getTime() + 2000));
        addNetworkOrder(ctx, new Date(ps.getTime() + 3000));
      }
    }
    const result = await evaluateMerchants({ prisma }, { tenantId: TEST_TENANT });
    expect(result.blacklisted).toHaveLength(0);
    expect(result.signalsWritten).toBe(3);
    const active = ctx.catalogBlacklist.filter((r) => r.status === "active");
    expect(active).toHaveLength(0);
  });

  it("无网络订单数据 → insufficient_data，不判", async () => {
    const { prisma, ctx, ids } = setup();
    const ps = periodStart(0);
    for (let k = 0; k < 5; k++) {
      addConversion(ctx, ids.click, new Date(ps.getTime() + 1000 + k));
    }
    const result = await evaluateMerchants({ prisma }, { tenantId: TEST_TENANT });
    expect(result.blacklisted).toHaveLength(0);
    const sig = ctx.catalogMerchantSignal.find(
      (s) => s.merchantId === ids.merchant
    )!;
    expect(sig.shavePct).toBe(null);
    expect(String(sig.note)).toContain("insufficient_data");
  });
});

describe("evaluateMerchants 不付钱", () => {
  it("PENDING 超 nonPaymentDays → non_payment 黑名单", async () => {
    const { prisma, ctx, ids } = setup();
    ctx.order.push({
      id: randomUUID(),
      tenantId: TEST_TENANT,
      clickId: ids.click,
      conversionId: null,
      orderId: "ord-1",
      value: 50,
      currency: "USD",
      status: "PENDING",
      createdAt: new Date(Date.now() - 60 * DAY),
    });
    const result = await evaluateMerchants({ prisma }, { tenantId: TEST_TENANT });
    expect(result.blacklisted).toHaveLength(1);
    expect(result.blacklisted[0].reason).toBe("non_payment");
    const bl = ctx.catalogBlacklist.find((r) => r.status === "active")!;
    expect(bl.reason).toBe("non_payment");
  });

  it("无归因订单 → 跳过并记数，不误判", async () => {
    const { prisma, ctx } = setup();
    ctx.order.push({
      id: randomUUID(),
      tenantId: TEST_TENANT,
      clickId: "unrelated-click",
      conversionId: null,
      orderId: "ord-x",
      value: 50,
      currency: "USD",
      status: "PENDING",
      createdAt: new Date(Date.now() - 60 * DAY),
    });
    const result = await evaluateMerchants({ prisma }, { tenantId: TEST_TENANT });
    expect(result.blacklisted).toHaveLength(0);
  });
});

describe("evaluateMerchants 跑不正", () => {
  it("ROAS 低于阈值 → unprofitable_roas 黑名单", async () => {
    const { prisma, ctx, ids } = setup();
    ctx.launchArchive.push({
      id: randomUUID(),
      tenantId: TEST_TENANT,
      offerId: ids.offer,
      spend: 100,
      createdAt: new Date(Date.now() - 2 * DAY),
    });
    ctx.order.push({
      id: randomUUID(),
      tenantId: TEST_TENANT,
      clickId: ids.click,
      conversionId: null,
      orderId: "ord-1",
      value: 50,
      currency: "USD",
      status: "CONFIRMED",
      createdAt: new Date(Date.now() - 2 * DAY),
    });
    const result = await evaluateMerchants({ prisma }, { tenantId: TEST_TENANT });
    expect(result.blacklisted).toHaveLength(1);
    expect(result.blacklisted[0].reason).toBe("unprofitable_roas");
  });

  it("无花费数据 → insufficient_data，不判", async () => {
    const { prisma, ctx, ids } = setup();
    ctx.order.push({
      id: randomUUID(),
      tenantId: TEST_TENANT,
      clickId: ids.click,
      conversionId: null,
      orderId: "ord-1",
      value: 50,
      currency: "USD",
      status: "CONFIRMED",
      createdAt: new Date(Date.now() - 2 * DAY),
    });
    const result = await evaluateMerchants({ prisma }, { tenantId: TEST_TENANT });
    expect(result.blacklisted).toHaveLength(0);
  });

  it("已在黑名单的商家 → 跳过", async () => {
    const { prisma, ctx, ids } = setup();
    ctx.catalogBlacklist.push({
      id: randomUUID(),
      tenantId: TEST_TENANT,
      channel: "affiliate",
      entityType: "merchant",
      entityId: ids.merchant,
      reason: "non_payment",
      firstSeenAt: new Date(),
      lastConfirmedAt: new Date(),
      source: "auto",
      status: "active",
    });
    const result = await evaluateMerchants({ prisma }, { tenantId: TEST_TENANT });
    expect(result.evaluated).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe("already_blacklisted");
  });
});
