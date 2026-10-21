/**
 * Offer 一键初筛基础流程（fake prisma + 注入 gate/网关）。
 * 覆盖：黑名单 stop、低佣金 stop、全过 go、佣金未知 unknown、
 * 流量门 false stop、结论写回 Offer 三字段、判停不删。
 */
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@adlinklab/database";
import type { TrafficGateResult } from "../traffic/types.js";
import { prescreenOffers } from "./offer-prescreen.js";

function offer(over: Record<string, unknown> = {}) {
  return {
    id: "o-x",
    name: "Widget Offer",
    network: "yeahpromos",
    source: "affiliate",
    destinationUrl: "https://example.com/go",
    merchantId: null,
    brandName: "WidgetCo",
    commissionValue: 20,
    commissionType: "FIXED",
    avgPrice: 100,
    ...over,
  };
}

function makeWorld(blacklist: Array<Record<string, unknown>> = []) {
  const offerUpdates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const audits: Array<Record<string, unknown>> = [];
  const prisma = {
    catalogBlacklist: { findMany: async () => blacklist },
    catalogScreeningPreset: { findUnique: async () => null },
    aiSetting: { findUnique: async () => null },
    networkProduct: {
      findMany: async () => [
        { id: "np1", brand: "WidgetCo", adCount: 6, adCountLongtail: 3 },
        // 三通道全 0 已知（SERP 裸词/长尾 + 透明中心）→ 判停口径夹具
        { id: "np2", brand: "ZeroBrand", adCount: 0, adCountLongtail: 0, tcAdvertisersCount: 0 },
      ],
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
  };
  return { prisma: prisma as unknown as PrismaClient, offerUpdates, audits };
}

const gatewayOk = async () => ({
  allowed: true,
  feature: "catalog-ad-count" as const,
  keySource: "owner" as const,
  credentials: null,
  grantId: null,
  remainingCalls: null,
});

describe("prescreenOffers", () => {
  it("go / stop(佣金) / unknown(佣金未知) / stop(流量门) 四路分布", async () => {
    const world = makeWorld();
    const gate = async (input: { title: string }): Promise<TrafficGateResult> =>
      ({
        passed: input.title.includes("GateBad") ? false : true,
        reason: input.title.includes("GateBad") ? "流量不足" : "ok",
        officialSite: null,
        signals: [],
      }) as TrafficGateResult;
    const { outcomes, counts } = await prescreenOffers(
      { prisma: world.prisma, gateEvaluator: gate, gatewayResolve: gatewayOk },
      {
        tenantId: "t1",
        actorId: "u1",
        userRole: "owner",
        offers: [
          offer({ id: "o-go" }),
          offer({ id: "o-low", commissionValue: 3 }),
          offer({ id: "o-unknown", commissionValue: null, commissionType: null, avgPrice: null }),
          offer({ id: "o-gate", name: "GateBad Offer" }),
        ],
      }
    );
    expect(counts).toMatchObject({ go: 1, unknown: 1, stop: 2 });
    const byId = new Map(outcomes.map((o) => [o.offerId, o]));
    expect(byId.get("o-go")?.verdict).toBe("go");
    expect(byId.get("o-low")?.verdict).toBe("stop");
    expect(byId.get("o-unknown")?.verdict).toBe("unknown");
    expect(byId.get("o-gate")?.verdict).toBe("stop");
    // 结论写回三字段
    expect(world.offerUpdates).toHaveLength(4);
    const low = world.offerUpdates.find((u) => u.id === "o-low");
    expect(low?.data.prescreenVerdict).toBe("stop");
    expect(String(low?.data.prescreenReason)).toContain("8");
    expect(world.audits.some((a) => a.action === "OFFER_PRESCREEN_BATCH")).toBe(true);
  });

  it("佣金口径：PERCENT 值是已换算金额（不二次乘均价）、percentage 才是费率", async () => {
    const world = makeWorld();
    const gate = async (): Promise<TrafficGateResult> =>
      ({ passed: true, reason: "ok", officialSite: null, signals: [] }) as TrafficGateResult;
    const { outcomes, counts } = await prescreenOffers(
      { prisma: world.prisma, gateEvaluator: gate, gatewayResolve: gatewayOk },
      {
        tenantId: "t1",
        actorId: "u1",
        userRole: "owner",
        offers: [
          // catalog-sync 口径：值 $5 就是单笔 $5 <$8 必须停；
          // 旧读法按费率 5% × 均价 $899 = $44.95 会误放行。
          offer({ id: "o-pct-low", commissionType: "PERCENT", commissionValue: 5, avgPrice: 899 }),
          // offer-form 真费率：1% × $100 = $1 <$8 必须停；旧读法当未知放行。
          offer({ id: "o-rate-low", commissionType: "percentage", commissionValue: 1, avgPrice: 100 }),
          // catalog-sync 正常值：$13 ≥$8、反推费率 13% ≥10% → 全过 go。
          offer({ id: "o-pct-ok", commissionType: "PERCENT", commissionValue: 13, avgPrice: 100 }),
        ],
      }
    );
    const byId = new Map(outcomes.map((o) => [o.offerId, o]));
    expect(byId.get("o-pct-low")?.verdict).toBe("stop");
    expect(byId.get("o-pct-low")?.reason).toContain("8");
    expect(byId.get("o-rate-low")?.verdict).toBe("stop");
    expect(byId.get("o-pct-ok")?.verdict).toBe("go");
    expect(counts.stop).toBe(2);
    expect(counts.go).toBe(1);
  });

  it("黑名单（merchant）→ stop；品牌广告数全 0 → stop", async () => {
    const world = makeWorld([
      { channel: "affiliate", entityType: "merchant", entityId: "m-bad", reason: "拒付" },
    ]);
    const { outcomes } = await prescreenOffers(
      {
        prisma: world.prisma,
        gateEvaluator: async () =>
          ({ passed: true, reason: "ok", officialSite: null, signals: [] }) as TrafficGateResult,
        gatewayResolve: gatewayOk,
      },
      {
        tenantId: "t1",
        actorId: "u1",
        userRole: "owner",
        offers: [
          offer({ id: "o-bl", merchantId: "m-bad" }),
          offer({ id: "o-zero", brandName: "ZeroBrand" }),
        ],
      }
    );
    const byId = new Map(outcomes.map((o) => [o.offerId, o]));
    expect(byId.get("o-bl")?.verdict).toBe("stop");
    expect(byId.get("o-bl")?.reason).toContain("黑名单");
    expect(byId.get("o-zero")?.verdict).toBe("stop");
    expect(byId.get("o-zero")?.reason).toContain("广告数为 0");
  });

  it("网关拒绝 → 广告层跳过（skippedPaidLayer），不因广告数判停", async () => {
    const world = makeWorld();
    const { outcomes, skippedPaidLayer } = await prescreenOffers(
      {
        prisma: world.prisma,
        gateEvaluator: async () =>
          ({ passed: true, reason: "ok", officialSite: null, signals: [] }) as TrafficGateResult,
        gatewayResolve: async () => ({
          allowed: false,
          feature: "catalog-ad-count" as const,
          reason: "no_grant" as const,
        }),
      },
      {
        tenantId: "t1",
        actorId: "u2",
        userRole: "member",
        offers: [offer({ id: "o-zero", brandName: "ZeroBrand" })],
      }
    );
    expect(skippedPaidLayer).toBe(true);
    expect(outcomes[0].verdict).toBe("go");
  });
});

describe("prescreenOffers adStoppedCount（疑似停投计数）", () => {
  function makeWorldWithProducts(
    products: Array<Record<string, unknown>>,
    profiles: Array<Record<string, unknown>> = []
  ): PrismaClient {
    return {
      catalogBlacklist: { findMany: async () => [] },
      catalogScreeningPreset: { findUnique: async () => null },
      aiSetting: { findUnique: async () => null },
      networkProduct: { findMany: async () => products },
      brandProfile: { findMany: async () => profiles },
      offer: { update: async () => ({}) },
      adminGrantAudit: { create: async () => ({}) },
    } as unknown as PrismaClient;
  }
  const gateOk = async () =>
    ({
      passed: true,
      reason: "ok",
      officialSite: null,
      signals: [],
    }) as TrafficGateResult;

  it("上次有广告、本次 0 的商品计数；同品牌多 Offer 不重复计；无关品牌不计", async () => {
    const prisma = makeWorldWithProducts([
      { id: "np-s1", brand: "StoppedBrand", adCount: 0, adCountLongtail: 0, lastAdCount: 4 },
      { id: "np-s2", brand: "StoppedBrand", adCount: 0, adCountLongtail: 0, lastAdCount: 2 },
      { id: "np-s3", brand: "StoppedBrand", adCount: 3, adCountLongtail: 2, lastAdCount: 1 },
      { id: "np-o1", brand: "OtherBrand", adCount: 0, adCountLongtail: 0, lastAdCount: 5 },
    ]);
    const { counts } = await prescreenOffers(
      { prisma, gateEvaluator: gateOk, gatewayResolve: gatewayOk },
      {
        tenantId: "t1",
        actorId: "u1",
        userRole: "owner",
        offers: [
          offer({ id: "o-a", brandName: "StoppedBrand" }),
          offer({ id: "o-b", brandName: "StoppedBrand" }),
        ],
      }
    );
    // np-s1/np-s2 停投（2 件）；np-s3 持续在投不计；OtherBrand 无 Offer 引用不计。
    expect(counts.adStoppedCount).toBe(2);
  });

  it("网关拒绝 → adStoppedCount = 0", async () => {
    const prisma = makeWorldWithProducts([
      { id: "np-s1", brand: "StoppedBrand", adCount: 0, adCountLongtail: 0, lastAdCount: 4 },
    ]);
    const { counts, skippedPaidLayer } = await prescreenOffers(
      {
        prisma,
        gateEvaluator: gateOk,
        gatewayResolve: async () => ({
          allowed: false,
          feature: "catalog-ad-count" as const,
          reason: "no_grant" as const,
        }),
      },
      {
        tenantId: "t1",
        actorId: "u2",
        userRole: "member",
        offers: [offer({ id: "o-a", brandName: "StoppedBrand" })],
      }
    );
    expect(skippedPaidLayer).toBe(true);
    expect(counts.adStoppedCount).toBe(0);
  });
});

describe("prescreenOffers 广告层投放方式分流（promoMode）", () => {
  function makeWorldWithProducts(
    products: Array<Record<string, unknown>>,
    profiles: Array<Record<string, unknown>> = []
  ): PrismaClient {
    return {
      catalogBlacklist: { findMany: async () => [] },
      catalogScreeningPreset: { findUnique: async () => null },
      aiSetting: { findUnique: async () => null },
      networkProduct: { findMany: async () => products },
      brandProfile: { findMany: async () => profiles },
      offer: { update: async () => ({}) },
      adminGrantAudit: { create: async () => ({}) },
    } as unknown as PrismaClient;
  }
  const gateOk = async () =>
    ({
      passed: true,
      reason: "ok",
      officialSite: null,
      signals: [],
    }) as TrafficGateResult;
  const zeroProduct = (brand: string) => ({
    id: `np-${brand}`,
    brand,
    networkId: "net-1",
    countryCode: "US",
    adCount: 0,
    adCountLongtail: 0,
    // 三通道全 0 已知才能进判停分支（promoMode 豁免在该分支内判定）
    tcAdvertisersCount: 0,
    lastAdCount: null,
  });
  const profile = (brandKey: string, promoMode: string) => ({
    networkId: "net-1",
    brandKey,
    countryCode: "US",
    promoMode,
  });

  it("promoMode=product 品牌广告数 0 → 不判停 + adReferenceOnly + adWaivedCount", async () => {
    const prisma = makeWorldWithProducts(
      [zeroProduct("SoloBrand")],
      [profile("solobrand", "product")]
    );
    const { outcomes, counts } = await prescreenOffers(
      { prisma, gateEvaluator: gateOk, gatewayResolve: gatewayOk },
      {
        tenantId: "t1",
        actorId: "u1",
        userRole: "owner",
        offers: [
          offer({ id: "o-a", brandName: "SoloBrand" }),
          offer({ id: "o-b", brandName: "SoloBrand" }),
        ],
      }
    );
    expect(counts.stop).toBe(0);
    expect(counts.go).toBe(2);
    expect(counts.adWaivedCount).toBe(2);
    expect(outcomes.every((o) => o.adReferenceOnly === true)).toBe(true);
  });

  it("promoMode=brand 与未标注品牌：广告数 0 照旧判停，无豁免", async () => {
    const prisma = makeWorldWithProducts(
      [zeroProduct("BrandMode"), zeroProduct("PlainBrand")],
      [profile("brandmode", "brand")]
    );
    const { outcomes, counts } = await prescreenOffers(
      { prisma, gateEvaluator: gateOk, gatewayResolve: gatewayOk },
      {
        tenantId: "t1",
        actorId: "u1",
        userRole: "owner",
        offers: [
          offer({ id: "o-brand", brandName: "BrandMode" }),
          offer({ id: "o-plain", brandName: "PlainBrand" }),
        ],
      }
    );
    expect(counts.stop).toBe(2);
    expect(counts.adWaivedCount).toBe(0);
    expect(outcomes.every((o) => o.adReferenceOnly === undefined)).toBe(true);
    expect(outcomes.every((o) => o.reason.includes("广告数为 0"))).toBe(true);
  });

  it("promoMode=product 品牌广告数 ≥1 → 正常 pass，不加 adReferenceOnly", async () => {
    const prisma = makeWorldWithProducts(
      [{ ...zeroProduct("SoloBrand"), adCount: 4 }],
      [profile("solobrand", "product")]
    );
    const { outcomes, counts } = await prescreenOffers(
      { prisma, gateEvaluator: gateOk, gatewayResolve: gatewayOk },
      {
        tenantId: "t1",
        actorId: "u1",
        userRole: "owner",
        offers: [offer({ id: "o-a", brandName: "SoloBrand" })],
      }
    );
    expect(outcomes[0].verdict).toBe("go");
    expect(outcomes[0].adReferenceOnly).toBeUndefined();
    expect(counts.adWaivedCount).toBe(0);
  });

  it("promoMode=product 品牌被其他层（$8 门槛）判停 → 不受豁免影响", async () => {
    const prisma = makeWorldWithProducts(
      [zeroProduct("SoloBrand")],
      [profile("solobrand", "product")]
    );
    const { outcomes, counts } = await prescreenOffers(
      { prisma, gateEvaluator: gateOk, gatewayResolve: gatewayOk },
      {
        tenantId: "t1",
        actorId: "u1",
        userRole: "owner",
        offers: [offer({ id: "o-low", brandName: "SoloBrand", commissionValue: 3 })],
      }
    );
    expect(outcomes[0].verdict).toBe("stop");
    expect(outcomes[0].reason).toContain("8");
    expect(counts.adWaivedCount).toBe(0);
  });
});

describe("prescreenOffers 广告层多探针口径", () => {
  function makeWorldWithProducts(
    products: Array<Record<string, unknown>>
  ): PrismaClient {
    return {
      catalogBlacklist: { findMany: async () => [] },
      catalogScreeningPreset: { findUnique: async () => null },
      aiSetting: { findUnique: async () => null },
      networkProduct: { findMany: async () => products },
      brandProfile: { findMany: async () => [] },
      offer: { update: async () => ({}) },
      adminGrantAudit: { create: async () => ({}) },
    } as unknown as PrismaClient;
  }
  const gateOk = async () =>
    ({
      passed: true,
      reason: "ok",
      officialSite: null,
      signals: [],
    }) as TrafficGateResult;

  it("裸词 0 + 长尾 ≥1 → go + adLongtailOnly 标记与计数", async () => {
    const prisma = makeWorldWithProducts([
      { id: "np-t1", brand: "TailBrand", adCount: 0, adCountLongtail: 4, lastAdCount: null },
    ]);
    const { outcomes, counts } = await prescreenOffers(
      { prisma, gateEvaluator: gateOk, gatewayResolve: gatewayOk },
      {
        tenantId: "t1",
        actorId: "u1",
        userRole: "owner",
        offers: [offer({ id: "o-tail", brandName: "TailBrand" })],
      }
    );
    expect(outcomes[0].verdict).toBe("go");
    expect(outcomes[0].adLongtailOnly).toBe(true);
    expect(counts.adLongtailOnlyCount).toBe(1);
    expect(counts.stop).toBe(0);
  });

  it("裸词与长尾双 0 + 政策风险组 → stop，原因用政策口径文案", async () => {
    const prisma = makeWorldWithProducts([
      {
        id: "np-g1",
        brand: "GunBrand",
        adCount: 0,
        adCountLongtail: 0,
        tcAdvertisersCount: 0,
        adPolicyRisk: true,
        lastAdCount: null,
      },
    ]);
    const { outcomes, counts } = await prescreenOffers(
      { prisma, gateEvaluator: gateOk, gatewayResolve: gatewayOk },
      {
        tenantId: "t1",
        actorId: "u1",
        userRole: "owner",
        offers: [offer({ id: "o-gun", brandName: "GunBrand" })],
      }
    );
    expect(outcomes[0].verdict).toBe("stop");
    expect(outcomes[0].reason).toContain("政策受限");
    expect(outcomes[0].reason).not.toContain("暂无人在投放");
    expect(counts.stop).toBe(1);
  });

  it("长尾未探明（null，旧印记）→ 新口径不判停：任一维度未知 → unknown 转复核", async () => {
    // 2026-10-21 透明中心旁证批改判：旧口径"长尾未知只看裸词判停"已废止——
    // 判停须裸词/长尾/透明中心三通道全 0 已知；长尾未探明 + TC 未查时
    // "无人投放"未被证实，绝不判停（unknown-never-fail）。
    const prisma = makeWorldWithProducts([
      // 无 adCountLongtail 字段 = 多探针上线前旧印记；TC 同样从未查过
      { id: "np-old", brand: "OldBrand", adCount: 0, lastAdCount: null },
    ]);
    const { outcomes, counts } = await prescreenOffers(
      {
        prisma,
        gateEvaluator: gateOk,
        gatewayResolve: gatewayOk,
        // 触发增量计算但组被新鲜度/无探针跳过（groupsQueried=0）→ 长尾/TC 仍未知
        adCountCalc: async () => ({
          groupsQueried: 0,
          groupsSkippedCache: 1,
          productsUpdated: 0,
          errors: [],
        }),
      },
      {
        tenantId: "t1",
        actorId: "u1",
        userRole: "owner",
        offers: [offer({ id: "o-old", brandName: "OldBrand" })],
      }
    );
    expect(outcomes[0].verdict).toBe("unknown");
    expect(outcomes[0].reason).toContain("待人工复核");
    expect(counts.stop).toBe(0);
    expect(outcomes[0].adLongtailOnly).toBeUndefined();
  });
});

describe("prescreenOffers 广告层透明中心旁证口径", () => {
  function makeWorldWithProducts(
    products: Array<Record<string, unknown>>
  ): PrismaClient {
    return {
      catalogBlacklist: { findMany: async () => [] },
      catalogScreeningPreset: { findUnique: async () => null },
      aiSetting: { findUnique: async () => null },
      networkProduct: { findMany: async () => products },
      brandProfile: { findMany: async () => [] },
      offer: { update: async () => ({}) },
      adminGrantAudit: { create: async () => ({}) },
    } as unknown as PrismaClient;
  }
  const gateOk = async () =>
    ({
      passed: true,
      reason: "ok",
      officialSite: null,
      signals: [],
    }) as TrafficGateResult;

  it("SERP 双 0 + TC ≥1 → go + tcRescued 标记/计数 + 旁证原因文案", async () => {
    const prisma = makeWorldWithProducts([
      {
        id: "np-tc1",
        brand: "OlightLike",
        adCount: 0,
        adCountLongtail: 0,
        tcAdvertisersCount: 11,
        lastAdCount: null,
      },
    ]);
    const { outcomes, counts } = await prescreenOffers(
      { prisma, gateEvaluator: gateOk, gatewayResolve: gatewayOk },
      {
        tenantId: "t1",
        actorId: "u1",
        userRole: "owner",
        offers: [offer({ id: "o-tc", brandName: "OlightLike" })],
      }
    );
    expect(outcomes[0].verdict).toBe("go");
    expect(outcomes[0].tcRescued).toBe(true);
    expect(outcomes[0].tcAdvertisersCount).toBe(11);
    expect(outcomes[0].reason).toContain(
      "透明中心有 11 家广告主在投（快照未捕获）"
    );
    expect(counts.adTcRescuedCount).toBe(1);
    expect(counts.stop).toBe(0);
  });

  it("SERP 双 0 + TC = 0（三通道全 0 已知）→ stop，双通道确认文案", async () => {
    const prisma = makeWorldWithProducts([
      {
        id: "np-tc0",
        brand: "DeadBrand",
        adCount: 0,
        adCountLongtail: 0,
        tcAdvertisersCount: 0,
        lastAdCount: null,
      },
    ]);
    const { outcomes, counts } = await prescreenOffers(
      { prisma, gateEvaluator: gateOk, gatewayResolve: gatewayOk },
      {
        tenantId: "t1",
        actorId: "u1",
        userRole: "owner",
        offers: [offer({ id: "o-dead", brandName: "DeadBrand" })],
      }
    );
    expect(outcomes[0].verdict).toBe("stop");
    expect(outcomes[0].reason).toContain("SERP 与透明中心双通道确认");
    expect(counts.stop).toBe(1);
    expect(counts.adTcRescuedCount).toBe(0);
  });

  it("SERP 双 0 + TC 未查（calc 补查后仍未知）→ unknown 转复核，绝不判停", async () => {
    const prisma = makeWorldWithProducts([
      {
        id: "np-tcn",
        brand: "UnknownBrand",
        adCount: 0,
        adCountLongtail: 0,
        lastAdCount: null,
      },
    ]);
    const { outcomes, counts } = await prescreenOffers(
      {
        prisma,
        gateEvaluator: gateOk,
        gatewayResolve: gatewayOk,
        adCountCalc: async () => ({
          groupsQueried: 0,
          groupsSkippedCache: 1,
          productsUpdated: 0,
          errors: [],
        }),
      },
      {
        tenantId: "t1",
        actorId: "u1",
        userRole: "owner",
        offers: [offer({ id: "o-unk", brandName: "UnknownBrand" })],
      }
    );
    expect(outcomes[0].verdict).toBe("unknown");
    expect(outcomes[0].reason).toContain("待人工复核");
    expect(counts.stop).toBe(0);
  });

  it("TC 触发 + 记账：双 0 未查 TC → 送 calc；calc 只补 TC（tcQueries=1）也记账并刷回翻案", async () => {
    const products: Array<Record<string, unknown>> = [
      {
        id: "np-tcb",
        brand: "LateBrand",
        adCount: 0,
        adCountLongtail: 0,
        lastAdCount: null,
      },
    ];
    const usageCalls: number[] = [];
    const prisma = {
      catalogBlacklist: { findMany: async () => [] },
      catalogScreeningPreset: { findUnique: async () => null },
      aiSetting: { findUnique: async () => null },
      networkProduct: { findMany: async () => products },
      brandProfile: { findMany: async () => [] },
      offer: { update: async () => ({}) },
      adminGrantAudit: { create: async () => ({}) },
      paidDataUsage: {
        upsert: async (args: { create: { calls: number } }) => {
          usageCalls.push(args.create.calls);
          return {};
        },
      },
    } as unknown as PrismaClient;
    const { outcomes, counts } = await prescreenOffers(
      {
        prisma,
        gateEvaluator: gateOk,
        gatewayResolve: gatewayOk,
        // 模拟 calc 的 TC 单独补查：SERP 零查询、TC 1 次，写回 TC=7。
        adCountCalc: async () => {
          products[0].tcAdvertisersCount = 7;
          return {
            groupsQueried: 0,
            groupsSkippedCache: 1,
            serpQueries: 0,
            tcQueries: 1,
            tcChecked: 1,
            tcFailed: 0,
            tcRescued: 1,
            productsUpdated: 1,
            errors: [],
          };
        },
      },
      {
        tenantId: "t1",
        actorId: "u1",
        userRole: "owner",
        offers: [offer({ id: "o-late", brandName: "LateBrand" })],
      }
    );
    // 记账：groupsQueried=0 也记（TC 的 1 次不能漏）
    expect(usageCalls).toEqual([1]);
    // 刷回后按 TC=7 翻案
    expect(outcomes[0].verdict).toBe("go");
    expect(outcomes[0].tcRescued).toBe(true);
    expect(outcomes[0].tcAdvertisersCount).toBe(7);
    expect(counts.adTcRescuedCount).toBe(1);
  });
});
