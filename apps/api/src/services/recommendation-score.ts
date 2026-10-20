/**
 * 商品推荐指数计算（2026-10-19；2026-10-20 并入统一评分入口）。
 *
 * 本函数是 recommendationScore 的唯一计算来源（质量分，公式不变）。
 * recommended 的判定不在这里：由 catalog-screening.ts 的 evaluateProduct
 * 统一负责（有预设走预设阈值，无预设时才用本函数的 score >= 60 口径）。
 * 同步评分、POST /catalog/screen、POST /catalog/products/calc-score 三处
 * 都经 evaluateProduct 调用本函数，同一商品结果一致，不再互相覆盖。
 *
 * 权重（固定，合计 100%）：
 *   佣金金额  30% — 单次转化能赚多少是第一位的
 *   评论数    20% — 社会证明，评论越多转化越稳
 *   价格      15% — 适中最好：太便宜佣金绝对值小，太贵付费流量难转化
 *   佣金率    10% — 比例高低的辅助信号
 *   结算率    15% — 补强 #1：商家历史结算率（settlementRatePct，0–100 数值，
 *                   直接映射为 0–100 分）。未知（null/undefined/越界）→ 中性
 *                   50 分，绝不编造一个结算率出来。
 *   返款周期  10% — 补强 #4：payoutCycleDays。规则（分档）：
 *                   ≤30 天 → 100 分；31–60 天 → 80 分；61–90 天 → 60 分；
 *                   >90 天 → 20 分（长周期明显扣分：资金占用久、风险高）。
 *                   未知 → 中性 50 分，不臆断。
 * 缺数据的项按中性（50 分）处理，绝不编造数据。
 *
 * $8 门槛（MIN_COMMISSION_USD，packages/shared/src/commission-gate.ts）：
 * 可算出单次佣金且 < $8 → 直接限分（最高 25 分）。这是经济性判断
 * （低于 $8 不值得付费测试），不是政策禁止。算不出佣金时不限分，
 * 缺数据按中性处理，不臆断。
 */
import { MIN_COMMISSION_USD } from "@adlinklab/shared";

export interface RecommendationInput {
  /** 单次转化佣金（USD）。 */
  commissionAmount?: number | null;
  /** 佣金率（百分比数值，如 10 表示 10%）。 */
  commissionRate?: number | null;
  /** 商品评论数。 */
  reviewCount?: number | null;
  /** 商品价格（USD）。 */
  price?: number | null;
  /**
   * 商家历史结算率（百分比数值，0–100，如 70 表示 70%）。
   * 补强 #1：已知时按数值直接计分；未知/越界 → 中性，不编造。
   */
  settlementRatePct?: number | null;
  /**
   * 返款/结算周期（天）。补强 #4：>90 天扣分（见文件头分档规则）；
   * 未知 → 中性，不编造。
   */
  payoutCycleDays?: number | null;
}

export interface RecommendationBreakdown {
  commission: number; // 0–100
  reviews: number; // 0–100
  price: number; // 0–100
  rate: number; // 0–100
  settlement: number; // 0–100（补强 #1；未知为中性 50）
  payoutCycle: number; // 0–100（补强 #4；未知为中性 50）
}

export interface RecommendationResult {
  /** 0–100 整数。 */
  score: number;
  /** score >= RECOMMEND_THRESHOLD。 */
  recommended: boolean;
  breakdown: RecommendationBreakdown;
  /** 是否被 $8 门槛限分。 */
  cappedByGate: boolean;
  /** 用于门槛判断的有效佣金（USD）；算不出为 null。 */
  effectiveCommission: number | null;
}

/** 推荐阈值：>= 60 分则 recommended = true。 */
export const RECOMMEND_THRESHOLD = 60;
/** $8 门槛触发时的分数上限。 */
export const RECOMMEND_GATE_CAP = 25;

const clamp100 = (v: number): number => Math.max(0, Math.min(100, v));
const NEUTRAL = 50;

/** 返款周期超过该天数即进入最低档扣分（补强 #4）。 */
export const PAYOUT_CYCLE_LONG_DAYS = 90;

/**
 * 返款周期分档分（补强 #4）：≤30→100，31–60→80，61–90→60，>90→20。
 * 无效值（负数/非有限）→ null（调用方按中性处理）。
 */
export function payoutCycleScore(days: number | null): number {
  if (days === null || days < 0) return NEUTRAL;
  if (days <= 30) return 100;
  if (days <= 60) return 80;
  if (days <= PAYOUT_CYCLE_LONG_DAYS) return 60;
  return 20;
}

const numOrNull = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export function calcRecommendationScore(
  input: RecommendationInput
): RecommendationResult {
  const commissionAmount = numOrNull(input.commissionAmount);
  const commissionRate = numOrNull(input.commissionRate);
  const reviewCount = numOrNull(input.reviewCount);
  const price = numOrNull(input.price);
  // 结算率：只接受 0–100 的数值；越界视为未知（不 clamp 编造）。
  const settlementRaw = numOrNull(input.settlementRatePct);
  const settlementRate =
    settlementRaw !== null && settlementRaw >= 0 && settlementRaw <= 100
      ? settlementRaw
      : null;
  const payoutDaysRaw = numOrNull(input.payoutCycleDays);
  const payoutDays =
    payoutDaysRaw !== null && payoutDaysRaw >= 0 ? payoutDaysRaw : null;

  // 有效佣金：优先用 commissionAmount；否则用 price × commissionRate 反推；
  // 都没有则为 null（不臆断，不限分）。
  const effectiveCommission =
    commissionAmount ??
    (price !== null && commissionRate !== null
      ? (price * commissionRate) / 100
      : null);

  // 1) 佣金分（40%）：$8 → 0 分，$50 → 100 分，线性。缺数据 → 中性。
  const commission =
    effectiveCommission === null
      ? NEUTRAL
      : clamp100(((effectiveCommission - 8) / (50 - 8)) * 100);

  // 2) 评论分（25%）：log10 尺度，1 万条评论 → 100 分。缺数据 → 中性。
  const reviews =
    reviewCount === null
      ? NEUTRAL
      : clamp100((Math.log10(reviewCount + 1) / 4) * 100);

  // 3) 价格分（20%）：$25–$200 为最佳区间（100 分）；
  //    低于 $25 从 0 线性爬升（太便宜佣金绝对值小）；
  //    高于 $200 线性衰减，到 $1000 → 0 分（太贵付费流量难转化）。
  //    缺数据 → 中性。
  let priceScore = NEUTRAL;
  if (price !== null) {
    if (price <= 0) priceScore = 0;
    else if (price < 25) priceScore = (price / 25) * 100;
    else if (price <= 200) priceScore = 100;
    else priceScore = clamp100(100 - ((price - 200) / (1000 - 200)) * 100);
  }

  // 4) 佣金率分（10%）：30% → 100 分，线性。缺数据 → 中性。
  const rate =
    commissionRate === null ? NEUTRAL : clamp100((commissionRate / 30) * 100);

  // 5) 结算率分（15%，补强 #1）：结算率数值直接映射为分数
  //    （70% 结算率 → 70 分）。未知/越界 → 中性，绝不编造。
  const settlement = settlementRate === null ? NEUTRAL : clamp100(settlementRate);

  // 6) 返款周期分（10%，补强 #4）：分档见文件头；>90 天只给 20 分（扣分）。
  const payoutCycle = payoutCycleScore(payoutDays);

  let score = Math.round(
    (commission * 30 +
      reviews * 20 +
      priceScore * 15 +
      rate * 10 +
      settlement * 15 +
      payoutCycle * 10) /
      100
  );

  // $8 门槛：算得出佣金且 < $8 → 直接限分（经济性判断，非政策禁止）。
  let cappedByGate = false;
  if (
    effectiveCommission !== null &&
    effectiveCommission < MIN_COMMISSION_USD
  ) {
    cappedByGate = true;
    score = Math.min(score, RECOMMEND_GATE_CAP);
  }
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    recommended: score >= RECOMMEND_THRESHOLD,
    breakdown: {
      commission: Math.round(commission),
      reviews: Math.round(reviews),
      price: Math.round(priceScore),
      rate: Math.round(rate),
      settlement: Math.round(settlement),
      payoutCycle: Math.round(payoutCycle),
    },
    cappedByGate,
    effectiveCommission,
  };
}
