import { describe, expect, it } from "vitest";
import { generateRuleIdeas, ruleScoreFor } from "./keyword-ideas.js";

describe("P1-10 generateRuleIdeas", () => {
  it("品牌 + 后缀 → brand-suffix，70 分起；来源固定规则生成；搜索量/竞争永远 null", () => {
    const ideas = generateRuleIdeas({ seeds: ["dive knife"], brandTerms: ["wenoker"], domain: "" });
    const brand = ideas.find((i) => i.kind === "brand-suffix");
    expect(brand).toBeDefined();
    expect(brand!.source).toBe("rule-generated");
    expect(brand!.avgMonthlySearches).toBeNull();
    expect(brand!.competition).toBeNull();
    expect(brand!.ruleScore).toBeGreaterThanOrEqual(70);
    expect(brand!.brandCoverage).toBe(1);
    expect(brand!.brandCoverageWarn).toBe(false);
  });

  it("域名相关性加成与 web 口径一致（关键词含域名 token 加分）", () => {
    expect(ruleScoreFor("green vines review", "brand-suffix", "green-vines.com")).toBeGreaterThan(70);
    expect(ruleScoreFor("best running shoes", "brand-suffix", "green-vines.com")).toBe(70);
  });

  it("种子两两组合 → seed-combo；种子+后缀 → token-suffix；去重", () => {
    const ideas = generateRuleIdeas({ seeds: ["dive knife", "titanium"], brandTerms: [] });
    expect(ideas.some((i) => i.kind === "seed-combo")).toBe(true);
    expect(ideas.some((i) => i.kind === "token-suffix")).toBe(true);
    const keys = ideas.map((i) => i.keyword.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("品牌覆盖 <0.6 → 警告（非门禁）；无品牌词 → 覆盖 null", () => {
    const ideas = generateRuleIdeas({ seeds: ["running shoes"], brandTerms: ["wenoker"], domain: "" });
    const token = ideas.find((i) => i.kind === "token-suffix");
    expect(token!.brandCoverage).not.toBeNull();
    expect(token!.brandCoverage!).toBeLessThan(0.6);
    expect(token!.brandCoverageWarn).toBe(true);
    const noBrand = generateRuleIdeas({ seeds: ["running shoes"], brandTerms: [] });
    expect(noBrand[0]!.brandCoverage).toBeNull();
  });

  it("空种子 → 空列表（不编造）", () => {
    expect(generateRuleIdeas({ seeds: [] })).toEqual([]);
  });
});
