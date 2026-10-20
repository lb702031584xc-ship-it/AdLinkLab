/**
 * P2-9 — 每日预警分级（纯函数；复用 P1-5 的 pace-checklist.ts 规则源，不另立口径）。
 * API 只返回原始输入（档案摘要 + 近 90 天 Alerts），分级全部在 Web 端计算。
 * 只做展示，绝不自动执行。
 */
import { daysActiveSince, paceChecklist } from "./pace-checklist";

export type DailyAlertLevel = "P0" | "P1" | "P2";
export type DailyAlertGroup = "立即止损" | "投放受限" | "数据与归因";

export interface DailyAlertsInput {
  generatedAt: string;
  hasData: boolean;
  archives: Array<{
    id: string;
    offerName: string;
    impressions: number | null;
    clicks: number | null;
    spend: number | null;
    conversions: number | null;
    revenue: number | null;
    payout: number | null;
    launchedAt: string | null;
    createdAt: string;
    endedAt: string | null;
  }>;
  alerts: Array<{
    id: string;
    metric: string;
    severity: string;
    message: string;
    status: string;
    createdAt: string;
  }>;
}

export interface DailyAlertItem {
  level: DailyAlertLevel;
  group: DailyAlertGroup;
  title: string;
  detail: string;
  source: string;
  archiveId?: string;
}

export interface DailyAlertsClassified {
  items: DailyAlertItem[];
  counts: Record<DailyAlertLevel, { total: number; unresolved: number }>;
}

function levelOfSuggestion(level: "info" | "warn" | "action"): DailyAlertLevel {
  if (level === "action") return "P0";
  if (level === "warn") return "P1";
  return "P2";
}

function groupOfText(text: string): DailyAlertGroup {
  if (text.includes("亏损") || text.includes("停止")) return "立即止损";
  if (text.includes("无展示") || text.includes("无点击")) return "投放受限";
  return "数据与归因";
}

function levelOfSeverity(severity: string): DailyAlertLevel {
  const s = severity.toLowerCase();
  if (s === "critical" || s === "high" || s === "error") return "P0";
  if (s === "warning" || s === "warn" || s === "medium") return "P1";
  return "P2";
}

export function classifyDailyAlerts(input: DailyAlertsInput): DailyAlertsClassified {
  const items: DailyAlertItem[] = [];
  const counts: DailyAlertsClassified["counts"] = {
    P0: { total: 0, unresolved: 0 },
    P1: { total: 0, unresolved: 0 },
    P2: { total: 0, unresolved: 0 },
  };
  for (const a of input.archives) {
    const suggestions = paceChecklist({
      impressions: a.impressions,
      clicks: a.clicks,
      conversions: a.conversions,
      spend: a.spend,
      revenue: a.revenue,
      payout: a.payout,
      daysActive: daysActiveSince(a.launchedAt ?? a.createdAt),
    });
    for (const s of suggestions) {
      const level = levelOfSuggestion(s.level);
      items.push({
        level,
        group: groupOfText(s.text),
        title: `${a.offerName} — ${s.text}`,
        detail: s.text,
        source: s.source,
        archiveId: a.id,
      });
      counts[level].total += 1;
      counts[level].unresolved += 1; // 节奏建议均为待处理（展示即未处理）
    }
  }
  for (const alert of input.alerts) {
    const level = levelOfSeverity(alert.severity);
    const unresolved = alert.status === "open";
    counts[level].total += 1;
    if (unresolved) counts[level].unresolved += 1;
    items.push({
      level,
      group: "数据与归因",
      title: `${alert.metric} — ${alert.message}`,
      detail: alert.message,
      source: "近 90 天告警",
    });
  }
  // 排序：P0 → P1 → P2。
  const order: Record<DailyAlertLevel, number> = { P0: 0, P1: 1, P2: 2 };
  items.sort((x, y) => order[x.level] - order[y.level]);
  return { items, counts };
}

export const DAILY_ALERT_LEVEL_LABELS: Record<DailyAlertLevel, string> = {
  P0: "P0 立即处理",
  P1: "P1 需要关注",
  P2: "P2 信息提醒",
};

export const DAILY_ALERT_GROUP_LABELS: Record<DailyAlertGroup, string> = {
  立即止损: "立即止损",
  投放受限: "投放受限",
  数据与归因: "数据与归因",
};
