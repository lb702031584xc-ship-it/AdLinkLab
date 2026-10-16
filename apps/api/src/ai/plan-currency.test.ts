/**
 * plan-currency：换算 / 校验单元测试。
 */
import { describe, expect, it } from "vitest";
import { ValidationError } from "@adlinklab/shared";
import type { AdPlan } from "./ad-generator.js";
import {
  assertPlanCurrencyMatches,
  convertPlanCurrency,
} from "./plan-currency.js";

function makePlan(opts?: {
  budgetCurrency?: string;
  budgetAmount?: number;
  maxCpcCurrency?: string | null;
  maxCpcAmount?: number | null;
}): AdPlan {
  const budgetCurrency = opts?.budgetCurrency ?? "USD";
  // 显式 null 表示 maxCpc 为空，不能用 ??（null 会被吞掉）
  const maxCpcCurrency = opts?.maxCpcCurrency === undefined ? budgetCurrency : opts.maxCpcCurrency;
  const maxCpcAmount = opts?.maxCpcAmount === undefined ? 1.25 : opts.maxCpcAmount;
  return {
    version: 1,
    planId: "00000000-0000-0000-0000-000000000001",
    tenantId: "00000000-0000-0000-0000-000000000002",
    language: "zh",
    sourceUrls: ["https://merchant.example/offer"],
    offerId: null,
    googleAccountId: null,
    copyStyle: "affiliate",
    campaign: {
      name: "Test Campaign",
      dailyBudget: { amount: opts?.budgetAmount ?? 30, currency: budgetCurrency, dataQuality: "PREDICTED" },
      geoTargets: ["US"],
      bidding: { strategy: "MANUAL_CPC", maxCpc: null },
      status: "PAUSED",
      dataQuality: "PREDICTED",
    },
    adGroups: [
      {
        group: {
          name: "Test Group",
          finalUrl: "https://merchant.example/offer",
          keywords: [],
          negativeKeywords: [],
          maxCpc:
            maxCpcCurrency === null || maxCpcAmount === null
              ? null
              : { amount: maxCpcAmount, currency: maxCpcCurrency, dataQuality: "PREDICTED" },
          dataQuality: "PREDICTED",
          keywordsSource: "ai",
        },
        rsa: {
          headlines: Array.from({ length: 15 }, (_, i) => `H${i + 1}`),
          descriptions: ["d1", "d2", "d3", "d4"],
          finalUrl: "https://merchant.example/offer",
          path1: null,
          path2: null,
          dataQuality: "PREDICTED",
        },
      },
    ],
    createdAt: new Date().toISOString(),
    dataQuality: "PREDICTED",
  };
}

describe("convertPlanCurrency", () => {
  it("USD → CNY：amount × fxRate，currency 同步改，写换算记录", () => {
    const plan = makePlan({ budgetCurrency: "USD", budgetAmount: 30, maxCpcAmount: 1.25 });
    const out = convertPlanCurrency(plan, "CNY", 7.1);
    expect(out).toBe(plan);
    expect(plan.campaign.dailyBudget.amount).toBe(213);
    expect(plan.campaign.dailyBudget.currency).toBe("CNY");
    expect(plan.adGroups[0]!.group.maxCpc!.amount).toBe(8.88);
    expect(plan.adGroups[0]!.group.maxCpc!.currency).toBe("CNY");
    expect(plan.currencyConversion).toEqual({ from: "USD", to: "CNY", fxRate: 7.1 });
  });

  it("CNY → USD：amount ÷ fxRate", () => {
    const plan = makePlan({ budgetCurrency: "CNY", budgetAmount: 213, maxCpcCurrency: "CNY", maxCpcAmount: 8.88 });
    convertPlanCurrency(plan, "USD", 7.1);
    expect(plan.campaign.dailyBudget.amount).toBe(30);
    expect(plan.campaign.dailyBudget.currency).toBe("USD");
    expect(plan.adGroups[0]!.group.maxCpc!.amount).toBeCloseTo(1.25, 2);
    expect(plan.adGroups[0]!.group.maxCpc!.currency).toBe("USD");
    expect(plan.currencyConversion).toEqual({ from: "CNY", to: "USD", fxRate: 7.1 });
  });

  it("同货币：不动，不写换算记录", () => {
    const plan = makePlan({ budgetCurrency: "USD", budgetAmount: 30, maxCpcAmount: 1.25 });
    convertPlanCurrency(plan, "USD", 7.1);
    expect(plan.campaign.dailyBudget.amount).toBe(30);
    expect(plan.adGroups[0]!.group.maxCpc!.amount).toBe(1.25);
    expect(plan.currencyConversion).toBeUndefined();
  });

  it("maxCpc 为 null：不崩，只换算日预算", () => {
    const plan = makePlan({ budgetCurrency: "USD", budgetAmount: 30, maxCpcCurrency: null, maxCpcAmount: null });
    convertPlanCurrency(plan, "CNY", 7.1);
    expect(plan.campaign.dailyBudget.amount).toBe(213);
    expect(plan.adGroups[0]!.group.maxCpc).toBeNull();
  });

  it("非法货币对（既非 USD 也非目标货币）：报错，不静默", () => {
    const plan = makePlan({ budgetCurrency: "EUR", budgetAmount: 30, maxCpcCurrency: "EUR", maxCpcAmount: 1.25 });
    expect(() => convertPlanCurrency(plan, "CNY", 7.1)).toThrow(ValidationError);
    expect(() => convertPlanCurrency(plan, "CNY", 7.1)).toThrow("不支持的货币对");
  });

  it("fxRate 非正数 / 非数字：报错", () => {
    const plan = makePlan();
    expect(() => convertPlanCurrency(plan, "CNY", 0)).toThrow(ValidationError);
    expect(() => convertPlanCurrency(plan, "CNY", -7.1)).toThrow(ValidationError);
    expect(() => convertPlanCurrency(plan, "CNY", Number.NaN)).toThrow(ValidationError);
    expect(() => convertPlanCurrency(plan, "CNY", "7.1")).toThrow(ValidationError);
  });

  it("目标货币非法（非 3 字母码）：报错", () => {
    const plan = makePlan();
    expect(() => convertPlanCurrency(plan, "US", 7.1)).toThrow(ValidationError);
    expect(() => convertPlanCurrency(plan, "", 7.1)).toThrow(ValidationError);
  });

  it("金额按各自货币换算：maxCpc 货币与日预算货币不一致时各算各的", () => {
    // 日预算 USD，maxCpc 已是 CNY → 换算到 CNY 时 maxCpc 不动
    const plan = makePlan({ budgetCurrency: "USD", budgetAmount: 30, maxCpcCurrency: "CNY", maxCpcAmount: 8.88 });
    convertPlanCurrency(plan, "CNY", 7.1);
    expect(plan.campaign.dailyBudget.amount).toBe(213);
    expect(plan.adGroups[0]!.group.maxCpc!.amount).toBe(8.88);
  });
});

describe("assertPlanCurrencyMatches", () => {
  it("日预算 + maxCpc 货币都一致时通过", () => {
    const plan = makePlan({ budgetCurrency: "CNY", maxCpcCurrency: "CNY" });
    expect(() => assertPlanCurrencyMatches(plan, "CNY")).not.toThrow();
  });

  it("maxCpc 为 null 时只校验日预算", () => {
    const plan = makePlan({ budgetCurrency: "CNY", maxCpcCurrency: null, maxCpcAmount: null });
    expect(() => assertPlanCurrencyMatches(plan, "CNY")).not.toThrow();
  });

  it("日预算货币不一致：抛中文 ValidationError", () => {
    const plan = makePlan({ budgetCurrency: "USD" });
    expect(() => assertPlanCurrencyMatches(plan, "CNY")).toThrow(ValidationError);
    expect(() => assertPlanCurrencyMatches(plan, "CNY")).toThrow(
      "计划货币 USD 与广告账户货币 CNY 不一致"
    );
  });

  it("maxCpc 货币不一致：抛错", () => {
    const plan = makePlan({ budgetCurrency: "CNY", maxCpcCurrency: "USD" });
    expect(() => assertPlanCurrencyMatches(plan, "CNY")).toThrow(ValidationError);
    expect(() => assertPlanCurrencyMatches(plan, "CNY")).toThrow("计划最高 CPC 货币 USD");
  });
});
