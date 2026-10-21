/**
 * 广告投放数量计算「预估 → 确认」的数字拼装（纯函数，可单测）。
 *
 * 付费防误触口径（与后端 preview/calc 同一套数字定义）：
 * - 将计费查询的组数：增量模式 = groupsStale（过期/未算的组）；
 *   强制模式 = groupsTotal − deadGroupsSkipped（全量减去活口径死组，
 *   scope=all 时 deadGroupsSkipped 恒为 0，即全部组）。
 * - 强制模式下缓存不再跳过任何组 → freshSkipped 归 0（确认框不展示该行）。
 */
export type CalcAdCountScope = "all" | "alive";
export type CalcKeySource = "owner" | "tenant-own" | "platform";

/** 每组查询深度的可选档位（总查询数，含裸品牌词 1 次），与后端同口径。 */
export const CALC_DEPTH_OPTIONS = [4, 8, 12] as const;
export type CalcDepth = (typeof CALC_DEPTH_OPTIONS)[number];
/** 默认深度 = 后端默认（历史行为，每组最多 12 次）。 */
export const DEFAULT_CALC_DEPTH: CalcDepth = 12;

/**
 * localStorage 里的深度是用户可篡改的外部输入：只接受 "4"|"8"|"12"，
 * 其余一律视为未存（调用方回默认 12），与 resolveStoredSort 同防御口径。
 */
export function resolveStoredCalcDepth(
  raw: string | null | undefined
): CalcDepth | null {
  if (raw === "4" || raw === "8" || raw === "12") return Number(raw) as CalcDepth;
  return null;
}

/**
 * 美元金额展示：最多 4 位小数、至少 2 位（0.004 显示 "0.004" 而不是
 * "0.00"——小额预估四舍五入成 0 会误导用户以为免费）。仅格式化，
 * 数值本身永远来自后端预估，前端不算钱。
 */
export function formatUsdAmount(v: number): string {
  if (!Number.isFinite(v)) return "0.00";
  const fixed = v.toFixed(4);
  const dot = fixed.indexOf(".");
  let end = fixed.length;
  // 末尾 0 逐个去掉，但至少保留 2 位小数（dot+3 = 小数点后第 2 位的下标界）
  while (end > dot + 3 && fixed[end - 1] === "0") end -= 1;
  return fixed.slice(0, end);
}

export interface CalcAdCountPreviewData {
  allowed: boolean;
  keySource: CalcKeySource | null;
  groupsTotal: number;
  groupsFresh: number;
  groupsStale: number;
  deadGroupsSkipped: number;
  /** 以下费用预估字段由后端 preview 返回（可选：旧响应缺失时为 undefined）。 */
  depth?: number;
  expectedQueries?: number;
  worstCaseQueries?: number;
  unitPriceUsd?: number;
  estimatedCostUsd?: number;
}

export interface CalcAdCountConfirmFacts {
  /** 本次将真正计费查询的品牌组数。 */
  billableGroups: number;
  /** 因 14 天缓存将跳过的组数（强制模式为 0）。 */
  freshSkipped: number;
  /** 活口径下将跳过的全死组数（scope=all 时为 0）。 */
  deadSkipped: number;
  scope: CalcAdCountScope;
  force: boolean;
  /** 本次计算的每组查询深度（确认与提交都按此快照）。 */
  depth: CalcDepth;
  /** 预计实际查询数（后端按本地派生预估；缺失 → null，确认框不展示该行）。 */
  expectedQueries: number | null;
  /** 最坏查询数 = 将计费组数 × 深度（后端返回；缺失 → null）。 */
  worstCaseQueries: number | null;
  /** 单次查询单价（美元，后端常量；缺失 → null）。 */
  unitPriceUsd: number | null;
  /** 预计费用（美元，后端 = 预计查询数 × 单价；前端只展示不计算）。 */
  estimatedCostUsd: number | null;
  keySource: CalcKeySource | null;
  allowed: boolean;
}

export function calcAdCountConfirmFacts(
  preview: CalcAdCountPreviewData,
  opts: { force: boolean; scope: CalcAdCountScope; depth?: CalcDepth }
): CalcAdCountConfirmFacts {
  return {
    billableGroups: opts.force
      ? preview.groupsTotal - preview.deadGroupsSkipped
      : preview.groupsStale,
    freshSkipped: opts.force ? 0 : preview.groupsFresh,
    deadSkipped: preview.deadGroupsSkipped,
    scope: opts.scope,
    force: opts.force,
    depth:
      (preview.depth as CalcDepth | undefined) ??
      opts.depth ??
      DEFAULT_CALC_DEPTH,
    expectedQueries: preview.expectedQueries ?? null,
    worstCaseQueries: preview.worstCaseQueries ?? null,
    unitPriceUsd: preview.unitPriceUsd ?? null,
    estimatedCostUsd: preview.estimatedCostUsd ?? null,
    keySource: preview.keySource,
    allowed: preview.allowed,
  };
}
