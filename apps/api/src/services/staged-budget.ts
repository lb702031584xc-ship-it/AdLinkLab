/**
 * P1-4：分阶段预算（纯函数，供 API 校验 + Web 展示共用口径）。
 *
 * 测试期：日预算 = 盈亏平衡 CPA × 预期日转化数（代码算，不靠 LLM 口头算）。
 * 初始日预算默认值 10 美元/天（讲师测试期默认值，可配置；非平台官方标准）。
 * 扩量口径：上新广告系列、预算不变、上到新/不同 ADS——绝不“直接提预算扩量”
 * （同一系列直接提预算会重置学习期；扩量文案必须用“上新系列”口径）。
 */

export const DEFAULT_TEST_DAILY_BUDGET = 10;
export const DEFAULT_TEST_DURATION_DAYS = 7;

export interface TestingPhase {
  dailyBudget: number;
  totalBudget: number;
  expectedClicks: number;
  expectedConversions: number;
  durationDays: number;
}

export interface ScalingPhase {
  /** 触发扩量的 ROAS（>= 该值才考虑上新系列）。 */
  triggerRoas: number;
  /** 新系列日预算（扩量时预算不变 = 等于测试期日预算）。 */
  dailyBudget: number;
  /** 新系列日预算上限。 */
  maxDailyBudget: number;
}

export interface ComputeTestingPhaseInput {
  /** 盈亏平衡 CPA（= payout / (1 + 目标 ROI)，与 K3 口径一致）。 */
  breakevenCpa: number;
  /** 预期转化率（0–1），用于换算预期点击数。 */
  expectedCvr: number;
  /** 预期每日转化数。 */
  expectedDailyConversions: number;
  durationDays?: number;
}

/**
 * 测试期预算 = 盈亏平衡 CPA × 预期日转化数 × 天数。
 * 输入非法 → null（调用方报错，不编默认值）。
 */
export function computeTestingPhase(input: ComputeTestingPhaseInput): TestingPhase | null {
  const { breakevenCpa, expectedCvr, expectedDailyConversions } = input;
  const durationDays = input.durationDays ?? DEFAULT_TEST_DURATION_DAYS;
  if (
    !Number.isFinite(breakevenCpa) || breakevenCpa <= 0 ||
    !Number.isFinite(expectedCvr) || expectedCvr <= 0 || expectedCvr > 1 ||
    !Number.isFinite(expectedDailyConversions) || expectedDailyConversions <= 0 ||
    !Number.isFinite(durationDays) || durationDays <= 0
  ) {
    return null;
  }
  const dailyBudget = breakevenCpa * expectedDailyConversions;
  const expectedConversions = expectedDailyConversions * durationDays;
  const expectedClicks = expectedConversions / expectedCvr;
  return {
    dailyBudget: Math.round(dailyBudget * 100) / 100,
    totalBudget: Math.round(dailyBudget * durationDays * 100) / 100,
    expectedClicks: Math.round(expectedClicks * 100) / 100,
    expectedConversions: Math.round(expectedConversions * 100) / 100,
    durationDays,
  };
}

/** 校验 + 规范化 PATCH 入参的 testingPhase（非法字段 → 抛错，不静默吞）。 */
export function parseTestingPhase(v: unknown): TestingPhase {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new Error("testingPhase must be an object");
  }
  const o = v as Record<string, unknown>;
  const num = (key: string): number => {
    const n = Number(o[key]);
    if (!Number.isFinite(n) || n < 0) throw new Error(`testingPhase.${key} must be a non-negative number`);
    return n;
  };
  const durationDays = num("durationDays");
  if (!Number.isInteger(durationDays) || durationDays < 1) {
    throw new Error("testingPhase.durationDays must be a positive integer");
  }
  return {
    dailyBudget: num("dailyBudget"),
    totalBudget: num("totalBudget"),
    expectedClicks: num("expectedClicks"),
    expectedConversions: num("expectedConversions"),
    durationDays,
  };
}

/** 校验 + 规范化 PATCH 入参的 scalingPhase。 */
export function parseScalingPhase(v: unknown): ScalingPhase {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new Error("scalingPhase must be an object");
  }
  const o = v as Record<string, unknown>;
  const num = (key: string): number => {
    const n = Number(o[key]);
    if (!Number.isFinite(n) || n < 0) throw new Error(`scalingPhase.${key} must be a non-negative number`);
    return n;
  };
  return {
    triggerRoas: num("triggerRoas"),
    dailyBudget: num("dailyBudget"),
    maxDailyBudget: num("maxDailyBudget"),
  };
}

/** 扩量口径校验：扩量文案中出现“直接提预算/提高预算扩量”即视为违规口径。 */
export function isDirectBudgetIncreaseCopy(text: string): boolean {
  return /直接(提|提高|增加)预算|提高预算扩量|直接加预算/.test(text);
}
