/**
 * Shared profitability math (pure functions, no dependencies).
 *
 * Single source of truth for: the /ai/profit page, the /ai/analyze worksheet
 * step ③ (盈利测算), the /offers quick-calc button, and the traffic-planner
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
  /** Target ROI as a fraction (e.g. 1 for 100%). Default 1. */
  targetRoiF?: number;
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
  /** Max CPC that still hits the target ROI (null when EPC invalid). */
  maxCpcAtTargetRoi: number | null;
  /** Actual ROI at the current CPC, as a fraction (null when CPC <= 0). */
  roiAtCpc: number | null;
  /** Suggested test budget in clicks (null when CVR unknown/invalid). */
  testBudgetClicks: number | null;
  /** Suggested test budget cost. */
  testBudgetCost: number | null;
  /** Rule-of-thumb budget: 3x payout. */
  ruleBudget: number;
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0;
}

/** Payout after refund and shave deductions. */
export function effectivePayout(
  payout: number,
  refundF = 0,
  shaveF = 0,
): number {
  if (!Number.isFinite(payout) || payout <= 0) return 0;
  return payout * (1 - clamp01(refundF)) * (1 - clamp01(shaveF));
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
 * Max CPC that still hits the target ROI.
 * ROI = (EPC − CPC) / CPC  →  CPC = EPC / (1 + ROI).
 * Target ROI 0 = breakeven; 100% → half of EPC; 200% → a third.
 */
export function maxCpcForRoi(epc: number, roiF: number): number | null {
  if (!Number.isFinite(epc) || epc <= 0) return null;
  if (!Number.isFinite(roiF) || roiF < 0) return null;
  return epc / (1 + roiF);
}

/** Actual ROI at the current CPC, as a fraction (null when CPC <= 0). */
export function roiAtCpc(epc: number, cpc: number): number | null {
  if (!Number.isFinite(epc) || !Number.isFinite(cpc) || cpc <= 0) return null;
  return (epc - cpc) / cpc;
}

/** Suggested test clicks for statistical confidence. */
export function testBudgetClicks(cvrF: number): number | null {
  if (!Number.isFinite(cvrF) || cvrF <= 0 || cvrF >= 1) return null;
  return Math.ceil((16 * (1 - cvrF)) / cvrF);
}

export function calcProfit(inputs: ProfitInputs): ProfitResult {
  const { payout, cpc, cvrF } = inputs;
  const eff = effectivePayout(payout, inputs.refundF, inputs.shaveF);
  const epc = epcFor(eff, cvrF);
  const beCpc = breakEvenCpc(cvrF, eff);
  const clicks = testBudgetClicks(cvrF);
  const roiF = inputs.targetRoiF ?? 1;
  return {
    effectivePayout: eff,
    epc,
    perClickProfit:
      Number.isFinite(epc) && Number.isFinite(cpc) ? epc - cpc : 0,
    breakEvenCvrPct: breakEvenCvrPct(cpc, eff),
    breakEvenCpc: beCpc,
    maxCpc30: recommendedMaxCpc(beCpc),
    maxCpcAtTargetRoi: maxCpcForRoi(epc, roiF),
    roiAtCpc: roiAtCpc(epc, cpc),
    testBudgetClicks: clicks,
    testBudgetCost:
      clicks !== null && Number.isFinite(cpc) && cpc > 0 ? clicks * cpc : null,
    ruleBudget: Number.isFinite(payout) && payout > 0 ? 3 * payout : 0,
  };
}
