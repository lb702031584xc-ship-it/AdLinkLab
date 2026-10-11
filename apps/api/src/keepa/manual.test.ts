/**
 * Keepa 手动输入数字判定单测：
 * - 映射计算：跳水品 kill / 平稳品 pass / 介于两者 unknown
 * - 边界值：跌幅恰 25% / rankRatio 恰 10 → 不 kill（严格大于）
 * - 非法输入：负数 / 最低价>最高价 / 缺字段 → 抛错
 * - reviews90dAgo 可选：不填时不参与 pass 判定
 */
import { describe, expect, it } from "vitest";
import { ValidationError } from "@adlinklab/shared";
import {
  evaluateManualNumbers,
  parseManualNumbers,
  type ManualNumbersInput,
} from "./rules.js";

const BASE: ManualNumbersInput = {
  amazonPriceNow: 100,
  amazonPrice30dAgo: 100,
  priceLow90d: 96,
  priceHigh90d: 104,
  rankNow: 50,
  rankBest90d: 45,
  rankWorst90d: 60,
  reviewsNow: 700,
  reviews90dAgo: 500,
};

describe("evaluateManualNumbers", () => {
  it("跳水品：30 天跌幅 30% → kill", () => {
    const out = evaluateManualNumbers({ ...BASE, amazonPrice30dAgo: 100, amazonPriceNow: 70 });
    expect(out.verdict).toBe("kill");
    expect(out.metrics.priceDrop30dPct).toBeCloseTo(30, 0);
    expect(out.reasons.some((r) => r.code === "price_drop")).toBe(true);
  });

  it("排名大起大落：worst/best=16 → kill", () => {
    const out = evaluateManualNumbers({ ...BASE, rankBest90d: 50, rankWorst90d: 800 });
    expect(out.verdict).toBe("kill");
    expect(out.reasons.some((r) => r.code === "rank_swing")).toBe(true);
  });

  it("平稳品：波动小、排名好、评论增长 → pass", () => {
    const out = evaluateManualNumbers(BASE);
    expect(out.verdict).toBe("pass");
    expect(out.metrics.priceVolatility90dPct).toBeLessThan(15);
  });

  it("不填 90 天前评论数：仍可 pass（该项记 unknown 不参与判定）", () => {
    const out = evaluateManualNumbers({ ...BASE, reviews90dAgo: null });
    expect(out.verdict).toBe("pass");
    expect(out.metrics.reviewGrowth90d).toBeNull();
  });

  it("评论零增长 → 不 pass（降级 unknown）", () => {
    const out = evaluateManualNumbers({ ...BASE, reviews90dAgo: 700 });
    expect(out.verdict).toBe("unknown");
  });

  it("介于两者之间 → unknown（建议人工复核）", () => {
    // 波动 20%（≥15 未达 pass，跌幅 0 未达 kill）
    const out = evaluateManualNumbers({ ...BASE, priceLow90d: 90, priceHigh90d: 110 });
    expect(out.verdict).toBe("unknown");
    expect(out.reasons[0].detail).toContain("人工复核");
  });

  it("边界：跌幅恰好 25% → 不 kill", () => {
    const out = evaluateManualNumbers({ ...BASE, amazonPrice30dAgo: 100, amazonPriceNow: 75 });
    expect(out.metrics.priceDrop30dPct).toBeCloseTo(25, 0);
    expect(out.verdict).not.toBe("kill");
  });

  it("边界：rankRatio 恰好 10 → 不 kill", () => {
    const out = evaluateManualNumbers({ ...BASE, rankBest90d: 10, rankWorst90d: 100 });
    expect(out.metrics.rankRatio90d).toBeCloseTo(10, 0);
    expect(out.verdict).not.toBe("kill");
  });

  it("30 天前价格为 0 → 跌幅记 null，不崩", () => {
    const out = evaluateManualNumbers({ ...BASE, amazonPrice30dAgo: 0 });
    expect(out.metrics.priceDrop30dPct).toBeNull();
    expect(["pass", "unknown"]).toContain(out.verdict);
  });
});

describe("parseManualNumbers", () => {
  it("合法输入解析通过（含可选字段缺省）", () => {
    const out = parseManualNumbers({
      amazonPriceNow: "99.5",
      amazonPrice30dAgo: 100,
      priceLow90d: 90,
      priceHigh90d: 110,
      rankNow: 50,
      rankBest90d: 40,
      rankWorst90d: 80,
      reviewsNow: 1000,
    });
    expect(out.amazonPriceNow).toBeCloseTo(99.5, 1);
    expect(out.reviews90dAgo).toBeNull();
  });

  it("负数 → 400", () => {
    expect(() => parseManualNumbers({ ...BASE, rankNow: -1 })).toThrow(ValidationError);
  });

  it("最低价高于最高价 → 400", () => {
    expect(() =>
      parseManualNumbers({ ...BASE, priceLow90d: 120, priceHigh90d: 100 })
    ).toThrow(/最低价不能高于最高价/);
  });

  it("缺字段 → 400", () => {
    const { rankNow: _drop, ...rest } = BASE;
    expect(() => parseManualNumbers(rest)).toThrow(ValidationError);
  });

  it("非数字字符串 → 400", () => {
    expect(() => parseManualNumbers({ ...BASE, reviewsNow: "abc" })).toThrow(ValidationError);
  });

  it("全角数字（中文输入法）→ 正常解析", () => {
    const out = parseManualNumbers({
      ...BASE,
      amazonPriceNow: "１９９",
      priceLow90d: "９６．５",
    });
    expect(out.amazonPriceNow).toBe(199);
    expect(out.priceLow90d).toBeCloseTo(96.5, 1);
  });

  it("空 body → 400", () => {
    expect(() => parseManualNumbers(null)).toThrow(ValidationError);
  });
});
