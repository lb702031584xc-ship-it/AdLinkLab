/**
 * 需求门槛（AI 分析第 ① 步）纯函数。
 *
 * 付费投流只能收割已有搜索需求，创造不了需求。没量就投，等于拿钱等一个
 * 不存在的流量。门槛逻辑：
 *
 * 1. 相关搜索量 = AI 判为相关的关键词月搜索量之和（不相关的量再大也不算）。
 * 2. 测款所需点击 = 测款预算 ÷ CPC，测款预算按 3 × payout（与盈利测算一致）。
 * 3. 所需月搜索量 = 测款所需点击 ÷ 点击率（新账户排 2–4 位按 10% 估算）。
 *    相关量 < 所需量 → 一个月连一次测款都跑不完 → 不通过；
 *    相关量 < 3 × 所需量 → 测款要拖一个多月 → 谨慎；
 *    否则 → 通过。
 * 4. 修正项：付费趋势下滑（对手在撤）通过→谨慎；亚马逊月销量 < 30（死链接）
 *    直接不通过；评论 < 20 / 评分 < 3.5（没信任，落地页转化差）通过→谨慎。
 *
 * 域名自然/付费搜索量只作参考展示，不进门槛数学（真正能买的是关键词量）。
 * 亚马逊销量不从 BSR 编造——由用户按 Keepa/BSR 工具填预估月销量。
 */

export type DemandTrend = "up" | "flat" | "down";

export interface DemandGateKeyword {
  keyword: string;
  volume: number | null;
  /** null = 还没 AI 判断 */
  relevant: boolean | null;
}

export interface DemandGateAmazon {
  estimatedMonthlySales: number | null;
  reviewCount: number | null;
  rating: number | null;
}

export interface DemandGateInputs {
  payout: number;
  cpc: number;
  keywords: DemandGateKeyword[];
  domainOrganicVolume: number | null;
  domainPaidVolume: number | null;
  paidTrend: DemandTrend | null;
  amazon: DemandGateAmazon | null;
}

export type DemandGateFlag =
  | "noKeywords"
  | "notJudged"
  | "noRelevant"
  | "lowRelevanceRatio"
  | "noPayout"
  | "noCpc"
  | "volumeBelowTest"
  | "volumeThin"
  | "volumeEnough"
  | "trendDown"
  | "trendUp"
  | "amazonLowSales"
  | "amazonFewReviews"
  | "amazonLowRating";

export interface DemandGateResult {
  verdict: "pass" | "caution" | "fail" | "unknown";
  relevantVolume: number;
  relevantCount: number;
  totalCount: number;
  judgedCount: number;
  relevanceRatio: number | null;
  testClicksNeeded: number | null;
  requiredVolume: number | null;
  flags: DemandGateFlag[];
}

/** 新账户排 2–4 位的搜索广告点击率估算。 */
export const DEMAND_GATE_CTR = 0.1;
/** 相关量达到所需量的几倍才算“量够、能快速测完”。 */
export const DEMAND_GATE_COMFORT_MULTIPLE = 3;
/** 亚马逊月销量低于此值视为死链接（付费流量救不活）。 */
export const AMAZON_MIN_MONTHLY_SALES = 30;
/** 亚马逊评论低于此值视为缺信任。 */
export const AMAZON_MIN_REVIEWS = 20;
/** 亚马逊评分低于此值视为口碑差。 */
export const AMAZON_MIN_RATING = 3.5;

export function evaluateDemandGate(inputs: DemandGateInputs): DemandGateResult {
  const { payout, cpc, keywords, paidTrend, amazon } = inputs;
  const totalCount = keywords.length;
  const judged = keywords.filter((k) => k.relevant !== null);
  const relevant = keywords.filter((k) => k.relevant === true);
  const relevantVolume = relevant.reduce((sum, k) => sum + Math.max(k.volume ?? 0, 0), 0);
  const relevanceRatio = totalCount > 0 ? relevant.length / totalCount : null;

  const base: Omit<DemandGateResult, "verdict" | "flags"> = {
    relevantVolume,
    relevantCount: relevant.length,
    totalCount,
    judgedCount: judged.length,
    relevanceRatio,
    testClicksNeeded: null,
    requiredVolume: null,
  };

  if (totalCount === 0) {
    return { ...base, verdict: "unknown", flags: ["noKeywords"] };
  }
  if (judged.length === 0) {
    return { ...base, verdict: "unknown", flags: ["notJudged"] };
  }
  if (relevant.length === 0) {
    return { ...base, verdict: "fail", flags: ["noRelevant"] };
  }

  const flags: DemandGateFlag[] = [];
  if (relevanceRatio !== null && relevanceRatio < 0.3) flags.push("lowRelevanceRatio");

  if (!(payout > 0)) {
    return { ...base, verdict: "unknown", flags: [...flags, "noPayout"] };
  }
  if (!(cpc > 0)) {
    return { ...base, verdict: "unknown", flags: [...flags, "noCpc"] };
  }

  const testClicksNeeded = Math.ceil((3 * payout) / cpc);
  const requiredVolume = Math.ceil(testClicksNeeded / DEMAND_GATE_CTR);

  let verdict: "pass" | "caution" | "fail";
  if (relevantVolume < requiredVolume) {
    verdict = "fail";
    flags.push("volumeBelowTest");
  } else if (relevantVolume < DEMAND_GATE_COMFORT_MULTIPLE * requiredVolume) {
    verdict = "caution";
    flags.push("volumeThin");
  } else {
    verdict = "pass";
    flags.push("volumeEnough");
  }

  // 付费趋势：对手在撤，通过降为谨慎（趋势本身不直接判死）。
  if (paidTrend === "down" && verdict === "pass") {
    verdict = "caution";
    flags.push("trendDown");
  } else if (paidTrend === "up") {
    flags.push("trendUp");
  }

  // 亚马逊：销量是硬门槛，评论/评分只降级。
  if (amazon) {
    if (amazon.estimatedMonthlySales != null && amazon.estimatedMonthlySales < AMAZON_MIN_MONTHLY_SALES) {
      verdict = "fail";
      flags.push("amazonLowSales");
    }
    if (amazon.reviewCount != null && amazon.reviewCount < AMAZON_MIN_REVIEWS && verdict === "pass") {
      verdict = "caution";
      flags.push("amazonFewReviews");
    }
    if (amazon.rating != null && amazon.rating < AMAZON_MIN_RATING && verdict === "pass") {
      verdict = "caution";
      flags.push("amazonLowRating");
    }
  }

  return { ...base, verdict, flags, testClicksNeeded, requiredVolume };
}
