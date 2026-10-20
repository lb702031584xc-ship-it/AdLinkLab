/**
 * 广告系列卡片视图 strings (2026-10-19). Standalone dict:
 * `lang === "en" ? en : zh`. Strings only — no functions.
 */
export const zh = {
  overview: {
    total: "广告系列总数",
    active: "投放中",
    paused: "已暂停",
    clicks: "总点击",
    conversions: "总转化",
    value: "总转化价值",
  },
  card: {
    adGroups: "广告组",
    trackingLinks: "追踪链接",
    clicks: "点击",
    conversions: "转化",
    conversionValue: "转化价值",
    biddingStrategy: "出价策略",
    updatedAt: "更新于",
    viewAdGroups: "广告组 →",
    viewMonitoring: "监控 →",
  },
};

export type CampaignCardsDict = typeof zh;

export const en: CampaignCardsDict = {
  overview: {
    total: "Campaigns",
    active: "Active",
    paused: "Paused",
    clicks: "Total clicks",
    conversions: "Total conversions",
    value: "Total conv. value",
  },
  card: {
    adGroups: "Ad groups",
    trackingLinks: "Tracking links",
    clicks: "Clicks",
    conversions: "Conversions",
    conversionValue: "Conv. value",
    biddingStrategy: "Bidding strategy",
    updatedAt: "Updated",
    viewAdGroups: "Ad groups →",
    viewMonitoring: "Monitoring →",
  },
};
