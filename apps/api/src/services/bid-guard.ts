/**
 * 出价保本校验（2026-10-28，纯函数）。
 *
 * 目的：把「算出来的保本 CPC」变成「建计划时的硬约束」。
 * 在此之前，关键词推荐给出「这个词最多 $0.40」，而建广告时用的是
 * 另一个数（手填或 AI 建议），两者之间没有任何关系。
 *
 * 保本 CPC = 净 payout × 目标 CVR
 *   净 payout = 单笔佣金 × (1 − 拒单率) × (1 − 退款率)
 *
 * 纪律：
 *   - 出价缺失 / 佣金未知 → 不拦截（算不出来就不装能算）；
 *   - 只在能算出保本线且出价确实超过时才判定为不允许；
 *   - 越界幅度一并返回，供提示文案使用。
 */
export interface BidGuardInput {
  /** 计划里最大的出价（美元/点击）。null 或 <=0 视为未设置。 */
  maxCpcUsd: number | null;
  /** 单笔佣金（美元）。null 或 <=0 视为未知。 */
  payoutUsd: number | null;
  targetCvrPct?: number | null;
  rejectionRate?: number | null;
  refundRate?: number | null;
}

export interface BidGuardResult {
  allowed: boolean;
  /** 实际出价（回显）。 */
  maxCpcUsd: number | null;
  /** 保本 CPC；算不出为 null。 */
  breakevenCpcUsd: number | null;
  /** 超出保本线的百分比（正数表示超了）；未超或算不出为 null。 */
  overByPct: number | null;
  /** 不允许时给用户看的原因；允许时为 null。 */
  reason: string | null;
}

export const DEFAULT_BID_GUARD_CVR_PCT = 2.5;
export const DEFAULT_BID_GUARD_REJECTION = 0.15;
export const DEFAULT_BID_GUARD_REFUND = 0.05;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function checkBidAgainstBreakeven(input: BidGuardInput): BidGuardResult {
  const maxCpc = num(input.maxCpcUsd);
  const payout = num(input.payoutUsd);

  // 出价没设：没有可校验的对象。
  if (maxCpc == null || maxCpc <= 0) {
    return {
      allowed: true,
      maxCpcUsd: maxCpc,
      breakevenCpcUsd: null,
      overByPct: null,
      reason: null,
    };
  }

  // 佣金未知：算不出保本线，不拦截（但也不假装校验过）。
  if (payout == null || payout <= 0) {
    return {
      allowed: true,
      maxCpcUsd: maxCpc,
      breakevenCpcUsd: null,
      overByPct: null,
      reason: null,
    };
  }

  const cvr = clamp(num(input.targetCvrPct) ?? DEFAULT_BID_GUARD_CVR_PCT, 0.1, 100);
  const rejection = clamp(
    num(input.rejectionRate) ?? DEFAULT_BID_GUARD_REJECTION,
    0,
    1
  );
  const refund = clamp(num(input.refundRate) ?? DEFAULT_BID_GUARD_REFUND, 0, 1);

  const netPayout = payout * (1 - rejection) * (1 - refund);
  const breakeven = round4(netPayout * (cvr / 100));
  if (!(breakeven > 0)) {
    return {
      allowed: true,
      maxCpcUsd: maxCpc,
      breakevenCpcUsd: null,
      overByPct: null,
      reason: null,
    };
  }

  if (maxCpc <= breakeven + 1e-9) {
    return {
      allowed: true,
      maxCpcUsd: maxCpc,
      breakevenCpcUsd: breakeven,
      overByPct: null,
      reason: null,
    };
  }

  const overByPct = Math.round((maxCpc / breakeven - 1) * 1000) / 10;
  return {
    allowed: false,
    maxCpcUsd: maxCpc,
    breakevenCpcUsd: breakeven,
    overByPct,
    reason:
      `出价 $${maxCpc.toFixed(2)} 高于保本 CPC $${breakeven.toFixed(2)} ` +
      `（佣金 $${payout.toFixed(2)}，目标 CVR ${cvr}%，` +
      `按拒单 ${Math.round(rejection * 100)}% / 退款 ${Math.round(refund * 100)}% 折算），` +
      `超 ${overByPct.toFixed(1)}%——按这个价投必然亏损`,
  };
}
