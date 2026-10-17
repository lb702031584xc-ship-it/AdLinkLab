import { describe, expect, it } from "vitest";
import { evaluateDemandGate } from "./demand-gate.js";

const kw = (keyword: string, volume: number, relevant: boolean | null) => ({
  keyword,
  volume,
  relevant,
});

const base = {
  domainOrganicVolume: null,
  domainPaidVolume: null,
  paidTrend: null,
  amazon: null,
} as const;

describe("evaluateDemandGate", () => {
  it("无关键词 → unknown", () => {
    const r = evaluateDemandGate({ ...base, keywords: [] });
    expect(r.verdict).toBe("unknown");
    expect(r.flags).toContain("noKeywords");
  });
  it("未判断相关性 → unknown", () => {
    const r = evaluateDemandGate({ ...base, keywords: [kw("a", 1000, null)] });
    expect(r.verdict).toBe("unknown");
    expect(r.flags).toContain("notJudged");
  });
  it("无相关关键词 → fail", () => {
    const r = evaluateDemandGate({
      ...base,
      keywords: [kw("a", 1000, false), kw("b", 500, false)],
    });
    expect(r.verdict).toBe("fail");
    expect(r.flags).toContain("noRelevant");
  });
  it("量门槛（绝对量，不用测款预算倒推）：相关量 < 3000 → fail；3000–10000 → caution；≥ 10000 → pass", () => {
    const mk = (vol: number) => ({ ...base, keywords: [kw("a", vol, true)] });
    expect(evaluateDemandGate(mk(2999)).verdict).toBe("fail");
    expect(evaluateDemandGate(mk(2999)).flags).toContain("volumeBelowFloor");
    expect(evaluateDemandGate(mk(3000)).verdict).toBe("caution");
    expect(evaluateDemandGate(mk(3000)).flags).toContain("volumeConditional");
    expect(evaluateDemandGate(mk(9999)).verdict).toBe("caution");
    expect(evaluateDemandGate(mk(10000)).verdict).toBe("pass");
    expect(evaluateDemandGate(mk(10000)).flags).toContain("volumeEnough");
  });
  it("预估可抢点击 = 相关量 × 80% 展示份额 × 2.1% 点击率", () => {
    const r = evaluateDemandGate({ ...base, keywords: [kw("a", 10000, true)] });
    expect(r.estimatedClicks).toBe(Math.round(10000 * 0.8 * 0.021));
  });
  it("不相关量不算进相关量", () => {
    const r = evaluateDemandGate({
      ...base,
      keywords: [kw("a", 100, true), kw("b", 100000, false)],
    });
    expect(r.relevantVolume).toBe(100);
    expect(r.verdict).toBe("fail");
  });
  it("付费趋势下滑：pass 降为 caution", () => {
    const r = evaluateDemandGate({
      ...base,
      keywords: [kw("a", 10000, true)],
      paidTrend: "down",
    });
    expect(r.verdict).toBe("caution");
    expect(r.flags).toContain("trendDown");
  });
  it("亚马逊：评分 < 4.0 直接 fail；4.0–4.3 降级；评论 < 15 直接 fail；15–49 降级；销量不进门槛", () => {
    const mk = (amazon: { estimatedMonthlySales: number | null; reviewCount: number | null; rating: number | null }) => ({
      ...base,
      keywords: [kw("a", 10000, true)],
      amazon,
    });
    const lowRating = evaluateDemandGate(mk({ estimatedMonthlySales: 500, reviewCount: 500, rating: 3.9 }));
    expect(lowRating.verdict).toBe("fail");
    expect(lowRating.flags).toContain("amazonLowRating");
    const ratingCaution = evaluateDemandGate(mk({ estimatedMonthlySales: 500, reviewCount: 500, rating: 4.2 }));
    expect(ratingCaution.verdict).toBe("caution");
    expect(ratingCaution.flags).toContain("amazonRatingCaution");
    const fewReviews = evaluateDemandGate(mk({ estimatedMonthlySales: 500, reviewCount: 14, rating: 4.5 }));
    expect(fewReviews.verdict).toBe("fail");
    expect(fewReviews.flags).toContain("amazonFewReviews");
    const reviewsCaution = evaluateDemandGate(mk({ estimatedMonthlySales: 500, reviewCount: 30, rating: 4.5 }));
    expect(reviewsCaution.verdict).toBe("caution");
    expect(reviewsCaution.flags).toContain("amazonReviewsCaution");
    // 销量再低也不判死（无公开可信最低线）
    const lowSales = evaluateDemandGate(mk({ estimatedMonthlySales: 5, reviewCount: 500, rating: 4.5 }));
    expect(lowSales.verdict).toBe("pass");
    expect(lowSales.flags).not.toContain("amazonLowSales");
  });
  it("域名只提示不判死：域名总量 < 5000 → 可信度低提示；付费为 0 → 未检出提示；都不改变 verdict", () => {
    const r = evaluateDemandGate({
      keywords: [kw("a", 10000, true)],
      domainOrganicVolume: 2000,
      domainPaidVolume: 0,
      paidTrend: null,
      amazon: null,
    });
    expect(r.verdict).toBe("pass");
    expect(r.flags).toContain("domainLowAccuracy");
    expect(r.flags).toContain("domainNoPaid");
  });
  it("不填域名数据（无独立站）→ 没有域名相关 flag", () => {
    const r = evaluateDemandGate({ ...base, keywords: [kw("a", 10000, true)] });
    expect(r.flags).not.toContain("domainLowAccuracy");
    expect(r.flags).not.toContain("domainNoPaid");
  });
});
