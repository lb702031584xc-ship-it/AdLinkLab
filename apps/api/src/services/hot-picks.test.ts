/**
 * 可能热销推荐（hot picks）纯函数测试：跨品类排序、无依据不推荐、
 * 0% 不推荐、排除清单仍生效、一品牌一款、原结论打标、零推荐合法。
 */
import { describe, expect, it } from "vitest";
import {
  rankHotPicks,
  type HotPickRow,
} from "./hot-picks.js";

function row(over: Partial<HotPickRow> = {}): HotPickRow {
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
    seasonalEvidence: null,
    stock: null,
    rating: null,
    reviewCount: null,
    monthlySales: null,
    epcUsd: null,
    conversionRate: null,
    lowPriceTraffic: null,
    riskCost: [],
    prescreenVerdict: "go",
    prescreenReason: "",
    ...over,
  };
}

describe("rankHotPicks", () => {
  it("跨品类排序：不按品类过滤，月销在前、其次评论数、其次佣金", () => {
    const { picks } = rankHotPicks([
      row({ id: "o-low", name: "Low", brandName: "BrandA", category: "a", monthlySales: 100, reviewCount: 10, commissionValue: 50 }),
      row({ id: "o-mid", name: "Mid", brandName: "BrandB", category: "b", monthlySales: null, reviewCount: 5000, commissionValue: 30 }),
      row({ id: "o-top", name: "Top", brandName: "BrandC", category: "c", monthlySales: 9000, reviewCount: 5, commissionValue: 5 }),
    ]);
    expect(picks.map((p) => p.offerId)).toEqual(["o-top", "o-low", "o-mid"]);
  });

  it("无依据不推荐：只有佣金、无评论无月销无评分无季节依据", () => {
    const { picks, counts } = rankHotPicks([
      row({ id: "o-none" }),
    ]);
    expect(picks).toEqual([]);
    expect(counts.notRecommended).toBe(1);
  });

  it("0% 不推荐：Offer 费率为零与商品库费率为零都排除", () => {
    const { picks, counts } = rankHotPicks([
      row({ id: "o-rate0", commissionValue: 0, commissionType: "percentage", reviewCount: 100 }),
      row({ id: "o-prod0", productCommissionRate: 0, reviewCount: 100 }),
    ]);
    expect(picks).toEqual([]);
    expect(counts.notRecommended).toBe(2);
  });

  it("排除清单仍生效：品牌与品类排除都不进榜", () => {
    const { picks, counts } = rankHotPicks(
      [
        row({ id: "o-b", brandName: "NoBrand", reviewCount: 100 }),
        row({ id: "o-c", brandName: "OkBrand", category: "nope", reviewCount: 100 }),
        row({ id: "o-ok", brandName: "OkBrand", category: "fine", reviewCount: 100 }),
      ],
      { excludedBrands: ["nobrand"], excludedCategories: ["nope"] }
    );
    expect(picks.map((p) => p.offerId)).toEqual(["o-ok"]);
    expect(counts.notRecommended).toBe(2);
  });

  it("同一品牌只推荐一款：排序首位胜出，其余进 droppedByBrand 并注明保留款", () => {
    const { picks, droppedByBrand, counts } = rankHotPicks([
      row({ id: "o-weak", name: "Weak", brandName: "Same", monthlySales: 10, commissionValue: 99 }),
      row({ id: "o-strong", name: "Strong", brandName: "Same", monthlySales: 8000, commissionValue: 5 }),
      row({ id: "o-nobrand", name: "NoBrand", brandName: null, reviewCount: 50 }),
    ]);
    expect(picks.map((p) => p.offerId)).toEqual(["o-strong", "o-nobrand"]);
    expect(droppedByBrand).toHaveLength(1);
    expect(droppedByBrand[0].offerId).toBe("o-weak");
    expect(droppedByBrand[0].reasons[0]).toContain("Strong");
    expect(counts.droppedByBrand).toBe(1);
  });

  it("原结论打标：判停进榜写明推荐不改变结论；禁令只进风险栏不排除", () => {
    const { picks } = rankHotPicks([
      row({
        id: "o-stop",
        prescreenVerdict: "stop",
        prescreenReason: "广告数为 0",
        riskCost: ["禁品牌词竞价"],
        reviewCount: 200,
      }),
    ]);
    expect(picks).toHaveLength(1);
    expect(picks[0].verdictNote).toContain("原初筛判停");
    expect(picks[0].verdictNote).toContain("不改变判停结论");
    expect(picks[0].riskCost).toEqual(["禁品牌词竞价"]);
  });

  it("推荐理由全部由具体数值构成", () => {
    const { picks } = rankHotPicks([
      row({
        id: "o-r",
        monthlySales: 3000,
        reviewCount: 120,
        rating: 4.5,
        seasonalEvidence: "冬季取暖旺季",
        commissionValue: 18.9,
      }),
    ]);
    expect(picks[0].reasons).toEqual([
      "月销 3000+",
      "120 评论",
      "评分 4.5",
      "当季热销依据：冬季取暖旺季",
      "单均佣金 $18.90",
    ]);
  });

  it("零条推荐合法：空输入与全不推荐都不抛错、不硬凑", () => {
    expect(rankHotPicks([]).picks).toEqual([]);
    const r = rankHotPicks([row({ id: "o-x" })]);
    expect(r.picks).toEqual([]);
    expect(r.counts).toEqual({ picks: 0, droppedByBrand: 0, notRecommended: 1 });
  });

  it("单均佣金算不出不推荐", () => {
    const { picks } = rankHotPicks([
      row({ id: "o-unk", commissionValue: null, commissionType: null, reviewCount: 100 }),
    ]);
    expect(picks).toEqual([]);
  });
});
