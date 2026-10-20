import { describe, expect, it } from "vitest";
import { paceChecklist, daysActiveSince, PACE_STOP_LOSS_SOURCE, STOP_LOSS_PAYOUT_MULTIPLE, stopLossMultiplierForFlow, netValidOrderCount, affiliateConversionRate, roiStatusFor, roiRatioOf } from "./pace-checklist.js";

describe("P1-5 pace-checklist", () => {
  it("2–3 天无展示/点击 → CPC +10%~20% 再观察 2 天", () => {
    const out = paceChecklist({ impressions: 0, clicks: 0, conversions: 0, spend: 0, revenue: 0, daysActive: 2 });
    expect(out.some((s) => s.text.includes("+10%~20%"))).toBe(true);
    expect(out.every((s) => s.source.includes("讲师经验"))).toBe(true);
  });

  it("4–5 天有点击无转化 → 再观察 2 天，仍无转化建议停止", () => {
    const out = paceChecklist({ impressions: 500, clicks: 20, conversions: 0, spend: 10, revenue: 0, daysActive: 5 });
    expect(out.some((s) => s.text.includes("再观察 2 天"))).toBe(true);
  });

  it("3 天有展示无点击 → 建议删除/重新发布", () => {
    const out = paceChecklist({ impressions: 300, clicks: 0, conversions: 0, spend: 0, revenue: 0, daysActive: 3 });
    expect(out.some((s) => s.text.includes("删除/重新发布"))).toBe(true);
  });

  it("满 1 周盈利 → 保持 + 扩量=上新系列口径；亏损 → 削减/停止", () => {
    const win = paceChecklist({ impressions: 1000, clicks: 50, conversions: 3, spend: 20, revenue: 90, daysActive: 8 });
    expect(win.some((s) => s.text.includes("上新广告系列"))).toBe(true);
    const lose = paceChecklist({ impressions: 1000, clicks: 50, conversions: 0, spend: 20, revenue: 0, daysActive: 8 });
    expect(lose.some((s) => s.text.includes("削减预算或停止"))).toBe(true);
  });

  it("品牌词首日有点击 → 观察提示，不判停", () => {
    const out = paceChecklist({ impressions: 100, clicks: 5, conversions: 0, spend: 2, revenue: 0, daysActive: 1 });
    expect(out.some((s) => s.text.includes("首日无转化先观察"))).toBe(true);
    expect(out.some((s) => s.level === "action")).toBe(false);
  });

  it("天数未知 → 不出时间相关建议（不编造）", () => {
    const out = paceChecklist({ impressions: 0, clicks: 0, conversions: 0, spend: 0, revenue: 0, daysActive: null });
    expect(out).toEqual([]);
  });

  it("daysActiveSince：无效日期 → null；不足 1 天计 1 天", () => {
    expect(daysActiveSince("not-a-date")).toBeNull();
    expect(daysActiveSince(new Date(Date.now() - 3600_000).toISOString())).toBe(1);
  });

  it("金额型止损：花费达 2.5 倍 payout 且 0 转化/0 收入 → action + 硬规则来源 + 文案含金额与倍数", () => {
    const out = paceChecklist({ impressions: 2000, clicks: 80, conversions: 0, spend: 25, revenue: 0, payout: 10, daysActive: 6 });
    const stop = out.find((s) => s.text.includes("立即暂停止损"));
    expect(stop).toBeDefined();
    expect(stop?.level).toBe("action");
    expect(stop?.source).toBe(PACE_STOP_LOSS_SOURCE);
    expect(stop?.source).toContain("本站风控硬规则");
    expect(stop?.text).toContain("$25.00");
    expect(stop?.text).toContain(`${STOP_LOSS_PAYOUT_MULTIPLE.toFixed(1)} 倍 payout`);
  });

  it("金额型止损：天数未知也触发（不依赖时间规则）", () => {
    const out = paceChecklist({ impressions: 2000, clicks: 80, conversions: 0, spend: 30, revenue: null, payout: 10, daysActive: null });
    expect(out).toHaveLength(1);
    expect(out[0]?.text).toContain("立即暂停止损");
    expect(out[0]?.level).toBe("action");
  });

  it("补强 #20：stopLossMultiplierForFlow（源：arb-coach-verdict）— 浅层 2.5 / 深层 4 / 其余已知 3 / 未知 2.5", () => {
    expect(stopLossMultiplierForFlow("soi_simple")).toBe(2.5);
    expect(stopLossMultiplierForFlow("one_click")).toBe(2.5);
    expect(stopLossMultiplierForFlow("pin_submit")).toBe(3); // 其余已知流（arb 口径）
    expect(stopLossMultiplierForFlow("cc_submit")).toBe(4);
    expect(stopLossMultiplierForFlow("ftd")).toBe(4);
    expect(stopLossMultiplierForFlow("free_trial")).toBe(3);
    expect(stopLossMultiplierForFlow("cps_sale")).toBe(3);
    expect(stopLossMultiplierForFlow(null)).toBe(2.5);
    expect(stopLossMultiplierForFlow("unknown_flow")).toBe(2.5);
    expect(stopLossMultiplierForFlow(undefined)).toBe(STOP_LOSS_PAYOUT_MULTIPLE);
  });

  it("补强 #20：深层流（cc_submit）止损线为 4 倍 — 3 倍 payout 不触发、4 倍触发", () => {
    const below = paceChecklist({ impressions: 2000, clicks: 80, conversions: 0, spend: 30, revenue: 0, payout: 10, conversionFlow: "cc_submit", daysActive: null });
    expect(below.some((s) => s.text.includes("止损"))).toBe(false);
    const at = paceChecklist({ impressions: 2000, clicks: 80, conversions: 0, spend: 40, revenue: 0, payout: 10, conversionFlow: "cc_submit", daysActive: null });
    const stop = at.find((s) => s.text.includes("立即暂停止损"));
    expect(stop).toBeDefined();
    expect(stop?.text).toContain("止损线 4.0 倍");
  });

  it("补强 #20：ROI 口径 — 有效订单净值合并、转化率、ROI 阈值（≥100 点击才判定）", () => {
    expect(netValidOrderCount([
      { orderId: "a", value: 100, status: "CONFIRMED" },
      { orderId: "a", value: 100, status: "REFUNDED" },
      { orderId: "b", value: 20, status: "CONFIRMED" },
    ])).toBe(1);
    expect(affiliateConversionRate(4, 200)).toBeCloseTo(0.02);
    expect(affiliateConversionRate(4, 0)).toBeNull();
    expect(roiRatioOf(50, 100)).toBeCloseTo(0.5);
    expect(roiRatioOf(50, null)).toBeNull();
    expect(roiStatusFor(99, 0.1)).toBe("insufficient");
    expect(roiStatusFor(100, 0.9)).toBe("loss");
    expect(roiStatusFor(100, 1.5)).toBe("neutral");
    expect(roiStatusFor(100, 2)).toBe("profitable");
  });

  it("补强 #20：pace ROI 建议 — 点击 ≥100 且 ROI<1 出亏损提示；点击 <100 不判定", () => {
    const loss = paceChecklist({ impressions: 5000, clicks: 200, conversions: 2, spend: 100, revenue: 50, daysActive: null });
    expect(loss.some((s) => s.text.includes("ROI 0.50 < 1"))).toBe(true);
    const small = paceChecklist({ impressions: 500, clicks: 99, conversions: 2, spend: 100, revenue: 50, daysActive: null });
    expect(small.some((s) => s.text.includes("ROI"))).toBe(false);
    const win = paceChecklist({ impressions: 5000, clicks: 200, conversions: 10, spend: 100, revenue: 250, daysActive: null });
    expect(win.some((s) => s.text.includes("ROI 2.50 ≥ 2"))).toBe(true);
  });

  it("金额型止损：未达倍数 / 已有转化 / payout 未知或为 0 → 均不触发", () => {
    const below = paceChecklist({ impressions: 2000, clicks: 80, conversions: 0, spend: 24.99, revenue: 0, payout: 10, daysActive: null });
    expect(below.some((s) => s.text.includes("止损"))).toBe(false);
    const hasConv = paceChecklist({ impressions: 2000, clicks: 80, conversions: 1, spend: 30, revenue: 0, payout: 10, daysActive: null });
    expect(hasConv.some((s) => s.text.includes("止损"))).toBe(false);
    const noPayout = paceChecklist({ impressions: 2000, clicks: 80, conversions: 0, spend: 300, revenue: 0, payout: null, daysActive: null });
    expect(noPayout).toEqual([]);
    const zeroPayout = paceChecklist({ impressions: 2000, clicks: 80, conversions: 0, spend: 300, revenue: 0, payout: 0, daysActive: null });
    expect(zeroPayout).toEqual([]);
    const noPayoutField = paceChecklist({ impressions: 2000, clicks: 80, conversions: 0, spend: 300, revenue: 0, daysActive: null });
    expect(noPayoutField).toEqual([]);
  });
});
