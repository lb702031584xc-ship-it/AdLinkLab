/**
 * ⚡套利教练 — 速测看板判定纯函数。
 *
 * 规则（课程原打法，dict/arb-coach.ts board 文案一致）：
 * - 🔪 砍：单个 target/创意/lander 花费 ≥ 1×payout 且转化 = 0；或 ROI ≤ -50% 且花费 ≥ $10
 * - 🚀 加量：ROI > 20%
 * - 👀 观察：其余（数据不足 / 还没花钱 / payout 未知）
 *
 * 纯函数：无 IO，可单元测试；localStorage 读写在组件层。
 */

export type ArbComboVerdict = "kill" | "scale" | "watch";

export type ArbComboReason =
  | "kill_no_conv"
  | "kill_roi"
  | "scale"
  | "watch"
  | "no_spend"
  | "no_payout";

export interface ArbComboInput {
  spend: number;
  clicks: number;
  conversions: number;
  payout: number;
}

export interface ArbComboResult {
  cpc: number;
  epc: number;
  /** ROI 小数：0.2 = 20%。spend 为 0 时为 0。 */
  roi: number;
  verdict: ArbComboVerdict;
  reason: ArbComboReason;
}

/** 花费达到多少算"测够了"（kill_roi 档的门槛）。 */
export const ARB_KILL_SPEND_USD = 10;
/** ROI 低于多少判砍（kill_roi 档）。 */
export const ARB_KILL_ROI = -0.5;
/** ROI 高于多少判加量。 */
export const ARB_SCALE_ROI = 0.2;

function num(n: number): number {
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function judgeArbCombo(raw: ArbComboInput): ArbComboResult {
  const spend = num(raw.spend);
  const clicks = num(raw.clicks);
  const conversions = num(raw.conversions);
  const payout = num(raw.payout);

  const cpc = clicks > 0 ? spend / clicks : 0;
  const revenue = conversions * payout;
  const epc = clicks > 0 ? revenue / clicks : 0;
  const roi = spend > 0 ? (revenue - spend) / spend : 0;

  if (spend <= 0) {
    return { cpc, epc, roi, verdict: "watch", reason: "no_spend" };
  }
  if (payout <= 0) {
    return { cpc, epc, roi, verdict: "watch", reason: "no_payout" };
  }
  // 🔪 砍 1：1 单佣金花完还没转化（课程砍线：单个 target/创意/lander 1x payout 零转化即暂停）
  if (conversions === 0 && spend >= payout) {
    return { cpc, epc, roi, verdict: "kill", reason: "kill_no_conv" };
  }
  // 🔪 砍 2：ROI ≤ -50% 且已花 $10
  if (spend >= ARB_KILL_SPEND_USD && roi <= ARB_KILL_ROI) {
    return { cpc, epc, roi, verdict: "kill", reason: "kill_roi" };
  }
  // 🚀 加量：ROI > 20%
  if (roi > ARB_SCALE_ROI) {
    return { cpc, epc, roi, verdict: "scale", reason: "scale" };
  }
  // 👀 观察
  return { cpc, epc, roi, verdict: "watch", reason: "watch" };
}

/** verdict → dict 文案 key 映射（组件层用 dict.board.verdictKill 等渲染）。 */
export function verdictLabelKey(
  verdict: ArbComboVerdict
): "verdictKill" | "verdictScale" | "verdictWatch" {
  return verdict === "kill"
    ? "verdictKill"
    : verdict === "scale"
      ? "verdictScale"
      : "verdictWatch";
}

/** reason → dict 文案 key 映射。 */
export function reasonLabelKey(
  reason: ArbComboReason
): "reasonKillNoConv" | "reasonKillRoi" | "reasonScale" | "reasonWatch" | "reasonNoSpend" | "reasonNoPayout" {
  switch (reason) {
    case "kill_no_conv":
      return "reasonKillNoConv";
    case "kill_roi":
      return "reasonKillRoi";
    case "scale":
      return "reasonScale";
    case "no_spend":
      return "reasonNoSpend";
    case "no_payout":
      return "reasonNoPayout";
    default:
      return "reasonWatch";
  }
}
