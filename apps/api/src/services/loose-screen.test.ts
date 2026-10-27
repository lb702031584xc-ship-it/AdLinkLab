/**
 * 宽松型筛选项（loose mode）纯函数测试：筛查门、去重、排序、
 * 零合格、禁令进风险栏不排除、当季热销依据缺失则排除。
 */
import { describe, expect, it } from "vitest";
import {
  screenLooseOffers,
  type LooseScreenRow,
} from "./loose-screen.js";

function row(over: Partial<LooseScreenRow> = {}): LooseScreenRow {
  return {
    id: "o-1",
    name: "Heater Pro",
    brandName: "BrandA",
    category: "heating",
    destinationUrl: "https://example.com/dp/1",
    affiliateUrl: null,
    commissionValue: 20,
    commissionType: "FIXED",
    avgPrice: 100,
    productId: null,
    asin: null,
    productPrice: null,
    productReviewCount: null,
    productCommissionRate: null,
    seasonalEvidence: "冬季取暖热销",
    stock: "in_stock",
    rating: null,
    reviewCount: 100,
    monthlySales: null,
    epcUsd: null,
    conversionRate: null,
    lowPriceTraffic: "winnable",
    riskCost: [],
    ...over,
  };
}

describe("screenLooseOffers", () => {
  it("全过：字段齐全、推广链接取 affiliateUrl、风险栏透传不排除", () => {
    const { qualified, dropped, counts } = screenLooseOffers([
      row({
        id: "o-ok",
        affiliateUrl: "https://example.com/track/1",
        riskCost: ["禁品牌词竞价"],
      }),
    ]);
    expect(counts).toEqual({ qualified: 1, dropped: 0 });
    expect(dropped).toEqual([]);
    const q = qualified[0];
    expect(q.offerId).toBe("o-ok");
    expect(q.commissionUsd).toBe(20);
    expect(q.promoUrl).toBe("https://example.com/track/1");
    expect(q.riskCost).toEqual(["禁品牌词竞价"]);
    expect(q.seasonalEvidence).toBe("冬季取暖热销");
    expect(q.lowPriceTraffic).toBe("winnable");
  });

  it("当季热销依据缺失则排除（空串与 null 同理）", () => {
    const { qualified, dropped } = screenLooseOffers([
      row({ id: "o-nos", seasonalEvidence: null }),
      row({ id: "o-empty", seasonalEvidence: "   " }),
    ]);
    expect(qualified).toEqual([]);
    expect(dropped).toHaveLength(2);
    expect(dropped.every((d) => d.reasons.includes("当季热销依据缺失"))).toBe(
      true
    );
  });

  it("佣金门：低于下限、未知、费率为零均排除", () => {
    const { qualified, dropped } = screenLooseOffers(
      [
        row({ id: "o-low", commissionValue: 3 }),
        row({
          id: "o-unknown",
          commissionValue: null,
          commissionType: null,
          avgPrice: null,
        }),
        row({
          id: "o-zero-rate",
          commissionValue: 0,
          commissionType: "percentage",
          avgPrice: 100,
        }),
        row({
          id: "o-zero-product-rate",
          commissionValue: 20,
          productCommissionRate: 0,
        }),
      ],
      { minCommissionUsd: 3 }
    );
    expect(qualified).toEqual([]);
    const byId = new Map(dropped.map((d) => [d.offerId, d.reasons]));
    expect(byId.get("o-low")?.some((r) => r.includes("不高于下限"))).toBe(true);
    expect(byId.get("o-unknown")?.some((r) => r.includes("未知"))).toBe(true);
    expect(
      byId.get("o-zero-rate")?.includes("佣金率为零，直接排除")
    ).toBe(true);
    expect(
      byId.get("o-zero-product-rate")?.includes("佣金率为零，直接排除")
    ).toBe(true);
  });

  it("库存门：缺货与未知均排除", () => {
    const { dropped } = screenLooseOffers([
      row({ id: "o-out", stock: "out_of_stock" }),
      row({ id: "o-unk", stock: null }),
    ]);
    expect(dropped.map((d) => d.offerId)).toEqual(["o-out", "o-unk"]);
    expect(dropped[0].reasons).toContain("缺货");
    expect(dropped[1].reasons).toContain("库存未知");
  });

  it("需求佐证：无评分无评论无销量排除；商品库评论数可作证据", () => {
    const { qualified, dropped } = screenLooseOffers([
      row({
        id: "o-no-demand",
        rating: null,
        reviewCount: null,
        monthlySales: null,
      }),
      row({
        id: "o-product-reviews",
        rating: null,
        reviewCount: null,
        monthlySales: null,
        productReviewCount: 50,
      }),
    ]);
    expect(qualified.map((q) => q.offerId)).toEqual(["o-product-reviews"]);
    expect(qualified[0].reviewCount).toBe(50);
    expect(dropped[0].reasons).toContain(
      "无购买需求佐证（无评分、无评论、无销量）"
    );
  });

  it("低价流量：不可得排除，未知不排除且标 unknown", () => {
    const { qualified, dropped } = screenLooseOffers([
      row({ id: "o-no-traffic", lowPriceTraffic: "not_winnable" }),
      row({ id: "o-unk-traffic", lowPriceTraffic: null }),
    ]);
    expect(qualified.map((q) => q.offerId)).toEqual(["o-unk-traffic"]);
    expect(qualified[0].lowPriceTraffic).toBe("unknown");
    expect(dropped[0].reasons).toContain("低价流量不可得");
  });

  it("用户排除清单：品牌与品类原样执行", () => {
    const { dropped } = screenLooseOffers(
      [
        row({ id: "o-brand", brandName: "NoBrand" }),
        row({ id: "o-cat", category: "Ice Maker" }),
      ],
      { excludedBrands: ["nobrand"], excludedCategories: ["ice maker"] }
    );
    expect(dropped).toHaveLength(2);
    expect(dropped[0].reasons[0]).toContain("品牌排除");
    expect(dropped[1].reasons[0]).toContain("品类排除");
  });

  it("同品牌只留一条：按单均佣金最高留，被拿掉的写明保留条", () => {
    const { qualified, dropped } = screenLooseOffers([
      row({ id: "o-cheap", name: "Cheap One", commissionValue: 10 }),
      row({ id: "o-rich", name: "Rich One", commissionValue: 40 }),
      row({
        id: "o-nobrand",
        name: "No Brand One",
        brandName: null,
        commissionValue: 15,
      }),
      row({
        id: "o-nobrand-2",
        name: "No Brand Two",
        brandName: null,
        commissionValue: 12,
      }),
    ]);
    expect(qualified.map((q) => q.offerId)).toContain("o-rich");
    expect(qualified.map((q) => q.offerId)).not.toContain("o-cheap");
    // 品牌名为空的不参与去重，两条都留。
    expect(qualified.map((q) => q.offerId)).toContain("o-nobrand");
    expect(qualified.map((q) => q.offerId)).toContain("o-nobrand-2");
    const cheap = dropped.find((d) => d.offerId === "o-cheap");
    expect(cheap?.reasons[0]).toContain("同品牌只留一条");
    expect(cheap?.reasons[0]).toContain("Rich One");
  });

  it("排序：EPC → 单均佣金 → 转化率，未知排后", () => {
    const { qualified } = screenLooseOffers([
      // 各条品牌不同，避免去重干扰排序断言。
      row({ id: "o-comm", brandName: "B1", commissionValue: 90, epcUsd: null }),
      row({
        id: "o-epc",
        brandName: "B2",
        commissionValue: 10,
        epcUsd: 2,
        conversionRate: 1,
      }),
      row({
        id: "o-epc-cr",
        brandName: "B3",
        commissionValue: 10,
        epcUsd: 2,
        conversionRate: 5,
      }),
      row({ id: "o-mid", brandName: "B4", commissionValue: 50, epcUsd: 1 }),
    ]);
    expect(qualified.map((q) => q.offerId)).toEqual([
      "o-epc-cr",
      "o-epc",
      "o-mid",
      "o-comm",
    ]);
  });

  it("零条合格是合法输出，不硬凑", () => {
    const { qualified, dropped, counts } = screenLooseOffers([
      row({ id: "o-only", seasonalEvidence: null }),
    ]);
    expect(qualified).toEqual([]);
    expect(counts).toEqual({ qualified: 0, dropped: 1 });
    expect(dropped[0].reasons).toContain("当季热销依据缺失");
  });
});

describe("resolveEvidence · 实测优先与期望利润", () => {
  it("实测样本达标时优先于人工 EPC / 转化率，并标注来源", () => {
    const { qualified } = screenLooseOffers([
      row({
        id: "o-measured",
        epcUsd: 9,
        conversionRate: 9,
        measured: { epcUsd: 1.5, conversionRate: 2.5, clicks: 800 },
      }),
    ]);
    const q = qualified[0];
    expect(q.epcUsd).toBe(1.5);
    expect(q.conversionRate).toBe(2.5);
    expect(q.epcSource).toBe("measured");
    expect(q.conversionSource).toBe("measured");
    expect(q.measuredClicks).toBe(800);
  });

  it("实测样本不足门槛 → 退回人工证据（不被噪声带偏）", () => {
    const { qualified } = screenLooseOffers([
      row({ id: "o-thin", epcUsd: 9, measured: { epcUsd: 0.1, clicks: 10 } }),
    ]);
    const q = qualified[0];
    expect(q.epcUsd).toBe(9);
    expect(q.epcSource).toBe("assumed");
    expect(q.measuredClicks).toBe(0);
  });

  it("实测与人工都没有 → unknown，不拿 0 冒充", () => {
    const { qualified } = screenLooseOffers([row({ id: "o-none" })]);
    const q = qualified[0];
    expect(q.epcUsd).toBeNull();
    expect(q.epcSource).toBe("unknown");
    expect(q.netEpcUsd).toBeNull();
    expect(q.profitPerClick).toBeNull();
  });

  it("拒单率只认实测：无实测不扣减，有实测按比例扣", () => {
    const noRej = screenLooseOffers([
      row({ id: "o-norej", measured: { epcUsd: 2, clicks: 300 } }),
    ]).qualified[0];
    expect(noRej.rejectionRate).toBeNull();
    expect(noRej.netEpcUsd).toBe(2);

    const withRej = screenLooseOffers([
      row({
        id: "o-rej",
        measured: { epcUsd: 2, rejectionRate: 0.25, clicks: 300 },
      }),
    ]).qualified[0];
    expect(withRej.rejectionRate).toBe(0.25);
    expect(withRej.netEpcUsd).toBe(1.5);
  });

  it("排序：给了 cpcExpected 时按每点击期望利润，而不是 EPC", () => {
    const { qualified } = screenLooseOffers([
      // EPC 高但 CPC 更高 → 每点击亏
      row({
        id: "o-big-epc",
        brandName: "B1",
        commissionValue: 10,
        epcUsd: 5,
        cpcExpected: 6,
      }),
      // EPC 低但成本更低 → 每点击赚
      row({
        id: "o-small-epc",
        brandName: "B2",
        commissionValue: 10,
        epcUsd: 1.2,
        cpcExpected: 0.5,
      }),
    ]);
    expect(qualified.map((q) => q.offerId)).toEqual([
      "o-small-epc",
      "o-big-epc",
    ]);
    expect(qualified[0].profitPerClick).toBeCloseTo(0.7, 6);
    expect(qualified[1].profitPerClick).toBeCloseTo(-1, 6);
  });
});



describe("保本 CVR 与经济学判定", () => {
  it("保本 CVR = CPC ÷ 净EPC；低于 5% 判 viable", () => {
    const q = screenLooseOffers([
      // 净EPC 2.0、CPC 0.08 → 保本 4%
      row({
        id: "o-viable",
        measured: { epcUsd: 2, clicks: 500 },
        cpcExpected: 0.08,
      }),
    ]).qualified[0];
    expect(q.breakevenCvr).toBeCloseTo(4, 6);
    expect(q.economics).toBe("viable");
  });

  it("保本 CVR 在 5%–10% 之间判 marginal", () => {
    const q = screenLooseOffers([
      row({
        id: "o-marginal",
        measured: { epcUsd: 1, clicks: 500 },
        cpcExpected: 0.07,
      }),
    ]).qualified[0];
    expect(q.breakevenCvr).toBeCloseTo(7, 6);
    expect(q.economics).toBe("marginal");
  });

  it("保本 CVR 超过 10% 判 unviable（「筛出来不赚钱」的量化口径）", () => {
    const q = screenLooseOffers([
      // EPC 0.3、CPC 1.2 → 要 400% CVR
      row({
        id: "o-hopeless",
        measured: { epcUsd: 0.3, clicks: 500 },
        cpcExpected: 1.2,
      }),
    ]).qualified[0];
    expect(q.breakevenCvr).toBeCloseTo(400, 6);
    expect(q.economics).toBe("unviable");
  });

  it("缺 CPC 时不判经济性（unknown），不瞎猜", () => {
    const q = screenLooseOffers([
      row({ id: "o-nocpc", measured: { epcUsd: 2, clicks: 500 } }),
    ]).qualified[0];
    expect(q.breakevenCvr).toBeNull();
    expect(q.economics).toBe("unknown");
  });

  it("拒单率会抬高保本 CVR（净EPC 变小）", () => {
    const q = screenLooseOffers([
      row({
        id: "o-rej",
        measured: { epcUsd: 2, rejectionRate: 0.5, clicks: 500 },
        cpcExpected: 0.05,
      }),
    ]).qualified[0];
    // 净EPC 1.0 → 保本 5%
    expect(q.breakevenCvr).toBeCloseTo(5, 6);
    expect(q.economics).toBe("viable");
  });
});
