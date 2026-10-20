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

/**
 * 基础否定词预置（#14）：与 UNIVERSAL_NEGATIVES 分开的一份「意图排除」词表，
 * 在投放选词阶段一键预置。逐词注释（中英）：
 * - free 免费：只找免费资源、无购买意图
 * - login 登录 / sign in 登录：已有账号找入口，不是新客
 * - download 下载：找软件/资料下载
 * - manual 说明书：已购用户查手册
 * - setup 安装设置：已购用户找安装帮助
 * - repair 维修 / support 支持：售后意图
 * - price 价格 / deal 优惠 / coupon 优惠券：只比价找券、转化意图弱（按老师词表预置）
 * - jobs 招聘 / salary 薪资：求职意图
 * - what is 是什么 / how to 怎么做：纯信息意图
 * - review 评测 / reviews 评测（复数）/ rating 评分：评测意图——
 *   承接页本身是评测页时这类词是核心词，必须排除出预置（见下方函数）。
 */
export const BASE_NEGATIVE_PRESET: string[] = [
  "free", // 免费
  "login", // 登录
  "sign in", // 登录
  "download", // 下载
  "manual", // 说明书
  "setup", // 安装设置
  "repair", // 维修
  "support", // 支持/售后
  "price", // 价格
  "deal", // 优惠
  "coupon", // 优惠券
  "jobs", // 招聘
  "salary", // 薪资
  "what is", // 是什么（纯信息）
  "how to", // 怎么做（纯信息）
  "review", // 评测
  "reviews", // 评测（复数）
  "rating", // 评分
];

/** 评测类词：承接页为评测页时是核心词，不能当否定词。 */
export const REVIEW_CLASS_NEGATIVES: string[] = ["review", "reviews", "rating", "ratings"];

/** 承接页类型（与意图分组的承接页提示对应）。 */
export type LandingPageKind =
  | "homepage"
  | "product"
  | "review"
  | "compare"
  | "guide"
  | "landing";

/**
 * 按承接页类型取基础预置词表：评测页承接时自动排除 review 类词，其余原样。
 * 纯函数；不改动 BASE_NEGATIVE_PRESET 本身。
 */
export function baseNegativesForLanding(kind: LandingPageKind | null | undefined): string[] {
  if (kind !== "review") return [...BASE_NEGATIVE_PRESET];
  const drop = new Set(REVIEW_CLASS_NEGATIVES);
  return BASE_NEGATIVE_PRESET.filter((w) => !drop.has(w));
}

