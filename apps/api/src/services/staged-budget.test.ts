import { describe, expect, it } from "vitest";
import {
  computeTestingPhase,
  parseScalingPhase,
  parseTestingPhase,
  isDirectBudgetIncreaseCopy,
  DEFAULT_TEST_DAILY_BUDGET,
} from "./staged-budget.js";

describe("P1-4 staged budget", () => {
  it("测试期日预算 = 盈亏平衡 CPA × 预期日转化数", () => {
    // CPA $25 × 2 转化/天 = $50/天；7 天共 $350；CVR 2% → 700 点击
    const out = computeTestingPhase({
      breakevenCpa: 25,
      expectedCvr: 0.02,
      expectedDailyConversions: 2,
      durationDays: 7,
    });
    expect(out).toEqual({
      dailyBudget: 50,
      totalBudget: 350,
      expectedClicks: 700,
      expectedConversions: 14,
      durationDays: 7,
    });
  });

  it("非法输入 → null（不编默认值）", () => {
    expect(
      computeTestingPhase({ breakevenCpa: -1, expectedCvr: 0.02, expectedDailyConversions: 2 })
    ).toBeNull();
    expect(
      computeTestingPhase({ breakevenCpa: 25, expectedCvr: 0, expectedDailyConversions: 2 })
    ).toBeNull();
  });

  it("默认测试期日预算为 $10（讲师测试期默认值）", () => {
    expect(DEFAULT_TEST_DAILY_BUDGET).toBe(10);
  });

  it("parseTestingPhase / parseScalingPhase 校验非法字段", () => {
    expect(() =>
      parseTestingPhase({ dailyBudget: -1, totalBudget: 0, expectedClicks: 0, expectedConversions: 0, durationDays: 7 })
    ).toThrow();
    expect(() =>
      parseScalingPhase({ triggerRoas: 2, dailyBudget: 10, maxDailyBudget: 30 })
    ).not.toThrow();
  });

  it("“直接提预算扩量”口径被识别为违规文案", () => {
    expect(isDirectBudgetIncreaseCopy("盈利后直接提预算扩量")).toBe(true);
    expect(isDirectBudgetIncreaseCopy("扩量：上新广告系列、预算不变、上到新 ADS")).toBe(false);
  });
});
