/**
 * 商品库筛选评估测试（2026-10-20 统一评分后）：
 * score 恒为 calcRecommendationScore 质量分；recommended 有预设走预设阈值、
 * 无预设走 score>=60。确定性公式，无 LLM。
 */
import { describe, expect, it } from "vitest";
import { MIN_COMMISSION_USD } from "@adlinklab/shared";
import {
  DEFAULT_PRESET,
  evaluateProduct,
  scoreProduct,
} from "./catalog-screening.js";
import {
  calcRecommendationScore,
  RECOMMEND_THRESHOLD,
} from "./recommendation-score.js";

describe("scoreProduct", () => {
  it("全部阈值通过 → recommended=true，score 在 0–100", () => {
    const r = scoreProduct(
      { price: 100, commissionAmount: 30, commissionRate: 20, reviewCount: 5000 },
      DEFAULT_PRESET
    );
    expect(r.recommended).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("佣金金额不达标 → recommended=false（分数照算）", () => {
    const r = scoreProduct(
      { price: 100, commissionAmount: 5, commissionRate: 20, reviewCount: 5000 },
      DEFAULT_PRESET
    );
    expect(r.recommended).toBe(false);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });

  it("价格超出价格带 → recommended=false", () => {
    const low = scoreProduct(
      { price: 10, commissionAmount: 30, commissionRate: 20, reviewCount: 5000 },
      DEFAULT_PRESET
    );
    expect(low.recommended).toBe(false);
    const high = scoreProduct(
      { price: 9999, commissionAmount: 30, commissionRate: 20, reviewCount: 5000 },
      DEFAULT_PRESET
    );
    expect(high.recommended).toBe(false);
  });

  it("缺失字段 → 质量分按中性 50 处理（不虚构），recommended=false", () => {
    // 统一口径：score 来自 calcRecommendationScore（缺数据中性 50）；
    // recommended 走预设阈值：有效佣金算不出 → passAmount 不通过 → false。
    const r = scoreProduct({}, DEFAULT_PRESET);
    expect(r.recommended).toBe(false);
    expect(r.score).toBe(50);
  });

  it("minScore 卡分：分数不够 → recommended=false", () => {
    const r = scoreProduct(
      { price: 100, commissionAmount: 30, commissionRate: 20, reviewCount: 5000 },
      { ...DEFAULT_PRESET, minScore: 101 }
    );
    expect(r.recommended).toBe(false);
  });

  it("默认 preset 即讲师经验默认值", () => {
    // minCommissionAmount 与 $8 佣金门槛共用同一常量（入库第一道 + 库内第二道同口径）
    expect(DEFAULT_PRESET.minCommissionAmount).toBe(MIN_COMMISSION_USD);
    expect(DEFAULT_PRESET.minCommissionRate).toBe(10);
    expect(DEFAULT_PRESET.minPrice).toBe(80);
    expect(DEFAULT_PRESET.maxPrice).toBe(150);
  });

  it("分数单调：佣金越高分越高（其余相同）", () => {
    const base = { price: 100, commissionRate: 20, reviewCount: 1000 };
    const a = scoreProduct({ ...base, commissionAmount: 15 }, DEFAULT_PRESET);
    const b = scoreProduct({ ...base, commissionAmount: 60 }, DEFAULT_PRESET);
    expect(b.score).toBeGreaterThan(a.score);
  });

  it("⑤ 只有佣金率（PB 百分比佣金）：price×rate ≥ $8 → 可 recommended", () => {
    const r = scoreProduct(
      { price: 100, commissionAmount: null, commissionRate: 12, reviewCount: 5000 },
      DEFAULT_PRESET
    );
    // 有效佣金 = 100 × 12% = $12 ≥ $8；率 12 ≥ 10；价在 [80,150] → 全部通过
    expect(r.recommended).toBe(true);
  });

  it("⑤b 只有佣金率且 price×rate < $8 → passAmount 不通过（自定义 preset 隔离该项）", () => {
    const preset = {
      minReviews: 0,
      minCommissionAmount: 8,
      minCommissionRate: 0,
      minPrice: 0,
      maxPrice: 0,
      minScore: 0,
    };
    const low = scoreProduct(
      { price: 100, commissionAmount: null, commissionRate: 5, reviewCount: 5000 },
      preset
    );
    // 有效佣金 = 100 × 5% = $5 < $8 → 不通过
    expect(low.recommended).toBe(false);
    const ok = scoreProduct(
      { price: 100, commissionAmount: null, commissionRate: 12, reviewCount: 5000 },
      preset
    );
    expect(ok.recommended).toBe(true);
  });

  it("⑤c 固定佣金优先于估算：amount 明确 < $8 时不被 rate 估算翻案", () => {
    const preset = {
      minReviews: 0,
      minCommissionAmount: 8,
      minCommissionRate: 0,
      minPrice: 0,
      maxPrice: 0,
      minScore: 0,
    };
    const r = scoreProduct(
      { price: 100, commissionAmount: 5, commissionRate: 50, reviewCount: 5000 },
      preset
    );
    // estimateCommissionFigure 口径：amount 优先 → figure=5 < $8
    expect(r.recommended).toBe(false);
  });
});

describe("evaluateProduct（统一评分入口）", () => {
  const cases = [
    { price: 100, commissionAmount: 30, commissionRate: 20, reviewCount: 5000 },
    { price: 100, commissionAmount: null, commissionRate: 12, reviewCount: 5000 },
    { price: 10, commissionAmount: 5, commissionRate: 5, reviewCount: 3 },
    {},
    { price: 2000, commissionAmount: null, commissionRate: null, reviewCount: null },
    { price: 120, commissionAmount: 45, commissionRate: 30, reviewCount: 20000 },
  ];

  it("score 恒等于 calcRecommendationScore 质量分（三条路径同分）", () => {
    for (const p of cases) {
      const expected = calcRecommendationScore(p).score;
      expect(evaluateProduct(p, DEFAULT_PRESET).score).toBe(expected);
      expect(evaluateProduct(p, null).score).toBe(expected);
      expect(scoreProduct(p, DEFAULT_PRESET).score).toBe(expected);
    }
  });

  it("无预设（null）→ recommended = score >= 60", () => {
    for (const p of cases) {
      const r = evaluateProduct(p, null);
      expect(r.recommended).toBe(r.score >= RECOMMEND_THRESHOLD);
    }
  });

  it("scoreProduct 与 evaluateProduct(同预设) recommended 一致", () => {
    for (const p of cases) {
      expect(scoreProduct(p, DEFAULT_PRESET).recommended).toBe(
        evaluateProduct(p, DEFAULT_PRESET).recommended
      );
    }
  });

  it("预设与质量分口径可不同：质量分高但价格带外 → recommended=false", () => {
    // price=300：质量分价格段仍有分，但 DEFAULT_PRESET 价格带 [80,150] 不通过。
    const p = { price: 300, commissionAmount: 60, commissionRate: 25, reviewCount: 9000 };
    const r = evaluateProduct(p, DEFAULT_PRESET);
    expect(r.score).toBeGreaterThanOrEqual(RECOMMEND_THRESHOLD);
    expect(r.recommended).toBe(false);
  });

  it("breakdown 透传质量分分项", () => {
    const p = { price: 100, commissionAmount: 30, commissionRate: 20, reviewCount: 5000 };
    expect(evaluateProduct(p, DEFAULT_PRESET).breakdown).toEqual(
      calcRecommendationScore(p).breakdown
    );
  });
});
