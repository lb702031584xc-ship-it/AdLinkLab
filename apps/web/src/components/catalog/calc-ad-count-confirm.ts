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

export interface CalcAdCountPreviewData {
  allowed: boolean;
  keySource: CalcKeySource | null;
  groupsTotal: number;
  groupsFresh: number;
  groupsStale: number;
  deadGroupsSkipped: number;
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
  keySource: CalcKeySource | null;
  allowed: boolean;
}

export function calcAdCountConfirmFacts(
  preview: CalcAdCountPreviewData,
  opts: { force: boolean; scope: CalcAdCountScope }
): CalcAdCountConfirmFacts {
  return {
    billableGroups: opts.force
      ? preview.groupsTotal - preview.deadGroupsSkipped
      : preview.groupsStale,
    freshSkipped: opts.force ? 0 : preview.groupsFresh,
    deadSkipped: preview.deadGroupsSkipped,
    scope: opts.scope,
    force: opts.force,
    keySource: preview.keySource,
    allowed: preview.allowed,
  };
}
