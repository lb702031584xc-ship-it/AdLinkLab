import { describe, expect, it } from "vitest";
import {
  buildAdCountWhere,
  buildCountryWhere,
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

describe("buildAdCountWhere（广告投放数量过滤）", () => {
  it("无参数 → 不过滤", () => {
    expect(buildAdCountWhere({})).toEqual({});
    expect(buildAdCountWhere({ minAdCount: 0, hasAds: "0" })).toEqual({});
    expect(buildAdCountWhere({ minAdCount: "abc" })).toEqual({});
  });

  it("minAdCount → adCount gte（小数向下取整）", () => {
    expect(buildAdCountWhere({ minAdCount: "5" })).toEqual({
      adCount: { gte: 5 },
    });
    expect(buildAdCountWhere({ minAdCount: 3.9 })).toEqual({
      adCount: { gte: 3 },
    });
  });

  it("hasAds=1/true → adCount >= 1", () => {
    expect(buildAdCountWhere({ hasAds: "1" })).toEqual({
      adCount: { gte: 1 },
    });
    expect(buildAdCountWhere({ hasAds: "true" })).toEqual({
      adCount: { gte: 1 },
    });
  });

  it("两者同时给 → 取更严的一个", () => {
    expect(buildAdCountWhere({ minAdCount: 10, hasAds: "1" })).toEqual({
      adCount: { gte: 10 },
    });
    expect(buildAdCountWhere({ minAdCount: 0, hasAds: "1" })).toEqual({
      adCount: { gte: 1 },
    });
  });

  it("maxAdCount → adCount lte（区间上限，单独给也生效）", () => {
    expect(buildAdCountWhere({ maxAdCount: 20 })).toEqual({
      adCount: { lte: 20 },
    });
    expect(buildAdCountWhere({ maxAdCount: "20" })).toEqual({
      adCount: { lte: 20 },
    });
    expect(buildAdCountWhere({ maxAdCount: 0 })).toEqual({
      adCount: { lte: 0 },
    });
  });

  it("甜蜜点区间：min=1 + max=20 → { gte: 1, lte: 20 }", () => {
    expect(buildAdCountWhere({ minAdCount: 1, maxAdCount: 20 })).toEqual({
      adCount: { gte: 1, lte: 20 },
    });
    expect(buildAdCountWhere({ hasAds: "1", maxAdCount: 20 })).toEqual({
      adCount: { gte: 1, lte: 20 },
    });
  });

  it("maxAdCount 非法值（负数/非数字）→ 忽略上限", () => {
    expect(buildAdCountWhere({ maxAdCount: -1 })).toEqual({});
    expect(buildAdCountWhere({ maxAdCount: "abc" })).toEqual({});
    expect(buildAdCountWhere({ minAdCount: 2, maxAdCount: -5 })).toEqual({
      adCount: { gte: 2 },
    });
  });
});

describe("buildCountryWhere（投放国家过滤）", () => {
  it("无参数/非法值 → 不过滤", () => {
    expect(buildCountryWhere({})).toEqual({});
    expect(buildCountryWhere({ country: "" })).toEqual({});
    expect(buildCountryWhere({ country: "USA" })).toEqual({});
    expect(buildCountryWhere({ country: "C1" })).toEqual({});
    expect(buildCountryWhere({ country: 12 })).toEqual({});
  });

  it("单个国家 → 等值过滤（小写自动转大写）", () => {
    expect(buildCountryWhere({ country: "ca" })).toEqual({
      countryCode: "CA",
    });
  });

  it("多个国家 → in 过滤，去重且忽略非法片段", () => {
    expect(buildCountryWhere({ country: "US, ca ,US,x" })).toEqual({
      countryCode: { in: ["US", "CA"] },
    });
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
