/**
 * 通用否定关键词库（与投流决策页的否定词库同源，供关键词启动包投放 Tab 复用）。
 * 纯数据，无业务逻辑。
 */
export interface NegativeCategory {
  key: "afterSales" | "freebie" | "jobs" | "secondHand" | "info" | "local";
  nameZh: string;
  nameEn: string;
  words: string[];
}

export const UNIVERSAL_NEGATIVES: NegativeCategory[] = [
  {
    key: "afterSales",
    nameZh: "售后类",
    nameEn: "After-sales",
    words: [
      "维修", "保修", "说明书", "客服", "电话", "地址", "退货", "换货",
      "repair", "warranty", "manual", "support",
    ],
  },
  {
    key: "freebie",
    nameZh: "白嫖类",
    nameEn: "Freebie seekers",
    words: ["免费", "破解", "torrent", "下载", "free", "crack", "download"],
  },
  {
    key: "jobs",
    nameZh: "求职类",
    nameEn: "Job seekers",
    words: ["招聘", "兼职", "工资", "面试", "jobs", "hiring"],
  },
  {
    key: "secondHand",
    nameZh: "二手类",
    nameEn: "Second-hand",
    words: ["二手", "闲置", "转让", "used", "second hand"],
  },
  {
    key: "info",
    nameZh: "纯信息类",
    nameEn: "Informational",
    words: ["是什么", "图片", "视频", "what is", "pictures"],
  },
  {
    key: "local",
    nameZh: "本地类",
    nameEn: "Local",
    words: ["附近", "门店", "near me", "store location"],
  },
];
