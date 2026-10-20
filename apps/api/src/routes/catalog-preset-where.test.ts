import { describe, expect, it } from "vitest";
import { buildPresetWhere } from "./catalog.js";

describe("buildPresetWhere（筛选预设自动过滤）", () => {
  it("空预设 → 不过滤", () => {
    expect(buildPresetWhere({})).toEqual({});
    expect(
      buildPresetWhere({
        minReviews: 0,
        minCommissionAmount: 0,
        minCommissionRate: null,
        minPrice: null,
        maxPrice: null,
        minScore: null,
      })
    ).toEqual({});
  });

  it("阈值>0 → 生成 gte 条件，null 值不拦（OR null）", () => {
    const w = buildPresetWhere({ minReviews: 100, minCommissionAmount: 8 }) as {
      AND: Array<Record<string, unknown>>;
    };
    expect(w.AND).toHaveLength(2);
    expect(w.AND[0]).toEqual({
      OR: [{ reviewCount: { gte: 100 } }, { reviewCount: null }],
    });
    expect(w.AND[1]).toEqual({
      OR: [{ commissionAmount: { gte: 8 } }, { commissionAmount: null }],
    });
  });

  it("价格区间上下限同时生效", () => {
    const w = buildPresetWhere({ minPrice: 80, maxPrice: 150 }) as {
      AND: Array<Record<string, unknown>>;
    };
    expect(w.AND).toEqual([
      { OR: [{ price: { gte: 80 } }, { price: null }] },
      { OR: [{ price: { lte: 150 } }, { price: null }] },
    ]);
  });

  it("minScore 映射到 recommendationScore", () => {
    const w = buildPresetWhere({ minScore: 60 }) as {
      AND: Array<Record<string, unknown>>;
    };
    expect(w.AND).toEqual([
      { OR: [{ recommendationScore: { gte: 60 } }, { recommendationScore: null }] },
    ]);
  });
});
