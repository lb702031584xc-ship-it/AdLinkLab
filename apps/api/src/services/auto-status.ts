/**
 * P1-6：自动状态联动（纯评估器 + 执行器）。
 *
 * 默认关闭（autoStatusEnabled=false 时只给建议，不改任何状态）。
 * 显式开启后，仅零表现（zeroPerfDays 天内零点击）触发自动暂停 Offer
 * （ACTIVE → PAUSED），并写 AuditLog；ROAS 下滑只给建议，永不自动暂停。
 * 评估基于投放档案聚合数据；没有档案 → 不评估（不编造）。
 */

export interface AutoStatusPrefs {
  autoStatusEnabled: boolean;
  zeroPerfDays: number;
  roscDeclineDays: number;
}

export interface ArchiveStat {
  /** 档案创建时间（用于算已跑天数）。 */
  createdAt: Date;
  clicks: number | null;
  spend: number | null;
  revenue: number | null;
}

export type AutoStatusSuggestion = "none" | "pause_zero_perf" | "review_rosc_decline";

export interface AutoStatusEvaluation {
  suggestion: AutoStatusSuggestion;
  /** 是否真的会执行自动暂停（需开启 + 零表现建议）。 */
  willAutoPause: boolean;
  reason: string;
}

const DAY_MS = 86_400_000;

function daysSince(d: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / DAY_MS));
}

function roas(a: ArchiveStat): number | null {
  if (a.spend == null || a.revenue == null || a.spend <= 0) return null;
  return a.revenue / a.spend;
}

/**
 * 纯评估：archives 按 createdAt 升序（最旧 → 最新）。
 * - 零表现：最新档案已跑 ≥ zeroPerfDays 天且累计点击为 0 → pause_zero_perf。
 * - ROAS 下滑：有 ≥2 份档案，最新 ROAS < 上一份 ROAS，且两份间隔 ≥ roscDeclineDays 天 → review_rosc_decline。
 * - 其余 → none。
 */
export function evaluateAutoStatus(
  prefs: AutoStatusPrefs,
  archives: ArchiveStat[],
  now = new Date()
): AutoStatusEvaluation {
  if (archives.length === 0) {
    return { suggestion: "none", willAutoPause: false, reason: "无投放档案，不评估" };
  }
  const latest = archives[archives.length - 1];
  const ageDays = daysSince(latest.createdAt, now);
  const totalClicks = archives.reduce((sum, a) => sum + (a.clicks ?? 0), 0);
  if (ageDays >= prefs.zeroPerfDays && totalClicks === 0) {
    return {
      suggestion: "pause_zero_perf",
      willAutoPause: prefs.autoStatusEnabled,
      reason: `已跑 ${ageDays} 天（阈值 ${prefs.zeroPerfDays} 天）且累计点击为 0`,
    };
  }
  if (archives.length >= 2) {
    const prev = archives[archives.length - 2];
    const gapDays = Math.floor(
      (latest.createdAt.getTime() - prev.createdAt.getTime()) / DAY_MS
    );
    const rPrev = roas(prev);
    const rLatest = roas(latest);
    if (
      rPrev != null && rLatest != null &&
      rLatest < rPrev && gapDays >= prefs.roscDeclineDays
    ) {
      return {
        suggestion: "review_rosc_decline",
        willAutoPause: false,
        reason: `ROAS 由 ${rPrev.toFixed(2)} 下滑至 ${rLatest.toFixed(2)}（间隔 ${gapDays} 天 ≥ ${prefs.roscDeclineDays} 天），建议人工复核，不自动暂停`,
      };
    }
  }
  return { suggestion: "none", willAutoPause: false, reason: "未触发自动状态条件" };
}
