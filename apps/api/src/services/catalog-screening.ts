/**
 * 商品库筛选评分（2026-10-18）：确定性公式，无任何 LLM。
 *
 * DEFAULT_PRESET 为 P1-30 讲师经验默认值——讲师经验，非普适真理；
 * 用户可在商品库设置页按自己的品类/渠道调整。
 * minCommissionAmount 默认引用 MIN_COMMISSION_USD（与入库第一道门槛、
 * 推演/工作表判定共用同一常量）：入库时已拦掉 <$8 的，库内筛选默认不再更严。
 */
import { MIN_COMMISSION_USD, estimateCommissionFigure } from "@adlinklab/shared";

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
  /** 0–100 确定性评分。 */
  score: number;
}

/**
 * 评分公式（确定性，各分项归一化到 0–100，加权求和，总分 0–100）：
 * - 佣金金额分（40）：minCommissionAmount→0 分，3 倍阈值→满分，线性；
 *   佣金口径与入库 $8 门槛完全一致（estimateCommissionFigure：固定佣金优先，
 *   否则 price×佣金率估算）——只有佣金率的商品（如 PB 百分比佣金）同样参与判定/计分。
 * - 佣金率分（25）：minCommissionRate→0 分，3 倍阈值→满分，线性；
 * - 评论分（20）：对数归一化，10000 评论→满分；
 * - 价格带分（15）：价格在 [minPrice, maxPrice] 内→满分，偏离越远越低。
 * 全部阈值通过 → recommended=true；任一阈值不通过 → recommended=false（分数照算）。
 * 缺失字段：该分项按 0 分计（不虚构数据）；佣金完全算不出（无金额、无率或无价）
 * → passAmount 不通过。
 */
export function scoreProduct(
  p: ScoreableProduct,
  preset: ScreeningPreset = DEFAULT_PRESET
): ScreeningResult {
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
  const num = (v: number | null | undefined): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  const price = num(p.price);
  const commissionAmount = num(p.commissionAmount);
  const commissionRate = num(p.commissionRate);
  const reviewCount = num(p.reviewCount);

  // 有效佣金口径与入库第一道门槛（catalog-sync 第 5 步）完全一致：
  // 固定佣金优先，否则 price×佣金率估算；算不出 → null（passAmount 不通过）。
  const { figure: effectiveCommission } = estimateCommissionFigure({
    amount: commissionAmount,
    ratePct: commissionRate,
    price,
  });

  // 阈值判定（阈值为 0/null → 该项不卡）。
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
    (price === null ||
      (!(eff.minPrice > 0) || price >= eff.minPrice) &&
        (!(eff.maxPrice > 0) || price <= eff.maxPrice));
  const recommended = passReviews && passAmount && passRate && passPrice;

  // 分项评分。
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const linearTo3x = (v: number | null, threshold: number): number => {
    if (v === null || threshold <= 0) return 0;
    if (v <= threshold) return 0;
    return clamp(((v - threshold) / (2 * threshold)) * 100);
  };
  const amountScore = linearTo3x(effectiveCommission, eff.minCommissionAmount); // 0–100
  const rateScore = linearTo3x(commissionRate, eff.minCommissionRate); // 0–100
  const reviewScore =
    reviewCount === null ? 0 : clamp((Math.log10(reviewCount + 1) / 4) * 100); // 10^4→100
  let priceScore = 0;
  if (price !== null && eff.minPrice > 0 && eff.maxPrice > eff.minPrice) {
    if (price >= eff.minPrice && price <= eff.maxPrice) {
      priceScore = 100;
    } else {
      const width = eff.maxPrice - eff.minPrice;
      const dist =
        price < eff.minPrice ? eff.minPrice - price : price - eff.maxPrice;
      priceScore = clamp(100 - (dist / width) * 100);
    }
  }

  const score = Math.round(
    (amountScore * 40 + rateScore * 25 + reviewScore * 20 + priceScore * 15) / 100
  );
  const finalScore = clamp(score);

  if (eff.minScore > 0 && finalScore < eff.minScore) {
    return { recommended: false, score: finalScore };
  }
  return { recommended, score: finalScore };
}
