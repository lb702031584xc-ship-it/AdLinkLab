/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
/**
 * 黑白名单服务测试（in-memory fake Prisma）。
 *
 * 覆盖：幂等加入、active 才算黑名单、软删除+观察期、白名单只建议不自动加入、
 * 渠道隔离。
 */
import { describe, expect, it } from "vitest";
import {
  addToBlacklist,
  addWhitelistEntry,
  blacklistOfferForPolicyViolation,
  confirmWhitelistEntry,
  isBlacklisted,
  isMerchantObserved,
  isWhitelisted,
  networkKindToChannel,
  removeFromBlacklist,
  suggestWhitelistEntry,
} from "./catalog-blacklist.js";
import {
  makeCatalogFakePrisma,
  TEST_TENANT,
  TEST_USER,
} from "./catalog-fake-prisma.js";
import type { PrismaClient } from "@adlinklab/database";

function setup(): { prisma: PrismaClient; ctx: ReturnType<typeof makeCatalogFakePrisma>["ctx"] } {
  const { prisma, ctx } = makeCatalogFakePrisma();
  return { prisma, ctx };
}

describe("catalog-blacklist", () => {
  it("networkKindToChannel：amazon→amazon，其余→affiliate", () => {
    expect(networkKindToChannel("amazon")).toBe("amazon");
    expect(networkKindToChannel("yeahpromos")).toBe("affiliate");
    expect(networkKindToChannel("partnerboost")).toBe("affiliate");
  });

  it("加入黑名单幂等：重复加入不建第二条，只更新时间", async () => {
    const { prisma, ctx } = setup();
    await addToBlacklist(prisma, {
      tenantId: TEST_TENANT,
      channel: "affiliate",
      entityType: "product",
      entityId: "p1",
      reason: "sync_disappeared",
      source: "auto",
    });
    await addToBlacklist(prisma, {
      tenantId: TEST_TENANT,
      channel: "affiliate",
      entityType: "product",
      entityId: "p1",
      reason: "sync_disappeared",
      source: "auto",
    });
    expect(ctx.catalogBlacklist).toHaveLength(1);
    expect(
      ctx.adminGrantAudit.filter((a) => a.action === "CATALOG_BLACKLIST_AUTO_ADDED")
    ).toHaveLength(2);
  });

  it("渠道隔离：同实体不同 channel 各一条", async () => {
    const { prisma, ctx } = setup();
    await addToBlacklist(prisma, {
      tenantId: TEST_TENANT,
      channel: "affiliate",
      entityType: "product",
      entityId: "p1",
      reason: "x",
      source: "manual",
      createdBy: TEST_USER,
    });
    await addToBlacklist(prisma, {
      tenantId: TEST_TENANT,
      channel: "amazon",
      entityType: "product",
      entityId: "p1",
      reason: "x",
      source: "manual",
      createdBy: TEST_USER,
    });
    expect(ctx.catalogBlacklist).toHaveLength(2);
    expect(await isBlacklisted(prisma, TEST_TENANT, "affiliate", "product", "p1")).toBe(true);
    expect(await isBlacklisted(prisma, TEST_TENANT, "cashback", "product", "p1")).toBe(false);
  });

  it("软删除：status=removed 后不算黑名单；复拉黑改回 active", async () => {
    const { prisma, ctx } = setup();
    const row = await addToBlacklist(prisma, {
      tenantId: TEST_TENANT,
      channel: "affiliate",
      entityType: "merchant",
      entityId: "m1",
      reason: "non_payment",
      source: "auto",
    });
    await removeFromBlacklist(prisma, {
      tenantId: TEST_TENANT,
      id: row.id,
      actorId: TEST_USER,
      reason: "申诉通过",
      observationDays: 30,
    });
    const removed = ctx.catalogBlacklist[0];
    expect(removed.status).toBe("removed");
    expect(removed.removeReason).toBe("申诉通过");
    expect(removed.observationUntil).toBeInstanceOf(Date);
    expect(await isBlacklisted(prisma, TEST_TENANT, "affiliate", "merchant", "m1")).toBe(false);
    // 复拉黑：旧行改回 active
    await addToBlacklist(prisma, {
      tenantId: TEST_TENANT,
      channel: "affiliate",
      entityType: "merchant",
      entityId: "m1",
      reason: "non_payment",
      source: "auto",
    });
    expect(ctx.catalogBlacklist).toHaveLength(1);
    expect(ctx.catalogBlacklist[0].status).toBe("active");
    expect(await isBlacklisted(prisma, TEST_TENANT, "affiliate", "merchant", "m1")).toBe(true);
  });

  it("removeFromBlacklist 缺 reason → 400", async () => {
    const { prisma } = setup();
    const row = await addToBlacklist(prisma, {
      tenantId: TEST_TENANT,
      channel: "affiliate",
      entityType: "product",
      entityId: "p1",
      reason: "x",
      source: "manual",
      createdBy: TEST_USER,
    });
    await expect(
      removeFromBlacklist(prisma, {
        tenantId: TEST_TENANT,
        id: row.id,
        actorId: TEST_USER,
        reason: "  ",
        observationDays: 30,
      })
    ).rejects.toThrow("reason");
  });

  it("isMerchantObserved：观察期内 true，过期后 false", async () => {
    const { prisma } = setup();
    const row = await addToBlacklist(prisma, {
      tenantId: TEST_TENANT,
      channel: "affiliate",
      entityType: "merchant",
      entityId: "m1",
      reason: "x",
      source: "auto",
    });
    await removeFromBlacklist(prisma, {
      tenantId: TEST_TENANT,
      id: row.id,
      actorId: TEST_USER,
      reason: "复检",
      observationDays: 30,
    });
    expect(
      await isMerchantObserved(prisma, TEST_TENANT, "affiliate", "merchant", "m1")
    ).toBe(true);
    // 观察期过期
    await (prisma as any).catalogBlacklist.update({
      where: { id: row.id },
      data: { observationUntil: new Date(Date.now() - 1000) },
    });
    expect(
      await isMerchantObserved(prisma, TEST_TENANT, "affiliate", "merchant", "m1")
    ).toBe(false);
  });

  it("blacklistOfferForPolicyViolation：Offer 按 source 映射 channel", async () => {
    const { prisma, ctx } = setup();
    await blacklistOfferForPolicyViolation(prisma, {
      tenantId: TEST_TENANT,
      offerId: "o1",
      offerSource: "amazon",
      reason: "Google Ads 政策拒登",
    });
    expect(ctx.catalogBlacklist[0].channel).toBe("amazon");
    expect(ctx.catalogBlacklist[0].entityType).toBe("offer");
  });
});

describe("catalog-whitelist", () => {
  it("suggestWhitelistEntry：只建议不自动加入；重复建议返回 null", async () => {
    const { prisma, ctx } = setup();
    const row = await suggestWhitelistEntry(prisma, {
      tenantId: TEST_TENANT,
      channel: "affiliate",
      entityType: "product",
      entityId: "p1",
    });
    expect(row!.source).toBe("suggested");
    expect(await isWhitelisted(prisma, TEST_TENANT, "affiliate", "product", "p1")).toBe(true);
    // 已存在 → 跳过
    const again = await suggestWhitelistEntry(prisma, {
      tenantId: TEST_TENANT,
      channel: "affiliate",
      entityType: "product",
      entityId: "p1",
    });
    expect(again).toBe(null);
    expect(ctx.catalogWhitelist).toHaveLength(1);
  });

  it("confirmWhitelistEntry：suggested → manual", async () => {
    const { prisma } = setup();
    const row = await suggestWhitelistEntry(prisma, {
      tenantId: TEST_TENANT,
      channel: "affiliate",
      entityType: "product",
      entityId: "p1",
    });
    const confirmed = await confirmWhitelistEntry(prisma, {
      tenantId: TEST_TENANT,
      id: row!.id,
      actorId: TEST_USER,
    });
    expect(confirmed.source).toBe("manual");
    expect(confirmed.confirmedAt).toBeInstanceOf(Date);
  });

  it("addWhitelistEntry：手动添加即 manual", async () => {
    const { prisma } = setup();
    const row = await addWhitelistEntry(prisma, {
      tenantId: TEST_TENANT,
      channel: "cashback",
      entityType: "merchant",
      entityId: "m1",
      note: "长期合作",
      actorId: TEST_USER,
    });
    expect(row.source).toBe("manual");
    expect(row.channel).toBe("cashback");
  });
});
