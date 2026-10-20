/**
 * ⚡套利教练 — 测试节奏阶梯（纯前端派生，不改 judgeArbCombo 的砍/留/加量判定）。
 *
 * 按组合快照点击量 clicks 派生当前阶段（lead菌 / 课程节奏：30 → 等 2 天 → 60 → 100）：
 * - clicks < 30        验证期 verify：先跑满 30 个点击看是否出单
 * - 30 ≤ clicks < 60   等延迟 wait：已满 30 点击，先暂停等约 2 天（转化有延迟），不出单就放弃
 * - 60 ≤ clicks < 100  看持续 sustain：跑到 60 点击，看能否持续出单
 * - clicks ≥ 100       综合判定 judge：结合延迟转化与 ROI 做去留（参考砍/留/加量判定）
 *
 * 纯函数：无 IO，可单元测试；文案在 dict/arb-coach.ts board.pace* 里。
 */

export type PaceStage = "verify" | "wait" | "sustain" | "judge";

/** 阶段点击门槛（下限，含）。 */
export const PACE_THRESHOLDS = { wait: 30, sustain: 60, judge: 100 } as const;

export function paceStageForClicks(clicks: number): PaceStage {
  const c = Number.isFinite(clicks) && clicks > 0 ? clicks : 0;
  if (c < PACE_THRESHOLDS.wait) return "verify";
  if (c < PACE_THRESHOLDS.sustain) return "wait";
  if (c < PACE_THRESHOLDS.judge) return "sustain";
  return "judge";
}

/** stage → dict 阶段名 key 映射（组件层用 dict.board[key] 渲染）。 */
export function paceStageLabelKey(
  stage: PaceStage
): "paceStageVerify" | "paceStageWait" | "paceStageSustain" | "paceStageJudge" {
  switch (stage) {
    case "wait":
      return "paceStageWait";
    case "sustain":
      return "paceStageSustain";
    case "judge":
      return "paceStageJudge";
    default:
      return "paceStageVerify";
  }
}

/** stage → dict 该做什么 key 映射。 */
export function paceActionLabelKey(
  stage: PaceStage
): "paceActionVerify" | "paceActionWait" | "paceActionSustain" | "paceActionJudge" {
  switch (stage) {
    case "wait":
      return "paceActionWait";
    case "sustain":
      return "paceActionSustain";
    case "judge":
      return "paceActionJudge";
    default:
      return "paceActionVerify";
  }
}
