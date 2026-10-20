/**
 * 商品库筛选评估（2026-10-18；2026-10-20 统一评分口径）。
 *
 * 历史上有两套公式同时写 recommendationScore / recommended 互相覆盖：
 * - scoreProduct：绑定筛选预设的加权分（金额40/率25/评论20/价格15，缺数据 0 分）；
 * - calcRecommendationScore：固定权重质量分（缺数据中性 50 分）。
 * 2026-10-20 起统一为单一入口 evaluateProduct：
 * - recommendationScore 的唯一计算 = calcRecommendationScore（质量分，公式不变）；
 * - recommended 的唯一判定 = 预设阈值（本文件的 pass 逻辑：有效佣金用
 *   estimateCommissionFigure 口径、评论、价格带、佣金率、minScore 全过）；
 *   无预设（preset=null）时 recommended = score >= RECOMMEND_THRESHOLD(60)。
 * 同步评分（catalog-sync 第 7 步）、POST /catalog/screen、
 * POST /catalog/products/calc-score 三处都调 evaluateProduct，结果一致。
 *
 * DEFAULT_PRESET 为 P1-30 讲师经验默认值——讲师经验，非普适真理；
 * 用户可在商品库设置页按自己的品类/渠道调整。
 * minCommissionAmount 默认引用 MIN_COMMISSION_USD（与入库第一道门槛、
 * 推演/工作表判定共用同一常量）：入库时已拦掉 <$8 的，库内筛选默认不再更严。
 */
import { MIN_COMMISSION_USD, estimateCommissionFigure } from "@adlinklab/shared";
import {
  calcRecommendationScore,
  RECOMMEND_THRESHOLD,
  type RecommendationBreakdown,
} from "./recommendation-score.js";

export interface ScreeningPreset {
  minReviews?: number | null;
  minCommissionAmount?: number | null;
  minCommissionRate?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  minScore?: number | null;
}

export const DEFAULT_PRESET = {
  // P1-30 讲师经验默认值（注释标注：讲师经验，非普适真理）。
  minReviews: 0,
  minCommissionAmount: MIN_COMMISSION_USD,
  minCommissionRate: 10,
  minPrice: 80,
  maxPrice: 150,
  minScore: 0,
};

export interface ScoreableProduct {
  price?: number | null;
  commissionAmount?: number | null;
  commissionRate?: number | null;
  reviewCount?: number | null;
}

export interface ScreeningResult {
  recommended: boolean;
  /** 0–100 确定性评分（= calcRecommendationScore 质量分）。 */
  score: number;
}

export interface EvaluateResult extends ScreeningResult {
  /** 质量分分项（佣金/评论/价格/佣金率，0–100）。 */
  breakdown: RecommendationBreakdown;
}

const num = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * 预设阈值判定（recommended 的唯一口径，有预设时）：
 * 评论 / 有效佣金（estimateCommissionFigure：固定佣金优先，否则 price×佣金率
 * 估算；算不出 → 不通过）/ 佣金率 / 价格带 四项全过，且质量分 >= minScore。
 * 阈值为 0/null → 该项不卡；价格缺失 → 价格带不卡（与历史行为一致）。
 */
function presetRecommended(
  p: ScoreableProduct,
  preset: ScreeningPreset,
  score: number
): boolean {
  const eff = {
    minReviews: preset.minReviews ?? DEFAULT_PRESET.minReviews,
    minCommissionAmount:
      preset.minCommissionAmount ?? DEFAULT_PRESET.minCommissionAmount,
    minCommissionRate:
      preset.minCommissionRate ?? DEFAULT_PRESET.minCommissionRate,
    minPrice: preset.minPrice ?? DEFAULT_PRESET.minPrice,
    maxPrice: preset.maxPrice ?? DEFAULT_PRESET.maxPrice,
    minScore: preset.minScore ?? DEFAULT_PRESET.minScore,
  };
  const price = num(p.price);
  const commissionRate = num(p.commissionRate);
  const reviewCount = num(p.reviewCount);

  const { figure: effectiveCommission } = estimateCommissionFigure({
    amount: num(p.commissionAmount),
    ratePct: commissionRate,
    price,
  });

  const passReviews =
    !(eff.minReviews > 0) || (reviewCount !== null && reviewCount >= eff.minReviews);
  const passAmount =
    !(eff.minCommissionAmount > 0) ||
    (effectiveCommission !== null &&
      effectiveCommission >= eff.minCommissionAmount);
  const passRate =
    !(eff.minCommissionRate > 0) ||
    (commissionRate !== null && commissionRate >= eff.minCommissionRate);
  const passPrice =
    price === null ||
    ((!(eff.minPrice > 0) || price >= eff.minPrice) &&
      (!(eff.maxPrice > 0) || price <= eff.maxPrice));
  if (!(passReviews && passAmount && passRate && passPrice)) return false;
  if (eff.minScore > 0 && score < eff.minScore) return false;
  return true;
}

/**
 * 统一评估入口：score 恒为 calcRecommendationScore 质量分；
 * recommended 有预设走预设阈值，无预设（null）走 score >= 60。
 */
export function evaluateProduct(
  p: ScoreableProduct,
  preset: ScreeningPreset | null
): EvaluateResult {
  const r = calcRecommendationScore({
    commissionAmount: p.commissionAmount,
    commissionRate: p.commissionRate,
    reviewCount: p.reviewCount,
    price: p.price,
  });
  const recommended =
    preset === null
      ? r.score >= RECOMMEND_THRESHOLD
      : presetRecommended(p, preset, r.score);
  return { score: r.score, recommended, breakdown: r.breakdown };
}

/**
 * 兼容旧签名（同步/筛选旧调用点）：等价于 evaluateProduct(p, preset) 的
 * { recommended, score }。不再有独立权重公式。
 */
export function scoreProduct(
  p: ScoreableProduct,
  preset: ScreeningPreset = DEFAULT_PRESET
): ScreeningResult {
  const r = evaluateProduct(p, preset);
  return { recommended: r.recommended, score: r.score };
}
