/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
/**
 * 品牌榜路由测试（Fastify inject + in-memory fake Prisma）：
 * GET /api/v1/catalog/brands 聚合/排序/trend/band/landingUrl/租户隔离；
 * PUT /api/v1/catalog/brands/landing-url upsert/清除/非法 URL；
 * GET /api/v1/catalog/products 序列化补 lastAdCount/lastAdCountAt/adTrend。
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

const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";

function buildApp(ctx: CatalogFakeCtx): { app: ReturnType<typeof Fastify> } {
  (ctx as any).brandProfile ??= [];
  const { prisma } = makeCatalogFakePrisma(ctx as any);
  const app = Fastify();
  app.addHook("preHandler", (request, _reply, done) => {
    (request as any).sessionAuth = {
      id: TEST_USER,
      email: "u@test.dev",
      name: "Tester",
      role: "member",
      tenantId: TEST_TENANT,
    };
    done();
  });
  const offers = {
    create: async () => {
      throw new Error("not used");
    },
  } as unknown as OfferService;
  void registerCatalogRoutes(app, { prisma, offers });
  return { app };
}

function product(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: randomUUID(),
    tenantId: TEST_TENANT,
    networkId: TEST_NETWORK,
    externalId: `ext-${Math.random().toString(36).slice(2, 8)}`,
    name: "P",
    brand: "Roborock",
    asin: null,
    countryCode: "US",
    price: 100,
    commissionAmount: null,
    commissionRate: 10,
    currency: "USD",
    reviewCount: 100,
    recommended: false,
    recommendationScore: 50,
    promoUrl: "https://promo.test/x",
    rawData: {},
    syncedAt: new Date(),
    createdAt: new Date(),
    merchantId: null,
    status: "active",
    poolStage: "inbox",
    adCount: null,
    adCountSelf: null,
    adCountOthers: null,
    adCountHome: null,
    adCountProduct: null,
    lastAdCount: null,
    lastAdCountCheckedAt: null,
    ...overrides,
  };
}

function setupCatalog(): CatalogFakeCtx {
  const { ctx } = makeCatalogFakePrisma();
  (ctx as any).brandProfile = [];
  ctx.affiliateNetwork.push(testNetwork());
  return ctx;
}

/** Roborock/US（新投，甜蜜点）+ OldBrand/US（停投）+ NoAds/无国家（未计算）。 */
function seedThreeBrands(ctx: CatalogFakeCtx) {
  ctx.networkProduct.push(
    product({
      name: "Roborock S8",
      price: 899,
      commissionRate: 13,
      recommendationScore: 90,
      adCount: 8,
      adCountSelf: 3,
      adCountOthers: 5,
      adCountHome: 5,
      adCountProduct: 3,
      lastAdCount: 0,
    }),
    product({
      name: "Roborock Q5",
      price: 100,
      commissionRate: 10,
      recommendationScore: 70,
      adCount: 8,
      adCountSelf: 3,
      adCountOthers: 5,
      adCountHome: 5,
      adCountProduct: 3,
      lastAdCount: 0,
    }),
    product({
      name: "Roborock Dock",
      price: 50,
      commissionRate: 20,
      recommendationScore: 80,
      adCount: 8,
      adCountSelf: 3,
      adCountOthers: 5,
      adCountHome: 5,
      adCountProduct: 3,
      lastAdCount: 0,
    }),
    product({
      brand: "OldBrand",
      price: 100,
      commissionAmount: 30,
      commissionRate: null,
      recommendationScore: 60,
      adCount: 0,
      lastAdCount: 9,
    }),
    product({
      brand: "NoAds",
      countryCode: null,
      price: 40,
      commissionRate: 5,
      recommendationScore: 10,
    }),
    // 其他租户的同名品牌商品不得混入
    product({ tenantId: OTHER_TENANT, price: 9999 })
  );
}

describe("GET /api/v1/catalog/brands", () => {
  it("聚合数值 + trend/band + brandScore 排序 + 租户隔离", async () => {
    const ctx = setupCatalog();
    seedThreeBrands(ctx);
    const { app } = buildApp(ctx);
    const res = await app.inject({ method: "GET", url: "/api/v1/catalog/brands" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(3);
    expect(body.brands.map((b: any) => b.brand)).toEqual([
      "Roborock",
      "OldBrand",
      "NoAds",
    ]);

    const robo = body.brands[0];
    expect(robo.brandKey).toBe("roborock");
    expect(robo.countryCode).toBe("US");
    expect(robo.networkId).toBe(TEST_NETWORK);
    expect(robo.productCount).toBe(3);
    expect(robo.priceMin).toBe(50);
    expect(robo.priceMax).toBe(899);
    expect(robo.maxRatePct).toBe(20);
    // 单品佣金：899×13% = 116.87 最大
    expect(robo.maxCommissionUsd).toBe(116.87);
    expect(robo.ge80Count).toBe(2);
    expect(robo.adCount).toBe(8);
    expect(robo.adCountSelf).toBe(3);
    expect(robo.adCountOthers).toBe(5);
    // 广告落地拆分：组级一致值（落首页 5 / 落商品页 3）
    expect(robo.adCountHome).toBe(5);
    expect(robo.adCountProduct).toBe(3);
    expect(robo.lastAdCount).toBe(0);
    expect(robo.adTrend).toBe("new");
    expect(robo.adBand).toBe("sweet");
    // 广告 40（sweet）+ 佣金 30（≥50）+ 价格 round(20×2/3)=13 + 丰富 3 = 86
    expect(robo.brandScore).toBe(86);
    expect(robo.landingUrl).toBeNull();
    // topProducts：score 降序，ratePct/commissionUsd 带出
    expect(robo.topProducts.map((p: any) => p.score)).toEqual([90, 80, 70]);
    expect(robo.topProducts[0].name).toBe("Roborock S8");
    expect(robo.topProducts[0].ratePct).toBe(13);
    expect(robo.topProducts[0].commissionUsd).toBe(116.87);
    expect(robo.topProducts[0].poolStage).toBe("inbox");

    const old = body.brands[1];
    expect(old.adTrend).toBe("stopped");
    expect(old.adBand).toBe("none");
    expect(old.maxCommissionUsd).toBe(30);
    // 广告 5（停投封顶）+ 佣金 24（≥25）+ 价格 20（1/1 ≥80）+ 丰富 1 = 50
    expect(old.brandScore).toBe(50);

    const noAds = body.brands[2];
    expect(noAds.countryCode).toBeNull();
    expect(noAds.adCount).toBeNull();
    expect(noAds.adTrend).toBeNull();
    expect(noAds.adBand).toBeNull();
    // 广告 10（未计算）+ 佣金 8（40×5%=2）+ 价格 0 + 丰富 1 = 19
    expect(noAds.brandScore).toBe(19);
  });

  it("品牌名归一化合并（大小写/空白差异）+ 展示名取最常见写法", async () => {
    const ctx = setupCatalog();
    ctx.networkProduct.push(
      product({ brand: "Roborock" }),
      product({ brand: "Roborock" }),
      product({ brand: " ROBOROCK  " }),
      product({ brand: "roborock" })
    );
    const { app } = buildApp(ctx);
    const res = await app.inject({ method: "GET", url: "/api/v1/catalog/brands" });
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.brands[0].brandKey).toBe("roborock");
    expect(body.brands[0].brand).toBe("Roborock");
    expect(body.brands[0].productCount).toBe(4);
  });

  it("q / country / networkId 过滤", async () => {
    const ctx = setupCatalog();
    seedThreeBrands(ctx);
    ctx.networkProduct.push(
      product({ brand: "CanadaBrand", countryCode: "CA" })
    );
    const { app } = buildApp(ctx);
    const byQ = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/brands?q=ROBO",
    });
    expect(byQ.json().brands.map((b: any) => b.brand)).toEqual(["Roborock"]);
    const byCountry = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/brands?country=ca",
    });
    expect(byCountry.json().brands.map((b: any) => b.brand)).toEqual([
      "CanadaBrand",
    ]);
    const byNetwork = await app.inject({
      method: "GET",
      url: `/api/v1/catalog/brands?networkId=${randomUUID()}`,
    });
    expect(byNetwork.json().total).toBe(0);
  });

  it("landingUrl / promoMode 从 BrandProfile 带出；其他租户的 profile 不泄漏", async () => {
    const ctx = setupCatalog();
    seedThreeBrands(ctx);
    (ctx as any).brandProfile.push(
      {
        id: randomUUID(),
        tenantId: TEST_TENANT,
        networkId: TEST_NETWORK,
        brandKey: "roborock",
        countryCode: "US",
        landingUrl: "https://roborock.com/?tag=t-20",
        promoMode: "brand",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        // 只有标注、没有链接的行：promoMode 带出，landingUrl 仍为 null
        id: randomUUID(),
        tenantId: TEST_TENANT,
        networkId: TEST_NETWORK,
        brandKey: "noads",
        countryCode: "",
        landingUrl: "",
        promoMode: "product",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: randomUUID(),
        tenantId: OTHER_TENANT,
        networkId: TEST_NETWORK,
        brandKey: "oldbrand",
        countryCode: "US",
        landingUrl: "https://evil.test/",
        promoMode: "product",
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    );
    const { app } = buildApp(ctx);
    const res = await app.inject({ method: "GET", url: "/api/v1/catalog/brands" });
    const body = res.json();
    const robo = body.brands.find((b: any) => b.brandKey === "roborock");
    const old = body.brands.find((b: any) => b.brandKey === "oldbrand");
    const noAds = body.brands.find((b: any) => b.brandKey === "noads");
    expect(robo.landingUrl).toBe("https://roborock.com/?tag=t-20");
    expect(robo.promoMode).toBe("brand");
    expect(old.landingUrl).toBeNull();
    expect(old.promoMode).toBeNull();
    expect(noAds.landingUrl).toBeNull();
    expect(noAds.promoMode).toBe("product");
  });
});

describe("PUT /api/v1/catalog/brands/landing-url", () => {
  it("新建 → 更新 → 清除（服务端归一化 brandKey/countryCode）", async () => {
    const ctx = setupCatalog();
    const { app } = buildApp(ctx);
    const created = await app.inject({
      method: "PUT",
      url: "/api/v1/catalog/brands/landing-url",
      payload: {
        networkId: TEST_NETWORK,
        brandKey: "  RoboRock ",
        countryCode: "us",
        landingUrl: "https://store.roborock.com/",
      },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toEqual({
      ok: true,
      landingUrl: "https://store.roborock.com/",
      promoMode: null,
    });
    const store = (ctx as any).brandProfile as Array<Record<string, any>>;
    expect(store).toHaveLength(1);
    expect(store[0].brandKey).toBe("roborock");
    expect(store[0].countryCode).toBe("US");
    expect(store[0].tenantId).toBe(TEST_TENANT);

    const updated = await app.inject({
      method: "PUT",
      url: "/api/v1/catalog/brands/landing-url",
      payload: {
        networkId: TEST_NETWORK,
        brandKey: "roborock",
        countryCode: "US",
        landingUrl: "https://www.amazon.com/stores/roborock",
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(store).toHaveLength(1);
    expect(store[0].landingUrl).toBe("https://www.amazon.com/stores/roborock");

    const cleared = await app.inject({
      method: "PUT",
      url: "/api/v1/catalog/brands/landing-url",
      payload: {
        networkId: TEST_NETWORK,
        brandKey: "roborock",
        countryCode: "US",
        landingUrl: "",
      },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toEqual({
      ok: true,
      landingUrl: null,
      promoMode: null,
    });
    expect(store).toHaveLength(0);
  });

  it("非法输入 → 400（坏 URL / 非 http(s) / 空 brandKey / 超长）", async () => {
    const ctx = setupCatalog();
    const { app } = buildApp(ctx);
    const put = (payload: Record<string, unknown>) =>
      app.inject({
        method: "PUT",
        url: "/api/v1/catalog/brands/landing-url",
        payload,
      });
    const base = { networkId: TEST_NETWORK, brandKey: "roborock" };
    expect((await put({ ...base, landingUrl: "notaurl" })).statusCode).toBe(400);
    expect(
      (await put({ ...base, landingUrl: "ftp://example.com/x" })).statusCode
    ).toBe(400);
    expect(
      (await put({ ...base, brandKey: "   ", landingUrl: "https://x.com/" }))
        .statusCode
    ).toBe(400);
    expect(
      (
        await put({
          ...base,
          landingUrl: `https://x.com/${"a".repeat(2000)}`,
        })
      ).statusCode
    ).toBe(400);
    expect((ctx as any).brandProfile).toHaveLength(0);
  });

  it("promoMode 部分更新：只标模式建行（landingUrl 存 \"\"）→ 省略字段不改动 → null 清标注保留链接", async () => {
    const ctx = setupCatalog();
    const { app } = buildApp(ctx);
    const put = (payload: Record<string, unknown>) =>
      app.inject({
        method: "PUT",
        url: "/api/v1/catalog/brands/landing-url",
        payload,
      });
    const store = (ctx as any).brandProfile as Array<Record<string, any>>;

    // 只给 promoMode → 建行，landingUrl 缺省 ""
    const marked = await put({
      networkId: TEST_NETWORK,
      brandKey: "SoloProduct",
      promoMode: "product",
    });
    expect(marked.statusCode).toBe(200);
    expect(marked.json()).toEqual({ ok: true, landingUrl: null, promoMode: "product" });
    expect(store).toHaveLength(1);
    expect(store[0].landingUrl).toBe("");
    expect(store[0].promoMode).toBe("product");
    expect(store[0].brandKey).toBe("soloproduct");
    expect(store[0].countryCode).toBe("");

    // 只给 landingUrl → 模式保持不变
    const linked = await put({
      networkId: TEST_NETWORK,
      brandKey: "soloproduct",
      landingUrl: "https://example.com/brand",
    });
    expect(linked.json()).toEqual({
      ok: true,
      landingUrl: "https://example.com/brand",
      promoMode: "product",
    });
    expect(store).toHaveLength(1);

    // promoMode: null → 清回未标注，链接保留
    const unmarked = await put({
      networkId: TEST_NETWORK,
      brandKey: "soloproduct",
      promoMode: null,
    });
    expect(unmarked.json()).toEqual({
      ok: true,
      landingUrl: "https://example.com/brand",
      promoMode: null,
    });
    expect(store).toHaveLength(1);
    expect(store[0].promoMode).toBeNull();

    // 清链接但模式还在 → 行保留（landingUrl ""），返回 landingUrl null
    await put({
      networkId: TEST_NETWORK,
      brandKey: "soloproduct",
      promoMode: "brand",
    });
    const clearedLink = await put({
      networkId: TEST_NETWORK,
      brandKey: "soloproduct",
      landingUrl: "",
    });
    expect(clearedLink.json()).toEqual({
      ok: true,
      landingUrl: null,
      promoMode: "brand",
    });
    expect(store).toHaveLength(1);
    expect(store[0].landingUrl).toBe("");
  });

  it("promoMode 非法值 / 两字段都不给 → 400", async () => {
    const ctx = setupCatalog();
    const { app } = buildApp(ctx);
    const put = (payload: Record<string, unknown>) =>
      app.inject({
        method: "PUT",
        url: "/api/v1/catalog/brands/landing-url",
        payload,
      });
    expect(
      (
        await put({
          networkId: TEST_NETWORK,
          brandKey: "x",
          promoMode: "weird",
        })
      ).statusCode
    ).toBe(400);
    expect(
      (await put({ networkId: TEST_NETWORK, brandKey: "x" })).statusCode
    ).toBe(400);
    expect((ctx as any).brandProfile).toHaveLength(0);
  });
});

describe("GET /api/v1/catalog/products 序列化：广告历史字段", () => {
  it("lastAdCount / lastAdCountAt / adTrend（现算）带出", async () => {
    const ctx = setupCatalog();
    const checkedAt = new Date("2026-10-01T00:00:00.000Z");
    ctx.networkProduct.push(
      product({
        externalId: "stopped-1",
        adCount: 0,
        adCountHome: 0,
        adCountProduct: 0,
        lastAdCount: 6,
        lastAdCountCheckedAt: checkedAt,
      }),
      product({ externalId: "first-1", adCount: 5, lastAdCount: null }),
      product({ externalId: "never-1", adCount: null, lastAdCount: null })
    );
    const { app } = buildApp(ctx);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/products",
    });
    expect(res.statusCode).toBe(200);
    const byExt = new Map(
      res.json().items.map((p: any) => [p.externalId, p])
    ) as Map<string, any>;
    expect(byExt.get("stopped-1").lastAdCount).toBe(6);
    expect(byExt.get("stopped-1").adCountHome).toBe(0);
    expect(byExt.get("stopped-1").adCountProduct).toBe(0);
    expect(byExt.get("never-1").adCountHome).toBeNull();
    expect(byExt.get("stopped-1").lastAdCountAt).toBe(
      "2026-10-01T00:00:00.000Z"
    );
    expect(byExt.get("stopped-1").adTrend).toBe("stopped");
    expect(byExt.get("first-1").adTrend).toBe("first");
    expect(byExt.get("never-1").adTrend).toBeNull();
    expect(byExt.get("never-1").lastAdCount).toBeNull();
    expect(byExt.get("never-1").lastAdCountAt).toBeNull();
  });
});
