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
 *
 * 松绑模式（2026-10-25，preset.mode === "loose"，常规模式行为一字不动）：
 * - recommended 只看两条 OR 准入：价格 ≥ $80，或有效佣金 > $5；
 *   不设价格上限、不设佣金率下限、不设评论下限、不卡 minScore；
 * - 有效佣金仍用 estimateCommissionFigure（与常规路径同一 helper，
 *   不另写佣金换算）；figure === 0 直接排除；figure 为 null（未知）
 *   时不排除（未知不拦），准入只看价格那条；
 * - 注意 helper 的 toPositiveNum 把 0 折成 null（0% 佣金率 / 0 金额
 *   与真正未知在 figure 上无法区分）：松绑分支另用原始输入做
 *   「显式为零」判定（amount === 0 或 commissionRate === 0），
 *   这不是佣金换算，只是零值识别——0% 佣金是已知为零，必须排除，
 *   不能借「未知不拦」混过去；
 * - score 仍为 calcRecommendationScore 质量分（松绑只改 recommended
 *   的门，不改分）；
 * - 黑名单排除不在本函数内，仍在 /screen 路由里。
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
  /**
   * 筛选口径：缺失/undefined = 常规（regular）。松绑（loose）见文件头注释；
   * 常规模式下本字段不参与任何判定。
   */
  mode?: "regular" | "loose";
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
  /** 补强 #1：所属商家历史结算率（%，0–100）；null/缺失 = 未验证，评分中性。 */
  settlementRatePct?: number | null;
  /** 补强 #4：返款周期天数；null/缺失 = 未知，评分中性；>90 天扣分。 */
  payoutCycleDays?: number | null;
}

export interface ScreeningResult {
  recommended: boolean;
  /** 0–100 确定性评分（= calcRecommendationScore 质量分）。 */
  score: number;
}

export interface EvaluateResult extends ScreeningResult {
  /** 质量分分项（佣金/评论/价格/佣金率/结算率/返款周期，0–100）。 */
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
 * 松绑判定（preset.mode === "loose" 时的 recommended 唯一口径）：
 * 有效佣金 figure === 0 或原始输入显式为零 → 排除；
 * 否则准入 = 价格 ≥ $80 或有效佣金 > $5（满足任一）。
 * 其余预设阈值（评论/佣金率/价格上限/minScore）一律不卡。
 */
function looseRecommended(p: ScoreableProduct): boolean {
  const price = num(p.price);
  const commissionRate = num(p.commissionRate);
  const { figure } = estimateCommissionFigure({
    amount: num(p.commissionAmount),
    ratePct: commissionRate,
    price,
  });
  // helper 把 0 折成 null，故显式零值须看原始输入（见文件头注释）。
  const explicitlyZero =
    num(p.commissionAmount) === 0 || commissionRate === 0;
  if (figure === 0 || explicitlyZero) return false;
  const passPrice = price !== null && price >= 80;
  const passCommission = figure !== null && figure > 5;
  return passPrice || passCommission;
}

/**
 * 统一评估入口：score 恒为 calcRecommendationScore 质量分；
 * recommended 有预设走预设阈值（松绑预设走松绑分支），
 * 无预设（null）走 score >= 60。
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
    settlementRatePct: p.settlementRatePct,
    payoutCycleDays: p.payoutCycleDays,
  });
  const recommended =
    preset === null
      ? r.score >= RECOMMEND_THRESHOLD
      : preset.mode === "loose"
        ? looseRecommended(p)
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
