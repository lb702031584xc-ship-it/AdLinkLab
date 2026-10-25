/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
/**
 * 商品库松绑口径路由测试（2026-10-25，Fastify inject + in-memory fake Prisma）。
 *
 * 覆盖：预设 PUT/GET 的 mode 往返（默认 regular；loose 存取一致；非法值 400）；
 * loose 预设下 /screen 按松绑口径写 recommended；列表行 riskCost 商家级挂接
 * （有政策的商家挂标签、无政策的不挂）；commission_desc 排序（有效佣金降序，
 * null 排后，次级序 externalId 降序，全量内存排序后分页）。
 */
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import { registerCatalogRoutes } from "./catalog.js";
import {
  makeCatalogFakePrisma,
  testNetwork,
  TEST_NETWORK,
  TEST_TENANT,
  TEST_USER,
  type CatalogFakeCtx,
} from "../services/catalog-fake-prisma.js";
import type { OfferService } from "../services/offer-engine.js";

function buildApp(ctx: CatalogFakeCtx, role: string) {
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
    create: async (input: any) => {
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

function productRow(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: randomUUID(),
    tenantId: TEST_TENANT,
    networkId: TEST_NETWORK,
    externalId: `ext-${Math.random().toString(36).slice(2, 8)}`,
    name: "P",
    brand: "B",
    asin: null,
    price: 100,
    commissionAmount: null,
    commissionRate: null,
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

describe("预设 mode 往返（GET/PUT /api/v1/catalog/screening-preset）", () => {
  it("未保存 → 默认 regular，saved:false", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/screening-preset",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().preset.mode).toBe("regular");
    expect(res.json().saved).toBe(false);
  });

  it("loose 存取一致；再写 regular 回落；非法值 400 且不污染已存值", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const { app } = buildApp(ctx, "member");
    let res = await app.inject({
      method: "PUT",
      url: "/api/v1/catalog/screening-preset",
      payload: { mode: "loose" },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.catalogScreeningPreset[0].mode).toBe("loose");
    res = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/screening-preset",
    });
    expect(res.json().preset.mode).toBe("loose");
    expect(res.json().saved).toBe(true);
    res = await app.inject({
      method: "PUT",
      url: "/api/v1/catalog/screening-preset",
      payload: { mode: "bogus" },
    });
    expect(res.statusCode).toBe(400);
    expect(ctx.catalogScreeningPreset[0].mode).toBe("loose");
    res = await app.inject({
      method: "PUT",
      url: "/api/v1/catalog/screening-preset",
      payload: { mode: "regular" },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.catalogScreeningPreset[0].mode).toBe("regular");
  });

  it("显式 null → 视为 regular", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/catalog/screening-preset",
      payload: { mode: null },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.catalogScreeningPreset[0].mode).toBe("regular");
  });
});

describe("loose 预设下 /screen 按松绑口径写 recommended", () => {
  it("高价（常规价格带外）与低价高佣准入，低价低佣不准入", async () => {
    const { ctx } = makeCatalogFakePrisma();
    ctx.affiliateNetwork.push(testNetwork());
    ctx.catalogScreeningPreset.push({
      id: randomUUID(),
      tenantId: TEST_TENANT,
      minReviews: null,
      minCommissionAmount: null,
      minCommissionRate: null,
      minPrice: null,
      maxPrice: null,
      minScore: null,
      mode: "loose",
    });
    const high = productRow({ price: 9999, commissionAmount: 30 });
    const lowHighComm = productRow({ price: 50, commissionAmount: 6 });
    const lowLowComm = productRow({ price: 50, commissionAmount: 3 });
    ctx.networkProduct.push(high, lowHighComm, lowLowComm);
    const { app } = buildApp(ctx, "admin");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/screen",
      payload: { networkId: TEST_NETWORK },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ screened: 3, recommended: 2 });
    expect(ctx.networkProduct[0].recommended).toBe(true);
    expect(ctx.networkProduct[1].recommended).toBe(true);
    expect(ctx.networkProduct[2].recommended).toBe(false);
  });
});

describe("列表行 riskCost 商家级挂接", () => {
  it("有政策的商家挂最新快照标签；无政策/无商家的行不挂字段", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const m1 = randomUUID();
    const m2 = randomUUID();
    const o1 = randomUUID();
    const o2 = randomUUID();
    ctx.offer.push(
      { id: o1, tenantId: TEST_TENANT, merchantId: m1 },
      { id: o2, tenantId: TEST_TENANT, merchantId: m1 }
    );
    // 同商家两条快照：旧的禁 SEM，新的禁品牌词+直链 → 只取最新一条。
    ctx.offerPolicy.push(
      {
        id: randomUUID(),
        tenantId: TEST_TENANT,
        offerId: o2,
        rules: { PPC: "FORBIDDEN" },
        createdAt: new Date("2026-10-24T00:00:00Z"),
      },
      {
        id: randomUUID(),
        tenantId: TEST_TENANT,
        offerId: o1,
        rules: { BRAND_BIDDING: "FORBIDDEN", DIRECT_LINK: "FORBIDDEN" },
        createdAt: new Date("2026-10-25T00:00:00Z"),
      }
    );
    ctx.networkProduct.push(
      productRow({ merchantId: m1 }),
      productRow({ merchantId: m2 }),
      productRow({ merchantId: null })
    );
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/products?preset=0&pageSize=100",
    });
    expect(res.statusCode).toBe(200);
    const products = res.json().products as Array<Record<string, any>>;
    expect(products).toHaveLength(3);
    const byMerchant = new Map(products.map((p) => [p.merchantId, p]));
    expect(byMerchant.get(m1).riskCost).toEqual([
      "禁品牌词竞价",
      "禁直链",
    ]);
    expect("riskCost" in byMerchant.get(m2)).toBe(false);
    expect("riskCost" in byMerchant.get(null)).toBe(false);
  });
});

describe("commission_desc 排序", () => {
  it("有效佣金降序，null 排后，同佣金按 externalId 降序；全量排序后分页", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const p1 = productRow({ externalId: "100", price: 100, commissionAmount: 50 });
    const p5 = productRow({ externalId: "050", price: 200, commissionAmount: 50 });
    const p2 = productRow({ externalId: "200", price: 100, commissionRate: 10 });
    const p3 = productRow({ externalId: "300", price: 50, commissionAmount: 5 });
    const p4 = productRow({ externalId: "400", price: 100 });
    ctx.networkProduct.push(p1, p2, p3, p4, p5);
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/products?preset=0&sort=commission_desc&pageSize=100",
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json().products as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toEqual([p1.id, p5.id, p2.id, p3.id, p4.id]);
    // 分页切片在排序后：第一页 2 条即全局前 2 条（页内排序会给出不同结果）。
    const page1 = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/products?preset=0&sort=commission_desc&pageSize=2",
    });
    expect(page1.json().total).toBe(5);
    expect(
      (page1.json().products as Array<{ id: string }>).map((p) => p.id)
    ).toEqual([p1.id, p5.id]);
  });
});
