import { describe, expect, it } from "vitest";
import { evaluateDemandGate } from "./demand-gate.js";

const kw = (keyword: string, volume: number, relevant: boolean | null) => ({
  keyword,
  volume,
  relevant,
});

describe("evaluateDemandGate", () => {
  it("无关键词 → unknown", () => {
    const r = evaluateDemandGate({
      payout: 5, cpc: 0.8, keywords: [],
      domainOrganicVolume: null, domainPaidVolume: null, paidTrend: null, amazon: null,
    });
    expect(r.verdict).toBe("unknown");
    expect(r.flags).toContain("noKeywords");
  });
  it("未判断相关性 → unknown", () => {
    const r = evaluateDemandGate({
      payout: 5, cpc: 0.8, keywords: [kw("a", 1000, null)],
      domainOrganicVolume: null, domainPaidVolume: null, paidTrend: null, amazon: null,
    });
    expect(r.verdict).toBe("unknown");
    expect(r.flags).toContain("notJudged");
  });
  it("无相关关键词 → fail", () => {
    const r = evaluateDemandGate({
      payout: 5, cpc: 0.8,
      keywords: [kw("a", 1000, false), kw("b", 500, false)],
      domainOrganicVolume: null, domainPaidVolume: null, paidTrend: null, amazon: null,
    });
    expect(r.verdict).toBe("fail");
    expect(r.flags).toContain("noRelevant");
  });
  it("量门槛：payout 5 / CPC 0.8 → 测款需 19 点击 → 需 190 搜索/月；相关量 100 → fail，500 → caution，1000 → pass", () => {
    const mk = (vol: number) => ({
      payout: 5, cpc: 0.8, keywords: [kw("a", vol, true)],
      domainOrganicVolume: null, domainPaidVolume: null, paidTrend: null, amazon: null,
    });
    const fail = evaluateDemandGate(mk(100));
    expect(fail.verdict).toBe("fail");
    expect(fail.testClicksNeeded).toBe(19);
    expect(fail.requiredVolume).toBe(190);
    expect(fail.flags).toContain("volumeBelowTest");
    expect(evaluateDemandGate(mk(500)).verdict).toBe("caution");
    expect(evaluateDemandGate(mk(1000)).verdict).toBe("pass");
  });
  it("不相关量不算进相关量", () => {
    const r = evaluateDemandGate({
      payout: 5, cpc: 0.8,
      keywords: [kw("a", 100, true), kw("b", 100000, false)],
      domainOrganicVolume: null, domainPaidVolume: null, paidTrend: null, amazon: null,
    });
    expect(r.relevantVolume).toBe(100);
    expect(r.verdict).toBe("fail");
  });
  it("付费趋势下滑：pass 降为 caution", () => {
    const r = evaluateDemandGate({
      payout: 5, cpc: 0.8, keywords: [kw("a", 10000, true)],
      domainOrganicVolume: null, domainPaidVolume: null, paidTrend: "down", amazon: null,
    });
    expect(r.verdict).toBe("caution");
    expect(r.flags).toContain("trendDown");
  });
  it("亚马逊：月销量 < 30 直接 fail；评论 < 20 降级", () => {
    const lowSales = evaluateDemandGate({
      payout: 5, cpc: 0.8, keywords: [kw("a", 10000, true)],
      domainOrganicVolume: null, domainPaidVolume: null, paidTrend: null,
      amazon: { estimatedMonthlySales: 10, reviewCount: 500, rating: 4.5 },
    });
    expect(lowSales.verdict).toBe("fail");
    expect(lowSales.flags).toContain("amazonLowSales");
    const fewReviews = evaluateDemandGate({
      payout: 5, cpc: 0.8, keywords: [kw("a", 10000, true)],
      domainOrganicVolume: null, domainPaidVolume: null, paidTrend: null,
      amazon: { estimatedMonthlySales: 500, reviewCount: 5, rating: 4.5 },
    });
    expect(fewReviews.verdict).toBe("caution");
    expect(fewReviews.flags).toContain("amazonFewReviews");
  });
  it("缺 payout/CPC → unknown，不编造门槛", () => {
    const r = evaluateDemandGate({
      payout: 0, cpc: 0.8, keywords: [kw("a", 10000, true)],
      domainOrganicVolume: null, domainPaidVolume: null, paidTrend: null, amazon: null,
    });
    expect(r.verdict).toBe("unknown");
    expect(r.flags).toContain("noPayout");
  });
});
