import { describe, expect, it } from "vitest";
import {
  ruleScore,
  brandCoverage,
  brandCoverageWarn,
  RULE_BASE_SCORES,
} from "./rule-score.js";

describe("P1-10 rule-score", () => {
  it("基础分：brand-suffix 70 / seed-combo 55 / synonym 50 / token-suffix 45", () => {
    expect(RULE_BASE_SCORES["brand-suffix"]).toBe(70);
    expect(RULE_BASE_SCORES["seed-combo"]).toBe(55);
    expect(RULE_BASE_SCORES.synonym).toBe(50);
    expect(RULE_BASE_SCORES["token-suffix"]).toBe(45);
  });

  it("域名相关性加成：关键词含域名 token 时加分，不含时不加", () => {
    // 域名 green-vines.com，关键词含 green → Jaccard>0 → >70；无关词 → 70
    const withDomain = ruleScore("green vines review", "brand-suffix", "green-vines.com");
    const without = ruleScore("best running shoes", "brand-suffix", "green-vines.com");
    expect(withDomain).not.toBeNull();
    expect(without).toBe(70);
    expect(withDomain!).toBeGreaterThan(70);
    expect(withDomain!).toBeLessThanOrEqual(100);
  });

  it("空关键词 → null（不编分）", () => {
    expect(ruleScore("  ", "brand-suffix", "example.com")).toBeNull();
  });

  it("品牌覆盖：别名精确匹配 = 1.0；无关词 < 0.6 → 警告", () => {
    expect(brandCoverage("wenoker dive knife", ["wenoker"])).toBe(1);
    const low = brandCoverage("best running shoes", ["wenoker"]);
    expect(low).toBeLessThan(0.6);
    expect(brandCoverageWarn(low)).toBe(true);
    expect(brandCoverageWarn(1)).toBe(false);
  });
});
