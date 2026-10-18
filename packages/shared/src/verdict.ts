/**
 * 判定口径唯一代码实现（P2-2）。
 *
 * verdict = min(条款门禁, 盈利, 流量门, 初筛) —— 四条腿中最弱的一条决定最终判定。
 * 书面口径见 docs/verdict-synthesis.md；本文件是该口径的唯一代码来源，
 * blueprint §7、工作表一票否决横幅都调这里，不许各写一遍 min 逻辑。
 *
 * min 规则（worst wins）：
 * - 任一腿 stop → stop；
 * - 无 stop 但有 caution → caution；
 * - 无 stop/caution 但有 unknown → unknown；
 * - 全 go → go。
 * unknown 永不降级为 stop（K4：unknown 不判 fail）。
 */

/** 单条腿的判定档位。unknown = 暂无数据/尚未判定，不拉低为 fail。 */
export type VerdictLegLevel = "go" | "caution" | "stop" | "unknown";

export interface VerdictLeg {
  level: VerdictLegLevel;
  /** 一句话原因：stop/caution/unknown 时建议填写（为什么拦/为什么未知）。 */
  reason?: string | null;
}

/**
 * 参与合成的腿。条款/盈利/流量门/初筛是口径规定的四条腿（均为可选：
 * 未评估的腿直接不传，不传 ≠ unknown ≠ go，不参与 min）。
 * 调用方可附加额外的腿（如工作表的 demand、compliance），同样参与 min。
 */
export interface VerdictLegs {
  terms?: VerdictLeg;
  profit?: VerdictLeg;
  trafficGate?: VerdictLeg;
  prescreen?: VerdictLeg;
  [extra: string]: VerdictLeg | undefined;
}

export interface SynthesizedVerdict {
  verdict: "go" | "caution" | "stop" | "unknown";
  /** 决定最终判定的腿（一档最弱的）的原因列表。 */
  reasons: string[];
  /** 一档最弱的腿名（调试/展示用）。 */
  worstLegs: string[];
}

/** 构造一条腿的小助手。 */
export function leg(level: VerdictLegLevel, reason?: string | null): VerdictLeg {
  return { level, reason: reason ?? null };
}

const RANK: Record<VerdictLegLevel, number> = {
  stop: 0,
  caution: 1,
  unknown: 2,
  go: 3,
};

/**
 * 合成最终判定。纯函数，无副作用，可前后端共用。
 * 没有传入任何腿时返回 unknown（无证据不断言 go）。
 */
export function synthesizeVerdict(legs: VerdictLegs): SynthesizedVerdict {
  const entries = Object.entries(legs).filter(
    (e): e is [string, VerdictLeg] => e[1] != null
  );
  if (entries.length === 0) {
    return { verdict: "unknown", reasons: [], worstLegs: [] };
  }
  let worstRank = 3;
  for (const [, l] of entries) {
    const r = RANK[l.level];
    if (r < worstRank) worstRank = r;
  }
  const worstLegs = entries
    .filter(([, l]) => RANK[l.level] === worstRank)
    .map(([name]) => name);
  const reasons = entries
    .filter(([, l]) => RANK[l.level] === worstRank)
    .map(([, l]) => l.reason)
    .filter((r): r is string => !!r);
  const verdict =
    worstRank === 0 ? "stop" : worstRank === 1 ? "caution" : worstRank === 2 ? "unknown" : "go";
  return { verdict, reasons, worstLegs };
}
