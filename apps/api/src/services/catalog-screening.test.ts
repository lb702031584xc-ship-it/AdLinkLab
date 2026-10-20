/**
 * 商品库筛选评分测试：阈值通过/不通过、score 范围 0–100、默认值。
 * 确定性公式，无 LLM。
 */
import { describe, expect, it } from "vitest";
import { MIN_COMMISSION_USD } from "@adlinklab/shared";
import {
  DEFAULT_PRESET,
  scoreProduct,
} from "./catalog-screening.js";

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

  it("缺失字段 → 该分项 0 分，不虚构（recommended=false）", () => {
    const r = scoreProduct({}, DEFAULT_PRESET);
    expect(r.recommended).toBe(false);
    expect(r.score).toBe(0);
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
