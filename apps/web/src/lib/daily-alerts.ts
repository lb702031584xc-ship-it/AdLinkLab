/**
 * P2-9 — 每日预警分级（纯函数；复用 P1-5 的 pace-checklist.ts 规则源，不另立口径）。
 * API 只返回原始输入（档案摘要 + 近 90 天 Alerts），分级全部在 Web 端计算。
 * 只做展示，绝不自动执行。
 */
import { daysActiveSince, paceChecklist } from "./pace-checklist";

export type DailyAlertLevel = "P0" | "P1" | "P2";
export type DailyAlertGroup =
  | "立即止损"
  | "投放受限"
  | "数据与归因"
  | "佣金与上下线";

/** 补强 #21：预警种类（供 UI 选图标）。旧数据无 kind 时按 pace/alert 处理。 */
export type DailyAlertKind =
  | "pace"
  | "alert"
  | "commission_change"
  | "offer_offline";

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
    /** 补强 #20/#21（可选）：offer 转化流；有值时 pace 止损倍数按流取。 */
    conversionFlow?: string | null;
  }>;
  /**
   * 补强 #21（可选）：在投 offer 的当前值 + 上次同步值快照。
   * API 暂未返回该字段时整段缺失 → 不产生这两类预警（拿不到历史值不报，
   * 绝不编造变动）。字段齐全时才比对：
   * - commissionRate / commissionAmount 与 previous* 不一致 → 佣金变动
   * - status 非 ACTIVE，或 productStatus = inactive → 下线/暂停
   */
  offers?: Array<{
    id: string;
    name: string;
    status?: string | null;
    productStatus?: string | null;
    commissionRate?: number | null;
    previousCommissionRate?: number | null;
    commissionAmount?: number | null;
    previousCommissionAmount?: number | null;
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
  /** 补强 #21：预警种类（UI 图标用）；旧路径默认 pace/alert。 */
  kind?: DailyAlertKind;
  offerId?: string;
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
      conversionFlow: a.conversionFlow ?? null,
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
        kind: "pace",
      });
      counts[level].total += 1;
      counts[level].unresolved += 1; // 节奏建议均为待处理（展示即未处理）
    }
  }
  // 补强 #21：佣金变动 + 在投 offer 下线/暂停（只用已有当前值/上次同步值比对；
  // 任一侧缺失就不报，绝不编造变动）。
  for (const o of input.offers ?? []) {
    const push = (
      level: DailyAlertLevel,
      kind: DailyAlertKind,
      title: string,
      detail: string,
    ) => {
      items.push({
        level,
        group: "佣金与上下线",
        title,
        detail,
        source: "Offer 同步快照比对 / Sync snapshot comparison",
        kind,
        offerId: o.id,
      });
      counts[level].total += 1;
      counts[level].unresolved += 1;
    };
    // (a) 佣金率变动
    if (
      o.commissionRate != null &&
      o.previousCommissionRate != null &&
      Number.isFinite(o.commissionRate) &&
      Number.isFinite(o.previousCommissionRate) &&
      o.commissionRate !== o.previousCommissionRate
    ) {
      push(
        "P1",
        "commission_change",
        `${o.name} — 佣金率变动 Commission rate changed：${o.previousCommissionRate} → ${o.commissionRate}`,
        `佣金率与上次同步值不一致（${o.previousCommissionRate} → ${o.commissionRate}），请核对盈利测算与出价。`,
      );
    }
    // (a) 佣金金额变动
    if (
      o.commissionAmount != null &&
      o.previousCommissionAmount != null &&
      Number.isFinite(o.commissionAmount) &&
      Number.isFinite(o.previousCommissionAmount) &&
      o.commissionAmount !== o.previousCommissionAmount
    ) {
      push(
        "P1",
        "commission_change",
        `${o.name} — 佣金金额变动 Commission changed：${o.previousCommissionAmount} → ${o.commissionAmount}`,
        `单次佣金与上次同步值不一致（${o.previousCommissionAmount} → ${o.commissionAmount}），请核对盈利测算与出价。`,
      );
    }
    // (b) 在投 offer 下线/暂停：status 变为非 ACTIVE
    if (o.status != null && o.status !== "" && o.status !== "ACTIVE") {
      push(
        "P0",
        "offer_offline",
        `${o.name} — Offer 已下线/暂停 Offer offline/paused：status = ${o.status}`,
        `在投 offer 状态已变为 ${o.status}（非 ACTIVE），请立即暂停对应广告，避免继续烧钱无佣金。`,
      );
    }
    // (b) 商品下线：NetworkProduct.status = inactive
    if (o.productStatus != null && o.productStatus.toLowerCase() === "inactive") {
      push(
        "P0",
        "offer_offline",
        `${o.name} — 商品已下线 Product inactive`,
        `商品状态为 inactive，请立即暂停对应广告并更换 offer。`,
      );
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
      kind: "alert",
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
  佣金与上下线: "佣金与上下线",
};

/** 补强 #21：kind → 图标（卡片与页面共用）。 */
export const DAILY_ALERT_KIND_ICONS: Record<DailyAlertKind, string> = {
  pace: "⏱️",
  alert: "🔔",
  commission_change: "💰",
  offer_offline: "⛔",
};
