/**
 * 初筛（零成本杀法则）纯逻辑：4 条确定性规则。
 *
 * - 第 1 条（黑名单）与第 4 条（流量门）需要调后端，编排在工作表组件里；
 *   这里只放不依赖网络的纯函数，便于 vitest 覆盖。
 * - 第 2 条复用 packages/shared/src/commission-gate.ts（$8 门槛，unknown 不拦）。
 * - 第 3 条是后端 traffic/gate.ts evaluatePaidZeroRule 的客户端镜像实现
 *   （同一口径：kill 档 / caution 档 / 数据不足 unknown；阈值走后端配置）。
 */
import {
  MIN_COMMISSION_USD,
  estimateCommissionFigure,
  belowMinCommission,
  minCommissionStopReason,
} from "../../../../packages/shared/src/commission-gate";

export type PrescreenRowId =
  | "blacklist"
  | "commission"
  | "paidZero"
  | "trafficGate";

/**
 * idle=未跑 pass=通过 kill=命中（一票否决） caution=谨慎（继续往下走）
 * unknown=未检测（数据不足，不杀——unknown 永不判 fail）
 */
export type PrescreenRowStatus =
  | "idle"
  | "pass"
  | "kill"
  | "caution"
  | "unknown";

export interface PrescreenRowState {
  id: PrescreenRowId;
  status: PrescreenRowStatus;
  reason: string;
}

export function initialPrescreenRows(): PrescreenRowState[] {
  const ids: PrescreenRowId[] = [
    "blacklist",
    "commission",
    "paidZero",
    "trafficGate",
  ];
  return ids.map((id) => ({ id, status: "idle" as PrescreenRowStatus, reason: "" }));
}

/**
 * 竞争红海（补强 #2，后端 gate.ts evaluateRedOceanRule 的客户端镜像常量）：
 * 付费 > 自然 × 50% 且付费绝对量 ≥ 1000 → caution（慎入），永不 kill。
 */
export const PAID_RED_OCEAN_MIN_PAID = 1000;
export const PAID_RED_OCEAN_RATIO = 0.5;

function normPositiveInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0
    ? Math.floor(v)
    : null;
}

function normNonNegInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0
    ? Math.floor(v)
    : null;
}

/**
 * 第 2 条：$8 佣金门槛。payout 已知且 < 阈值 → kill；
 * 未知（未填/算不出）→ unknown，不拦截。
 * 佣金口径与后端入库门槛一致（estimateCommissionFigure）：固定佣金（amount）优先，
 * 缺金额时可用 extra.ratePct × extra.price 估算（如百分比佣金 offer 的佣金率 × 均价）。
 */
export function evaluateCommissionPrescreen(
  payoutRaw: unknown,
  lang: "zh" | "en",
  thresholdUsd: number = MIN_COMMISSION_USD,
  extra?: { ratePct?: unknown; price?: unknown },
): { status: PrescreenRowStatus; reason: string } {
  const fig = estimateCommissionFigure({
    amount: payoutRaw,
    ratePct: extra?.ratePct,
    price: extra?.price,
  });
  if (fig.figure == null) {
    return {
      status: "unknown",
      reason:
        lang === "zh"
          ? "佣金未知（未填 payout），不拦截"
          : "Commission unknown (no payout entered) — not blocking",
    };
  }
  if (belowMinCommission(fig.figure, thresholdUsd)) {
    return {
      status: "kill",
      reason: minCommissionStopReason(fig.figure, "USD", thresholdUsd, lang),
    };
  }
  return {
    status: "pass",
    reason:
      lang === "zh"
        ? `单次转化佣金 $${fig.figure} ≥ $${thresholdUsd}，有测试价值`
        : `Per-conversion commission $${fig.figure} ≥ $${thresholdUsd} — worth testing`,
  };
}

/**
 * 第 3 条：付费为零规则（客户端镜像实现，口径与后端一致）。
 * - kill：自然流量 ≥ organicTrafficMin 且付费流量 === 0
 * - caution：0 < 付费 < 自然 × warnRatio（不 kill，继续）
 * - caution（红海，补强 #2）：付费 > 自然 × 50% 且付费 ≥ 1000（不 kill，继续）
 * - unknown：数据不足（organic 未知/低于阈值，或 paid 未知）→ 不杀
 */
export function evaluatePaidZeroPrescreen(
  organicTraffic: unknown,
  paidTraffic: unknown,
  paidKeywords: unknown,
  organicTrafficMin: number,
  warnRatio: number,
  lang: "zh" | "en",
): { status: PrescreenRowStatus; reason: string } {
  const organic = normPositiveInt(organicTraffic);
  const paid = normNonNegInt(paidTraffic);
  const paidKw = normNonNegInt(paidKeywords);
  const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
  if (organic == null || paid == null) {
    return {
      status: "unknown",
      reason:
        lang === "zh"
          ? "SEMrush 自然/付费流量未填或不足，不做付费为零判定（不杀）"
          : "SEMrush organic/paid traffic missing or below threshold — no paid-zero verdict (not blocking)",
    };
  }
  // 竞争红海（补强 #2，镜像后端）：与付费为零规则共用 caution 档但文案可区分；
  // 永不 kill。独立于 organicTrafficMin——付费绝对量与占比已足够说明竞争。
  if (paid >= PAID_RED_OCEAN_MIN_PAID && paid > organic * PAID_RED_OCEAN_RATIO) {
    const pct = Math.round((paid / organic) * 100);
    return {
      status: "caution",
      reason:
        lang === "zh"
          ? `竞争红海：付费流量已达自然流量的 ${pct}%（自然 ${fmtInt(organic)}，付费 ${fmtInt(paid)}），同行付费竞争激烈，慎入`
          : `Red ocean: paid traffic is ${pct}% of organic (organic ${fmtInt(organic)}, paid ${fmtInt(paid)}) — competitors are spending heavily on paid; enter with caution`,
    };
  }
  if (organic < organicTrafficMin) {
    return {
      status: "unknown",
      reason:
        lang === "zh"
          ? "SEMrush 自然/付费流量未填或不足，不做付费为零判定（不杀）"
          : "SEMrush organic/paid traffic missing or below threshold — no paid-zero verdict (not blocking)",
    };
  }
  const kwPart =
    paidKw != null
      ? lang === "zh"
        ? `（付费关键词 ${fmtInt(paidKw)}）`
        : ` (${fmtInt(paidKw)} paid keywords)`
      : "";
  if (paid === 0) {
    return {
      status: "kill",
      reason:
        lang === "zh"
          ? `自然流量 ${fmtInt(organic)} 但付费流量为 0${kwPart}——同行已验证付费跑不正，直接 PK（SEMrush 为估算值，阈值仅作方向性判断）`
          : `Organic traffic ${fmtInt(organic)} but paid traffic is 0${kwPart} — competitors have proven paid doesn't convert; kill it (SEMrush values are estimates; thresholds are directional)`,
    };
  }
  if (paid < organic * warnRatio) {
    const pct = Math.round(warnRatio * 100);
    return {
      status: "caution",
      reason:
        lang === "zh"
          ? `付费流量极少（不到自然流量的 ${pct}%）：自然 ${fmtInt(organic)}，付费 ${fmtInt(paid)}——同行付费投入微弱，谨慎测试、小预算验证`
          : `Paid traffic minimal (<${pct}% of organic): organic ${fmtInt(organic)}, paid ${fmtInt(paid)} — competitors invest little in paid; test cautiously with a small budget`,
    };
  }
  return {
    status: "pass",
    reason:
      lang === "zh"
        ? `自然流量 ${fmtInt(organic)}，付费流量 ${fmtInt(paid)}，有同行在投付费`
        : `Organic ${fmtInt(organic)}, paid ${fmtInt(paid)} — competitors are spending on paid`,
  };
}

/**
 * 初筛综合：任一 kill → kill；全部 pass → pass；
 * 否则 pending（有 unknown/caution/idle，未被判停）。
 */
export function prescreenOverall(
  rows: PrescreenRowState[],
): "kill" | "pass" | "pending" {
  if (rows.some((r) => r.status === "kill")) return "kill";
  if (rows.length > 0 && rows.every((r) => r.status === "pass")) return "pass";
  return "pending";
}
