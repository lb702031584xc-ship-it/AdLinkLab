/**
 * 商品库挑选器测试：经济性门、品牌去重、排序。
 */
import { describe, expect, it } from "vitest";
import { pickFromCatalog, type CatalogCandidate } from "./catalog-pick.js";

const c = (over: Partial<CatalogCandidate> = {}): CatalogCandidate => ({
  productId: "p-1",
  name: "Widget",
  brand: "BrandA",
  priceUsd: 200,
  payoutUsd: 20,
  inStock: true,
  ...over,
});

describe("pickFromCatalog", () => {
  it("佣金低于门槛 → 砍", () => {
    const r = pickFromCatalog([c({ payoutUsd: 8 })]);
    expect(r.picked).toHaveLength(0);
    expect(r.dropped[0].code).toBe("BELOW_MIN_PAYOUT");
  });

  it("佣金未知 → 砍（不猜）", () => {
    const r = pickFromCatalog([c({ payoutUsd: null })]);
    expect(r.dropped[0].code).toBe("PAYOUT_UNKNOWN");
  });

  it("保本 CPC 低于类目 CPC → 砍", () => {
    // 20 × 0.85 × 0.95 × 2.5% = 0.4038 < 0.5
    const r = pickFromCatalog([c()], { categoryCpcUsd: 0.5 });
    expect(r.picked).toHaveLength(0);
    expect(r.dropped[0].code).toBe("CANNOT_COVER_CPC");
    expect(r.dropped[0].reason).toContain("无法覆盖");
  });

  it("保本 CPC 高于类目 CPC → 保留（按预期佣金算）", () => {
    // 20 × 0.6(折损) × 0.8075 × 2.5% = 0.2423
    const r = pickFromCatalog([c()], { categoryCpcUsd: 0.2 });
    expect(r.picked).toHaveLength(1);
    expect(r.picked[0].breakevenCpcUsd).toBeCloseTo(0.2423, 4);
    expect(r.picked[0].expectedPayoutUsd).toBeCloseTo(12, 2);
  });

  it("预期佣金 = 页面佣金 × 0.6，保本线随之下降", () => {
    const r = pickFromCatalog([c({ payoutUsd: 100 })], { categoryCpcUsd: 0.2 });
    expect(r.picked[0].payoutUsd).toBe(100);
    expect(r.picked[0].expectedPayoutUsd).toBe(60);
    // 100 × 0.6 × 0.8075 × 2.5% = 1.2113
    expect(r.picked[0].breakevenCpcUsd).toBeCloseTo(1.2113, 3);
  });

  it("不给类目 CPC 时跳过可行性判断", () => {
    const r = pickFromCatalog([c()]);
    expect(r.picked).toHaveLength(1);
  });

  it("缺货 → 砍", () => {
    const r = pickFromCatalog([c({ inStock: false })]);
    expect(r.dropped[0].code).toBe("OUT_OF_STOCK");
  });

  it("同品牌只留 payout 最高的一个", () => {
    const r = pickFromCatalog([
      c({ productId: "a", brand: "VEVOR", payoutUsd: 20, name: "Heater" }),
      c({ productId: "b", brand: "VEVOR", payoutUsd: 26, name: "Sealer" }),
    ]);
    expect(r.picked.map((x) => x.productId)).toEqual(["b"]);
    expect(r.dropped[0].productId).toBe("a");
    expect(r.dropped[0].code).toBe("BRAND_DEDUP");
  });

  it("不同品牌各留一个", () => {
    const r = pickFromCatalog([
      c({ productId: "a", brand: "VEVOR", payoutUsd: 26 }),
      c({ productId: "b", brand: "Roborock", payoutUsd: 30 }),
    ]);
    expect(r.picked).toHaveLength(2);
  });

  it("品牌为空的不参与去重", () => {
    const r = pickFromCatalog([
      c({ productId: "a", brand: null, payoutUsd: 20 }),
      c({ productId: "b", brand: null, payoutUsd: 15 }),
    ]);
    expect(r.picked).toHaveLength(2);
  });

  it("结果按 payout 降序", () => {
    const r = pickFromCatalog([
      c({ productId: "low", brand: "A", payoutUsd: 15 }),
      c({ productId: "high", brand: "B", payoutUsd: 40 }),
    ]);
    expect(r.picked.map((x) => x.productId)).toEqual(["high", "low"]);
  });

  it("超出上限的部分进 dropped", () => {
    const r = pickFromCatalog(
      [
        c({ productId: "a", brand: "A", payoutUsd: 30 }),
        c({ productId: "b", brand: "B", payoutUsd: 20 }),
      ],
      { limit: 1 }
    );
    expect(r.picked).toHaveLength(1);
    expect(r.dropped.some((d) => d.code === "OVER_LIMIT")).toBe(true);
  });

  it("空库时给出提示", () => {
    const r = pickFromCatalog([]);
    expect(r.picked).toHaveLength(0);
    expect(r.notes.join("")).toContain("商品库为空");
  });

  it("全被门槛砍时指出主因", () => {
    const r = pickFromCatalog([
      c({ productId: "a", payoutUsd: 5 }),
      c({ productId: "b", payoutUsd: 6 }),
    ]);
    expect(r.summary.topDropCode).toBe("BELOW_MIN_PAYOUT");
    expect(r.summary.topDropCount).toBe(2);
    expect(r.notes.join("")).toContain("换更高客单");
  });
});
