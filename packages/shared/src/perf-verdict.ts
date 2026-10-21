/**
 * 投流止损 / 低价判断引擎（确定性纯函数，前后端共用唯一来源）。
 *
 * 背景：Google Ads 无 API 直连、转化不在站内，真实投后数据靠人工回填。
 * 本引擎只吃「最新一笔人工回填」+ Offer 的 payout / 经济上限（保本 CPC）/
 * 已知页首出价下限，输出确定性判断；数据不足 → insufficient，绝不猜。
 *
 * 规则（按优先级，先命中先算）：
 * 1. stop（红色·必须止损）：花费 >= 2.5 × payout 且转化 = 0
 *    （站内既有止损口径：花费 ≥ 2.5×payout 且 0 转化 → 立即暂停）。
 * 2. market_too_high（红色·市场价高于经济上限，建议停）：
 *    展示 = 0 且页首出价下限 > 经济上限 —— 不是鼓励加价，是判死。
 * 3. low_bid（琥珀·出价太低）：展示 = 0 且已回填实际出价 < 页首出价下限
 *    （且页首下限未超过经济上限，还有加价空间时才给这条）。
 * 4. ok（绿色·可继续）：有转化且实际平均 CPC <= 经济上限。
 * 5. insufficient（灰色·数据不足）：无回填 / payout 未知 / 页首下限缺失 /
 *    尚未触发任何规则 —— 不猜。
 */

/** 止损倍数：花费达到 payout 的 2.5 倍且 0 转化 → 必须止损。 */
export const STOP_LOSS_PAYOUT_MULTIPLE = 2.5;

export interface AdPerfBackfillInput {
  /** 实际花费（与 payout 同币种）；null = 未回填。 */
  spend: number | null;
  /** 实际平均出价（CPC）；null = 未回填该项。 */
  avgCpc: number | null;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
}

export interface AdPerfContext {
  /** 单次转化佣金（payout）；null = 未知（止损规则无法判定）。 */
  payout: number | null;
  /** 经济上限 = 保本 CPC（投流快照）；null = 未知。 */
  breakevenCpc: number | null;
  /** 已知页首出价下限（广告测算 low_top_of_page_bid / 档案官方出价）；null = 无。 */
  topOfPageFloor: number | null;
}

export type AdPerfVerdictLevel =
  | "stop"
  | "market_too_high"
  | "low_bid"
  | "ok"
  | "insufficient";

export interface AdPerfVerdict {
  level: AdPerfVerdictLevel;
  /** 判断依据数字（前端逐项列明用）；算不出的一律 null，不编造。 */
  basis: {
    spend: number | null;
    payout: number | null;
    /** 花费 / payout 倍数；payout 未知或为 0 → null。 */
    spendPayoutRatio: number | null;
    /** 止损阈值 = 2.5 × payout；payout 未知 → null。 */
    stopLossThreshold: number | null;
    avgCpc: number | null;
    topOfPageFloor: number | null;
    breakevenCpc: number | null;
    impressions: number | null;
    conversions: number | null;
  };
}

function pos(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

function nonNeg(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

export function evaluateAdPerformance(
  backfill: AdPerfBackfillInput | null,
  ctx: AdPerfContext
): AdPerfVerdict {
  const payout = pos(ctx.payout);
  const breakevenCpc = pos(ctx.breakevenCpc);
  const floor = pos(ctx.topOfPageFloor);
  const spend = nonNeg(backfill?.spend);
  const avgCpc = pos(backfill?.avgCpc);
  const impressions = nonNeg(backfill?.impressions);
  const conversions = nonNeg(backfill?.conversions);
  const stopLossThreshold =
    payout !== null ? STOP_LOSS_PAYOUT_MULTIPLE * payout : null;
  const basis: AdPerfVerdict["basis"] = {
    spend,
    payout,
    spendPayoutRatio:
      payout !== null && spend !== null
        ? Math.round((spend / payout) * 100) / 100
        : null,
    stopLossThreshold,
    avgCpc,
    topOfPageFloor: floor,
    breakevenCpc,
    impressions,
    conversions,
  };

  if (!backfill || spend === null) {
    return { level: "insufficient", basis };
  }

  // 1) 必须止损：花费 >= 2.5×payout 且 0 转化（恰好 2.5 倍也触发）。
  if (
    stopLossThreshold !== null &&
    conversions === 0 &&
    spend >= stopLossThreshold
  ) {
    return { level: "stop", basis };
  }

  // 2/3) 0 展示：先看市场价是否已高于经济上限（判死），再看是否单纯出价低。
  if (impressions === 0 && floor !== null) {
    if (breakevenCpc !== null && floor > breakevenCpc) {
      return { level: "market_too_high", basis };
    }
    if (avgCpc !== null && avgCpc < floor) {
      return { level: "low_bid", basis };
    }
  }

  // 4) 有转化且实际 CPC 在经济上限内 → 可继续。
  if (
    conversions !== null &&
    conversions > 0 &&
    avgCpc !== null &&
    breakevenCpc !== null &&
    avgCpc <= breakevenCpc
  ) {
    return { level: "ok", basis };
  }

  // 5) 其余一律数据不足/未触发规则，不猜。
  return { level: "insufficient", basis };
}
