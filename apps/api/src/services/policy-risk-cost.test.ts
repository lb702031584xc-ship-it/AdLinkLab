/**
 * riskCost 共享映射测试（2026-10-25）：与 Offer 一键初筛上线时的内联
 * 实现一字一致——PPC/SEARCH_ADS→禁付费搜索（SEM）、BRAND_BIDDING→
 * 禁品牌词竞价、DIRECT_LINK→禁直链；其余规则不进栏。
 */
import { describe, expect, it } from "vitest";
import { riskCostFromPolicyRules } from "./policy-risk-cost.js";

describe("riskCostFromPolicyRules", () => {
  it("三项 FORBIDDEN 各自映射", () => {
    expect(riskCostFromPolicyRules({ PPC: "FORBIDDEN" })).toEqual([
      "禁付费搜索（SEM）",
    ]);
    expect(riskCostFromPolicyRules({ SEARCH_ADS: "FORBIDDEN" })).toEqual([
      "禁付费搜索（SEM）",
    ]);
    expect(riskCostFromPolicyRules({ BRAND_BIDDING: "FORBIDDEN" })).toEqual([
      "禁品牌词竞价",
    ]);
    expect(riskCostFromPolicyRules({ DIRECT_LINK: "FORBIDDEN" })).toEqual([
      "禁直链",
    ]);
  });

  it("组合：顺序固定为 SEM → 品牌词 → 直链", () => {
    expect(
      riskCostFromPolicyRules({
        DIRECT_LINK: "FORBIDDEN",
        BRAND_BIDDING: "FORBIDDEN",
        PPC: "FORBIDDEN",
      })
    ).toEqual(["禁付费搜索（SEM）", "禁品牌词竞价", "禁直链"]);
  });

  it("PPC 与 SEARCH_ADS 同时 FORBIDDEN 只记一条（不重复）", () => {
    expect(
      riskCostFromPolicyRules({ PPC: "FORBIDDEN", SEARCH_ADS: "FORBIDDEN" })
    ).toEqual(["禁付费搜索（SEM）"]);
  });

  it("ALLOWED / UNKNOWN / REQUIRED 不进栏", () => {
    expect(
      riskCostFromPolicyRules({
        PPC: "ALLOWED",
        BRAND_BIDDING: "UNKNOWN",
        DIRECT_LINK: "REQUIRED",
        EMAIL: "FORBIDDEN",
      })
    ).toEqual([]);
  });

  it("空 rules / null / 非对象 → 空数组", () => {
    expect(riskCostFromPolicyRules({})).toEqual([]);
    expect(riskCostFromPolicyRules(null)).toEqual([]);
    expect(riskCostFromPolicyRules(undefined)).toEqual([]);
    expect(riskCostFromPolicyRules("FORBIDDEN")).toEqual([]);
  });
});
