/**
 * 关键词推荐纯函数测试：保本 CPC、意图分类、品牌词禁令、核心词提取。
 */
import { describe, expect, it } from "vitest";
import {
  buildLongTailCandidates,
  extractCore,
  recommendKeywords,
  splitCoreAndSpecs,
} from "./keyword-recommend.js";

describe("extractCore", () => {
  it("剥掉品牌词，保留核心词", () => {
    expect(extractCore("VEYOR Diesel Heater 8KW", "VEYOR")).toBe(
      "diesel heater 8kw"
    );
  });

  it("名字里没有品牌时原样归一化", () => {
    expect(extractCore("Diesel  Heater!", null)).toBe("diesel heater");
  });

  it("剥完为空时回退到原名", () => {
    expect(extractCore("VEYOR", "VEYOR")).toBe("veyor");
  });
});

describe("recommendKeywords", () => {
  const base = {
    offerName: "VEYOR Diesel Heater 8KW",
    brandName: "VEYOR",
    payoutUsd: 20,
  };

  it("保本 CPC = 净 payout × 目标 CVR", () => {
    const r = recommendKeywords(base);
    // 20 × 0.85 × 0.95 = 16.15；× 2.5% = 0.40375 → 0.4038
    expect(r.breakeven?.netPayoutUsd).toBe(16.15);
    expect(r.maxCpcUsd).toBe(0.4038);
    expect(r.core).toBe("diesel heater 8kw");
  });

  it("成交型词可测，信息型词给 skip", () => {
    const r = recommendKeywords(base);
    const buy = r.suggestions.find((s) => s.keyword === "buy diesel heater 8kw");
    const info = r.suggestions.find(
      (s) => s.keyword === "how to use diesel heater 8kw"
    );
    expect(buy?.intent).toBe("transactional");
    expect(buy?.verdict).toBe("test");
    expect(info?.intent).toBe("informational");
    expect(info?.verdict).toBe("skip");
  });

  it("比价词标注 CVR 偏低但仍可测", () => {
    const r = recommendKeywords(base);
    const best = r.suggestions.find((s) => s.keyword === "best diesel heater 8kw");
    expect(best?.intent).toBe("commercial");
    expect(best?.verdict).toBe("test");
    expect(best?.note).toContain("比价");
  });

  it("排序：可测的在前，信息型垫底", () => {
    const r = recommendKeywords(base);
    const firstSkip = r.suggestions.findIndex((s) => s.verdict !== "test");
    if (firstSkip >= 0) {
      expect(
        r.suggestions.slice(firstSkip).every((s) => s.verdict !== "test")
      ).toBe(true);
    }
  });

  it("禁止品牌词时不生成品牌词，并写明原因", () => {
    const r = recommendKeywords({ ...base, brandBiddingForbidden: true });
    expect(r.suggestions.some((s) => s.keyword.includes("veyor"))).toBe(false);
    expect(
      r.skipped.some((s) => s.keyword.includes("veyor") && s.reason.includes("禁止"))
    ).toBe(true);
  });

  it("允许时生成品牌词，且归为成交型", () => {
    const r = recommendKeywords({ ...base, brandBiddingForbidden: false });
    const brandKw = r.suggestions.find((s) => s.keyword === "veyor diesel heater 8kw");
    expect(brandKw?.intent).toBe("transactional");
  });

  it("佣金未知时全部 blocked，不假装能算", () => {
    const r = recommendKeywords({ ...base, payoutUsd: null });
    expect(r.maxCpcUsd).toBeNull();
    expect(r.breakeven).toBeNull();
    expect(r.suggestions.length).toBeGreaterThan(0);
    expect(r.suggestions.every((s) => s.verdict === "blocked")).toBe(true);
  });

  it("条数上限生效，多余的进 skipped", () => {
    const r = recommendKeywords({ ...base, maxKeywords: 3 });
    expect(r.suggestions).toHaveLength(3);
    expect(r.skipped.some((s) => s.reason.includes("超出上限"))).toBe(true);
  });

  it("目标 CVR 可覆盖，保本 CPC 随之变化", () => {
    const r = recommendKeywords({ ...base, targetCvrPct: 5 });
    expect(r.maxCpcUsd).toBe(0.8075);
  });
});


describe("长尾候选（规格词重组）", () => {
  it("从产品名里拆出规格词", () => {
    const r = splitCoreAndSpecs("chamber vacuum sealer 260w 10.2 inch");
    expect(r.base).toBe("chamber vacuum sealer");
    expect(r.specs).toEqual(["260w", "10.2 inch"]);
  });

  it("生成 基础词+规格 与 品牌+基础词+规格", () => {
    const r = buildLongTailCandidates({
      core: "chamber vacuum sealer 260w",
      brandName: "VEVOR",
    });
    expect(r.some((x) => x.keyword === "chamber vacuum sealer 260w")).toBe(true);
    expect(
      r.some((x) => x.keyword === "vevor chamber vacuum sealer 260w")
    ).toBe(true);
  });

  it("没有规格词时返回空（不硬造）", () => {
    expect(buildLongTailCandidates({ core: "air purifier" })).toEqual([]);
  });

  it("结果去重", () => {
    const r = buildLongTailCandidates({
      core: "heater 8kw 8kw",
      brandName: null,
    });
    const kws = r.map((x) => x.keyword);
    expect(new Set(kws).size).toBe(kws.length);
  });

  it("推荐结果里带上 longTail", () => {
    const r = recommendKeywords({
      offerName: "VEVOR Chamber Vacuum Sealer 260W 10.2-Inch",
      brandName: "VEVOR",
      payoutUsd: 26,
    });
    expect(r.longTail.length).toBeGreaterThan(0);
    expect(r.longTail[0].keyword).toContain("chamber vacuum sealer");
  });
});
