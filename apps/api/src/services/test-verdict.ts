/**
 * 测试阶段判定 + 扩量建议（纯函数）。
 *
 * 解决的问题：新手最大的困惑不是「选哪个」，而是「已经花了钱，现在到底
 * 该继续、该停、还是该加预算」。
 *
 * 判定顺序（先排除无效数据，再谈结论）：
 *   1. 没花钱也没点击                 → not_started
 *   2. 曝光够但 CTR 太低（<1%）        → low_ctr（文案/关键词不匹配，24h 可判）
 *   3. 花了钱但点击 < 50 且曝光不足    → no_delivery（投放设置问题）
 *   4. 点击 < 200                    → too_early（样本不够）
 *   5. 花费 ≥ 3 × 单笔佣金且 0 转化    → failing（判死）
 *   6. 实际 CVR ≥ 保本 CVR            → promising / winner
 *   7. 有转化但 CVR < 保本 CVR         → failing
 *   8. 其余                          → inconclusive
 *
 * 为什么 low_ctr 排在 no_delivery 前面：有曝光说明投放是通的，只是没人点；
 * 这时候让新手去改出价是错的，该改文案。反过来把「没曝光」当成「offer 不行」
 * 也是新手最常见的误判。
 *
 * 纪律：所有阈值都写在这里、可读可改；算不出保本 CVR 时不假装能判。
 */
export type TestStage =
  | "not_started"
  | "no_delivery"
  | "too_early"
  | "failing"
  | "promising"
  | "winner"
  | "inconclusive"
  /** 曝光够但 CTR 太低：文案/关键词与搜索意图不匹配。 */
  | "low_ctr";

export type TestAction =
  | "wait"
  | "fix_delivery"
  /** 修文案 / 换关键词，而不是改出价或停投。 */
  | "fix_creatives"
  | "stop"
  | "hold"
  | "scale_20"
  | "scale_50";

export interface TestVerdictInput {
  clicks: number;
  spendUsd: number;
  conversions: number;
  revenueUsd: number;
  /** 已投放天数（保留字段，供后续节奏规则用）。 */
  daysRunning?: number | null;
  /** 曝光数：用于 CTR 早期信号（Google Ads 里每天就有）。 */
  impressions?: number | null;
  /** 保本 CVR（百分数，2.5 表示 2.5%）；null = 算不出。 */
  breakevenCvrPct?: number | null;
  /** 单笔佣金（美元），用于「花费 ≥ 3 倍佣金」的止损线。 */
  payoutUsd?: number | null;
}

export interface TestVerdictResult {
  stage: TestStage;
  action: TestAction;
  actualCvrPct: number | null;
  epcUsd: number | null;
  /** 点击率（%）：比转化更早可得的信号。 */
  ctrPct: number | null;
  /** 距离「可以下结论」还差多少（供界面显示进度）。 */
  remaining: {
    clicksToDecide: number;
    spendCapUsd: number | null;
  };
  reasons: string[];
}

export const MIN_CLICKS_TO_DECIDE = 200;
export const MIN_CLICKS_DELIVERY = 50;
export const STOP_AT_PAYOUT_MULTIPLE = 3;
export const WINNER_MIN_CONVERSIONS = 10;
export const STRONG_ROAS = 1.5;
/** CTR 早期信号的样本门槛：曝光不足时 CTR 波动太大，不下结论。 */
export const MIN_IMPRESSIONS_FOR_CTR = 500;
/** CTR 低于此值说明文案或关键词与搜索意图不匹配（行业经验值，可调）。 */
export const LOW_CTR_PCT = 1;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

export function judgeTestStage(input: TestVerdictInput): TestVerdictResult {
  const clicks = Math.max(0, Math.floor(num(input.clicks) ?? 0));
  const spend = Math.max(0, num(input.spendUsd) ?? 0);
  const conversions = Math.max(0, Math.floor(num(input.conversions) ?? 0));
  const revenue = Math.max(0, num(input.revenueUsd) ?? 0);
  const impressions = Math.max(0, Math.floor(num(input.impressions) ?? 0));
  const breakeven = num(input.breakevenCvrPct);
  const payout = num(input.payoutUsd);

  const actualCvrPct = clicks > 0 ? (conversions / clicks) * 100 : null;
  const epcUsd = clicks > 0 ? revenue / clicks : null;
  const ctrPct = impressions > 0 ? (clicks / impressions) * 100 : null;
  const spendCapUsd =
    payout != null && payout > 0 ? round2(payout * STOP_AT_PAYOUT_MULTIPLE) : null;
  const remaining = {
    clicksToDecide: Math.max(0, MIN_CLICKS_TO_DECIDE - clicks),
    spendCapUsd,
  };

  const base = { actualCvrPct, epcUsd, ctrPct, remaining };

  if (clicks === 0 && spend === 0) {
    return {
      ...base,
      stage: "not_started",
      action: "wait",
      reasons: ["还没有投放数据，先建计划跑起来"],
    };
  }

  // 1) CTR 早期信号：有曝光但没人点 —— 问题在文案/关键词，不是 offer。
  if (
    ctrPct != null &&
    impressions >= MIN_IMPRESSIONS_FOR_CTR &&
    ctrPct < LOW_CTR_PCT &&
    clicks < MIN_CLICKS_TO_DECIDE
  ) {
    return {
      ...base,
      stage: "low_ctr",
      action: "fix_creatives",
      reasons: [
        `曝光 ${impressions} 次只有 ${clicks} 次点击（CTR ${ctrPct.toFixed(2)}% < ${LOW_CTR_PCT}%）：问题在文案或关键词与搜索意图不匹配，不是 offer 本身`,
      ],
    };
  }

  // 2) 没拿到量：花了钱、点击极少、且曝光也不够（或没有曝光数据）。
  //    有足够曝光的情况已在上一步被 CTR 分支拦下。
  if (
    clicks < MIN_CLICKS_DELIVERY &&
    (ctrPct == null || impressions < MIN_IMPRESSIONS_FOR_CTR)
  ) {
    return {
      ...base,
      stage: "no_delivery",
      action: "fix_delivery",
      reasons: [
        `已花 $${round2(spend)} 但只有 ${clicks} 次点击、曝光不足：这是投放设置问题（出价过低 / 审核未过 / 受众过窄），不是 offer 的问题`,
      ],
    };
  }

  // 3) 样本不足
  if (clicks < MIN_CLICKS_TO_DECIDE) {
    return {
      ...base,
      stage: "too_early",
      action: "wait",
      reasons: [
        `只有 ${clicks} 次点击，还差 ${remaining.clicksToDecide} 次才够下结论（${MIN_CLICKS_TO_DECIDE} 次门槛）`,
      ],
    };
  }

  // 4) 点击够了：先看是否已经烧穿止损线。
  if (conversions === 0 && spendCapUsd != null && spend >= spendCapUsd) {
    return {
      ...base,
      stage: "failing",
      action: "stop",
      reasons: [
        `已花 $${round2(spend)}（止损线 $${spendCapUsd} = ${STOP_AT_PAYOUT_MULTIPLE} × 单笔佣金）仍 0 转化，可以判死`,
      ],
    };
  }

  // 5) 佣金未知 → 算不出保本线，不判达标与否。
  if (breakeven == null) {
    return {
      ...base,
      stage: "inconclusive",
      action: "hold",
      reasons: ["佣金未知，算不出保本 CVR，无法判断达标与否——先补佣金再复盘"],
    };
  }

  const cvr = actualCvrPct ?? 0;
  if (cvr >= breakeven) {
    const roas = spend > 0 ? revenue / spend : 0;
    const isWinner = conversions >= WINNER_MIN_CONVERSIONS && revenue > spend;
    if (isWinner) {
      return {
        ...base,
        stage: "winner",
        action: roas >= STRONG_ROAS ? "scale_50" : "scale_20",
        reasons: [
          `实际 CVR ${cvr.toFixed(2)}% ≥ 保本 ${breakeven.toFixed(2)}%，${conversions} 次转化、ROAS ${roas.toFixed(2)}`,
          roas >= STRONG_ROAS
            ? "可以加预算 50%（每 3 天最多一次，避免重启学习期）"
            : "先加预算 20%，稳住再继续",
        ],
      };
    }
    return {
      ...base,
      stage: "promising",
      action: "hold",
      reasons: [
        `实际 CVR ${cvr.toFixed(2)}% ≥ 保本 ${breakeven.toFixed(2)}%，但只有 ${conversions} 次转化，再跑到 ${WINNER_MIN_CONVERSIONS} 次再决定扩量`,
      ],
    };
  }

  return {
    ...base,
    stage: "failing",
    action: "stop",
    reasons: [
      `实际 CVR ${cvr.toFixed(2)}% 低于保本 ${breakeven.toFixed(2)}%，${clicks} 次点击已够下结论——这个 offer 不成立`,
    ],
  };
}
