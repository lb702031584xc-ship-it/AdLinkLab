/**
 * AdPlan 货币换算与校验。
 *
 * 背景：计划金额（日预算 / 最高 CPC）由 AI 按 USD 语义生成，而 Google Ads
 * 账户按自己的结算货币（GoogleAccount.currency，如 CNY）扣费。Script 直接把
 * 数字转 micros 推出去，货币不对时金额会差一个汇率。
 *
 * 汇率语义：fxRate = 1 USD = X 目标货币（如 7.10 表示 1 USD = 7.10 CNY）。
 * 换算只涉及两处金额字段：plan.campaign.dailyBudget 与每条
 * plan.adGroups[i].group.maxCpc（可为 null）。
 */
import { ValidationError } from "@adlinklab/shared";
import type { AdPlan } from "./ad-generator.js";

const USD = "USD";

/** 3 字母大写货币码（如 USD / CNY），否则抛 ValidationError。 */
function normalizeCurrency(value: unknown, field: string): string {
  const s = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(s)) {
    throw new ValidationError(`${field} 必须是 3 字母货币码`);
  }
  return s;
}

/** fxRate 必须是正数，否则抛 ValidationError。 */
function assertFxRate(value: unknown): number {
  const n = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) {
    throw new ValidationError("fxRate 必须是正数（1 USD = X 目标货币）");
  }
  return n;
}

/** 金额保留两位小数（分/角），避免浮点残留。 */
function round2(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * 把 plan 的金额换算成目标货币（原地修改并返回同一 plan）。
 * - USD → 目标货币：amount × fxRate；目标货币 → USD：amount ÷ fxRate。
 * - from == to：不动（不写换算记录）。
 * - 既非 USD 也非目标货币的货币对：直接报错，不静默。
 * 换算成功后写 plan.currencyConversion = { from, to, fxRate }（from 取日预算货币）。
 */
export function convertPlanCurrency(
  plan: AdPlan,
  targetCurrency: unknown,
  fxRate: unknown
): AdPlan {
  const to = normalizeCurrency(targetCurrency, "targetCurrency");
  const rate = assertFxRate(fxRate);
  const planFrom = normalizeCurrency(
    plan.campaign.dailyBudget.currency,
    "计划货币"
  );

  const convertAmount = (amount: number, from: string): number => {
    if (!Number.isFinite(amount)) {
      throw new ValidationError("计划金额必须是有限数字");
    }
    const f = normalizeCurrency(from, "计划货币");
    if (f === to) return amount;
    if (f !== USD && to !== USD) {
      throw new ValidationError(
        `不支持的货币对：${f} → ${to}（仅支持与 USD 之间的换算）`
      );
    }
    return round2(f === USD ? amount * rate : amount / rate);
  };

  plan.campaign.dailyBudget.amount = convertAmount(
    plan.campaign.dailyBudget.amount,
    planFrom
  );
  plan.campaign.dailyBudget.currency = to;
  for (const block of plan.adGroups) {
    const m = block.group.maxCpc;
    if (m) {
      m.amount = convertAmount(m.amount, m.currency);
      m.currency = to;
    }
  }
  if (planFrom !== to) {
    plan.currencyConversion = { from: planFrom, to, fxRate: rate };
  }
  return plan;
}

/**
 * 校验计划货币 == 给定货币（日预算 + 全部 adGroup maxCpc），不一致抛
 * ValidationError（中文，说明要重新生成计划并选该货币的广告账户）。
 */
export function assertPlanCurrencyMatches(
  plan: AdPlan,
  currency: unknown
): void {
  const expected = normalizeCurrency(currency, "广告账户货币");
  const budgetCurrency = normalizeCurrency(
    plan.campaign.dailyBudget.currency,
    "计划货币"
  );
  if (budgetCurrency !== expected) {
    throw new ValidationError(
      `计划货币 ${budgetCurrency} 与广告账户货币 ${expected} 不一致，请重新生成计划并选择该货币的广告账户`
    );
  }
  for (const block of plan.adGroups) {
    const m = block.group.maxCpc;
    if (m) {
      const c = normalizeCurrency(m.currency, "计划最高 CPC 货币");
      if (c !== expected) {
        throw new ValidationError(
          `计划最高 CPC 货币 ${c} 与广告账户货币 ${expected} 不一致，请重新生成计划并选择该货币的广告账户`
        );
      }
    }
  }
}
