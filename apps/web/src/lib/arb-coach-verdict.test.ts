import { describe, expect, it } from "vitest";
import {
  DEFAULT_STOPLOSS_MULTIPLIER,
  judgeArbCombo,
  reasonLabelKey,
  STOPLOSS_FLOW_MULTIPLIER,
  stopLossMultiplierForFlow,
  verdictLabelKey,
} from "./arb-coach-verdict";

describe("judgeArbCombo", () => {
  it("没花钱 → 观察（no_spend）", () => {
    const r = judgeArbCombo({ spend: 0, clicks: 0, conversions: 0, payout: 2 });
    expect(r.verdict).toBe("watch");
    expect(r.reason).toBe("no_spend");
    expect(r.cpc).toBe(0);
    expect(r.epc).toBe(0);
    expect(r.roi).toBe(0);
  });

  it("payout 未知 → 观察（no_payout），不乱判", () => {
    const r = judgeArbCombo({ spend: 10, clicks: 1000, conversions: 5, payout: 0 });
    expect(r.verdict).toBe("watch");
    expect(r.reason).toBe("no_payout");
  });

  it("1 单佣金花完还没转化 → 砍（kill_no_conv）", () => {
    // payout $2，烧 $2 无转化
    const r = judgeArbCombo({ spend: 2, clicks: 400, conversions: 0, payout: 2 });
    expect(r.verdict).toBe("kill");
    expect(r.reason).toBe("kill_no_conv");
    expect(r.cpc).toBeCloseTo(0.005);
    expect(r.epc).toBe(0);
  });

  it("没烧够 1 单佣金 → 还不砍，继续观察", () => {
    const r = judgeArbCombo({ spend: 1, clicks: 200, conversions: 0, payout: 2 });
    expect(r.verdict).toBe("watch");
    expect(r.reason).toBe("watch");
  });

  it("ROI ≤ -50% 且花够 $10 → 砍（kill_roi）", () => {
    // 花 $10，1 转化 × $2 = $2 收入，ROI = -80%
    const r = judgeArbCombo({ spend: 10, clicks: 2000, conversions: 1, payout: 2 });
    expect(r.verdict).toBe("kill");
    expect(r.reason).toBe("kill_roi");
    expect(r.roi).toBeCloseTo(-0.8);
    expect(r.epc).toBeCloseTo(0.001);
  });

  it("ROI 差但没花够 $10 → 按 1x 砍线处理", () => {
    const r = judgeArbCombo({ spend: 5, clicks: 1000, conversions: 0, payout: 2 });
    // 0 转化且 $5 ≥ 1×$2 → kill_no_conv 先命中
    expect(r.verdict).toBe("kill");
    expect(r.reason).toBe("kill_no_conv");
  });

  it("ROI > 20% → 加量（scale）", () => {
    // 花 $10，8 转化 × $2 = $16，ROI = 60%
    const r = judgeArbCombo({ spend: 10, clicks: 2000, conversions: 8, payout: 2 });
    expect(r.verdict).toBe("scale");
    expect(r.reason).toBe("scale");
    expect(r.roi).toBeCloseTo(0.6);
    expect(r.epc).toBeCloseTo(0.008);
  });

  it("ROI 在 -50%~20% 之间 → 观察", () => {
    // 花 $10，5 转化 × $2 = $10，ROI = 0
    const r = judgeArbCombo({ spend: 10, clicks: 2000, conversions: 5, payout: 2 });
    expect(r.verdict).toBe("watch");
    expect(r.reason).toBe("watch");
    expect(r.roi).toBeCloseTo(0);
  });

  it("非法输入（负数/NaN）按 0 处理，不抛错", () => {
    const r = judgeArbCombo({ spend: -5, clicks: NaN, conversions: -1, payout: 2 });
    expect(r.verdict).toBe("watch");
    expect(r.reason).toBe("no_spend");
  });

  it("#9 stopLossMultiplierForFlow：浅层 2.5 / 深层 4 / 其余已知 3 / 未知 2.5", () => {
    // 浅层
    expect(stopLossMultiplierForFlow("soi_simple")).toBe(2.5);
    expect(stopLossMultiplierForFlow("one_click")).toBe(2.5);
    // 深层
    expect(stopLossMultiplierForFlow("cc_submit")).toBe(4);
    expect(stopLossMultiplierForFlow("ftd")).toBe(4);
    // 其余已知
    expect(stopLossMultiplierForFlow("pin_submit")).toBe(3);
    expect(stopLossMultiplierForFlow("free_trial")).toBe(3);
    expect(stopLossMultiplierForFlow("pay_per_call")).toBe(3);
    expect(stopLossMultiplierForFlow("cps_sale")).toBe(3);
    expect(stopLossMultiplierForFlow("mixed")).toBe(3);
    // 未知 / 空 → 现有值 2.5
    expect(stopLossMultiplierForFlow(null)).toBe(2.5);
    expect(stopLossMultiplierForFlow(undefined)).toBe(2.5);
    expect(stopLossMultiplierForFlow("")).toBe(2.5);
    expect(stopLossMultiplierForFlow("some_unknown_flow")).toBe(2.5);
    // 大小写/空白不敏感
    expect(stopLossMultiplierForFlow(" CC_Submit ")).toBe(4);
    // 常量表与默认值自洽
    expect(DEFAULT_STOPLOSS_MULTIPLIER).toBe(2.5);
    expect(STOPLOSS_FLOW_MULTIPLIER.soi_simple).toBe(2.5);
    expect(Object.keys(STOPLOSS_FLOW_MULTIPLIER)).toHaveLength(9);
  });

  it("label key 映射正确", () => {
    expect(verdictLabelKey("kill")).toBe("verdictKill");
    expect(verdictLabelKey("scale")).toBe("verdictScale");
    expect(verdictLabelKey("watch")).toBe("verdictWatch");
    expect(reasonLabelKey("kill_no_conv")).toBe("reasonKillNoConv");
    expect(reasonLabelKey("kill_roi")).toBe("reasonKillRoi");
    expect(reasonLabelKey("scale")).toBe("reasonScale");
    expect(reasonLabelKey("watch")).toBe("reasonWatch");
    expect(reasonLabelKey("no_spend")).toBe("reasonNoSpend");
    expect(reasonLabelKey("no_payout")).toBe("reasonNoPayout");
  });
});
