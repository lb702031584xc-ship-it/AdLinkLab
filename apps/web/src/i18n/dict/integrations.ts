/**
 * Script Integrations admin pages + components strings.
 * Shared vocabulary (nav, actions, pagination, generic empty/error) lives in
 * `t.common.*` — do not duplicate it here.
 */
export const zh = {
  list: {
    title: "集成",
    description:
      "管理 Google Ads 脚本集成、目标和安全的脚本生成。期望 URL 仅来自 ACTIVE 状态的 UrlVersion。",
    create: "创建集成",
    columns: {
      googleAccount: "Google 账号",
      targets: "目标",
      token: "令牌",
      lastSeen: "上次活跃",
    },
    empty: "还没有集成。创建一个开始吧。",
    footerPrefix: "只读同步健康状况也可在",
    footerSuffix: "查看。",
  },
  detail: {
    notFound: "未找到集成",
    overview: "概览",
    fields: {
      googleAccount: "Google 账号",
      tokenStatus: "令牌状态",
      lastSeen: "上次活跃",
      targets: "目标",
    },
    prefix: "前缀",
    scheduleNote:
      "脚本执行计划在 Google Ads 脚本中控制——本实验平台不会虚构下次执行时间。",
    rotateToken: "轮换令牌",
    disable: "禁用",
    enable: "启用",
    revoke: "撤销",
    delete: "删除",
    deleteConfirm:
      "确定删除这个集成？删除后 Google Ads 里的脚本将无法再拉取配置，请同时去 Google Ads 脚本页删除该脚本。",
    manualAdTitle: "手动登记真实广告",
    manualAdHint:
      "真实 Google Ads API 同步未接通时，在这里把 Google Ads 里的系列 / 广告组 / 广告 ID 登记进来，登记后即可在上方下拉里选中并关联。ID 必须和 Google Ads 里一致。",
    manualGoogleCampaignId: "Google 系列 ID",
    manualCampaignName: "系列名（可选）",
    manualGoogleAdGroupId: "Google 广告组 ID",
    manualAdGroupName: "广告组名（可选）",
    manualGoogleAdId: "Google 广告 ID",
    manualAdName: "广告名",
    manualRegisterAd: "登记广告",
    manualRegistered: "已登记",
    newTokenTitle: "新令牌（仅显示一次）",
    copyToken: "复制令牌",
    targets: "目标",
    ad: "广告",
    attachAd: "关联广告",
    detach: "解绑",
    noTargets: "未关联目标。",
    columns: {
      googleAdId: "Google 广告 ID",
      desired: "期望版本",
      applied: "已应用版本",
      sync: "同步",
      health: "健康度",
      lastExec: "上次执行",
    },
    scriptTitle: "Google Ads 脚本",
    scriptIntegration: "集成",
    scriptStatus: "状态",
    scriptVersion: (v: string) => ` · 版本 ${v}`,
    tokenLabel: "集成令牌（来自创建/轮换——仅保存在内存中）",
    generateScript: "生成脚本",
    securityNotice: "此脚本包含集成凭据。请妥善保管，不要公开分享。",
    copyScript: "复制脚本",
    clear: "清除",
    actionFailed: "操作失败",
  },
  new: {
    description: "仅需名称 + Google 账号。不需要代理、UA 或 Referer 字段。",
  },
  form: {
    nameLabel: "集成名称",
    namePlaceholder: "例如：生产环境美国脚本",
    accountLabel: "Google 账号",
    creating: "创建中…",
    copyToken: "复制令牌",
    tokenTitle: "集成令牌（仅显示一次）",
    tokenNote:
      "此令牌仅显示一次。请妥善保管。稍后生成 Google Ads 脚本源码时需要用到它。",
    continue: "继续",
  },
  errors: {
    unexpected: "发生未知的管理 API 错误",
  },
};

export const en: typeof zh = {
  list: {
    title: "Integrations",
    description:
      "Manage Google Ads Script Integrations, targets, and secure script generation. Desired URLs come from ACTIVE UrlVersion only.",
    create: "Create Integration",
    columns: {
      googleAccount: "Google Account",
      targets: "Targets",
      token: "Token",
      lastSeen: "Last seen",
    },
    empty: "No integrations yet. Create one to get started.",
    footerPrefix: "Read-only sync health also available on",
    footerSuffix: ".",
  },
  detail: {
    notFound: "Integration not found",
    overview: "Overview",
    fields: {
      googleAccount: "Google Account",
      tokenStatus: "Token status",
      lastSeen: "Last seen",
      targets: "Targets",
    },
    prefix: "prefix",
    scheduleNote:
      "Script execution schedule is controlled in Google Ads Scripts — this lab does not invent a next-execution time.",
    rotateToken: "Rotate Token",
    disable: "Disable",
    enable: "Enable",
    revoke: "Revoke",
    delete: "Delete",
    deleteConfirm:
      "Delete this integration? The Google Ads script will no longer be able to fetch config — also remove that script in Google Ads Scripts.",
    manualAdTitle: "Register a real ad manually",
    manualAdHint:
      "While the real Google Ads API sync is not connected, register the campaign / ad group / ad IDs from Google Ads here. After registering, the ad shows up in the dropdown above and can be attached. IDs must match Google Ads exactly.",
    manualGoogleCampaignId: "Google campaign ID",
    manualCampaignName: "Campaign name (optional)",
    manualGoogleAdGroupId: "Google ad group ID",
    manualAdGroupName: "Ad group name (optional)",
    manualGoogleAdId: "Google ad ID",
    manualAdName: "Ad name",
    manualRegisterAd: "Register ad",
    manualRegistered: "Registered",
    newTokenTitle: "New token (shown once)",
    copyToken: "Copy Token",
    targets: "Targets",
    ad: "Ad",
    attachAd: "Attach Ad",
    detach: "Detach",
    noTargets: "No targets attached.",
    columns: {
      googleAdId: "Google Ad ID",
      desired: "Desired",
      applied: "Applied",
      sync: "Sync",
      health: "Health",
      lastExec: "Last exec",
    },
    scriptTitle: "Google Ads Script",
    scriptIntegration: "Integration",
    scriptStatus: "Status",
    scriptVersion: (v: string) => ` · Version ${v}`,
    tokenLabel: "Integration token (from create/rotate — kept in memory only)",
    generateScript: "Generate Script",
    securityNotice:
      "This script contains an integration credential. Store it securely and do not share it publicly.",
    copyScript: "Copy Script",
    clear: "Clear",
    actionFailed: "Action failed",
  },
  new: {
    description: "Name + Google Account only. No proxy, UA, or Referer fields.",
  },
  form: {
    nameLabel: "Integration Name",
    namePlaceholder: "e.g. Production US Script",
    accountLabel: "Google Account",
    creating: "Creating…",
    copyToken: "Copy Token",
    tokenTitle: "Integration token (shown once)",
    tokenNote:
      "This token will only be shown once. Store it securely. It is required to generate Google Ads Script source later.",
    continue: "Continue",
  },
  errors: {
    unexpected: "Unexpected admin API error",
  },
};
