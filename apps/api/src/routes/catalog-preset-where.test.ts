import { describe, expect, it } from "vitest";
import {
  buildPresetWhere,
  buildProductOrderBy,
  extractProductId,
} from "./catalog.js";

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

describe("extractProductId（主键ID 取数字）", () => {
  it("优先取 rawData.product_id", () => {
    expect(
      extractProductId({ product_id: "62837599", id: "abc" }, "8f3a91")
    ).toBe("62837599");
  });
  it("product_id 非数字时跳过，取数字 externalId", () => {
    expect(extractProductId({ product_id: "hash-xyz" }, "62837598")).toBe(
      "62837598"
    );
  });
  it("JSON 字符串 rawData 也能解析", () => {
    expect(
      extractProductId(JSON.stringify({ productId: 12345 }), "zz")
    ).toBe("12345");
  });
  it("都没有数字 → null", () => {
    expect(extractProductId({ product_id: "hash" }, "8f3a91")).toBeNull();
    expect(extractProductId(null, null)).toBeNull();
  });
});

describe("buildProductOrderBy（autoads 式排序）", () => {
  it("默认主键ID 倒序", () => {
    expect(buildProductOrderBy(undefined)).toEqual([{ externalId: "desc" }]);
    expect(buildProductOrderBy("id_desc")).toEqual([{ externalId: "desc" }]);
    expect(buildProductOrderBy("nonsense")).toEqual([{ externalId: "desc" }]);
  });
  it("各列排序映射正确", () => {
    expect(buildProductOrderBy("price_desc")).toEqual([
      { price: "desc" },
      { externalId: "desc" },
    ]);
    expect(buildProductOrderBy("reviews_asc")).toEqual([
      { reviewCount: "asc" },
      { externalId: "desc" },
    ]);
    expect(buildProductOrderBy("score_desc")).toEqual([
      { recommendationScore: "desc" },
      { externalId: "desc" },
    ]);
    expect(buildProductOrderBy("created_asc")).toEqual([
      { createdAt: "asc" },
      { externalId: "desc" },
    ]);
  });
});
