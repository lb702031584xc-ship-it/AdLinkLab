/**
 * 每日预警独立页 strings (2026-10-19). Standalone dict.
 * 分级口径复用 @/lib/daily-alerts（P0/P1/P2 + 三分组），不另立标准。
 */
export const zh = {
  page: {
    title: "每日预警",
    description: "按 P0 立即处理 / P1 需要关注 / P2 信息提醒分级的每日风险报告，只展示不自动执行。",
    loadError: "每日预警加载失败",
    noData: "暂无数据：还没有投放档案或告警，报告待生成。",
    reportDate: "报告日期",
    today: "今天",
    lastEvent: "最后事件",
    baseline: "数据生成于",
    noRiskTitle: "未发现运行中风险",
  },
  current: {
    title: "当前活跃风险（本次报告）",
    overview: "风险总览",
    unresolvedOf: "未处理 {u} / 总数 {t}",
  },
  history: {
    title: "近 90 日历史累计（包含已恢复项）",
    p0: "累计风险 P0",
    p1: "累计风险 P1",
    p2: "累计风险 P2",
    total: "累计总数",
  },
  events: {
    title: "风险事件（按业务模块查看）",
    activeItems: "{n} 项活跃",
    empty: "暂无风险事件",
    source: "来源",
  },
};

export type DailyAlertsPageDict = typeof zh;

export const en: DailyAlertsPageDict = {
  page: {
    title: "Daily Alerts",
    description:
      "Daily risk report graded P0 (act now) / P1 (watch) / P2 (info). Display only — nothing runs automatically.",
    loadError: "Failed to load daily alerts",
    noData: "No data yet: no launch archives or alerts, the report is pending.",
    reportDate: "Report date",
    today: "Today",
    lastEvent: "Last event",
    baseline: "Generated at",
    noRiskTitle: "No active risks found",
  },
  current: {
    title: "Active risks (this report)",
    overview: "Risk overview",
    unresolvedOf: "{u} unresolved / {t} total",
  },
  history: {
    title: "Last 90 days (including recovered)",
    p0: "Cumulative P0",
    p1: "Cumulative P1",
    p2: "Cumulative P2",
    total: "Cumulative total",
  },
  events: {
    title: "Risk events (by module)",
    activeItems: "{n} active",
    empty: "No risk events",
    source: "Source",
  },
};
