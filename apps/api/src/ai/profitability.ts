/**
 * Phase 11 — profitability math for AI offer analysis.
 * Computed in code (never by the LLM) so the numbers are deterministic.
 *
 * Extended: supports commission ranges (fixed amount OR price range ×
 * commission % range), bid suggestions at three risk levels, and
 * profit/loss scenarios across conversion rates.
 */

export interface Profitability {
  payout: number | null;
  payoutCurrency: string | null;
  estimatedCpc: number | null;
  /** Break-even conversion rate in percent, rounded to 2 decimals. */
  breakEvenCvrPct: number | null;
}

export interface CommissionRangeInput {
  /** Fixed commission amount (takes precedence if set). */
  fixedAmount?: number | null;
  /** Price range for percentage-based commission. */
  priceMin?: number | null;
  priceMax?: number | null;
  /** Commission percentage range (e.g. 5–10 means 5 to 10). */
  commissionPctMin?: number | null;
  commissionPctMax?: number | null;
  currency?: string | null;
}

export interface CommissionEstimate {
  /** Estimated commission low/high in currency units. */
  commissionMin: number | null;
  commissionMax: number | null;
  currency: string | null;
  /** How the estimate was derived. */
  method: "fixed" | "range" | "unknown";
}

export interface BidSuggestion {
  level: "conservative" | "moderate" | "aggressive";
  /** Suggested max CPC. */
  maxCpc: number | null;
  /** Fraction of break-even CPC used. */
  fraction: number;
  /** Expected margin at assumed conversion rate. */
  note: string;
}

export interface ProfitScenario {
  /** Assumed conversion rate in percent. */
  cvrPct: number;
  /** Profit per 100 clicks at suggested CPC (moderate level). */
  profitPer100Clicks: number | null;
  /**
   * 到账口径：收入按预计到账率折算后的每 100 点击利润
   * （= revenue × settlementRateF − cost）。账面口径见 profitPer100Clicks。
   */
  profitPer100ClicksNet: number | null;
  verdict: "profit" | "loss" | "unknown";
}

export interface ProfitAnalysis {
  commission: CommissionEstimate;
  /** Break-even CPC at assumed conversion rate. */
  breakEvenCpc: number | null;
  assumedCvrPct: number;
  /** 实际生效的预计到账率（0–1）。 */
  settlementRateF: number;
  bids: BidSuggestion[];
  scenarios: ProfitScenario[];
  currency: string | null;
}

/** 预计到账率默认值（与 web profit-calc 的 DEFAULT_SETTLEMENT_RATE_F 同口径）。 */
export const DEFAULT_SETTLEMENT_RATE_F = 0.7;

/** 到账率入参归一：未传/非有限数 → 默认 0.7；其余钳制到 0–1。 */
export function normalizeSettlementRateF(v?: number | null): number {
  if (v == null || typeof v !== "number" || !Number.isFinite(v)) {
    return DEFAULT_SETTLEMENT_RATE_F;
  }
  return Math.min(Math.max(v, 0), 1);
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * breakEvenCvrPct = estimatedCpc / payout * 100 (2dp).
 * Nulls when inputs are missing or non-positive.
 */
export function computeProfitability(
  payout: unknown,
  payoutCurrency: unknown,
  estimatedCpc: unknown
): Profitability {
  const p = finiteOrNull(payout);
  const c = finiteOrNull(estimatedCpc);
  const breakEvenCvrPct =
    p !== null && c !== null && p > 0 && c > 0
      ? Math.round((c / p) * 100 * 100) / 100
      : null;
  return {
    payout: p,
    payoutCurrency:
      typeof payoutCurrency === "string" && payoutCurrency.trim()
        ? payoutCurrency.trim()
        : null,
    estimatedCpc: c,
    breakEvenCvrPct,
  };
}

/**
 * Estimate commission from fixed amount or price × percentage ranges.
 */
export function estimateCommission(
  input: CommissionRangeInput
): CommissionEstimate {
  const currency =
    typeof input.currency === "string" && input.currency.trim()
      ? input.currency.trim().toUpperCase()
      : null;
  const fixed = finiteOrNull(input.fixedAmount);
  if (fixed !== null && fixed > 0) {
    return {
      commissionMin: round2(fixed),
      commissionMax: round2(fixed),
      currency,
      method: "fixed",
    };
  }
  const pMin = finiteOrNull(input.priceMin);
  const pMax = finiteOrNull(input.priceMax) ?? pMin;
  const cMin = finiteOrNull(input.commissionPctMin);
  const cMax = finiteOrNull(input.commissionPctMax) ?? cMin;
  if (
    pMin !== null &&
    pMin > 0 &&
    pMax !== null &&
    pMax > 0 &&
    cMin !== null &&
    cMin > 0 &&
    cMax !== null &&
    cMax > 0
  ) {
    return {
      commissionMin: round2((pMin * cMin) / 100),
      commissionMax: round2((pMax * cMax) / 100),
      currency,
      method: "range",
    };
  }
  return { commissionMin: null, commissionMax: null, currency, method: "unknown" };
}

/**
 * Full profit analysis: commission estimate → break-even CPC →
 * three bid suggestions → profit/loss scenarios.
 *
 * assumedCvrPct: expected conversion rate in percent (default 2).
 * Bid fractions: conservative 50%, moderate 70%, aggressive 90% of break-even CPC.
 */
export function analyzeProfit(
  commissionInput: CommissionRangeInput,
  assumedCvrPct: unknown = 2,
  settlementRateF?: number | null
): ProfitAnalysis {
  const settleF = normalizeSettlementRateF(settlementRateF);
  const commission = estimateCommission(commissionInput);
  const cvr =
    finiteOrNull(assumedCvrPct) !== null && (assumedCvrPct as number) > 0
      ? (assumedCvrPct as number)
      : 2;
  const currency = commission.currency;

  // Use midpoint of commission range for break-even math.
  const midCommission =
    commission.commissionMin !== null && commission.commissionMax !== null
      ? (commission.commissionMin + commission.commissionMax) / 2
      : null;
  const breakEvenCpc =
    midCommission !== null && midCommission > 0
      ? round2((midCommission * cvr) / 100)
      : null;

  const levels: BidSuggestion["level"][] = ["conservative", "moderate", "aggressive"];
  const fractions = [0.5, 0.7, 0.9];
  const notes = [
    "低风险：即使转化率偏低也有缓冲",
    "平衡：兼顾流量规模与利润",
    "激进：接近盈亏线，需高转化支撑",
  ];
  const bids: BidSuggestion[] = levels.map((level, i) => ({
    level,
    maxCpc: breakEvenCpc !== null ? round2(breakEvenCpc * fractions[i]) : null,
    fraction: fractions[i],
    note: notes[i],
  }));

  // Scenarios at 1%, assumed, and 2× assumed conversion rates.
  const scenarioCvrs = [round2(cvr * 0.5), cvr, round2(cvr * 2)];
  const moderateCpc = bids[1].maxCpc;
  const scenarios: ProfitScenario[] = scenarioCvrs.map((cvrPct) => {
    if (midCommission === null || moderateCpc === null) {
      return {
        cvrPct,
        profitPer100Clicks: null,
        profitPer100ClicksNet: null,
        verdict: "unknown" as const,
      };
    }
    // Profit per 100 clicks = 100 × cvr% × commission − 100 × cpc
    const revenue = 100 * (cvrPct / 100) * midCommission;
    const cost = 100 * moderateCpc;
    const profit = round2(revenue - cost);
    return {
      cvrPct,
      profitPer100Clicks: profit,
      // 到账口径：只有收入按到账率折算，成本（广告花费）全额发生。
      profitPer100ClicksNet: round2(revenue * settleF - cost),
      verdict: profit > 0 ? ("profit" as const) : ("loss" as const),
    };
  });

  return {
    commission,
    breakEvenCpc,
    assumedCvrPct: cvr,
    settlementRateF: settleF,
    bids,
    scenarios,
    currency,
  };
}

/* ------------------------------------------------------------------ */
/* 第十一批：每次点击盈亏 + 推荐 CPC 出价                                */
/* ------------------------------------------------------------------ */

/**
 * Amazon US 类目佣金率静态估算表（by category）。
 * 明确标注：估算值，实际以 Amazon Associates 类目政策为准；用户可手动覆盖。
 * 键为英文类目 key；页面展示中英双语由 Web 字典负责。
 */
export const AMAZON_US_COMMISSION_RATES: Record<string, number> = {
  electronics: 0.04, // 3C数码
  home_kitchen: 0.045, // 家居厨房
  fashion: 0.04, // 服装配饰
  beauty: 0.045, // 美妆个护（Luxury Beauty 可达 10%，此处取保守值）
  baby_toys: 0.045, // 母婴玩具
  sports_outdoor: 0.045, // 运动户外
  pet: 0.045, // 宠物用品
  office: 0.045, // 办公用品
  books: 0.045, // 图书
  grocery: 0.045, // 食品杂货
  automotive: 0.045, // 汽车用品
  health: 0.045, // 健康个护
};

/** 默认佣金率（估算值）：4%。 */
export const DEFAULT_AMAZON_COMMISSION_RATE = 0.04;

export interface ClickProfitInput {
  /** 商品价格（美元）。 */
  price?: number | null;
  /** 佣金率（0-1，如 0.04）。 */
  commissionRate?: number | null;
  /** 固定佣金（美元；优先于 price × commissionRate）。 */
  fixedCommission?: number | null;
  /** 预估转化率（0-1，默认 0.02；页面明确标注"预估"）。 */
  cvr?: number | null;
  /** 实际 CPC（美元，可选）：用于计算该出价下的期望盈亏。 */
  cpc?: number | null;
  /** 预计到账率（0-1，默认 0.7）：只影响到账口径输出，账面口径不变。 */
  settlementRateF?: number | null;
}

export interface ClickProfit {
  /** 单次转化佣金 = price × commissionRate（或 fixedCommission）。 */
  commissionPerSale: number | null;
  /** 盈亏平衡出价 = commissionPerSale × cvr。 */
  breakEvenCpc: number | null;
  /** 推荐出价 = breakEvenCpc × 0.7（留 30% 安全边际）。 */
  recommendedBid: number | null;
  /** 每次点击期望盈亏（按推荐出价）= commissionPerSale × cvr − recommendedBid。 */
  expectedProfitPerClick: number | null;
  /** 每次点击期望盈亏（按实际 CPC；未提供 cpc 时为 null）。 */
  expectedProfitPerClickAtCpc: number | null;
  /** 实际生效的预计到账率（0–1）。 */
  settlementRateF: number;
  /**
   * 到账口径每次点击期望盈亏（按实际 CPC）= commissionPerSale × cvr ×
   * settlementRateF − cpc（未提供 cpc 或不可投时为 null）。
   */
  expectedProfitPerClickNetAtCpc: number | null;
  /** 数学上是否可投（佣金>0 且 cvr>0）。 */
  viable: boolean;
  /** 不可投时的提示。 */
  note: string | null;
}

/**
 * 每次点击盈亏 + 推荐出价。
 * 公式（透明）：
 *   commissionPerSale = fixedCommission ?? price × commissionRate
 *   breakEvenCpc      = commissionPerSale × cvr
 *   recommendedBid    = breakEvenCpc × 0.7
 *   expectedProfitPerClick = commissionPerSale × cvr − recommendedBid
 * cvr=0 或佣金=0 → 推荐出价 0，并提示"数学上不可投"。
 */
export function computeClickProfit(input: ClickProfitInput): ClickProfit {
  const price = finiteOrNull(input.price);
  const rate = finiteOrNull(input.commissionRate);
  const fixed = finiteOrNull(input.fixedCommission);
  const cvr = input.cvr === undefined || input.cvr === null ? 0.02 : finiteOrNull(input.cvr);
  const cpc = finiteOrNull(input.cpc);
  const settleF = normalizeSettlementRateF(input.settlementRateF);

  const commissionPerSale =
    fixed !== null && fixed > 0
      ? fixed
      : price !== null && rate !== null && price > 0 && rate > 0
        ? round2(price * rate)
        : null;

  const viable =
    commissionPerSale !== null && commissionPerSale > 0 && cvr !== null && cvr > 0;

  if (!viable) {
    return {
      commissionPerSale,
      breakEvenCpc: null,
      recommendedBid: 0,
      expectedProfitPerClick: null,
      expectedProfitPerClickAtCpc: null,
      settlementRateF: settleF,
      expectedProfitPerClickNetAtCpc: null,
      viable: false,
      note: "数学上不可投：佣金或预估转化率为 0",
    };
  }

  const breakEvenCpc = round2(commissionPerSale * (cvr as number));
  const recommendedBid = round2(breakEvenCpc * 0.7);
  const expectedProfitPerClick = round2(commissionPerSale * (cvr as number) - recommendedBid);
  return {
    commissionPerSale,
    breakEvenCpc,
    recommendedBid,
    expectedProfitPerClick,
    expectedProfitPerClickAtCpc:
      cpc !== null && cpc >= 0 ? round2(commissionPerSale * (cvr as number) - cpc) : null,
    settlementRateF: settleF,
    expectedProfitPerClickNetAtCpc:
      cpc !== null && cpc >= 0
        ? round2(commissionPerSale * (cvr as number) * settleF - cpc)
        : null,
    viable: true,
    note: null,
  };
}
