/**
 * Shared profitability math (pure functions, no dependencies).
 *
 * Single source of truth for: the /ai/profit page, the /ai/analyze worksheet
 * step ④ (盈利测算), the /offers quick-calc button, and the traffic-planner
 * bid math. Add new formulas here — never duplicate them per page.
 *
 * All money values are in the account currency; rates are fractions (0-1)
 * unless the name says Pct.
 */

export interface ProfitInputs {
  /** Offer payout per conversion. */
  payout: number;
  /** Estimated cost per click. */
  cpc: number;
  /** Expected conversion rate as a fraction (e.g. 0.02 for 2%). */
  cvrF: number;
  /** Refund rate as a fraction (0-1). */
  refundF?: number;
  /** Shave/deduction rate as a fraction (0-1). */
  shaveF?: number;
  /**
   * 页面佣金 → 预期佣金的折损系数，默认 1（不折损，保持旧行为）。
   * 传 0.6 表示「按页面佣金的六成预估」——因为顾客常买便宜变体或走
   * Brand Halo，用页面最高佣金算保本会系统性偏乐观。
   * 只影响显式传入的调用方，不改变其它页面的数字。
   */
  expectedPayoutFactor?: number;
  /** Target return ratio r = 产出 / 投入（投 1 产出 r，利润 r − 1）。如 1.5 = 投 1 产出 1.5、利润 0.5；1 = 保平。默认 2。 */
  targetReturnRatio?: number;
  /**
   * 预计到账率（0–1）：账面佣金最终实际到账的比例（联盟结算会扣减/拒付
   * 一部分）。默认 0.7。只影响到账口径 returnRatioNetAtCpc，账面口径不变。
   */
  settlementRateF?: number;
  /**
   * Whether the inputs are estimates (AI guess / defaults) rather than
   * measured data. Default false. Never silently treat a guess as measured:
   * callers that cannot prove a measured source must pass true.
   */
  inputsEstimated?: boolean;
}

export interface ProfitResult {
  /** Payout after refunds and shave. */
  effectivePayout: number;
  /** Earnings per click. */
  epc: number;
  /** Profit per click (can be negative). */
  perClickProfit: number;
  /** Breakeven CVR in percent (null when inputs invalid). */
  breakEvenCvrPct: number | null;
  /** Max CPC at expected CVR (null when CVR unknown). */
  breakEvenCpc: number | null;
  /** Recommended max CPC with 30% safety margin. */
  maxCpc30: number | null;
  /** Max CPC that still hits the target return ratio (null when EPC invalid). */
  maxCpcAtTargetRatio: number | null;
  /** Actual return ratio at the current CPC: EPC / CPC (null when CPC <= 0). 1 = 保平。 */
  returnRatioAtCpc: number | null;
  /** 实际生效的预计到账率（0–1，已做默认/钳制处理）。 */
  settlementRateF: number;
  /**
   * 到账口径产出比 = returnRatioAtCpc × settlementRateF：按预计实际到账
   * 折算后的产出比（null 与 returnRatioAtCpc 同步，CPC 无效时 null）。
   */
  returnRatioNetAtCpc: number | null;
  /** Suggested test budget in clicks (null when CVR unknown/invalid). */
  testBudgetClicks: number | null;
  /** Suggested test budget cost. */
  testBudgetCost: number | null;
  /** Rule-of-thumb budget: 3x payout. */
  ruleBudget: number;
  /** True when the inputs were estimates, not measured data. */
  isEstimated: boolean;
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0;
}

/** 预计到账率默认值：账面佣金约七成最终到账（课程经验值，可由调用方覆盖）。 */
export const DEFAULT_SETTLEMENT_RATE_F = 0.7;

/** 结算周期默认值（天）：联盟常见的 120–150 天回款周期的中位。 */
export const DEFAULT_SETTLEMENT_CYCLE_DAYS = 135;

/** 到账率入参归一：未传/非有限数 → 默认 0.7；其余钳制到 0–1。 */
export function normalizeSettlementRateF(v?: number | null): number {
  if (v == null || !Number.isFinite(v)) return DEFAULT_SETTLEMENT_RATE_F;
  return clamp01(v);
}

/**
 * 预计回款提示（纯函数）：按结算周期天数估算「约 X 个月后回款」。
 * cycleDays 未传/无效/≤0 时用默认 135 天（120–150 天中位）。
 * 月数 = 天数 ÷ 30，保留一位小数（整数时不带小数点）。
 */
export function settlementPayoutHint(
  cycleDays: number | null | undefined,
  lang: "zh" | "en"
): string {
  const days =
    cycleDays != null && Number.isFinite(cycleDays) && cycleDays > 0
      ? Math.round(cycleDays)
      : DEFAULT_SETTLEMENT_CYCLE_DAYS;
  const months = Math.round((days / 30) * 10) / 10;
  const m = Number.isInteger(months) ? String(months) : months.toFixed(1);
  return lang === "en"
    ? `Payout expected in ~${m} months (settlement cycle ~${days} days, at the estimated settlement rate)`
    : `约 ${m} 个月后回款（按约 ${days} 天结算周期、预计到账率估算）`;
}

/**
 * #8 — CVR 分档默认值（按客单价估算，属估算值不是实测）：
 * 价格 <100 → 6%；100–300（含）→ 4%；>300 → 2.5%。
 * 无效价格（null/NaN/≤0）→ null（不编造）。
 */
export function defaultCvrForPrice(
  avgPrice: number | null | undefined
): number | null {
  if (avgPrice == null || !Number.isFinite(avgPrice) || avgPrice <= 0) {
    return null;
  }
  if (avgPrice < 100) return 0.06;
  if (avgPrice <= 300) return 0.04;
  return 0.025;
}

/** Payout after refund and shave deductions. */
export function effectivePayout(
  payout: number,
  refundF = 0,
  shaveF = 0,
  expectedPayoutFactor = 1,
): number {
  if (!Number.isFinite(payout) || payout <= 0) return 0;
  const factor = Number.isFinite(expectedPayoutFactor) && expectedPayoutFactor > 0
    ? expectedPayoutFactor
    : 1;
  return payout * factor * (1 - clamp01(refundF)) * (1 - clamp01(shaveF));
}

/** Earnings per click = payout × CVR. */
export function epcFor(payout: number, cvrF: number): number {
  if (!Number.isFinite(payout) || !Number.isFinite(cvrF)) return 0;
  return payout * cvrF;
}

/**
 * Breakeven CVR in percent: the CVR needed for EPC to cover CPC.
 * Formula: (cpc / effectivePayout) × 100
 */
export function breakEvenCvrPct(
  cpc: number,
  effPayout: number,
): number | null {
  if (!Number.isFinite(cpc) || cpc <= 0) return null;
  if (!Number.isFinite(effPayout) || effPayout <= 0) return null;
  return (cpc / effPayout) * 100;
}

/** Max affordable CPC at the expected CVR. */
export function breakEvenCpc(
  cvrF: number,
  effPayout: number,
): number | null {
  if (!Number.isFinite(cvrF) || cvrF <= 0 || cvrF >= 1) return null;
  if (!Number.isFinite(effPayout) || effPayout <= 0) return null;
  return cvrF * effPayout;
}

/** Recommended max CPC with a 30% safety margin under breakeven. */
export function recommendedMaxCpc(breakEven: number | null): number | null {
  return breakEven !== null ? breakEven * 0.7 : null;
}

/**
 * Round a bid amount to the ad platform's billable unit (¥0.01 / $0.01).
 * Bids that become real API values must pass through here: Google rejects
 * cpcBidMicros that is not a multiple of the billable unit, and a 4-decimal
 * display (1.2709) promises precision the platform cannot take. Analysis
 * values (EPC, breakeven) stay full precision — round only at the point a
 * number becomes a bid. Positive inputs never round below one unit.
 */
export function roundBidToBillableUnit(amount: number): number {
  const rounded = Math.round(amount * 100) / 100;
  return amount > 0 && rounded < 0.01 ? 0.01 : rounded;
}

/**
 * Max CPC that still hits the target return ratio.
 * ratio r = 产出 / 投入 = EPC / CPC  →  CPC = EPC / r。
 * r = 1 → 保平（CPC = EPC）；r = 1.5 → 投 1 产出 1.5（利润 0.5）；r = 2 → 投 1 产出 2（利润 1）。
 */
export function maxCpcForReturnRatio(epc: number, ratio: number): number | null {
  if (!Number.isFinite(epc) || epc <= 0) return null;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return epc / ratio;
}

/** Actual return ratio at the current CPC: EPC / CPC (null when CPC <= 0). 1 = 保平。 */
export function returnRatioAtCpc(epc: number, cpc: number): number | null {
  if (!Number.isFinite(epc) || !Number.isFinite(cpc) || cpc <= 0) return null;
  return epc / cpc;
}

/**
 * 旧快照迁移：目标 ROI%（如 100/300）→ 目标产出比（2/4）。
 * 新快照已有比值时直接用；都没有时默认 2（= 旧 ROI 100%）。
 */
export function normalizeReturnRatio(opts?: {
  targetReturnRatio?: unknown;
  targetRoiPct?: unknown;
}): string {
  const r = opts?.targetReturnRatio;
  if (r != null && String(r).trim()) return String(r);
  const pct = parseFloat(String(opts?.targetRoiPct ?? ""));
  if (Number.isFinite(pct) && pct >= 0) return String(1 + pct / 100);
  return "2";
}

/**
 * P1-1 — 公式 A：按出单成本建议 CPC。
 *   建议 CPC = 价格 × 佣金比例 ÷ 预期点击出单数
 * （GREENVINES 验算：100 × 15% ÷ 50 = $0.30）。
 * 分母来源：优先用实测 CVR（预期点击出单数 = 1 / 实测 CVR）；无实测时
 * 调用方传入讲师假设 50，并必须在 UI 打“假设 50 估算”角标（见 P0-2）。
 * 本函数只算数，不决定分母来源——假设标注是调用方的责任。
 * commissionRatePct: 佣金比例（百分比，如 15 表示 15%）。
 */
export function suggestCpcByClicksToOrder(args: {
  price: number;
  commissionRatePct: number;
  clicksToOrder: number;
}): number | null {
  const { price, commissionRatePct, clicksToOrder } = args;
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(commissionRatePct) || commissionRatePct <= 0) return null;
  if (!Number.isFinite(clicksToOrder) || clicksToOrder <= 0) return null;
  return (price * (commissionRatePct / 100)) / clicksToOrder;
}

/** P1-1 — 公式 A 的分母：实测 CVR → 预期点击出单数（1 / CVR）。CVR 无效时 null。 */
export function clicksToOrderFromCvr(cvrF: number): number | null {
  if (!Number.isFinite(cvrF) || cvrF <= 0 || cvrF >= 1) return null;
  return 1 / cvrF;
}

/** P1-1 — 公式 A 默认假设分母（讲师经验：50 点击出一单，非实测）。 */
export const ASSUMED_CLICKS_TO_ORDER = 50;

/** Suggested test clicks for statistical confidence. */
export function testBudgetClicks(cvrF: number): number | null {
  if (!Number.isFinite(cvrF) || cvrF <= 0 || cvrF >= 1) return null;
  return Math.ceil((16 * (1 - cvrF)) / cvrF);
}

export function calcProfit(inputs: ProfitInputs): ProfitResult {
  const { payout, cpc, cvrF } = inputs;
  const eff = effectivePayout(
    payout,
    inputs.refundF,
    inputs.shaveF,
    inputs.expectedPayoutFactor ?? 1
  );
  const epc = epcFor(eff, cvrF);
  const beCpc = breakEvenCpc(cvrF, eff);
  const clicks = testBudgetClicks(cvrF);
  const ratio = inputs.targetReturnRatio ?? 2;
  const settleF = normalizeSettlementRateF(inputs.settlementRateF);
  const bookRatio = returnRatioAtCpc(epc, cpc);
  return {
    effectivePayout: eff,
    epc,
    perClickProfit:
      Number.isFinite(epc) && Number.isFinite(cpc) ? epc - cpc : 0,
    breakEvenCvrPct: breakEvenCvrPct(cpc, eff),
    breakEvenCpc: beCpc,
    maxCpc30: recommendedMaxCpc(beCpc),
    maxCpcAtTargetRatio: maxCpcForReturnRatio(epc, ratio),
    returnRatioAtCpc: bookRatio,
    settlementRateF: settleF,
    returnRatioNetAtCpc: bookRatio !== null ? bookRatio * settleF : null,
    testBudgetClicks: clicks,
    testBudgetCost:
      clicks !== null && Number.isFinite(cpc) && cpc > 0 ? clicks * cpc : null,
    ruleBudget: Number.isFinite(payout) && payout > 0 ? 3 * payout : 0,
    isEstimated: inputs.inputsEstimated ?? false,
  };
}
