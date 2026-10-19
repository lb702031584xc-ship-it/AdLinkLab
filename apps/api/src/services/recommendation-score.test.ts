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
    expect(r.score).toBe(74);
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
    expect(r.score).toBe(98);
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
    });
  });

  it("超高价（$2000）→ 价格分归零，总分低", () => {
    const r = calcRecommendationScore({ price: 2000 });
    expect(r.breakdown.price).toBe(0);
    expect(r.score).toBe(40);
    expect(r.recommended).toBe(false);
  });

  it("无 commissionAmount 时用 price × commissionRate 反推（$10 ≥ $8 不限分）", () => {
    const r = calcRecommendationScore({ price: 100, commissionRate: 10 });
    expect(r.effectiveCommission).toBe(10);
    expect(r.cappedByGate).toBe(false);
    expect(r.score).toBe(39);
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
