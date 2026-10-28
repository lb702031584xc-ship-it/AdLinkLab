/**
 * 测试阶段判定测试：四个阶段的边界与止损线。
 */
import { describe, expect, it } from "vitest";
import { judgeTestStage } from "./test-verdict.js";

describe("judgeTestStage", () => {
  it("没有投放数据 → not_started", () => {
    const r = judgeTestStage({ clicks: 0, spendUsd: 0, conversions: 0, revenueUsd: 0 });
    expect(r.stage).toBe("not_started");
    expect(r.action).toBe("wait");
  });

  it("花了钱但没点击 → no_delivery（投放设置问题）", () => {
    const r = judgeTestStage({ clicks: 10, spendUsd: 12, conversions: 0, revenueUsd: 0 });
    expect(r.stage).toBe("no_delivery");
    expect(r.action).toBe("fix_delivery");
    expect(r.reasons[0]).toContain("投放设置问题");
  });

  it("点击不够 → too_early，并给出还差多少", () => {
    const r = judgeTestStage({ clicks: 120, spendUsd: 80, conversions: 1, revenueUsd: 15 });
    expect(r.stage).toBe("too_early");
    expect(r.remaining.clicksToDecide).toBe(80);
  });

  it("烧穿止损线且 0 转化 → failing/stop", () => {
    const r = judgeTestStage({
      clicks: 500,
      spendUsd: 60,
      conversions: 0,
      revenueUsd: 0,
      payoutUsd: 20, // 止损线 60
      breakevenCvrPct: 4,
    });
    expect(r.stage).toBe("failing");
    expect(r.action).toBe("stop");
    expect(r.remaining.spendCapUsd).toBe(60);
  });

  it("CVR 达标 + 10 转化 + 高 ROAS → winner/scale_50", () => {
    const r = judgeTestStage({
      clicks: 400,
      spendUsd: 120,
      conversions: 20,
      revenueUsd: 400, // ROAS 3.3
      payoutUsd: 20,
      breakevenCvrPct: 4, // 实际 5%
    });
    expect(r.stage).toBe("winner");
    expect(r.action).toBe("scale_50");
    expect(r.actualCvrPct).toBeCloseTo(5, 6);
  });

  it("CVR 达标但转化不足 10 次 → promising/hold", () => {
    const r = judgeTestStage({
      clicks: 400,
      spendUsd: 120,
      conversions: 5, // 1.25%
      revenueUsd: 100,
      payoutUsd: 20,
      breakevenCvrPct: 1, // 1.25% ≥ 1，但转化不足 10
    });
    expect(r.stage).toBe("promising");
    expect(r.action).toBe("hold");
    expect(r.reasons[0]).toContain("再跑到 10 次");
  });

  it("CVR 不达标（有转化）→ failing/stop", () => {
    const r = judgeTestStage({
      clicks: 500,
      spendUsd: 200,
      conversions: 5, // 1%
      revenueUsd: 100,
      payoutUsd: 20,
      breakevenCvrPct: 4,
    });
    expect(r.stage).toBe("failing");
    expect(r.action).toBe("stop");
    expect(r.reasons[0]).toContain("不成立");
  });

  it("佣金未知 → inconclusive，不假装能判", () => {
    const r = judgeTestStage({
      clicks: 500,
      spendUsd: 200,
      conversions: 5,
      revenueUsd: 100,
      breakevenCvrPct: null,
    });
    expect(r.stage).toBe("inconclusive");
    expect(r.action).toBe("hold");
    expect(r.reasons[0]).toContain("保本 CVR");
  });
});


describe("CTR 早期信号", () => {
  it("曝光够但 CTR < 1% → low_ctr，建议修文案而不是停投", () => {
    const r = judgeTestStage({
      impressions: 2000,
      clicks: 10, // CTR 0.5%
      spendUsd: 12,
      conversions: 0,
      revenueUsd: 0,
    });
    expect(r.stage).toBe("low_ctr");
    expect(r.action).toBe("fix_creatives");
    expect(r.ctrPct).toBeCloseTo(0.5, 6);
    expect(r.reasons[0]).toContain("不是 offer 本身");
  });

  it("曝光不足时不下 CTR 结论（样本太小）", () => {
    const r = judgeTestStage({
      impressions: 100,
      clicks: 0,
      spendUsd: 5,
      conversions: 0,
      revenueUsd: 0,
    });
    // 点击 <50 先走 no_delivery
    expect(r.stage).toBe("no_delivery");
  });

  it("CTR 正常时照常走点击门槛判定", () => {
    const r = judgeTestStage({
      impressions: 2000,
      clicks: 100, // CTR 5%
      spendUsd: 120,
      conversions: 1,
      revenueUsd: 20,
    });
    expect(r.stage).toBe("too_early");
    expect(r.ctrPct).toBeCloseTo(5, 6);
  });

  it("没有曝光数据时 ctrPct 为 null，不假装知道", () => {
    const r = judgeTestStage({ clicks: 300, spendUsd: 100, conversions: 0, revenueUsd: 0 });
    expect(r.ctrPct).toBeNull();
  });
});
