/**
 * 推荐指数计算测试：高分/低分/$8 门槛/缺数据/价格极端/佣金反推。
 * 确定性纯函数，无 LLM、无 DB。
 */
import { describe, expect, it } from "vitest";
import {
  calcRecommendationScore,
  RECOMMEND_GATE_CAP,
  RECOMMEND_THRESHOLD,
} from "./recommendation-score.js";

describe("calcRecommendationScore", () => {
  it("优质商品 → 高分且 recommended=true", () => {
    const r = calcRecommendationScore({
      commissionAmount: 30,
      commissionRate: 20,
      reviewCount: 5000,
      price: 100,
    });
    expect(r.score).toBe(68);
    expect(r.recommended).toBe(true);
    expect(r.cappedByGate).toBe(false);
    expect(r.effectiveCommission).toBe(30);
  });

  it("顶级商品 → 接近满分", () => {
    const r = calcRecommendationScore({
      commissionAmount: 60,
      commissionRate: 25,
      reviewCount: 20000,
      price: 80,
    });
    expect(r.score).toBe(86);
    expect(r.recommended).toBe(true);
    expect(r.cappedByGate).toBe(false);
  });

  it("佣金 $5（<$8 门槛）→ 直接限分 25，不推荐", () => {
    const r = calcRecommendationScore({
      commissionAmount: 5,
      commissionRate: 10,
      reviewCount: 100,
      price: 50,
    });
    expect(r.cappedByGate).toBe(true);
    expect(r.score).toBeLessThanOrEqual(RECOMMEND_GATE_CAP);
    expect(r.recommended).toBe(false);
    expect(r.effectiveCommission).toBe(5);
  });

  it("全部缺数据 → 中性 50 分，不推荐，不限分", () => {
    const r = calcRecommendationScore({});
    expect(r.score).toBe(50);
    expect(r.recommended).toBe(false);
    expect(r.cappedByGate).toBe(false);
    expect(r.effectiveCommission).toBeNull();
    expect(r.breakdown).toEqual({
      commission: 50,
      reviews: 50,
      price: 50,
      rate: 50,
      settlement: 50,
      payoutCycle: 50,
    });
  });

  it("超高价（$2000）→ 价格分归零，总分低", () => {
    const r = calcRecommendationScore({ price: 2000 });
    expect(r.breakdown.price).toBe(0);
    expect(r.score).toBe(43);
    expect(r.recommended).toBe(false);
  });

  it("无 commissionAmount 时用 price × commissionRate 反推（$10 ≥ $8 不限分）", () => {
    const r = calcRecommendationScore({ price: 100, commissionRate: 10 });
    expect(r.effectiveCommission).toBe(10);
    expect(r.cappedByGate).toBe(false);
    expect(r.score).toBe(42);
    expect(r.recommended).toBe(false);
  });

  it("分数恒在 0–100，阈值行为一致", () => {
    const cases = [
      {},
      { commissionAmount: 0 },
      { commissionAmount: 1000, reviewCount: 1e9, price: 1, commissionRate: 100 },
      { price: -5 },
    ];
    for (const c of cases) {
      const r = calcRecommendationScore(c);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(r.recommended).toBe(r.score >= RECOMMEND_THRESHOLD);
    }
  });
});

describe("calcRecommendationScore 补强 #1 结算率", () => {
  it("结算率已知 → 直接映射为 settlement 分并影响总分", () => {
    const hi = calcRecommendationScore({ settlementRatePct: 90 });
    expect(hi.breakdown.settlement).toBe(90);
    const lo = calcRecommendationScore({ settlementRatePct: 20 });
    expect(lo.breakdown.settlement).toBe(20);
    expect(hi.score).toBeGreaterThan(lo.score);
  });

  it("结算率未知（null/undefined）→ 中性 50，不编造", () => {
    expect(calcRecommendationScore({ settlementRatePct: null }).breakdown.settlement).toBe(50);
    expect(calcRecommendationScore({}).breakdown.settlement).toBe(50);
  });

  it("结算率越界（>100 / <0）→ 视为未知，中性 50", () => {
    expect(calcRecommendationScore({ settlementRatePct: 150 }).breakdown.settlement).toBe(50);
    expect(calcRecommendationScore({ settlementRatePct: -5 }).breakdown.settlement).toBe(50);
  });

  it("结算率 0 / 100 边界有效", () => {
    expect(calcRecommendationScore({ settlementRatePct: 0 }).breakdown.settlement).toBe(0);
    expect(calcRecommendationScore({ settlementRatePct: 100 }).breakdown.settlement).toBe(100);
  });
});

describe("calcRecommendationScore 补强 #4 返款周期", () => {
  it("≤30 天 → payoutCycle 100 分", () => {
    expect(calcRecommendationScore({ payoutCycleDays: 30 }).breakdown.payoutCycle).toBe(100);
    expect(calcRecommendationScore({ payoutCycleDays: 7 }).breakdown.payoutCycle).toBe(100);
  });

  it("31–60 天 → 80 分；61–90 天 → 60 分", () => {
    expect(calcRecommendationScore({ payoutCycleDays: 45 }).breakdown.payoutCycle).toBe(80);
    expect(calcRecommendationScore({ payoutCycleDays: 90 }).breakdown.payoutCycle).toBe(60);
  });

  it(">90 天 → 20 分扣分，总分低于未知（中性）情形", () => {
    const long = calcRecommendationScore({ payoutCycleDays: 120 });
    expect(long.breakdown.payoutCycle).toBe(20);
    const unknown = calcRecommendationScore({});
    expect(long.score).toBeLessThan(unknown.score);
  });

  it("返款周期未知 → 中性 50", () => {
    expect(calcRecommendationScore({ payoutCycleDays: null }).breakdown.payoutCycle).toBe(50);
  });
});
