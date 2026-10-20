/**
 * 商品推荐指数计算（2026-10-19；2026-10-20 并入统一评分入口）。
 *
 * 本函数是 recommendationScore 的唯一计算来源（质量分，公式不变）。
 * recommended 的判定不在这里：由 catalog-screening.ts 的 evaluateProduct
 * 统一负责（有预设走预设阈值，无预设时才用本函数的 score >= 60 口径）。
 * 同步评分、POST /catalog/screen、POST /catalog/products/calc-score 三处
 * 都经 evaluateProduct 调用本函数，同一商品结果一致，不再互相覆盖。
 *
 * 权重（固定）：
 *   佣金金额  40% — 单次转化能赚多少是第一位的
 *   评论数    25% — 社会证明，评论越多转化越稳
 *   价格      20% — 适中最好：太便宜佣金绝对值小，太贵付费流量难转化
 *   佣金率    15% — 比例高低的辅助信号
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
}

export interface RecommendationBreakdown {
  commission: number; // 0–100
  reviews: number; // 0–100
  price: number; // 0–100
  rate: number; // 0–100
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

const numOrNull = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export function calcRecommendationScore(
  input: RecommendationInput
): RecommendationResult {
  const commissionAmount = numOrNull(input.commissionAmount);
  const commissionRate = numOrNull(input.commissionRate);
  const reviewCount = numOrNull(input.reviewCount);
  const price = numOrNull(input.price);

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

  // 4) 佣金率分（15%）：30% → 100 分，线性。缺数据 → 中性。
  const rate =
    commissionRate === null ? NEUTRAL : clamp100((commissionRate / 30) * 100);

  let score = Math.round(
    (commission * 40 + reviews * 25 + priceScore * 20 + rate * 15) / 100
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
    },
    cappedByGate,
    effectiveCommission,
  };
}
