/**
 * 测试阶段判定 + 扩量建议（2026-10-28，纯函数）。
 *
 * 解决的问题：新手最大的困惑不是「选哪个」，而是「已经花了钱，现在到底
 * 该继续、该停、还是该加预算」。系统此前只有筛选和止损，没有把事情
 * 串成「小额测试 → 看到结果 → 扩大投流」这条节奏。
 *
 * 判定顺序（先排除无效数据，再谈结论）：
 *   1. 没花钱也没点击            → not_started（还没开始）
 *   2. 花了钱但点击 < 50         → no_delivery（投放设置问题，不是 offer 问题）
 *   3. 点击 < 200               → too_early（样本不够，任何结论都是噪声）
 *   4. 花费 ≥ 3 × 单笔佣金且 0 转化 → failing（可以判死了）
 *   5. 实际 CVR ≥ 保本 CVR       → promising / winner
 *   6. 有转化但 CVR < 保本 CVR    → failing（测出来了，不达标）
 *   7. 其余                      → inconclusive（数据够但中性）
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
  | "inconclusive";

export type TestAction =
  | "wait"
  | "fix_delivery"
  | "stop"
  | "hold"
  | "scale_20"
  | "scale_50";

export interface TestVerdictInput {
  clicks: number;
  spendUsd: number;
  conversions: number;
  revenueUsd: number;
  /** 已投放天数（用于 no_delivery 判定）。 */
  daysRunning?: number | null;
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
  const breakeven = num(input.breakevenCvrPct);
  const payout = num(input.payoutUsd);

  const actualCvrPct = clicks > 0 ? (conversions / clicks) * 100 : null;
  const epcUsd = clicks > 0 ? revenue / clicks : null;
  const spendCapUsd =
    payout != null && payout > 0 ? round2(payout * STOP_AT_PAYOUT_MULTIPLE) : null;
  const remaining = {
    clicksToDecide: Math.max(0, MIN_CLICKS_TO_DECIDE - clicks),
    spendCapUsd,
  };

  const base = { actualCvrPct, epcUsd, remaining };

  if (clicks === 0 && spend === 0) {
    return {
      ...base,
      stage: "not_started",
      action: "wait",
      reasons: ["还没有投放数据，先建计划跑起来"],
    };
  }

  if (clicks < MIN_CLICKS_DELIVERY) {
    return {
      ...base,
      stage: "no_delivery",
      action: "fix_delivery",
      reasons: [
        `已花 $${round2(spend)} 但只有 ${clicks} 次点击：这是投放设置问题（出价过低 / 审核未过 / 受众过窄），不是 offer 的问题`,
      ],
    };
  }

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

  // 到这一步点击已够：先看是否已经烧穿止损线。
  if (
    conversions === 0 &&
    spendCapUsd != null &&
    spend >= spendCapUsd
  ) {
    return {
      ...base,
      stage: "failing",
      action: "stop",
      reasons: [
        `已花 $${round2(spend)}（止损线 $${spendCapUsd} = ${STOP_AT_PAYOUT_MULTIPLE} × 单笔佣金）仍 0 转化，可以判死`,
      ],
    };
  }

  if (breakeven == null) {
    return {
      ...base,
      stage: "inconclusive",
      action: "hold",
      reasons: [
        "佣金未知，算不出保本 CVR，无法判断达标与否——先补佣金再复盘",
      ],
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
