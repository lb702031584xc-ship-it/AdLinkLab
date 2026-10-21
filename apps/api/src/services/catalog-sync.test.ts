/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
/**
 * 商品库同步引擎测试（in-memory fake Prisma + fake session 适配器）。
 *
 * 覆盖：无授权→403；黑名单账号→跳过；session 过期→EXPIRED+strike；
 * 连续 3 次过期→自动黑名单；403 restricted→立即黑名单；429→429；
 * 消失商品→自动黑名单；连续 3 期→白名单建议（只建议）；自动建 Offer 跳过黑名单。
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { AppError, ForbiddenError, ValidationError } from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import { syncCatalog, type CatalogSyncDeps } from "./catalog-sync.js";
import {
  BaseSessionAdapter,
  SessionExpiredError,
  SessionRateLimitedError,
  type SessionPageResult,
  type SessionProduct,
} from "../networks/session-adapter.js";
import { encryptApiKey } from "../networks/network-crypto.js";
import {
  PartnerBoostAdapter,
  type PartnerBoostDatafeedPullOpts,
} from "../networks/partnerboost-adapter.js";
import type {
  AdapterContext,
  NetworkAdapter,
  NetworkOffer,
} from "../networks/types.js";
import {
  activeGrant,
  makeCatalogFakePrisma,
  testNetwork,
  TEST_NETWORK,
  TEST_TENANT,
  TEST_USER,
  type CatalogFakeCtx,
  type Row,
} from "./catalog-fake-prisma.js";

const PEPPER = "test-pepper-catalog-sync";

class FakeSessionAdapter extends BaseSessionAdapter {
  readonly sessionKind = "yeahpromos";
  readonly sessionDisplayName = "FakeYP";
  readonly defaultSessionBaseUrl = "https://fake.test";
  products: SessionProduct[] = [];
  error: unknown = null;
  calls = 0;
  protected async fetchSessionPage(): Promise<SessionPageResult> {
    throw new Error("unused");
  }
  override async pullViaSession(): Promise<SessionProduct[]> {
    this.calls += 1;
    if (this.error) throw this.error;
    return this.products;
  }
}

class FakeApiAdapter implements NetworkAdapter {
  readonly kind = "yeahpromos";
  readonly displayName = "FakeApiYP";
  readonly defaultBaseUrl = "https://fake.test";
  offers: NetworkOffer[] = [];
  async pullOffers(): Promise<NetworkOffer[]> {
    return this.offers;
  }
}

function sessionProduct(overrides: Partial<SessionProduct> = {}): SessionProduct {
  return {
    externalId: "ext-1",
    name: "Test Product",
    payout: null,
    currency: "USD",
    termsText: null,
    url: "https://promo.test/1",
    rawData: { externalId: "ext-1" },
    brand: "TestBrand",
    asin: null,
    price: 100,
    commissionAmount: 20,
    commissionRate: 15,
    reviewCount: 100,
    promoUrl: "https://promo.test/1",
    ...overrides,
  };
}

function setup(opts: {
  grantKind?: string | null;
  network?: Partial<Row>;
  sessionAdapter?: FakeSessionAdapter;
  createOfferImpl?: CatalogSyncDeps["createOfferImpl"];
} = {}): {
  prisma: PrismaClient;
  ctx: CatalogFakeCtx;
  deps: CatalogSyncDeps;
  adapter: FakeSessionAdapter;
} {
  process.env.NETWORK_API_PEPPER = PEPPER;
  const adapter = opts.sessionAdapter ?? new FakeSessionAdapter();
  const { prisma, ctx } = makeCatalogFakePrisma();
  const sessionRef =
    opts.network?.sessionRef !== undefined
      ? opts.network.sessionRef
      : encryptApiKey("cookie=abc", PEPPER);
  ctx.affiliateNetwork.push(testNetwork({ sessionRef, ...opts.network }));
  if (opts.grantKind !== null) {
    ctx.adminGrant.push(activeGrant(opts.grantKind ?? "yeahpromos"));
  }
  const deps: CatalogSyncDeps = {
    prisma,
    getSessionAdapterImpl: () => adapter,
    createOfferImpl:
      opts.createOfferImpl ??
      (async () => ({ offer: { id: randomUUID() }, created: true, replayed: false })),
  };
  return { prisma, ctx, deps, adapter };
}

const input = {
  tenantId: TEST_TENANT,
  userId: TEST_USER,
  userRole: "member",
  networkId: TEST_NETWORK,
};

const ownerInput = {
  tenantId: TEST_TENANT,
  userId: TEST_USER,
  userRole: "owner",
  networkId: TEST_NETWORK,
};

describe("syncCatalog 授权与黑名单", () => {
  it("无 grant → 403", async () => {
    const { deps } = setup({ grantKind: null });
    await expect(syncCatalog(deps, input)).rejects.toThrow(ForbiddenError);
  });

  it("owner 无 grant 也能同步（豁免）", async () => {
    const { deps } = setup({ grantKind: null });
    const summary = await syncCatalog(deps, ownerInput);
    expect(summary.skipped).not.toBe(true);
  });

  it("grant 白名单不含 kind → 403", async () => {
    const { deps } = setup({ grantKind: "awin" });
    await expect(syncCatalog(deps, input)).rejects.toThrow(ForbiddenError);
  });

  it("黑名单账号 → 跳过同步（不调适配器）+ 审计", async () => {
    const { deps, ctx, adapter } = setup();
    ctx.catalogBlacklist.push({
      id: randomUUID(),
      tenantId: TEST_TENANT,
      channel: "affiliate",
      entityType: "network_account",
      entityId: TEST_NETWORK,
      networkKind: "yeahpromos",
      reason: "session_expired_x3",
      firstSeenAt: new Date(),
      lastConfirmedAt: new Date(),
      source: "auto",
      createdBy: null,
      status: "active",
      removedAt: null,
      removedBy: null,
      removeReason: null,
      observationUntil: null,
    });
    const summary = await syncCatalog(deps, input);
    expect(summary.skipped).toBe(true);
    expect(summary.skipReason).toContain("黑名单");
    expect(adapter.calls).toBe(0);
    expect(
      ctx.adminGrantAudit.some((a) => a.action === "CATALOG_SYNC_SKIPPED_BLACKLIST")
    ).toBe(true);
  });

  it("removed 状态的黑名单 → 不跳过", async () => {
    const { deps, ctx, adapter } = setup();
    ctx.catalogBlacklist.push({
      id: randomUUID(),
      tenantId: TEST_TENANT,
      channel: "affiliate",
      entityType: "network_account",
      entityId: TEST_NETWORK,
      reason: "x",
      firstSeenAt: new Date(),
      lastConfirmedAt: new Date(),
      source: "auto",
      status: "removed",
      observationUntil: new Date(Date.now() + 86400000),
    });
    adapter.products = [sessionProduct()];
    const summary = await syncCatalog(deps, input);
    expect(summary.skipped).not.toBe(true);
    expect(adapter.calls).toBe(1);
  });
});

describe("syncCatalog session 错误语义", () => {
  it("401 过期 → sessionStatus=EXPIRED + strike=1 + 409", async () => {
    const { deps, ctx, adapter } = setup();
    adapter.error = new SessionExpiredError("expired");
    await expect(syncCatalog(deps, input)).rejects.toThrow("登录态过期");
    const net = ctx.affiliateNetwork[0];
    expect(net.sessionStatus).toBe("EXPIRED");
    expect(net.sessionExpireStrikes).toBe(1);
    expect(net.pullStatus).toBe("FAILED");
  });

  it("连续 3 次过期 → 自动进黑名单（network_account）", async () => {
    const { deps, ctx, adapter } = setup({
      network: { sessionExpireStrikes: 2 },
    });
    adapter.error = new SessionExpiredError("expired");
    await expect(syncCatalog(deps, input)).rejects.toThrow();
    const bl = ctx.catalogBlacklist.find(
      (r) => r.entityType === "network_account" && r.status === "active"
    );
    expect(bl).toBeDefined();
    expect(bl!.reason).toBe("session_expired_x3");
    expect(
      ctx.adminGrantAudit.some((a) => a.action === "CATALOG_BLACKLIST_AUTO_ADDED")
    ).toBe(true);
  });

  it("403 restricted → 立即黑名单（不等 3 次）", async () => {
    const { deps, ctx, adapter } = setup();
    adapter.error = new SessionExpiredError("restricted", true);
    await expect(syncCatalog(deps, input)).rejects.toThrow();
    const bl = ctx.catalogBlacklist.find(
      (r) => r.entityType === "network_account" && r.status === "active"
    );
    expect(bl!.reason).toBe("session_account_restricted");
  });

  it("429 → 429 错误（不重试：适配器只调一次）", async () => {
    const { deps, adapter } = setup();
    adapter.error = new SessionRateLimitedError("limited");
    const err = await syncCatalog(deps, input).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(429);
    expect(adapter.calls).toBe(1);
  });

  it("session 成功 → strikes 清零", async () => {
    const { deps, ctx, adapter } = setup({
      network: { sessionExpireStrikes: 2 },
    });
    adapter.products = [sessionProduct()];
    await syncCatalog(deps, input);
    expect(ctx.affiliateNetwork[0].sessionExpireStrikes).toBe(0);
    expect(ctx.affiliateNetwork[0].sessionStatus).toBe("OK");
  });
});

describe("syncCatalog API 模式字段透传", () => {
  it("countryCode / landingPageType 从 NetworkOffer 透传到入库行", async () => {
    // 回归：offerToSessionProduct 曾丢掉这两个字段 → 投放国家列恒为「—」、
    // 广告数按国家分组全落空。API 模式（YP 官方 API）走这条转换，必须透传。
    process.env.NETWORK_API_PEPPER = PEPPER;
    const adapter = new FakeApiAdapter();
    adapter.offers = [
      {
        externalId: "yp-1",
        name: "API Product",
        payout: 15,
        currency: "%",
        price: 100,
        priceCurrency: "CAD",
        reviewCount: 50,
        brand: "ApiBrand",
        countryCode: "CA",
        landingPageType: "amazon_product",
        rawData: { product_id: "yp-1" },
      },
    ];
    const { prisma, ctx } = makeCatalogFakePrisma();
    ctx.affiliateNetwork.push(
      testNetwork({
        syncMode: "api",
        apiKeyRef: encryptApiKey("test-api-key", PEPPER),
        sessionRef: null,
      })
    );
    ctx.adminGrant.push(activeGrant("yeahpromos"));
    const deps: CatalogSyncDeps = {
      prisma,
      getAdapterImpl: () => adapter,
      createOfferImpl: async () => ({
        offer: { id: randomUUID() },
        created: true,
        replayed: false,
      }),
    };
    const summary = await syncCatalog(deps, input);
    expect(summary.synced).toBe(1);
    const p = ctx.networkProduct[0];
    expect(p.countryCode).toBe("CA");
    expect(p.landingPageType).toBe("amazon_product");
  });
});

describe("syncCatalog 商品处理", () => {
  it("upsert + 评分写回 + 成功审计/grant 计数", async () => {
    const { deps, ctx, adapter } = setup();
    adapter.products = [sessionProduct()];
    const summary = await syncCatalog(deps, input);
    expect(summary.synced).toBe(1);
    expect(summary.created).toBe(1);
    expect(summary.recommended).toBe(1);
    const p = ctx.networkProduct[0];
    expect(p.recommended).toBe(true);
    expect(p.syncStreak).toBe(1);
    expect(ctx.affiliateNetwork[0].pullStatus).toBe("SUCCESS");
    expect(
      ctx.adminGrantAudit.some((a) => a.action === "CATALOG_SYNC_SUCCESS")
    ).toBe(true);
    expect(ctx.adminGrant[0].usageCount).toBe(1);
  });

  it("onProgress 在四阶段边界按序调用；回调抛错不中断同步", async () => {
    const { deps, adapter } = setup();
    adapter.products = [sessionProduct()];
    const stages: string[] = [];
    const partials: Array<Record<string, unknown> | undefined> = [];
    deps.onProgress = (stage, partial) => {
      stages.push(stage);
      partials.push(partial);
    };
    const summary = await syncCatalog(deps, input);
    expect(summary.synced).toBe(1);
    expect(stages).toEqual(["pulled", "upserted", "scored", "offers"]);
    expect(partials[0]).toMatchObject({ fetched: 1 });
    expect(partials[1]).toMatchObject({ created: 1 });
    expect(partials[2]).toMatchObject({ recommended: 1 });
    expect(partials[3]).toMatchObject({ autoCreatedOffers: 0 });

    // 回调抛错 → 同步仍成功
    const second = setup();
    second.adapter.products = [sessionProduct()];
    second.deps.onProgress = () => {
      throw new Error("progress boom");
    };
    const summary2 = await syncCatalog(second.deps, input);
    expect(summary2.synced).toBe(1);
  });

  it("消失商品 → 自动进黑名单（sync_disappeared）", async () => {
    const { deps, ctx, adapter } = setup();
    ctx.networkProduct.push({
      id: randomUUID(),
      tenantId: TEST_TENANT,
      networkId: TEST_NETWORK,
      externalId: "gone-1",
      name: "Gone Product",
      brand: null,
      price: 100,
      commissionAmount: 20,
      commissionRate: null,
      currency: "USD",
      reviewCount: 10,
      recommended: true,
      recommendationScore: 80,
      promoUrl: null,
      rawData: {},
      syncedAt: new Date(Date.now() - 3600 * 1000),
      syncStreak: 5,
      merchantId: null,
      createdAt: new Date(Date.now() - 3600 * 1000),
    });
    adapter.products = [sessionProduct({ externalId: "ext-1" })];
    await syncCatalog(deps, input);
    const bl = ctx.catalogBlacklist.find(
      (r) => r.entityType === "product" && r.status === "active"
    );
    expect(bl).toBeDefined();
    expect(bl!.reason).toBe("sync_disappeared");
    const audit = ctx.adminGrantAudit.find(
      (a) => a.action === "CATALOG_BLACKLIST_AUTO_ADDED"
    );
    expect(audit).toBeDefined();
    expect((audit!.detail as any).entityType).toBe("product");
  });

  it("连续 3 期出现 → 白名单建议（只建议，source=suggested）", async () => {
    const { deps, ctx, adapter } = setup();
    ctx.networkProduct.push({
      id: randomUUID(),
      tenantId: TEST_TENANT,
      networkId: TEST_NETWORK,
      externalId: "ext-1",
      name: "Test Product",
      brand: null,
      price: 100,
      commissionAmount: 20,
      commissionRate: null,
      currency: "USD",
      reviewCount: 100,
      recommended: false,
      promoUrl: "https://promo.test/1",
      rawData: {},
      syncedAt: new Date(Date.now() - 3600 * 1000),
      syncStreak: 2,
      merchantId: null,
      createdAt: new Date(Date.now() - 3600 * 1000),
    });
    adapter.products = [sessionProduct({ externalId: "ext-1" })];
    await syncCatalog(deps, input);
    const p = ctx.networkProduct.find((r) => r.externalId === "ext-1")!;
    expect(p.syncStreak).toBe(3);
    const wl = ctx.catalogWhitelist.find((r) => r.entityId === p.id);
    expect(wl).toBeDefined();
    expect(wl!.source).toBe("suggested");
    // 只建议：没有自动转 manual
    expect(wl!.confirmedAt ?? null).toBe(null);
  });

  it("自动建 Offer：跳过黑名单商品 + 幂等去重", async () => {
    const createdOffers: string[] = [];
    const { deps, ctx, adapter } = setup({
      createOfferImpl: async (ino) => {
        createdOffers.push(ino.idempotencyKey!);
        return { offer: { id: randomUUID() }, created: true, replayed: false };
      },
    });
    ctx.catalogScreeningPreset.push({
      id: randomUUID(),
      tenantId: TEST_TENANT,
      minReviews: 0,
      minCommissionAmount: 10,
      minCommissionRate: 0,
      minPrice: 0,
      maxPrice: 0,
      minScore: 0,
      autoCreateOffer: true,
      autoCreateTopN: 20,
    });
    adapter.products = [
      sessionProduct({ externalId: "ext-1", name: "Good" }),
      sessionProduct({ externalId: "ext-2", name: "Bad" }),
    ];
    // 先同步一次建出商品
    await syncCatalog(deps, input);
    const bad = ctx.networkProduct.find((r) => r.externalId === "ext-2")!;
    // 手动拉黑（非 sync_disappeared 自动记录）：不会被第 5.5 步"重现自动解除"恢复。
    ctx.catalogBlacklist.push({
      id: randomUUID(),
      tenantId: TEST_TENANT,
      channel: "affiliate",
      entityType: "product",
      entityId: bad.id,
      reason: "policy_blocked",
      firstSeenAt: new Date(),
      lastConfirmedAt: new Date(),
      source: "manual",
      status: "active",
    });
    // 第二次同步：ext-2 在黑名单 → 不建 Offer
    createdOffers.length = 0;
    const summary = await syncCatalog(deps, input);
    expect(summary.autoCreatedOffers).toBe(1);
    expect(createdOffers).toHaveLength(1);
    expect(createdOffers[0]).toContain("ext-1");
  });

  it("自动建 Offer：只从 recommended 取，manual 白名单优先、suggested 不优先", async () => {
    const createdNames: string[] = [];
    const { deps, ctx, adapter } = setup({
      createOfferImpl: async (ino) => {
        createdNames.push(ino.name as string);
        return { offer: { id: randomUUID() }, created: true, replayed: false };
      },
    });
    ctx.catalogScreeningPreset.push({
      id: randomUUID(),
      tenantId: TEST_TENANT,
      minReviews: 0,
      minCommissionAmount: 10,
      minCommissionRate: 10,
      minPrice: 80,
      maxPrice: 150,
      minScore: 0,
      autoCreateOffer: true,
      autoCreateTopN: 50,
    });
    adapter.products = [
      // 未达筛选门槛（价格 10 < minPrice 80）→ 不应建 Offer；
      // 佣金 ≥$8 以免被入库第一道门槛拦掉（保留本用例的原测试意图）
      sessionProduct({ externalId: "low", name: "Low", price: 10, commissionAmount: 20, commissionRate: 15 }),
      // 达门槛但分数较低，稍后加 manual 白名单 → 置顶
      sessionProduct({ externalId: "mid", name: "Mid", price: 100, commissionAmount: 20, commissionRate: 15 }),
      // 达门槛且分数更高（无白名单）
      sessionProduct({ externalId: "high", name: "High", price: 100, commissionAmount: 40, commissionRate: 40, reviewCount: 5000 }),
      // suggested 白名单：不应置顶
      sessionProduct({ externalId: "sug", name: "Sug", price: 100, commissionAmount: 25, commissionRate: 20 }),
    ];
    // 第一轮：建出商品行（Low 不推荐，无 Offer；其余推荐但先无白名单）
    await syncCatalog(deps, input);
    const byExt = new Map(ctx.networkProduct.map((p) => [p.externalId, p]));
    expect(byExt.get("low")!.recommended).toBe(false);
    expect(byExt.get("mid")!.recommended).toBe(true);
    ctx.catalogWhitelist.push(
      {
        id: randomUUID(),
        tenantId: TEST_TENANT,
        channel: "affiliate",
        entityType: "product",
        entityId: byExt.get("mid")!.id,
        note: null,
        source: "manual",
        suggestedAt: null,
        confirmedAt: new Date(),
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        tenantId: TEST_TENANT,
        channel: "affiliate",
        entityType: "product",
        entityId: byExt.get("sug")!.id,
        note: null,
        source: "suggested",
        suggestedAt: new Date(),
        confirmedAt: null,
        createdAt: new Date(),
      }
    );
    // 第二轮：幂等已建的跳过，观察排序（Mid 应第一个被创建）
    createdNames.length = 0;
    // 先清掉 Offer 幂等记录以便观察排序（保留商品）
    ctx.offer.length = 0;
    await syncCatalog(deps, input);
    expect(createdNames).not.toContain("Low");
    expect(createdNames[0]).toBe("Mid");
    expect(createdNames).toContain("High");
    expect(createdNames).toContain("Sug");
  });

  it("api 模式无 apiKeyRef → 400", async () => {
    const { deps } = setup({ network: { syncMode: "api", apiKeyRef: null } });
    await expect(syncCatalog(deps, input)).rejects.toThrow(ValidationError);
  });

  it("非法 syncMode → 按 api 处理", async () => {
    const { deps, ctx } = setup({
      network: { syncMode: "weird", apiKeyRef: null },
    });
    await expect(syncCatalog(deps, input)).rejects.toThrow(ValidationError);
    expect(
      ctx.adminGrantAudit.some((a) => a.action === "CATALOG_SYNC_INVALID_MODE")
    ).toBe(true);
  });
});

describe("syncCatalog $8 佣金门槛（入库第一道）", () => {
  it("7.99 固定佣金的商品不入库，只计数；8.00 入库", async () => {
    const adapter = new FakeSessionAdapter();
    adapter.products = [
      sessionProduct({
        externalId: "low",
        name: "Low",
        commissionAmount: 7.99,
        commissionRate: null,
      }),
      sessionProduct({
        externalId: "ok",
        name: "Ok",
        commissionAmount: 8.0,
        commissionRate: null,
      }),
    ];
    const { deps, ctx } = setup({ sessionAdapter: adapter });
    const summary = await syncCatalog(deps, input);
    expect(summary.skippedLowCommission).toBe(1);
    const names = ctx.networkProduct.map((p) => p.name);
    expect(names).not.toContain("Low");
    expect(names).toContain("Ok");
  });

  it("百分比佣金 × 价格估算低于 $8 → 不入库", async () => {
    const adapter = new FakeSessionAdapter();
    // 100 × 5% = $5 估算 → 低于 $8
    adapter.products = [
      sessionProduct({
        externalId: "pct",
        name: "Pct",
        commissionAmount: null,
        commissionRate: 5,
        price: 100,
      }),
    ];
    const { deps, ctx } = setup({ sessionAdapter: adapter });
    const summary = await syncCatalog(deps, input);
    expect(summary.skippedLowCommission).toBe(1);
    expect(ctx.networkProduct).toHaveLength(0);
    // 审计记总数 + 来源分布
    const audit = ctx.adminGrantAudit.find(
      (a) => a.action === "CATALOG_SYNC_SUCCESS"
    );
    expect(audit).toBeDefined();
    expect((audit as Row).detail.skippedLowCommission).toBe(1);
    expect((audit as Row).detail.skippedLowCommissionBySource.estimated).toBe(1);
  });

  it("佣金未知（算不出金额）→ 入库不拦截", async () => {
    const adapter = new FakeSessionAdapter();
    adapter.products = [
      sessionProduct({
        externalId: "unk",
        name: "Unknown",
        commissionAmount: null,
        commissionRate: null,
        price: null,
      }),
    ];
    const { deps, ctx } = setup({ sessionAdapter: adapter });
    const summary = await syncCatalog(deps, input);
    expect(summary.skippedLowCommission).toBe(0);
    expect(ctx.networkProduct.map((p) => p.name)).toContain("Unknown");
  });

  it("过期 session → 跳过同步 + 红色提示 + 审计，不调适配器", async () => {
    const adapter = new FakeSessionAdapter();
    adapter.products = [sessionProduct()];
    const { deps, ctx } = setup({
      sessionAdapter: adapter,
      network: {
        lastLoginAt: new Date(Date.now() - 40 * 86400000),
        sessionValidDays: 30,
      },
    });
    const summary = await syncCatalog(deps, input);
    expect(summary.skipped).toBe(true);
    expect(summary.skipReason).toContain("登录态已过期，请重新登录刷新");
    expect(adapter.calls).toBe(0);
    expect(
      ctx.adminGrantAudit.some((a) => a.action === "CATALOG_SYNC_SKIPPED_EXPIRED")
    ).toBe(true);
  });

  it("有效期内的 session → 正常同步", async () => {
    const adapter = new FakeSessionAdapter();
    adapter.products = [
      sessionProduct({ commissionAmount: 20, commissionRate: null }),
    ];
    const { deps, ctx } = setup({
      sessionAdapter: adapter,
      network: {
        lastLoginAt: new Date(),
        sessionValidDays: 30,
      },
    });
    const summary = await syncCatalog(deps, input);
    expect(summary.skipped).toBeFalsy();
    expect(adapter.calls).toBe(1);
    expect(ctx.networkProduct).toHaveLength(1);
  });

  it("lastLoginAt 为空（老数据）→ 不按过期跳过，走原有探测逻辑", async () => {
    const adapter = new FakeSessionAdapter();
    adapter.products = [
      sessionProduct({ commissionAmount: 20, commissionRate: null }),
    ];
    const { deps } = setup({
      sessionAdapter: adapter,
      network: { lastLoginAt: null, sessionValidDays: 30 },
    });
    const summary = await syncCatalog(deps, input);
    expect(summary.skipped).toBeFalsy();
    expect(adapter.calls).toBe(1);
  });
});

describe("syncCatalog 消失判定守卫（P0-1）", () => {
  function oldProductRow(externalId: string, overrides: Partial<Row> = {}): Row {
    return {
      id: randomUUID(),
      tenantId: TEST_TENANT,
      networkId: TEST_NETWORK,
      externalId,
      name: `Product ${externalId}`,
      brand: "OldBrand",
      price: 100,
      commissionAmount: 20,
      commissionRate: null,
      currency: "USD",
      reviewCount: 10,
      recommended: true,
      recommendationScore: 80,
      promoUrl: null,
      rawData: {},
      syncedAt: new Date(Date.now() - 3600 * 1000),
      syncStreak: 5,
      merchantId: null,
      createdAt: new Date(Date.now() - 3600 * 1000),
      ...overrides,
    };
  }

  it("① 按商家同步（brandId）→ 整步跳过消失判定，不拉黑其他商品", async () => {
    const { deps, ctx, adapter } = setup();
    ctx.networkProduct.push(oldProductRow("other-1"));
    adapter.products = [sessionProduct({ externalId: "ext-1" })];
    const summary = await syncCatalog(deps, { ...input, brandId: "66303" });
    expect(summary.scope).toBe("brand");
    expect(summary.disappearedSkipped).toBe("brand_scope");
    const bl = ctx.catalogBlacklist.find(
      (r) => r.entityType === "product" && r.reason === "sync_disappeared"
    );
    expect(bl).toBeUndefined();
  });

  it("② 全量同步消失占比 >50% → 熔断不拉黑 + summary/审计记警告", async () => {
    const { deps, ctx, adapter } = setup();
    for (const ext of ["gone-1", "gone-2", "gone-3"]) {
      ctx.networkProduct.push(oldProductRow(ext));
    }
    adapter.products = [sessionProduct({ externalId: "ext-1" })];
    const summary = await syncCatalog(deps, input);
    expect(summary.disappearedSkipped).toBe("circuit_breaker");
    expect(
      ctx.catalogBlacklist.filter((r) => r.entityType === "product")
    ).toHaveLength(0);
    const audit = ctx.adminGrantAudit.find(
      (a) => a.action === "CATALOG_SYNC_SUCCESS"
    );
    expect(audit).toBeDefined();
    expect((audit!.detail as any).disappearedSkipped).toBe("circuit_breaker");
    expect((audit!.detail as any).disappearedBlacklisted).toBe(0);
  });

  it("②b 全量同步 upsert=0（上游返回空）→ 熔断不拉黑", async () => {
    const { deps, ctx, adapter } = setup();
    ctx.networkProduct.push(oldProductRow("gone-1"));
    adapter.products = [];
    const summary = await syncCatalog(deps, input);
    expect(summary.synced).toBe(0);
    expect(summary.disappearedSkipped).toBe("circuit_breaker");
    expect(
      ctx.catalogBlacklist.filter((r) => r.entityType === "product")
    ).toHaveLength(0);
  });

  it("③ $8 门槛跳过的商品不被判消失拉黑", async () => {
    const { deps, ctx, adapter } = setup();
    ctx.networkProduct.push(
      oldProductRow("ext-low", { commissionAmount: 5 })
    );
    adapter.products = [
      // 本轮仍出现，但佣金 $5 < $8 → 第 5 步跳过入库（syncedAt 不刷新）
      sessionProduct({
        externalId: "ext-low",
        commissionAmount: 5,
        commissionRate: null,
      }),
      sessionProduct({ externalId: "ext-ok" }),
    ];
    const summary = await syncCatalog(deps, input);
    expect(summary.skippedLowCommission).toBe(1);
    expect(summary.disappearedSkipped).toBeUndefined();
    const bl = ctx.catalogBlacklist.find((r) => r.entityType === "product");
    expect(bl).toBeUndefined();
  });

  it("④ 消失商品重现 → 自动解除 sync_disappeared 黑名单（手动记录不解除）", async () => {
    const { deps, ctx, adapter } = setup();
    const pidAuto = randomUUID();
    const pidManual = randomUUID();
    ctx.networkProduct.push(
      oldProductRow("ext-1", { id: pidAuto, syncStreak: 1 }),
      oldProductRow("ext-2", { id: pidManual, syncStreak: 1 })
    );
    const baseEntry = {
      tenantId: TEST_TENANT,
      channel: "affiliate",
      entityType: "product",
      networkKind: "yeahpromos",
      reason: "sync_disappeared",
      firstSeenAt: new Date(Date.now() - 3600 * 1000),
      lastConfirmedAt: new Date(Date.now() - 3600 * 1000),
      createdBy: null,
      status: "active",
      removedAt: null,
      removedBy: null,
      removeReason: null,
      observationUntil: null,
    };
    ctx.catalogBlacklist.push(
      { ...baseEntry, id: randomUUID(), entityId: pidAuto, source: "auto" },
      { ...baseEntry, id: randomUUID(), entityId: pidManual, source: "manual" }
    );
    adapter.products = [
      sessionProduct({ externalId: "ext-1" }),
      sessionProduct({ externalId: "ext-2" }),
    ];
    const summary = await syncCatalog(deps, input);
    expect(summary.synced).toBe(2);
    const autoEntry = ctx.catalogBlacklist.find((r) => r.entityId === pidAuto)!;
    expect(autoEntry.status).toBe("removed");
    expect(autoEntry.removeReason).toBe("sync_reappeared");
    const manualEntry = ctx.catalogBlacklist.find(
      (r) => r.entityId === pidManual
    )!;
    expect(manualEntry.status).toBe("active");
    expect(
      ctx.adminGrantAudit.some((a) => a.action === "CATALOG_BLACKLIST_REMOVED")
    ).toBe(true);
    const successAudit = ctx.adminGrantAudit.find(
      (a) => a.action === "CATALOG_SYNC_SUCCESS"
    );
    expect((successAudit!.detail as any).restoredDisappeared).toBe(1);
    // 解除后不再被黑名单排除 → 正常评分推荐；手动拉黑的仍不推荐
    const pAuto = ctx.networkProduct.find((r) => r.id === pidAuto)!;
    expect(pAuto.recommended).toBe(true);
  });
});

/* ── PB api 模式双数据源（FBA + Datafeed list）合并 ── */

/**
 * 真实 PartnerBoostAdapter 子类替身：instanceof 分支会被 syncCatalog 命中，
 * 两个拉取方法返回罐装数据（适配器本身的抓取/映射由 partnerboost-adapter.test 覆盖）。
 */
class FakePbAdapter extends PartnerBoostAdapter {
  fba: NetworkOffer[] = [];
  df: NetworkOffer[] = [];
  dfError: unknown = null;
  dfTypeErrors: Array<[string, string]> = [];
  override async pullOffers(): Promise<NetworkOffer[]> {
    return this.fba;
  }
  override async pullDatafeedOffers(
    _ctx: AdapterContext,
    opts: PartnerBoostDatafeedPullOpts = {}
  ): Promise<NetworkOffer[]> {
    for (const [bt, msg] of this.dfTypeErrors) {
      opts.onBrandTypeError?.(bt, msg);
    }
    if (this.dfError) throw this.dfError;
    return this.df;
  }
}

function pbFbaOffer(): NetworkOffer {
  return {
    externalId: "B0FBA00001",
    name: "FBA Widget",
    payout: 12,
    currency: "%",
    price: 100,
    priceCurrency: "USD",
    brand: "FbaBrand",
    asin: "B0FBA00001",
    countryCode: "US",
    landingPageType: "amazon_product",
    url: "https://partnerboost.com/smart/fba-widget",
    rawData: { product_id: "B0FBA00001", asin: "B0FBA00001" },
  };
}

function pbDfOffer(brandType: string, sku: string): NetworkOffer {
  return {
    externalId: `df:66303:${sku}`,
    name: `${brandType} Product ${sku}`,
    payout: null,
    currency: null,
    price: 60,
    priceCurrency: "USD",
    brand: "Ulike",
    asin: sku,
    countryCode: null,
    landingPageType: "dtc",
    url: "https://partnerboost.com/smart/tee",
    rawData: { sku, brand_type: brandType, source_feed: "datafeed_list" },
  };
}

function setupPb(adapter: FakePbAdapter) {
  process.env.NETWORK_API_PEPPER = PEPPER;
  const { prisma, ctx } = makeCatalogFakePrisma();
  ctx.affiliateNetwork.push(
    testNetwork({
      kind: "partnerboost",
      syncMode: "api",
      apiKeyRef: encryptApiKey("pb-channel-token", PEPPER),
      sessionRef: null,
    })
  );
  ctx.adminGrant.push(activeGrant("partnerboost"));
  const deps: CatalogSyncDeps = {
    prisma,
    getAdapterImpl: () => adapter,
    createOfferImpl: async () => ({
      offer: { id: randomUUID() },
      created: true,
      replayed: false,
    }),
  };
  return { prisma, ctx, deps };
}

describe("syncCatalog PB 双数据源合并", () => {
  it("FBA + DTC + Walmart 合并入库、externalId 不撞键、summary 分来源计数", async () => {
    const adapter = new FakePbAdapter();
    adapter.fba = [pbFbaOffer()];
    adapter.df = [pbDfOffer("DTC", "SKU1"), pbDfOffer("Walmart", "WM1")];
    const { ctx, deps } = setupPb(adapter);
    const summary = await syncCatalog(deps, input);
    expect(summary.synced).toBe(3);
    expect(summary.sourceBreakdown).toEqual({
      amazon: 1,
      dtc: 1,
      walmart: 1,
    });
    expect(summary.datafeedError).toBeUndefined();
    const ids = ctx.networkProduct.map((r) => r.externalId).sort();
    expect(ids).toEqual(["B0FBA00001", "df:66303:SKU1", "df:66303:WM1"]);
    // datafeed 行：国家未知 null、落地类型 dtc（不编造）
    const dtcRow = ctx.networkProduct.find(
      (r) => r.externalId === "df:66303:SKU1"
    )!;
    expect(dtcRow.countryCode).toBeNull();
    expect(dtcRow.landingPageType).toBe("dtc");
    // 成功审计也带分来源计数
    const successAudit = ctx.adminGrantAudit.find(
      (a) => a.action === "CATALOG_SYNC_SUCCESS"
    );
    expect((successAudit!.detail as any).sourceBreakdown).toEqual({
      amazon: 1,
      dtc: 1,
      walmart: 1,
    });
  });

  it("datafeed 整腿失败 → 降级只入 FBA，summary.datafeedError 记明不静默", async () => {
    const adapter = new FakePbAdapter();
    adapter.fba = [pbFbaOffer()];
    adapter.dfError = new Error("datafeed list unavailable");
    const { ctx, deps } = setupPb(adapter);
    const summary = await syncCatalog(deps, input);
    expect(summary.synced).toBe(1);
    expect(summary.sourceBreakdown).toEqual({
      amazon: 1,
      dtc: 0,
      walmart: 0,
    });
    expect(summary.datafeedError).toContain("datafeed list unavailable");
    expect(ctx.networkProduct.map((r) => r.externalId)).toEqual([
      "B0FBA00001",
    ]);
  });

  it("单个 brand_type 失败 → 部分成功 + datafeedError 警告带类名", async () => {
    const adapter = new FakePbAdapter();
    adapter.fba = [pbFbaOffer()];
    adapter.df = [pbDfOffer("DTC", "SKU1")];
    adapter.dfTypeErrors = [["Walmart", "brand type disabled"]];
    const { deps } = setupPb(adapter);
    const summary = await syncCatalog(deps, input);
    expect(summary.synced).toBe(2);
    expect(summary.sourceBreakdown).toEqual({
      amazon: 1,
      dtc: 1,
      walmart: 0,
    });
    expect(summary.datafeedError).toContain("Walmart");
    expect(summary.datafeedError).toContain("brand type disabled");
  });
});
