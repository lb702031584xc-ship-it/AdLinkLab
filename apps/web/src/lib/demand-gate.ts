/**
 * 需求门槛（AI 分析第 ① 步）纯函数。
 *
 * 付费投流只能收割已有搜索需求。门槛用查证过的绝对量，不用测款预算倒推：
 * 倒推假设你能拿到全部搜索量——实际上同一个 offer 很多人抢，你只能拿到一小片。
 * 打法是小预算测展示+点击、能盈利就上量，所以门槛要回答“测完能放大吗”。
 *
 * 量门槛（相关搜索量 = AI 判为相关的关键词月搜索量之和）：
 *   点击 = 搜索量 × 展示份额 × 点击率（Ads That Convert 公式）。
 *   保守估算：展示份额 80%（Ads That Convert 演算假设）、位置 1 点击率 2.1%
 *   （First Page Sage 2026）。200 点击是实操者测款下限（Ads That Convert；
 *   Adalysis 用 300）。200 ÷ (0.8 × 0.021) ≈ 11,905 → 取整 10,000 为放量门槛；
 *   乐观估算（100% 份额 × WordStream 中位点击率 6.66%）200 点击只需 ≈ 3,000，
 *   与 Pete Bowen 的 3,000 实操下限一致 → 3,000 为硬底线。
 *   相关量 < 3,000 → 不通过；3,000–10,000 → 谨慎（只有排到顶部 + 高份额才够，
 *   需用 Keyword Planner 核对）；≥ 10,000 → 通过。
 *
 * 亚马逊（Spiegel 2015 实测 + 实操者共识）：
 *   评分 < 4.0 → 不通过；4.0–4.3 → 谨慎；≥ 4.3 → 通过。
 *   评论 < 15 → 不通过（Red Stag：15+ 评论 + 4.0★ 付费才划算）；15–49 → 谨慎；≥ 50 → 通过。
 *   销量没有公开可信的最低线（30 和 300 都是编的/借的），不进门槛数学，只作参考展示。
 *
 * 域名（可选区块，无公开最低线，不进门槛数学；联盟里很多亚马逊 offer 根本没有独立站）：
 *   域名流量是 SEMrush 估算值，不是你能买到的展示——你的展示来自关键词拍卖。
 *   域名自然+付费 < 5,000 点击/月 → 估算可信度低（第三方研究区间），只提示不判死。
 *   域名付费 = 0 → 未检出付费关键词，不代表没需求，需用 Keyword Planner 核对。
 *   付费趋势：只看同比持续下滑（单月环比是噪音/季节性），下滑 → 谨慎。
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
  | "volumeBelowFloor"
  | "volumeConditional"
  | "volumeEnough"
  | "trendDown"
  | "trendUp"
  | "domainLowAccuracy"
  | "domainNoPaid"
  | "amazonLowRating"
  | "amazonRatingCaution"
  | "amazonFewReviews"
  | "amazonReviewsCaution";

export interface DemandGateResult {
  verdict: "pass" | "caution" | "fail" | "unknown";
  relevantVolume: number;
  relevantCount: number;
  totalCount: number;
  judgedCount: number;
  relevanceRatio: number | null;
  /** 保守估算每月能抢到的点击：相关量 × 80% 展示份额 × 2.1% 位置 1 点击率。 */
  estimatedClicks: number | null;
  flags: DemandGateFlag[];
}

/** 相关搜索量硬底线：低于此值，连乐观估算都凑不够一次测款的点击。 */
export const MIN_RELEVANT_VOLUME = 3000;
/** 相关搜索量放量门槛：保守估算下能拿到 200 测款点击。 */
export const SCALE_RELEVANT_VOLUME = 10000;
/** 保守估算用展示份额（Ads That Convert 演算假设，非实测基准）。 */
export const CONSERVATIVE_IMPRESSION_SHARE = 0.8;
/** 保守估算用点击率：位置 1 搜索广告点击率（First Page Sage 2026）。 */
export const CONSERVATIVE_CTR = 0.021;
/** 亚马逊评分低于此值不通过。 */
export const AMAZON_MIN_RATING = 4.0;
/** 亚马逊评分低于此值（但 ≥ 4.0）谨慎。 */
export const AMAZON_PREFERRED_RATING = 4.3;
/** 亚马逊评论低于此值不通过。 */
export const AMAZON_MIN_REVIEWS = 15;
/** 亚马逊评论低于此值（但 ≥ 15）谨慎。 */
export const AMAZON_SCALE_REVIEWS = 50;
/** 域名自然+付费低于此值时 SEMrush 估算可信度低（第三方研究区间）。 */
export const DOMAIN_LOW_ACCURACY_CLICKS = 5000;

export function evaluateDemandGate(inputs: DemandGateInputs): DemandGateResult {
  const { keywords, domainOrganicVolume, domainPaidVolume, paidTrend, amazon } = inputs;
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
    estimatedClicks: null,
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

  // 域名只提示，不判死（且只在用户填了域名数据时才提示）。
  const domainTotal = (domainOrganicVolume ?? 0) + (domainPaidVolume ?? 0);
  if (
    (domainOrganicVolume != null || domainPaidVolume != null) &&
    domainTotal > 0 &&
    domainTotal < DOMAIN_LOW_ACCURACY_CLICKS
  ) {
    flags.push("domainLowAccuracy");
  }
  if (domainPaidVolume === 0 && domainOrganicVolume != null) {
    flags.push("domainNoPaid");
  }

  let verdict: "pass" | "caution" | "fail";
  if (relevantVolume < MIN_RELEVANT_VOLUME) {
    verdict = "fail";
    flags.push("volumeBelowFloor");
  } else if (relevantVolume < SCALE_RELEVANT_VOLUME) {
    verdict = "caution";
    flags.push("volumeConditional");
  } else {
    verdict = "pass";
    flags.push("volumeEnough");
  }

  const downgrade = () => {
    if (verdict === "pass") verdict = "caution";
  };

  // 亚马逊：评分/评论是硬门槛（销量无公开可信最低线，不进门槛）。
  if (amazon) {
    if (amazon.rating != null && amazon.rating < AMAZON_MIN_RATING) {
      verdict = "fail";
      flags.push("amazonLowRating");
    } else if (amazon.rating != null && amazon.rating < AMAZON_PREFERRED_RATING) {
      downgrade();
      flags.push("amazonRatingCaution");
    }
    if (amazon.reviewCount != null && amazon.reviewCount < AMAZON_MIN_REVIEWS) {
      verdict = "fail";
      flags.push("amazonFewReviews");
    } else if (amazon.reviewCount != null && amazon.reviewCount < AMAZON_SCALE_REVIEWS) {
      downgrade();
      flags.push("amazonReviewsCaution");
    }
  }

  // 付费趋势：同比持续下滑，通过降为谨慎（趋势本身不直接判死）。
  if (paidTrend === "down") {
    downgrade();
    flags.push("trendDown");
  } else if (paidTrend === "up") {
    flags.push("trendUp");
  }

  return {
    ...base,
    verdict,
    flags,
    estimatedClicks: Math.round(
      relevantVolume * CONSERVATIVE_IMPRESSION_SHARE * CONSERVATIVE_CTR
    ),
  };
}
