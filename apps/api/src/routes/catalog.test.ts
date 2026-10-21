/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
/**
 * 商品库路由测试（Fastify inject + in-memory fake Prisma）。
 *
 * 覆盖：非管理员删黑名单 → 403；删除缺 reason → 400；白名单建议→确认流；
 * 管理员删除 → 软删除 + 观察期。
 */
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import { registerCatalogRoutes } from "./catalog.js";
import {
  activeGrant,
  makeCatalogFakePrisma,
  testNetwork,
  TEST_NETWORK,
  TEST_TENANT,
  TEST_USER,
  type CatalogFakeCtx,
} from "../services/catalog-fake-prisma.js";
import type { OfferService } from "../services/offer-engine.js";

function buildApp(
  ctx: CatalogFakeCtx,
  role: string,
  offersCreateImpl?: (input: any, ctx: CatalogFakeCtx) => Promise<any>
): { app: ReturnType<typeof Fastify>; prisma: PrismaClient } {
  const { prisma } = makeCatalogFakePrisma(ctx as any);
  const app = Fastify();
  app.addHook("preHandler", (request, _reply, done) => {
    (request as any).sessionAuth = {
      id: TEST_USER,
      email: "u@test.dev",
      name: "Tester",
      role,
      tenantId: TEST_TENANT,
    };
    done();
  });
  const offers = {
    // 模拟真实 OfferService.create 的持久化：写入 ctx.offer，
    // 使"批量建 Offer → 漏斗 offersCreated 联动"可端到端验证。
    // offersCreateImpl 可覆盖 create 行为（如模拟幂等回放 created=false）。
    create: offersCreateImpl
      ? (input: any) => offersCreateImpl(input, ctx)
      : async (input: any) => {
          const offer = {
            id: randomUUID(),
            tenantId: TEST_TENANT,
            name: input?.name ?? "Offer",
            idempotencyKey: input?.idempotencyKey ?? null,
            ...input,
          };
          ctx.offer.push(offer);
          return { offer, created: true, replayed: false };
        },
  } as unknown as OfferService;
  void registerCatalogRoutes(app, { prisma, offers });
  return { app, prisma };
}

function blacklistRow(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: randomUUID(),
    tenantId: TEST_TENANT,
    channel: "affiliate",
    entityType: "product",
    entityId: randomUUID(),
    networkKind: null,
    reason: "sync_disappeared",
    firstSeenAt: new Date(),
    lastConfirmedAt: new Date(),
    source: "auto",
    createdBy: null,
    status: "active",
    removedAt: null,
    removedBy: null,
    removeReason: null,
    observationUntil: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("DELETE /api/v1/catalog/blacklist/:id", () => {
  it("非管理员 → 403", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const row = blacklistRow();
    ctx.catalogBlacklist.push(row);
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/catalog/blacklist/${row.id}`,
      payload: { reason: "误删" },
    });
    expect(res.statusCode).toBe(403);
    // 未被删除
    expect(ctx.catalogBlacklist[0].status).toBe("active");
  });

  it("管理员但缺 reason → 400", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const row = blacklistRow();
    ctx.catalogBlacklist.push(row);
    const { app } = buildApp(ctx, "admin");
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/catalog/blacklist/${row.id}`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("管理员删除 → 软删除 + 观察期 + 审计", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const row = blacklistRow();
    ctx.catalogBlacklist.push(row);
    const { app } = buildApp(ctx, "admin");
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/catalog/blacklist/${row.id}`,
      payload: { reason: "申诉通过" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.removed).toBe(true);
    expect(body.observationUntil).toBeTruthy();
    expect(ctx.catalogBlacklist[0].status).toBe("removed");
    expect(ctx.catalogBlacklist[0].removeReason).toBe("申诉通过");
    expect(
      ctx.adminGrantAudit.some((a: any) => a.action === "CATALOG_BLACKLIST_REMOVED")
    ).toBe(true);
  });
});

describe("POST /api/v1/catalog/blacklist/import", () => {
  it("正常批量导入 → added 统计", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/blacklist/import",
      payload: {
        items: [
          { entityType: "merchant", entityId: "m1", reason: "不付钱", channel: "cashback" },
          { entityType: "product", entityId: "p1", reason: "下架" },
          { entityType: "offer", entityId: "o1", reason: "扣量", channel: "amazon" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.added).toBe(3);
    expect(body.skipped).toBe(0);
    expect(body.errors).toHaveLength(0);
  });

  it("已存在 active → 跳过不报错", async () => {
    const { ctx } = makeCatalogFakePrisma();
    ctx.catalogBlacklist.push(
      blacklistRow({ entityType: "product", entityId: "p1", channel: "affiliate" })
    );
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/blacklist/import",
      payload: {
        items: [
          { entityType: "product", entityId: "p1", reason: "再拉一次" },
          { entityType: "product", entityId: "p2", reason: "新拉黑" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.added).toBe(1);
    expect(body.skipped).toBe(1);
    expect(body.errors).toHaveLength(0);
  });

  it("非法行 → errors 逐条记录（index 对应）", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/blacklist/import",
      payload: {
        items: [
          { entityType: "bogus", entityId: "x", reason: "r" },
          { entityType: "product", entityId: "  ", reason: "r" },
          { entityType: "product", entityId: "p1", reason: "" },
          { entityType: "merchant", entityId: "m1", reason: "不付钱" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.added).toBe(0);
    expect(body.skipped).toBe(0);
    expect(body.errors).toHaveLength(4);
    expect(body.errors.map((e: any) => e.index)).toEqual([0, 1, 2, 3]);
  });

  it("超过 200 条 → 400", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const { app } = buildApp(ctx, "member");
    const items = Array.from({ length: 201 }, (_, i) => ({
      entityType: "product",
      entityId: `p${i}`,
      reason: "批量",
    }));
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/blacklist/import",
      payload: { items },
    });
    expect(res.statusCode).toBe(400);
  });

  it("空数组 → 400", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/blacklist/import",
      payload: { items: [] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("白名单建议→确认", () => {
  it("POST /whitelist 添加（manual）→ POST /:id/confirm", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const { app } = buildApp(ctx, "member");
    const add = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/whitelist",
      payload: { entityType: "product", entityId: randomUUID(), note: "手动" },
    });
    expect(add.statusCode).toBe(200);
    expect(add.json().item.source).toBe("manual");

    const list = await app.inject({ method: "GET", url: "/api/v1/catalog/whitelist" });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(1);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/catalog/whitelist/${add.json().item.id}`,
    });
    expect(del.statusCode).toBe(200);
    const list2 = await app.inject({ method: "GET", url: "/api/v1/catalog/whitelist" });
    expect(list2.json().items).toHaveLength(0);
  });

  it("GET /blacklist 按 entityType/channel 过滤", async () => {
    const { ctx } = makeCatalogFakePrisma();
    ctx.catalogBlacklist.push(blacklistRow({ entityType: "product", channel: "affiliate" }));
    ctx.catalogBlacklist.push(blacklistRow({ entityType: "merchant", channel: "amazon" }));
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/blacklist?entityType=merchant",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0].channel).toBe("amazon");
  });
});

describe("POST /api/v1/catalog/session-credentials（登录账号）", () => {
  const NETWORK_KIND = "yeahpromos";

  function setupCtx() {
    const { ctx } = makeCatalogFakePrisma();
    ctx.affiliateNetwork.push(
      testNetwork({ kind: NETWORK_KIND, syncMode: "session" })
    );
    ctx.adminGrant.push(activeGrant(NETWORK_KIND));
    return ctx;
  }

  it("密码落库是密文（非明文），lastLoginAt 被刷新，审计不记秘密", async () => {
    const ctx = setupCtx();
    const { app } = buildApp(ctx, "admin");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/session-credentials",
      payload: {
        networkId: TEST_NETWORK,
        username: "myuser",
        password: "s3cr3t-p@ss",
        sessionValidDays: 30,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().saved).toBe(true);

    const row = ctx.affiliateNetwork[0];
    expect(row.sessionUsername).toBe("myuser");
    // 密文：enc 前缀 + 不含明文
    expect(row.sessionPasswordRef).toMatch(/^enc:v1:/);
    expect(row.sessionPasswordRef).not.toContain("s3cr3t-p@ss");
    expect(row.sessionValidDays).toBe(30);
    expect(row.lastLoginAt).toBeInstanceOf(Date);

    // 审计：只记动作，不记用户名/密码内容
    const audit = ctx.adminGrantAudit.find(
      (a) => a.action === "CATALOG_SESSION_CREDENTIALS_SAVED"
    );
    expect(audit).toBeDefined();
    const detail = JSON.stringify((audit as Record<string, unknown>).detail);
    expect(detail).not.toContain("s3cr3t-p@ss");
    expect(detail).not.toContain("myuser");
  });

  it("留空密码 → 不覆盖已保存的密文", async () => {
    const ctx = setupCtx();
    ctx.affiliateNetwork[0].sessionPasswordRef = "enc:v1:old";
    const { app } = buildApp(ctx, "admin");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/session-credentials",
      payload: { networkId: TEST_NETWORK, username: "u2" },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.affiliateNetwork[0].sessionPasswordRef).toBe("enc:v1:old");
    expect(ctx.affiliateNetwork[0].sessionUsername).toBe("u2");
  });

  it("非法有效期天数 → 400", async () => {
    const ctx = setupCtx();
    const { app } = buildApp(ctx, "admin");
    for (const days of [0, -5, 366, 1.5, "abc"]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/catalog/session-credentials",
        payload: { networkId: TEST_NETWORK, sessionValidDays: days },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it("无 B6 授权 → 403", async () => {
    const { ctx } = makeCatalogFakePrisma();
    ctx.affiliateNetwork.push(
      testNetwork({ kind: NETWORK_KIND, syncMode: "session" })
    );
    const { app } = buildApp(ctx, "admin");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/session-credentials",
      payload: { networkId: TEST_NETWORK, username: "u" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /api/v1/catalog/products/launch-counts（历史投放次数）", () => {
  const prod = (overrides: Record<string, any> = {}) => ({
    id: randomUUID(),
    tenantId: TEST_TENANT,
    networkId: TEST_NETWORK,
    externalId: "62837599",
    name: "Midea 产品",
    ...overrides,
  });
  it("offer.idempotencyKey 挂钩 → 投放档案条数聚合", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const p = prod();
    ctx.networkProduct.push(p);
    const key = `catalog:${TEST_NETWORK}:62837599`;
    const offer = {
      id: randomUUID(),
      tenantId: TEST_TENANT,
      name: "Midea Offer",
      idempotencyKey: key,
    };
    ctx.offer.push(offer);
    ctx.launchArchive.push({
      id: randomUUID(),
      tenantId: TEST_TENANT,
      offerId: offer.id,
      offerName: "Midea Offer",
    });
    ctx.launchArchive.push({
      id: randomUUID(),
      tenantId: TEST_TENANT,
      offerId: offer.id,
      offerName: "Midea Offer",
    });
    // 其他租户的档案不计入
    ctx.launchArchive.push({
      id: randomUUID(),
      tenantId: "other-tenant",
      offerId: offer.id,
      offerName: "Midea Offer",
    });
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/catalog/products/launch-counts?ids=${p.id}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().counts[p.id]).toBe(2);
  });

  it("没投过 → 返回 0（不编数）", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const p = prod({ externalId: "99999999" });
    ctx.networkProduct.push(p);
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/catalog/products/launch-counts?ids=${p.id}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().counts[p.id] ?? 0).toBe(0);
  });
});

describe("GET /api/v1/catalog/products/:id/launch-history（单条投放历史）", () => {
  it("返回 Offer + 投放档案明细", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const p = {
      id: randomUUID(),
      tenantId: TEST_TENANT,
      networkId: TEST_NETWORK,
      externalId: "62837599",
      name: "Midea 产品",
    };
    ctx.networkProduct.push(p);
    const offer = {
      id: randomUUID(),
      tenantId: TEST_TENANT,
      name: "Midea Offer",
      status: "ACTIVE",
      idempotencyKey: `catalog:${TEST_NETWORK}:62837599`,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    };
    ctx.offer.push(offer);
    ctx.launchArchive.push({
      id: randomUUID(),
      tenantId: TEST_TENANT,
      offerId: offer.id,
      offerName: "Midea Offer",
      decision: "go",
      impressions: 1000,
      clicks: 50,
      spend: 10,
      conversions: 2,
      revenue: 16,
      launchedAt: new Date("2026-01-02T00:00:00Z"),
      endedAt: new Date("2026-01-03T00:00:00Z"),
      createdAt: new Date("2026-01-03T00:00:00Z"),
    });
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/catalog/products/${p.id}/launch-history`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.offers).toHaveLength(1);
    expect(body.offers[0].name).toBe("Midea Offer");
    expect(body.archives).toHaveLength(1);
    expect(body.archives[0].decision).toBe("go");
    expect(body.archives[0].clicks).toBe(50);
  });
});

/* ── 2026-10-20 完善批：广告数过滤 / 漏斗 / 同步任务 / 评分一致性 ── */

function funnelProduct(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: randomUUID(),
    tenantId: TEST_TENANT,
    networkId: TEST_NETWORK,
    externalId: `ext-${Math.random().toString(36).slice(2, 8)}`,
    name: "P",
    brand: "B",
    asin: null,
    price: 100,
    commissionAmount: 20,
    commissionRate: 15,
    currency: "USD",
    reviewCount: 100,
    recommended: false,
    recommendationScore: null,
    promoUrl: null,
    rawData: {},
    syncedAt: new Date(),
    createdAt: new Date(),
    merchantId: null,
    status: "active",
    adCount: null,
    ...overrides,
  };
}

describe("GET /api/v1/catalog/products 广告数过滤（minAdCount / hasAds）", () => {
  function setup() {
    const { ctx } = makeCatalogFakePrisma();
    ctx.affiliateNetwork.push(testNetwork());
    ctx.networkProduct.push(
      funnelProduct({ externalId: "a0", adCount: 0 }),
      funnelProduct({ externalId: "a5", adCount: 5 }),
      funnelProduct({ externalId: "an", adCount: null })
    );
    return ctx;
  }

  it("minAdCount=1 → 只剩 adCount>=1（0 和未计算都排除）", async () => {
    const ctx = setup();
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/products?minAdCount=1",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].externalId).toBe("a5");
  });

  it("hasAds=1 → 同 minAdCount=1", async () => {
    const ctx = setup();
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/products?hasAds=1",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(1);
  });

  it("无广告参数 → 全部返回", async () => {
    const ctx = setup();
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/products",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(3);
  });

  it("与其他过滤组合：minAdCount + recommended", async () => {
    const ctx = setup();
    ctx.networkProduct[0].recommended = true; // adCount=0 的那条
    ctx.networkProduct[1].recommended = true; // adCount=5 的那条
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/products?recommended=true&minAdCount=2",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].externalId).toBe("a5");
  });
});

describe("GET /api/v1/catalog/products 测试优先分（行字段 + sort=priority）", () => {
  function setup() {
    const { ctx } = makeCatalogFakePrisma();
    ctx.affiliateNetwork.push(testNetwork());
    // 分数逐项验算（初筛 + 广告 + 佣金）：
    // high: pass 30 + adCount 10 sweet 40 + 佣金金额 60 → 30 = 100
    // mid:  review 18 + adCount 3 small 30 + 费率换算 100×15% = 15 → 16 = 64
    // none: 未筛 5 + 未计算 12 + 佣金金额 20 → 16 = 33
    // low:  kill 0 + adCount 0 none 4 + 佣金未知 → 8 = 12
    ctx.networkProduct.push(
      funnelProduct({
        externalId: "p-high",
        screenVerdict: "pass",
        adCount: 10,
        commissionAmount: 60,
        countryCode: "CA",
      }),
      funnelProduct({
        externalId: "p-mid",
        screenVerdict: "review",
        adCount: 3,
        commissionAmount: null,
        commissionRate: 15,
        price: 100,
        countryCode: "US",
      }),
      funnelProduct({
        externalId: "p-none",
        commissionAmount: 20,
        countryCode: "US",
      }),
      funnelProduct({
        externalId: "p-low",
        screenVerdict: "kill",
        adCount: 0,
        commissionAmount: null,
        commissionRate: null,
        countryCode: "US",
      })
    );
    return ctx;
  }

  it("默认排序下每行也带 testPriority（score + reasons）", async () => {
    const ctx = setup();
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/products",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const mid = body.items.find((p: any) => p.externalId === "p-mid");
    expect(mid.testPriority.score).toBe(64);
    expect(mid.testPriority.reasons).toContain("初筛谨慎");
    const high = body.items.find((p: any) => p.externalId === "p-high");
    expect(high.testPriority.score).toBe(100);
    expect(high.testPriority.reasons).toContain("初筛通过");
  });

  it("sort=priority 与 priority_desc：按分数降序，total 不变", async () => {
    for (const sort of ["priority", "priority_desc"]) {
      const ctx = setup();
      const { app } = buildApp(ctx, "member");
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/catalog/products?sort=${sort}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(4);
      expect(body.items.map((p: any) => p.externalId)).toEqual([
        "p-high",
        "p-mid",
        "p-none",
        "p-low",
      ]);
      expect(body.items.map((p: any) => p.testPriority.score)).toEqual([
        100, 64, 33, 12,
      ]);
    }
  });

  it("sort=priority_asc：分数升序", async () => {
    const ctx = setup();
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/products?sort=priority_asc",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(4);
    expect(body.items.map((p: any) => p.externalId)).toEqual([
      "p-low",
      "p-none",
      "p-mid",
      "p-high",
    ]);
  });

  it("priority 排序分页：先全序再切片，total 为过滤后总数", async () => {
    const ctx = setup();
    const { app } = buildApp(ctx, "member");
    const page1 = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/products?sort=priority&pageSize=2&page=1",
    });
    expect(page1.json().total).toBe(4);
    expect(page1.json().items.map((p: any) => p.externalId)).toEqual([
      "p-high",
      "p-mid",
    ]);
    const page2 = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/products?sort=priority&pageSize=2&page=2",
    });
    expect(page2.json().total).toBe(4);
    expect(page2.json().items.map((p: any) => p.externalId)).toEqual([
      "p-none",
      "p-low",
    ]);
  });

  it("与 country 过滤叠加：先过滤后算分排序（CA 的高分商品被排除）", async () => {
    const ctx = setup();
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/products?sort=priority&country=US",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(3);
    expect(body.items.map((p: any) => p.externalId)).toEqual([
      "p-mid",
      "p-none",
      "p-low",
    ]);
  });
});

describe("探针明细透传（products 行字段 + brands 聚合）", () => {
  const DETAIL = [
    { q: "OLIGHT", kind: "bare", paid: 0, shopping: 0, total: 0 },
    { q: "OLIGHT baton4", kind: "model", paid: 2, shopping: 1, total: 3 },
    { q: "OLIGHT baton 4", kind: "model", paid: 0, shopping: 0, total: 0 },
  ];

  function setup() {
    const { ctx } = makeCatalogFakePrisma();
    ctx.affiliateNetwork.push(testNetwork());
    ctx.networkProduct.push(
      funnelProduct({
        externalId: "d1",
        brand: "OLIGHT",
        countryCode: "US",
        adCount: 0,
        adCountLongtail: 3,
        adProbeDetail: DETAIL,
      }),
      // 同组第二件 detail 为 null（半写状态）：聚合取第一个非 null
      funnelProduct({
        externalId: "d2",
        brand: "OLIGHT",
        countryCode: "US",
        adCount: 0,
        adCountLongtail: 3,
        adProbeDetail: null,
      }),
      // 从未按明细口径算过的品牌组 → null，不编造
      funnelProduct({ externalId: "d3", brand: "PlainBrand", countryCode: "US" })
    );
    return ctx;
  }

  it("GET products：adProbeDetail 原样透传；缺失/非法形状 → null", async () => {
    const ctx = setup();
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/products",
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<any>;
    expect(items.find((p) => p.externalId === "d1").adProbeDetail).toEqual(
      DETAIL
    );
    expect(items.find((p) => p.externalId === "d2").adProbeDetail).toBeNull();
    expect(items.find((p) => p.externalId === "d3").adProbeDetail).toBeNull();
  });

  it("GET brands：组级取第一个非 null 的 adProbeDetail；无明细组为 null", async () => {
    const ctx = setup();
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/brands",
    });
    expect(res.statusCode).toBe(200);
    const brands = res.json().brands as Array<any>;
    const olight = brands.find((b) => b.brand === "OLIGHT");
    expect(olight.adProbeDetail).toEqual(DETAIL);
    const plain = brands.find((b) => b.brand === "PlainBrand");
    expect(plain.adProbeDetail).toBeNull();
  });
});

describe("透明中心旁证透传（products 行字段 + brands 聚合 + 优先分地板）", () => {
  const TOP = [{ name: "OLIGHTSTORE USA INC", approxAds: 8300 }];
  const CHECKED = new Date("2026-10-21T08:00:00.000Z");

  function setup() {
    const { ctx } = makeCatalogFakePrisma();
    ctx.affiliateNetwork.push(testNetwork());
    ctx.networkProduct.push(
      funnelProduct({
        externalId: "t1",
        brand: "TcBrand",
        countryCode: "US",
        adCount: 0,
        adCountLongtail: 0,
        tcAdvertisersCount: 11,
        tcTopAdvertisers: TOP,
        tcCheckedAt: CHECKED,
      }),
      // 同组第二件 TC 为 null（半写状态）：聚合取第一个非 null
      funnelProduct({
        externalId: "t2",
        brand: "TcBrand",
        countryCode: "US",
        adCount: 0,
        adCountLongtail: 0,
      }),
      // TC = 0（查过且无广告主）：与未查（null）严格区分
      funnelProduct({
        externalId: "t3",
        brand: "ZeroTcBrand",
        countryCode: "US",
        adCount: 0,
        adCountLongtail: 0,
        tcAdvertisersCount: 0,
        tcCheckedAt: CHECKED,
      }),
      // 从未查过 TC 的品牌组 → null，不拿空冒充 0
      funnelProduct({ externalId: "t4", brand: "PlainBrand", countryCode: "US" })
    );
    return ctx;
  }

  it("GET products：tc 三字段透传（count/top/checkedAt ISO）；未查 → 全 null", async () => {
    const ctx = setup();
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/products",
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<any>;
    const t1 = items.find((p) => p.externalId === "t1");
    expect(t1.tcAdvertisersCount).toBe(11);
    expect(t1.tcTopAdvertisers).toEqual(TOP);
    expect(t1.tcCheckedAt).toBe("2026-10-21T08:00:00.000Z");
    const t3 = items.find((p) => p.externalId === "t3");
    expect(t3.tcAdvertisersCount).toBe(0);
    const t4 = items.find((p) => p.externalId === "t4");
    expect(t4.tcAdvertisersCount).toBeNull();
    expect(t4.tcTopAdvertisers).toBeNull();
    expect(t4.tcCheckedAt).toBeNull();
  });

  it("GET products：TC ≥1 给测试优先分广告腿托底（高于 TC=0 的同形商品）", async () => {
    const ctx = setup();
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/products",
    });
    const items = res.json().items as Array<any>;
    const t1 = items.find((p) => p.externalId === "t1");
    const t3 = items.find((p) => p.externalId === "t3");
    // 其余腿同形：广告腿 small(30) vs none(4) → 总分差 26
    expect(t1.testPriority.score - t3.testPriority.score).toBe(26);
    expect(t1.testPriority.reasons.join(" ")).toContain("透明中心有广告主在投");
  });

  it("GET brands：组级取第一个非 null 的 TC 三字段；未查组为 null", async () => {
    const ctx = setup();
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/brands",
    });
    expect(res.statusCode).toBe(200);
    const brands = res.json().brands as Array<any>;
    const tc = brands.find((b) => b.brand === "TcBrand");
    expect(tc.tcAdvertisersCount).toBe(11);
    expect(tc.tcTopAdvertisers).toEqual(TOP);
    expect(tc.tcCheckedAt).toBe("2026-10-21T08:00:00.000Z");
    const plain = brands.find((b) => b.brand === "PlainBrand");
    expect(plain.tcAdvertisersCount).toBeNull();
    expect(plain.tcTopAdvertisers).toBeNull();
    expect(plain.tcCheckedAt).toBeNull();
  });
});

describe("GET /api/v1/catalog/funnel（可投流漏斗）", () => {
  it("六段计数口径：total/passedGate/recommended/launchable/withAds/offersCreated", async () => {
    const { ctx } = makeCatalogFakePrisma();
    ctx.affiliateNetwork.push(testNetwork());
    const merchantId = randomUUID();
    // 1: recommended + 有链接 + active → launchable，且已建 Offer；adCount=5 → withAds
    const p1 = funnelProduct({
      externalId: "f1",
      recommended: true,
      promoUrl: "https://promo.test/1",
      adCount: 5,
    });
    // 2: recommended 但无链接 → 只进 recommended；adCount=0 不进 withAds
    const p2 = funnelProduct({
      externalId: "f2",
      recommended: true,
      adCount: 0,
    });
    // 3: recommended + 有链接但被拉黑（商品级）→ 哪段都不进（除 total/passedGate）
    const p3 = funnelProduct({
      externalId: "f3",
      recommended: true,
      promoUrl: "https://promo.test/3",
    });
    // 4: 未推荐 + inactive → 只进 total
    const p4 = funnelProduct({ externalId: "f4", status: "inactive" });
    // 5: recommended + 有链接但商家被拉黑 → 不进 recommended/launchable
    const p5 = funnelProduct({
      externalId: "f5",
      recommended: true,
      promoUrl: "https://promo.test/5",
      merchantId,
    });
    // 6: 裸品牌词 0、长尾探针 3 → 多探针口径下计入 withAds（total/passedGate 同步 +1）
    const p6 = funnelProduct({
      externalId: "f6",
      adCount: 0,
      adCountLongtail: 3,
    });
    ctx.networkProduct.push(p1, p2, p3, p4, p5, p6);
    ctx.catalogBlacklist.push(
      blacklistRow({ entityType: "product", entityId: p3.id }),
      blacklistRow({ entityType: "merchant", entityId: merchantId })
    );
    ctx.offer.push({
      id: randomUUID(),
      tenantId: TEST_TENANT,
      name: "Offer F1",
      idempotencyKey: `catalog:${TEST_NETWORK}:f1`,
    });
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({ method: "GET", url: "/api/v1/catalog/funnel" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      total: 6,
      passedGate: 5,
      recommended: 2,
      launchable: 1,
      withAds: 2,
      offersCreated: 1,
    });
  });

  it("networkId 过滤 + 其他租户不计入", async () => {
    const { ctx } = makeCatalogFakePrisma();
    ctx.affiliateNetwork.push(testNetwork());
    const otherNetwork = randomUUID();
    ctx.networkProduct.push(
      funnelProduct({ externalId: "n1" }),
      funnelProduct({ externalId: "n2", networkId: otherNetwork }),
      funnelProduct({ externalId: "n3", tenantId: "99999999-9999-4999-8999-999999999999" })
    );
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/catalog/funnel?networkId=${TEST_NETWORK}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(1);
    const all = await app.inject({ method: "GET", url: "/api/v1/catalog/funnel" });
    expect(all.json().total).toBe(2);
  });
});

describe("POST /api/v1/catalog/sync（后台任务）", () => {
  async function waitForJob(
    ctx: CatalogFakeCtx,
    id: string
  ): Promise<Record<string, any>> {
    const start = Date.now();
    for (;;) {
      const job = ctx.catalogSyncJob.find((j: any) => j.id === id);
      if (
        job &&
        ["succeeded", "failed", "skipped"].includes(job.status as string)
      ) {
        return job as Record<string, any>;
      }
      if (Date.now() - start > 5000) throw new Error("sync job 未在期限内结束");
      await new Promise((r) => setImmediate(r));
    }
  }

  it("立即返回 {jobId, status:running}；后台跑完 → skipped（黑名单账号）", async () => {
    const { ctx } = makeCatalogFakePrisma();
    ctx.affiliateNetwork.push(testNetwork({ kind: "yeahpromos" }));
    ctx.adminGrant.push(activeGrant("yeahpromos"));
    ctx.catalogBlacklist.push(
      blacklistRow({
        entityType: "network_account",
        entityId: TEST_NETWORK,
        reason: "session_expired_x3",
      })
    );
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/sync",
      payload: { networkId: TEST_NETWORK },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("running");
    expect(body.jobId).toMatch(/^[0-9a-f-]{36}$/i);
    const job = await waitForJob(ctx, body.jobId);
    expect(job.status).toBe("skipped");
    expect(job.scope).toBe("full");
    expect((job.result as any).skipped).toBe(true);
    expect(job.finishedAt).toBeInstanceOf(Date);
    // 轮询端点能读到同一条
    const poll = await app.inject({
      method: "GET",
      url: `/api/v1/catalog/sync-jobs/${body.jobId}`,
    });
    expect(poll.statusCode).toBe(200);
    expect(poll.json().job.status).toBe("skipped");
  });

  it("后台执行失败 → job failed + error（api 模式无凭证）", async () => {
    const { ctx } = makeCatalogFakePrisma();
    ctx.affiliateNetwork.push(
      testNetwork({ kind: "yeahpromos", syncMode: "api", apiKeyRef: null })
    );
    ctx.adminGrant.push(activeGrant("yeahpromos"));
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/sync",
      payload: { networkId: TEST_NETWORK, brandId: "66303" },
    });
    expect(res.statusCode).toBe(200);
    const job = await waitForJob(ctx, res.json().jobId);
    expect(job.status).toBe("failed");
    expect(job.scope).toBe("brand");
    expect(job.brandId).toBe("66303");
    expect(String(job.error)).toContain("API");
  });

  it("无 B6 授权（member 无 grant）→ 403 且不建 job", async () => {
    const { ctx } = makeCatalogFakePrisma();
    ctx.affiliateNetwork.push(testNetwork({ kind: "yeahpromos" }));
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/sync",
      payload: { networkId: TEST_NETWORK },
    });
    expect(res.statusCode).toBe(403);
    expect(ctx.catalogSyncJob).toHaveLength(0);
  });

  it("GET /sync-jobs 列表（最近在前）+ tenant 隔离 + :id 隔离 404", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const mine = {
      id: randomUUID(),
      tenantId: TEST_TENANT,
      networkId: TEST_NETWORK,
      userId: TEST_USER,
      scope: "full",
      brandId: null,
      status: "succeeded",
      stage: "done",
      result: { synced: 3 },
      error: null,
      createdAt: new Date("2026-10-20T01:00:00Z"),
      startedAt: new Date("2026-10-20T01:00:01Z"),
      finishedAt: new Date("2026-10-20T01:00:05Z"),
    };
    const otherTenantJob = {
      ...mine,
      id: randomUUID(),
      tenantId: "99999999-9999-4999-8999-999999999999",
      createdAt: new Date("2026-10-20T02:00:00Z"),
    };
    ctx.catalogSyncJob.push(otherTenantJob, mine);
    const { app } = buildApp(ctx, "member");
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/sync-jobs",
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().jobs).toHaveLength(1);
    expect(list.json().jobs[0].id).toBe(mine.id);
    const foreign = await app.inject({
      method: "GET",
      url: `/api/v1/catalog/sync-jobs/${otherTenantJob.id}`,
    });
    expect(foreign.statusCode).toBe(404);
  });
});

describe("评分三路径一致性（/screen 与 /calc-score）", () => {
  it("同一商品经 /screen 与 /calc-score 得到相同 score/recommended", async () => {
    const { ctx } = makeCatalogFakePrisma();
    ctx.affiliateNetwork.push(testNetwork());
    const p = funnelProduct({
      externalId: "s1",
      price: 100,
      commissionAmount: 30,
      commissionRate: 20,
      reviewCount: 5000,
    });
    ctx.networkProduct.push(p);
    // admin 角色 B6 豁免；/screen 与 /calc-score 都走 resolveScreeningPreset（无预设行 → DEFAULT_PRESET）
    const { app } = buildApp(ctx, "admin");
    const screen = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/screen",
      payload: { networkId: TEST_NETWORK },
    });
    expect(screen.statusCode).toBe(200);
    const afterScreen = { ...ctx.networkProduct[0] };
    const calc = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/products/calc-score",
      payload: { ids: [p.id] },
    });
    expect(calc.statusCode).toBe(200);
    const scored = calc.json().scored as Array<{
      productId: string;
      score: number;
      recommended: boolean;
    }>;
    expect(scored).toHaveLength(1);
    expect(scored[0].score).toBe(Number(afterScreen.recommendationScore));
    expect(scored[0].recommended).toBe(afterScreen.recommended);
    expect(ctx.networkProduct[0].recommendationScore).toBe(
      afterScreen.recommendationScore
    );
  });
});

/* ── 2026-10-20 巡检回归：筛选预设 PUT 留空语义（C-1）──
 * 口径：显式 null → 写 NULL（读时 ?? DEFAULT_PRESET 回落默认，"留空=默认"）；
 * 字段省略 → 保持旧值；0 → 写入（=禁用该项检查）；负数/非数字 → 400。 */
describe("PUT /api/v1/catalog/screening-preset 留空语义", () => {
  it("显式 null → 写 NULL；GET 回显 null（生效时回落默认 150）", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const { app } = buildApp(ctx, "member");
    let res = await app.inject({
      method: "PUT",
      url: "/api/v1/catalog/screening-preset",
      payload: { maxPrice: 200 },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.catalogScreeningPreset[0].maxPrice).toBe(200);
    // 用户清空输入框 → 前端发 null → 必须写 NULL，不能静默保持 200
    res = await app.inject({
      method: "PUT",
      url: "/api/v1/catalog/screening-preset",
      payload: { maxPrice: null },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.catalogScreeningPreset[0].maxPrice).toBeNull();
    const get = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/screening-preset",
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().preset.maxPrice).toBeNull();
    expect(get.json().saved).toBe(true);
  });

  it("0 正常写入（=禁用该项检查）；负数/非数字 → 400", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const { app } = buildApp(ctx, "member");
    let res = await app.inject({
      method: "PUT",
      url: "/api/v1/catalog/screening-preset",
      payload: { minReviews: 0 },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.catalogScreeningPreset[0].minReviews).toBe(0);
    res = await app.inject({
      method: "PUT",
      url: "/api/v1/catalog/screening-preset",
      payload: { minReviews: -5 },
    });
    expect(res.statusCode).toBe(400);
    res = await app.inject({
      method: "PUT",
      url: "/api/v1/catalog/screening-preset",
      payload: { minReviews: "abc" },
    });
    expect(res.statusCode).toBe(400);
    // 非法写入未污染已存值
    expect(ctx.catalogScreeningPreset[0].minReviews).toBe(0);
  });

  it("字段省略/空串 → 保持旧值（跳过）", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const { app } = buildApp(ctx, "member");
    await app.inject({
      method: "PUT",
      url: "/api/v1/catalog/screening-preset",
      payload: { maxPrice: 200 },
    });
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/catalog/screening-preset",
      payload: { minReviews: 10, maxPrice: "" },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.catalogScreeningPreset[0].maxPrice).toBe(200);
    expect(ctx.catalogScreeningPreset[0].minReviews).toBe(10);
  });
});

/* ── 2026-10-20 巡检模拟：商品库全流程数字自洽 ──
 * 同步入库（fixture）→ 筛选 → 列表过滤组合 → 广告数 → 批量建 Offer →
 * 漏斗每段数字必须与列表对应过滤的条数一致（"一轮轮筛选到底有没有搞"
 * 的数字证据链）。 */
describe("商品库全流程数字自洽（漏斗 = 列表过滤）", () => {
  async function seedFlow(
    offersCreateImpl?: (input: any, ctx: CatalogFakeCtx) => Promise<any>
  ) {
    const { ctx } = makeCatalogFakePrisma();
    ctx.affiliateNetwork.push(testNetwork());
    const merchantId = randomUUID();
    const p1 = funnelProduct({
      externalId: "e1",
      recommended: true,
      promoUrl: "https://promo.test/1",
      adCount: 5,
    }); // launchable + withAds
    const p2 = funnelProduct({
      externalId: "e2",
      recommended: true,
      promoUrl: "https://promo.test/2",
      adCount: null,
    }); // launchable，无广告数
    const p3 = funnelProduct({
      externalId: "e3",
      recommended: true,
      promoUrl: null,
      adCount: 3,
    }); // 仅推荐 + withAds
    const p4 = funnelProduct({ externalId: "e4", recommended: false, adCount: 0 });
    const p5 = funnelProduct({
      externalId: "e5",
      recommended: false,
      status: "inactive",
      adCount: null,
    });
    const p6 = funnelProduct({
      externalId: "e6",
      recommended: true,
      promoUrl: "https://promo.test/6",
      adCount: 2,
      merchantId,
    }); // 商家黑名单 → 不进 recommended/launchable，但 withAds 照计
    ctx.networkProduct.push(p1, p2, p3, p4, p5, p6);
    ctx.catalogBlacklist.push(
      blacklistRow({ entityType: "merchant", entityId: merchantId })
    );
    const { app } = buildApp(ctx, "member", offersCreateImpl);
    return { ctx, app, p1, p2 };
  }

  async function getJson(app: any, url: string) {
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  it("漏斗六段与列表过滤逐项对齐", async () => {
    const { app } = await seedFlow();
    const funnel = await getJson(app, "/api/v1/catalog/funnel");
    expect(funnel).toEqual({
      total: 6,
      passedGate: 5,
      recommended: 3,
      launchable: 2,
      withAds: 3,
      offersCreated: 0,
    });
    // 每段 = 列表对应过滤的条数
    expect((await getJson(app, "/api/v1/catalog/products")).total).toBe(
      funnel.total
    );
    expect(
      (await getJson(app, "/api/v1/catalog/products?recommended=true")).total
    ).toBe(funnel.recommended);
    expect(
      (await getJson(app, "/api/v1/catalog/products?hasAds=1")).total
    ).toBe(funnel.withAds);
    expect(
      (await getJson(app, "/api/v1/catalog/products?minAdCount=3")).total
    ).toBe(2); // e1(5)、e3(3)
    expect(
      (
        await getJson(
          app,
          "/api/v1/catalog/products?recommended=true&hasAds=1"
        )
      ).total
    ).toBe(2); // e1、e3（e6 被商家黑名单排除）
  });

  it("批量建 Offer → 漏斗 offersCreated 联动；失败项原因可见", async () => {
    const { app, p1, p2 } = await seedFlow();
    const batch = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/offers/batch",
      payload: { productIds: [p1.id, p2.id, "11111111-1111-4111-8111-111111111111"] },
    });
    expect(batch.statusCode).toBe(200);
    const body = batch.json();
    expect(body.created).toHaveLength(2);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0].reason).toMatch(/不存在/);
    const funnel = await getJson(app, "/api/v1/catalog/funnel");
    expect(funnel.offersCreated).toBe(2);
  });

  it("批量建 Offer 幂等回放 → skippedExisting 单列，不混进 created", async () => {
    // 忠实模拟 OfferService.create 的幂等：同 idempotencyKey 第二次返回 created=false。
    const seen = new Map<string, any>();
    const idempotentCreate = async (input: any, ctx: CatalogFakeCtx) => {
      const key = input?.idempotencyKey as string;
      const prev = seen.get(key);
      if (prev) return { offer: prev, created: false, replayed: true };
      const offer = {
        id: randomUUID(),
        tenantId: TEST_TENANT,
        name: input?.name ?? "Offer",
        idempotencyKey: key ?? null,
        ...input,
      };
      seen.set(key, offer);
      ctx.offer.push(offer);
      return { offer, created: true, replayed: false };
    };
    const { app, p1 } = await seedFlow(idempotentCreate);
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/offers/batch",
      payload: { productIds: [p1.id] },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    expect(firstBody.created).toHaveLength(1);
    expect(firstBody.skippedExisting).toHaveLength(0);
    // 同一件商品再点一次「建 Offer」：不重复建，明示已存在。
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/offers/batch",
      payload: { productIds: [p1.id] },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json();
    expect(secondBody.created).toHaveLength(0);
    expect(secondBody.failed).toHaveLength(0);
    expect(secondBody.skippedExisting).toHaveLength(1);
    expect(secondBody.skippedExisting[0].productId).toBe(p1.id);
    expect(secondBody.skippedExisting[0].offerId).toBe(
      firstBody.created[0].offerId
    );
  });
});
