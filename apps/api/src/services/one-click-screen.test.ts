/**
 * 一键筛选全流程（fake prisma + 注入 gate/广告数/网关/建 Offer）。
 * 覆盖：五关 kill 分布、review（佣金未知 / 流量门 unknown）、pass 建 Offer、
 * 去重跳过已建、付费层被拒整层跳过、报告数字自洽、分档分布、
 * 强制入选（黑名单拒绝 + 审计）。
 */
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@adlinklab/database";
import type { TrafficGateResult } from "../traffic/types.js";
import {
  forceSelectProducts,
  runOneClickScreen,
  type OneClickProductRow,
} from "./one-click-screen.js";

const TENANT = "t1";
const NETWORK = "n1";

function product(over: Partial<OneClickProductRow> = {}): OneClickProductRow {
  return {
    id: "p-x",
    networkId: NETWORK,
    externalId: "ext-x",
    name: "Widget Pro 3000",
    brand: "WidgetCo",
    price: 100,
    commissionAmount: 20,
    commissionRate: 20,
    reviewCount: 500,
    promoUrl: "https://example.com/go",
    landingPageType: "promo",
    countryCode: "US",
    merchantId: null,
    poolStage: "inbox",
    adCount: 8,
    adCountLongtail: 0,
    adPolicyRisk: false,
    adCountCheckedAt: new Date(),
    lastAdCount: null,
    ...over,
  };
}

interface FakeWorld {
  prisma: PrismaClient;
  productUpdates: Array<{ id: string; data: Record<string, unknown> }>;
  offerUpdates: Array<{ id: string; data: Record<string, unknown> }>;
  audits: Array<Record<string, unknown>>;
  offerCreates: Map<string, string>; // idempotencyKey -> offerId
}

function makeWorld(opts: {
  blacklist?: Array<Record<string, unknown>>;
  refreshedAdCounts?: Map<string, number | null>;
  brandProfiles?: Array<Record<string, unknown>>;
}): FakeWorld {
  const productUpdates: FakeWorld["productUpdates"] = [];
  const offerUpdates: FakeWorld["offerUpdates"] = [];
  const audits: FakeWorld["audits"] = [];
  const offerCreates = new Map<string, string>();
  const prisma = {
    affiliateNetwork: {
      findMany: async () => [{ id: NETWORK, kind: "yeahpromos" }],
    },
    catalogBlacklist: {
      findMany: async () => opts.blacklist ?? [],
    },
    catalogScreeningPreset: { findUnique: async () => null },
    brandProfile: { findMany: async () => opts.brandProfiles ?? [] },
    aiSetting: { findUnique: async () => null },
    merchant: { findMany: async () => [] },
    networkProduct: {
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        productUpdates.push({ id: args.where.id, data: args.data });
        return {};
      },
      findMany: async () =>
        [...(opts.refreshedAdCounts ?? new Map()).entries()].map(([id, adCount]) => ({
          id,
          adCount,
          lastAdCount: null,
        })),
    },
    offer: {
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        offerUpdates.push({ id: args.where.id, data: args.data });
        return {};
      },
    },
    adminGrantAudit: {
      create: async (args: { data: Record<string, unknown> }) => {
        audits.push(args.data);
        return {};
      },
    },
    paidDataUsage: { upsert: async () => ({}) },
    adminGrant: { findMany: async () => [], findUnique: async () => null },
    tenantSetting: { findUnique: async () => null },
  };
  return {
    prisma: prisma as unknown as PrismaClient,
    productUpdates,
    offerUpdates,
    audits,
    offerCreates,
  };
}

function makeCreateOfferImpl(world: FakeWorld) {
  let seq = 0;
  return async (input: { idempotencyKey?: string }) => {
    const key = input.idempotencyKey ?? "";
    const existing = world.offerCreates.get(key);
    if (existing) return { offer: { id: existing }, created: false, replayed: true };
    seq += 1;
    const id = `offer-${seq}`;
    world.offerCreates.set(key, id);
    return { offer: { id }, created: true, replayed: false };
  };
}

function gateByTitle(map: Map<string, TrafficGateResult>) {
  return async (input: { title: string }): Promise<TrafficGateResult> =>
    map.get(input.title) ?? ({ passed: true, reason: "ok" } as TrafficGateResult);
}

const PASS_GATE = { passed: true, reason: "ok" } as TrafficGateResult;

describe("runOneClickScreen 全流程", () => {
  it("五关分布 + 去重 + 数字自洽 + 分档分布", async () => {
    const world = makeWorld({
      blacklist: [
        {
          channel: "affiliate",
          entityType: "merchant",
          entityId: "m-bad",
          reason: "拒付记录",
        },
      ],
    });
    const products = [
      product({ id: "p-black", externalId: "e1", merchantId: "m-bad" }),
      product({ id: "p-comm", externalId: "e2", commissionAmount: 5, commissionRate: 5 }),
      product({ id: "p-preset", externalId: "e3", price: 200, commissionAmount: 30, commissionRate: 15 }),
      product({ id: "p-ads", externalId: "e4", adCount: 0 }),
      product({ id: "p-gate", externalId: "e5", name: "Gate Fail Item", adCount: 3 }),
      product({ id: "p-review", externalId: "e6", commissionAmount: null, commissionRate: null, adCount: 5 }),
      product({ id: "p-pass", externalId: "e7", adCount: 12 }),
      product({ id: "p-dupe", externalId: "e8", adCount: 30 }),
    ];
    // 预置 p-dupe 的 Offer（同 idempotencyKey）→ 应跳过已建。
    world.offerCreates.set(`catalog:${NETWORK}:e8`, "offer-existing");
    const gate = gateByTitle(
      new Map([
        ["Gate Fail Item", { passed: false, reason: "官网流量不足" } as TrafficGateResult],
      ])
    );
    const report = await runOneClickScreen(
      {
        prisma: world.prisma,
        createOfferImpl: makeCreateOfferImpl(world),
        gateEvaluator: gate,
        gatewayResolve: async () => ({
          allowed: true,
          feature: "catalog-ad-count",
          keySource: "owner",
          credentials: null,
          grantId: null,
          remainingCalls: null,
        }),
        adCountCalc: async () => ({
          groupsQueried: 0,
          groupsSkippedCache: 0,
          productsUpdated: 0,
          errors: [],
        }),
      },
      { tenantId: TENANT, actorId: "u1", userRole: "owner", products }
    );

    expect(report.processed).toBe(8);
    expect(report.killedBlacklist).toBe(1);
    expect(report.killedCommission).toBe(1);
    expect(report.killedPreset).toBe(1);
    expect(report.killedAdCount).toBe(1);
    expect(report.killedTrafficGate).toBe(1);
    expect(report.review).toBe(1);
    expect(report.passed).toBe(2);
    // 数字自洽：各关 kill + review + passed = processed
    const kills =
      report.killedBlacklist +
      report.killedCommission +
      report.killedPreset +
      report.killedAdCount +
      report.killedTrafficGate;
    expect(kills + report.review + report.passed).toBe(report.processed);
    expect(report.offersCreated).toBe(1);
    expect(report.offersSkippedExisting).toBe(1);
    expect(report.offersFailed).toEqual([]);
    expect(report.skippedPaidLayer).toBe(false);
    expect(report.paidKeySource).toBe("owner");
    // 分档分布（键：none/small/sweet/hot/red_ocean；未知不入分布）：
    // 8 件广告数全已知 → none=1（0）、small=2（3/5）、sweet=4（8/8/8/12）、hot=1（30）
    const distTotal =
      report.adTierDistribution.none +
      report.adTierDistribution.small +
      report.adTierDistribution.sweet +
      report.adTierDistribution.hot +
      report.adTierDistribution.red_ocean;
    expect(distTotal).toBe(8);
    expect(report.adTierDistribution.none).toBe(1);
    expect(report.adTierDistribution.small).toBe(2);
    expect(report.adTierDistribution.sweet).toBe(4);
    expect(report.adTierDistribution.hot).toBe(1);
    expect(report.adTierDistribution.red_ocean).toBe(0);
    // kill 的商品被移入备选池（inbox → pool）且带原因
    const blackUpdate = world.productUpdates.find((u) => u.id === "p-black");
    expect(blackUpdate?.data.screenVerdict).toBe("kill");
    expect(blackUpdate?.data.poolStage).toBe("pool");
    expect(String(blackUpdate?.data.screenReason)).toContain("黑名单");
    // pass 的 Offer 被标注一键筛选来源
    const annotation = world.offerUpdates.find(
      (u) => u.data.prescreenReason === "一键筛选通过（商品库）"
    );
    expect(annotation).toBeTruthy();
    // 审计已写
    expect(world.audits.some((a) => a.action === "CATALOG_ONE_CLICK_SCREEN")).toBe(true);
  });

  it("付费层被网关拒绝 → 整层跳过：adCount=0 不杀、未知不标记，报告 skippedPaidLayer", async () => {
    const world = makeWorld({});
    const products = [
      product({ id: "p-zero", externalId: "e1", adCount: 0 }),
      product({ id: "p-null", externalId: "e2", adCount: null, adCountCheckedAt: null }),
    ];
    const report = await runOneClickScreen(
      {
        prisma: world.prisma,
        createOfferImpl: makeCreateOfferImpl(world),
        gateEvaluator: async () => PASS_GATE,
        gatewayResolve: async () => ({
          allowed: false,
          feature: "catalog-ad-count",
          reason: "no_grant",
        }),
      },
      { tenantId: TENANT, actorId: "u2", userRole: "member", products }
    );
    expect(report.skippedPaidLayer).toBe(true);
    expect(report.paidKeySource).toBeNull();
    expect(report.killedAdCount).toBe(0);
    expect(report.passed).toBe(2);
    expect(report.review).toBe(0);
  });

  it("流量门 unknown → review 不判死", async () => {
    const world = makeWorld({});
    const report = await runOneClickScreen(
      {
        prisma: world.prisma,
        createOfferImpl: makeCreateOfferImpl(world),
        gateEvaluator: async () =>
          ({ passed: null, reason: "无数据" }) as TrafficGateResult,
        gatewayResolve: async () => ({
          allowed: true,
          feature: "catalog-ad-count",
          keySource: "owner",
          credentials: null,
          grantId: null,
          remainingCalls: null,
        }),
      },
      {
        tenantId: TENANT,
        actorId: "u1",
        userRole: "owner",
        products: [product({ id: "p-u", externalId: "e1" })],
      }
    );
    expect(report.review).toBe(1);
    expect(report.passed).toBe(0);
    expect(report.killedTrafficGate).toBe(0);
  });
});

describe("runOneClickScreen 广告趋势与单品豁免", () => {
  const allowedGateway = async () => ({
    allowed: true,
    feature: "catalog-ad-count",
    keySource: "owner" as const,
    credentials: null,
    grantId: null,
    remainingCalls: null,
  });
  const noCalc = async () => ({
    groupsQueried: 0,
    groupsSkippedCache: 0,
    productsUpdated: 0,
    errors: [],
  });

  it("疑似停投计数：上次 >0、本次 =0 计入 adStoppedCount（未标注品牌照旧被杀）", async () => {
    const world = makeWorld({});
    const report = await runOneClickScreen(
      {
        prisma: world.prisma,
        createOfferImpl: makeCreateOfferImpl(world),
        gateEvaluator: async () => PASS_GATE,
        gatewayResolve: allowedGateway,
        adCountCalc: noCalc,
      },
      {
        tenantId: TENANT,
        actorId: "u1",
        userRole: "owner",
        products: [
          product({ id: "p-stopped", externalId: "e1", adCount: 0, lastAdCount: 6 }),
          product({ id: "p-active", externalId: "e2", adCount: 4, lastAdCount: 9 }),
          product({ id: "p-first", externalId: "e3", adCount: 0, lastAdCount: null }),
        ],
      }
    );
    // 只有 p-stopped 是上次有、本次无 → 停投 1 件
    expect(report.adStoppedCount).toBe(1);
    // 未标注品牌广告数 0 照旧杀（p-stopped、p-first）
    expect(report.killedAdCount).toBe(2);
    expect(report.adWaivedCount).toBe(0);
    expect(report.passed).toBe(1);
  });

  it("单品品牌豁免：promoMode=product 的品牌广告数 0 不杀、标 adReferenceOnly、计 adWaivedCount", async () => {
    const world = makeWorld({
      brandProfiles: [
        {
          networkId: NETWORK,
          brandKey: "widgetco",
          countryCode: "US",
          promoMode: "product",
        },
      ],
    });
    const report = await runOneClickScreen(
      {
        prisma: world.prisma,
        createOfferImpl: makeCreateOfferImpl(world),
        gateEvaluator: async () => PASS_GATE,
        gatewayResolve: allowedGateway,
        adCountCalc: noCalc,
      },
      {
        tenantId: TENANT,
        actorId: "u1",
        userRole: "owner",
        products: [
          product({ id: "p-waived", externalId: "e1", adCount: 0, lastAdCount: 5 }),
          product({ id: "p-other", externalId: "e2", brand: "OtherBrand", adCount: 0 }),
        ],
      }
    );
    expect(report.adWaivedCount).toBe(1);
    expect(report.killedAdCount).toBe(1); // OtherBrand 未标注，照旧杀
    expect(report.passed).toBe(1);
    // 趋势是事实统计：被豁免的停投品牌仍计入 adStoppedCount
    expect(report.adStoppedCount).toBe(1);
    const waived = report.outcomes.find((o) => o.productId === "p-waived");
    expect(waived?.outcome).toBe("pass");
    expect(waived?.adReferenceOnly).toBe(true);
    const killed = report.outcomes.find((o) => o.productId === "p-other");
    expect(killed?.outcome).toBe("kill");
    expect(killed?.adReferenceOnly).toBeUndefined();
  });

  it("单品品牌豁免只限广告层：$8 门槛照旧杀", async () => {
    const world = makeWorld({
      brandProfiles: [
        {
          networkId: NETWORK,
          brandKey: "widgetco",
          countryCode: "US",
          promoMode: "product",
        },
      ],
    });
    const report = await runOneClickScreen(
      {
        prisma: world.prisma,
        createOfferImpl: makeCreateOfferImpl(world),
        gateEvaluator: async () => PASS_GATE,
        gatewayResolve: allowedGateway,
        adCountCalc: noCalc,
      },
      {
        tenantId: TENANT,
        actorId: "u1",
        userRole: "owner",
        products: [
          product({
            id: "p-cheap",
            externalId: "e1",
            adCount: 0,
            commissionAmount: 5,
            commissionRate: 5,
          }),
        ],
      }
    );
    expect(report.killedCommission).toBe(1);
    expect(report.adWaivedCount).toBe(0);
    expect(report.passed).toBe(0);
  });
});

describe("forceSelectProducts 强制入选", () => {
  it("黑名单商品拒绝强制；普通商品强制建 Offer + 审计 + 商品/Offer 标注", async () => {
    const world = makeWorld({
      blacklist: [
        {
          channel: "affiliate",
          entityType: "product",
          entityId: "p-bad",
          reason: "虚假宣传",
        },
      ],
    });
    const result = await forceSelectProducts(
      { prisma: world.prisma, createOfferImpl: makeCreateOfferImpl(world) },
      {
        tenantId: TENANT,
        actorId: "u1",
        products: [
          product({ id: "p-bad", externalId: "e1" }),
          product({ id: "p-ok", externalId: "e2" }),
        ],
      }
    );
    expect(result.refusedBlacklist).toHaveLength(1);
    expect(result.refusedBlacklist[0].productId).toBe("p-bad");
    expect(result.created).toHaveLength(1);
    expect(result.created[0].productId).toBe("p-ok");
    expect(world.audits.some((a) => a.action === "CATALOG_FORCE_SELECT")).toBe(true);
    const upd = world.productUpdates.find((u) => u.id === "p-ok");
    expect(upd?.data.screenReason).toBe("人工强制入选（跳过筛选阶梯）");
    const offerUpd = world.offerUpdates.find((u) => u.id === result.created[0].offerId);
    expect(offerUpd?.data.prescreenVerdict).toBe("unknown");
  });
});

describe("runOneClickScreen 广告层多探针口径", () => {
  const allowedGateway = async () => ({
    allowed: true,
    feature: "catalog-ad-count",
    keySource: "owner" as const,
    credentials: null,
    grantId: null,
    remainingCalls: null,
  });
  const noCalc = async () => ({
    groupsQueried: 0,
    groupsSkippedCache: 0,
    productsUpdated: 0,
    errors: [],
  });
  const deps = (world: FakeWorld) => ({
    prisma: world.prisma,
    createOfferImpl: makeCreateOfferImpl(world),
    gateEvaluator: async () => PASS_GATE,
    gatewayResolve: allowedGateway,
    adCountCalc: noCalc,
  });

  it("裸词 0 + 长尾 ≥1 → pass + adLongtailOnly 标记与报告计数", async () => {
    const world = makeWorld({});
    const report = await runOneClickScreen(deps(world), {
      tenantId: TENANT,
      actorId: "u1",
      userRole: "owner",
      products: [
        product({ id: "p-tail", externalId: "e1", adCount: 0, adCountLongtail: 4 }),
        product({ id: "p-zero", externalId: "e2", adCount: 0, adCountLongtail: 0 }),
      ],
    });
    expect(report.passed).toBe(1);
    expect(report.killedAdCount).toBe(1);
    expect(report.adLongtailOnlyCount).toBe(1);
    const tail = report.outcomes.find((o) => o.productId === "p-tail");
    expect(tail?.outcome).toBe("pass");
    expect(tail?.adLongtailOnly).toBe(true);
    const zero = report.outcomes.find((o) => o.productId === "p-zero");
    expect(zero?.outcome).toBe("kill");
    expect(zero?.adLongtailOnly).toBeUndefined();
  });

  it("双 0 + 政策风险 → kill 且原因用政策口径文案", async () => {
    const world = makeWorld({});
    const report = await runOneClickScreen(deps(world), {
      tenantId: TENANT,
      actorId: "u1",
      userRole: "owner",
      products: [
        product({
          id: "p-gun",
          externalId: "e1",
          brand: "GunBrand",
          adCount: 0,
          adCountLongtail: 0,
          adPolicyRisk: true,
        }),
      ],
    });
    expect(report.killedAdCount).toBe(1);
    const o = report.outcomes.find((x) => x.productId === "p-gun");
    expect(o?.outcome).toBe("kill");
    expect(o?.reason).toContain("政策受限");
    expect(o?.reason).not.toContain("暂无人在投放");
  });

  it("长尾未探明（null）+ 裸词 0 → 维持旧口径判停（不臆测长尾）", async () => {
    const world = makeWorld({});
    const report = await runOneClickScreen(deps(world), {
      tenantId: TENANT,
      actorId: "u1",
      userRole: "owner",
      products: [
        product({ id: "p-old", externalId: "e1", adCount: 0, adCountLongtail: null }),
      ],
    });
    expect(report.killedAdCount).toBe(1);
    const o = report.outcomes.find((x) => x.productId === "p-old");
    expect(o?.reason).toContain("暂无人在投放");
    expect(report.adLongtailOnlyCount).toBe(0);
  });
});
