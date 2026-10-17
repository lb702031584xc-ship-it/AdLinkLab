/**
 * Budget pacer strings (zh/en).
 * Standalone fragment (not wired into dictionaries.ts — do not add it there);
 * import directly from "@/i18n/dict/budget-rules" and pick by lang.
 */
export const zh = {
  budgetRules: {
    title: "预算自动调整",
    description:
      "按 ROAS 自动调整广告系列日预算：达到目标就加预算，远低于目标就降预算。所有调整都通过 SyncJob 排队，由你的 Google Ads 脚本执行——绝不直连 Google Ads API。",
    newRule: "新建规则",
    noRules: "还没有预算规则。先在下方创建一个，检查无误后再手动启用。",
    columns: {
      campaign: "广告系列",
      targetRoas: "目标 ROAS",
      budgetRange: "预算区间（日）",
      spendCap: "花费熔断",
      lastAction: "上次动作 / 原因",
      lastEvaluated: "上次评估",
      enabled: "启用",
      detail: "历史",
    },
    action: {
      up: "上调",
      down: "下调",
      hold: "保持",
      init: "初始",
      paused: "已暂停（熔断）",
    },
    spendCapOff: "未启用",
    spendCapAutoPauseOn: "超限自动暂停：开",
    spendCapAutoPauseOff: "超限自动暂停：关",
    enabledOn: "已启用",
    enabledOff: "已停用",
    enable: "启用",
    disable: "停用",
    neverEvaluated: "尚未评估",
    historyTitle: "评估历史",
    historyEmpty: "暂无评估记录",
    historyNote: "规则只保留最近一次评估结果（无独立历史表）。",
    form: {
      title: "新建预算规则",
      googleAccount: "Google 账户",
      campaignName: "广告系列名称",
      campaignNameHint: "模糊匹配该账户下名称包含此文本的广告系列",
      targetRoas: "目标 ROAS",
      minBudget: "日预算下限",
      maxBudget: "日预算上限",
      increasePct: "上调幅度 %",
      decreasePct: "下调幅度 %",
      checkInterval: "评估间隔（天）",
      initialBudget: "当前日预算（可选）",
      initialBudgetHint:
        "作为调整基线；不填则首次评估会保持并提示缺少当前预算",
      maxSpendCap: "累计花费上限 maxSpendCap（留空=不启用）",
      maxSpendCapHint:
        "累计花费（投放档案 spend 之和）达到该上限且已勾选自动暂停时，暂停该广告系列",
      autoPauseOnBreach: "超限自动暂停 autoPauseOnBreach（默认关闭）",
      autoPauseOnBreachHint:
        "勾选后，累计花费达到上限时自动下发 Google Ads 暂停任务",
      submit: "创建规则",
      submitting: "创建中…",
      cancel: "取消",
      defaultsNote: "上调/下调幅度默认 20%，评估间隔默认 7 天，创建后默认停用。",
    },
    spendWarning:
      "注意：当前系统没有广告花费数据源，规则在有花费数据前会保持并注明原因；收入来自真实转化数据。",
    createFailed: "创建失败",
    updateFailed: "更新失败",
    loadFailed: "加载失败",
    toggleConfirm: (name: string, on: boolean) =>
      `确认${on ? "启用" : "停用"}「${name}」的预算自动调整？`,
    unknownError: "未知错误",
  },
};

export const en = {
  budgetRules: {
    title: "Budget Auto-Pacing",
    description:
      "Adjust campaign daily budgets by ROAS automatically: scale up when the target is met, scale down when far below. Every change is queued as a SyncJob and executed by your Google Ads Script — never a direct Google Ads API call.",
    newRule: "New rule",
    noRules:
      "No budget rules yet. Create one below, review it, then enable it manually.",
    columns: {
      campaign: "Campaign",
      targetRoas: "Target ROAS",
      budgetRange: "Daily budget range",
      spendCap: "Spend circuit breaker",
      lastAction: "Last action / reason",
      lastEvaluated: "Last evaluated",
      enabled: "Enabled",
      detail: "History",
    },
    action: {
      up: "Up",
      down: "Down",
      hold: "Hold",
      init: "Init",
      paused: "Paused (breaker)",
    },
    spendCapOff: "Disabled",
    spendCapAutoPauseOn: "Auto-pause on breach: on",
    spendCapAutoPauseOff: "Auto-pause on breach: off",
    enabledOn: "Enabled",
    enabledOff: "Disabled",
    enable: "Enable",
    disable: "Disable",
    neverEvaluated: "Not evaluated yet",
    historyTitle: "Evaluation history",
    historyEmpty: "No evaluation records",
    historyNote:
      "Rules keep only the most recent evaluation (no separate history table).",
    form: {
      title: "New budget rule",
      googleAccount: "Google account",
      campaignName: "Campaign name",
      campaignNameHint:
        "Fuzzy-matches campaigns whose name contains this text under the account",
      targetRoas: "Target ROAS",
      minBudget: "Min daily budget",
      maxBudget: "Max daily budget",
      increasePct: "Increase %",
      decreasePct: "Decrease %",
      checkInterval: "Check interval (days)",
      initialBudget: "Current daily budget (optional)",
      initialBudgetHint:
        "Used as the adjustment baseline; leave empty and the first evaluation will hold with a reason",
      maxSpendCap: "Cumulative spend cap maxSpendCap (empty = disabled)",
      maxSpendCapHint:
        "When cumulative spend (sum of launch-archive spend) reaches this cap and auto-pause is on, the campaign is paused",
      autoPauseOnBreach: "Auto-pause on breach autoPauseOnBreach (default off)",
      autoPauseOnBreachHint:
        "When checked, reaching the cap queues a Google Ads pause task",
      submit: "Create rule",
      submitting: "Creating…",
      cancel: "Cancel",
      defaultsNote:
        "Increase/decrease default to 20%, check interval to 7 days; rules are created disabled.",
    },
    spendWarning:
      "Note: the system has no ad-spend data source yet, so rules will hold with a reason until spend data exists; revenue comes from real conversion data.",
    createFailed: "Failed to create",
    updateFailed: "Failed to update",
    loadFailed: "Failed to load",
    toggleConfirm: (name: string, on: boolean) =>
      `Confirm ${on ? "enabling" : "disabling"} budget auto-pacing for "${name}"?`,
    unknownError: "Unknown error",
  },
};

export type BudgetRulesDict = typeof zh;
