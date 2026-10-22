/**
 * calcProfit: isEstimated flag (P0-2). Math itself must stay unchanged.
 */
import { describe, expect, it } from "vitest";
import { calcProfit, clicksToOrderFromCvr, defaultCvrForPrice, maxCpcForReturnRatio, returnRatioAtCpc, roundBidToBillableUnit, settlementPayoutHint, suggestCpcByClicksToOrder } from "@/lib/profit-calc";

describe("roundBidToBillableUnit", () => {
  it("rounds 4-decimal profit math to the ¥0.01 billable unit", () => {
    // Regression 2026-10-22: 1.2709 reached Google as cpcBidMicros and was
    // rejected ("Value must be a multiple of billable unit").
    expect(roundBidToBillableUnit(1.2709)).toBe(1.27);
    expect(roundBidToBillableUnit(2.5418)).toBe(2.54);
    expect(roundBidToBillableUnit(1.276)).toBe(1.28);
    // Exact half-cents resolve DOWN (float repr. of x.xx5 sits just below
    // the half) — acceptable and safer for a max-CPC ceiling: never above
    // the computed cap.
    expect(roundBidToBillableUnit(1.275)).toBe(1.27);
  });

  it("never rounds a positive bid below one unit", () => {
    expect(roundBidToBillableUnit(0.004)).toBe(0.01);
    expect(roundBidToBillableUnit(0)).toBe(0);
  });
});

describe("calcProfit isEstimated", () => {
  it("defaults isEstimated to false when inputsEstimated is omitted", () => {
    const r = calcProfit({ payout: 10, cpc: 0.5, cvrF: 0.02 });
    expect(r.isEstimated).toBe(false);
  });

  it("passes inputsEstimated through to isEstimated", () => {
    expect(
      calcProfit({ payout: 10, cpc: 0.5, cvrF: 0.02, inputsEstimated: true })
        .isEstimated,
    ).toBe(true);
    expect(
      calcProfit({ payout: 10, cpc: 0.5, cvrF: 0.02, inputsEstimated: false })
        .isEstimated,
    ).toBe(false);
  });

  it("keeps the original math unchanged with the new field", () => {
    const r = calcProfit({ payout: 10, cpc: 0.5, cvrF: 0.02 });
    expect(r.epc).toBeCloseTo(0.2, 10);
    expect(r.perClickProfit).toBeCloseTo(-0.3, 10);
    expect(r.breakEvenCpc).toBeCloseTo(0.2, 10);
  });
});

describe("return ratio（产出比）: r = 产出 / 投入，投 1 产出 r、利润 r − 1", () => {
  it("maxCpcForReturnRatio：EPC 0.18、r 1.5 → 0.12；r 1 → 保平 0.18；r 2 → 0.09", () => {
    expect(maxCpcForReturnRatio(0.18, 1.5)).toBeCloseTo(0.12, 10);
    expect(maxCpcForReturnRatio(0.18, 1)).toBeCloseTo(0.18, 10);
    expect(maxCpcForReturnRatio(0.18, 2)).toBeCloseTo(0.09, 10);
  });

  it("maxCpcForReturnRatio：比值 <= 0 返回 null", () => {
    expect(maxCpcForReturnRatio(0.18, 0)).toBeNull();
    expect(maxCpcForReturnRatio(0.18, -1)).toBeNull();
  });

  it("returnRatioAtCpc：EPC 0.18、CPC 0.12 → 1.5；CPC 0.18 → 1（保平）；CPC 0 → null", () => {
    expect(returnRatioAtCpc(0.18, 0.12)).toBeCloseTo(1.5, 10);
    expect(returnRatioAtCpc(0.18, 0.18)).toBeCloseTo(1, 10);
    expect(returnRatioAtCpc(0.18, 0)).toBeNull();
  });

  it("calcProfit：默认比值 2（= 旧 ROI 100%）；显式 r 1.5 时最高 CPC = EPC / 1.5", () => {
    const d = calcProfit({ payout: 10, cpc: 0.5, cvrF: 0.02 });
    expect(d.maxCpcAtTargetRatio).toBeCloseTo(0.1, 10);
    expect(d.returnRatioAtCpc).toBeCloseTo(0.4, 10);
    const r = calcProfit({ payout: 10, cpc: 0.5, cvrF: 0.02, targetReturnRatio: 1.5 });
    expect(r.maxCpcAtTargetRatio).toBeCloseTo(0.2 / 1.5, 10);
  });
});

describe("#7 到账率双口径（settlementRateF）", () => {
  it("默认到账率 0.7：账面产出比不变，到账产出比 = 账面 × 0.7", () => {
    const r = calcProfit({ payout: 10, cpc: 0.5, cvrF: 0.02 });
    expect(r.settlementRateF).toBeCloseTo(0.7, 10);
    expect(r.returnRatioAtCpc).toBeCloseTo(0.4, 10);
    expect(r.returnRatioNetAtCpc).toBeCloseTo(0.28, 10);
  });

  it("自定义到账率：0.85 时到账产出比 = 账面 × 0.85；账面口径不受影响", () => {
    const r = calcProfit({ payout: 10, cpc: 0.5, cvrF: 0.02, settlementRateF: 0.85 });
    expect(r.settlementRateF).toBeCloseTo(0.85, 10);
    expect(r.returnRatioAtCpc).toBeCloseTo(0.4, 10);
    expect(r.returnRatioNetAtCpc).toBeCloseTo(0.34, 10);
  });

  it("到账率钳制到 0–1；非有限数回落默认 0.7", () => {
    expect(
      calcProfit({ payout: 10, cpc: 0.5, cvrF: 0.02, settlementRateF: 1.5 }).settlementRateF
    ).toBe(1);
    expect(
      calcProfit({ payout: 10, cpc: 0.5, cvrF: 0.02, settlementRateF: NaN }).settlementRateF
    ).toBeCloseTo(0.7, 10);
  });

  it("null 边界：CPC 无效（0）时账面与到账产出比都为 null", () => {
    const r = calcProfit({ payout: 10, cpc: 0, cvrF: 0.02 });
    expect(r.returnRatioAtCpc).toBeNull();
    expect(r.returnRatioNetAtCpc).toBeNull();
  });

  it("settlementPayoutHint：默认 135 天 → 约 4.5 个月；自定义天数与英文文案", () => {
    expect(settlementPayoutHint(null, "zh")).toContain("4.5");
    expect(settlementPayoutHint(undefined, "zh")).toContain("135");
    expect(settlementPayoutHint(60, "zh")).toContain("2 个月");
    expect(settlementPayoutHint(60, "en")).toContain("~2 months");
    expect(settlementPayoutHint(0, "zh")).toContain("135");
    expect(settlementPayoutHint(NaN, "en")).toContain("135");
  });
});

describe("#8 defaultCvrForPrice（按客单价分档估算 CVR）", () => {
  it("三档：<100 → 6%；100–300（含）→ 4%；>300 → 2.5%", () => {
    expect(defaultCvrForPrice(50)).toBeCloseTo(0.06, 10);
    expect(defaultCvrForPrice(99.99)).toBeCloseTo(0.06, 10);
    expect(defaultCvrForPrice(100)).toBeCloseTo(0.04, 10);
    expect(defaultCvrForPrice(300)).toBeCloseTo(0.04, 10);
    expect(defaultCvrForPrice(300.01)).toBeCloseTo(0.025, 10);
    expect(defaultCvrForPrice(1200)).toBeCloseTo(0.025, 10);
  });

  it("无效价格 → null（不编造）", () => {
    expect(defaultCvrForPrice(null)).toBeNull();
    expect(defaultCvrForPrice(undefined)).toBeNull();
    expect(defaultCvrForPrice(0)).toBeNull();
    expect(defaultCvrForPrice(-10)).toBeNull();
    expect(defaultCvrForPrice(NaN)).toBeNull();
  });
});

describe("P1-1 suggestCpcByClicksToOrder (公式 A)", () => {
  it("GREENVINES 验算：100 × 15% ÷ 50 = $0.30", () => {
    expect(
      suggestCpcByClicksToOrder({ price: 100, commissionRatePct: 15, clicksToOrder: 50 })
    ).toBeCloseTo(0.3, 10);
  });

  it("实测 CVR = 1% → 分母 100 → A = $0.15", () => {
    const cto = clicksToOrderFromCvr(0.01);
    expect(cto).toBeCloseTo(100, 10);
    expect(
      suggestCpcByClicksToOrder({ price: 100, commissionRatePct: 15, clicksToOrder: cto! })
    ).toBeCloseTo(0.15, 10);
  });

  it("实测 CVR = 2% → 分母 50，与假设 50 一致 → A = $0.30", () => {
    const cto = clicksToOrderFromCvr(0.02);
    expect(cto).toBeCloseTo(50, 10);
    expect(
      suggestCpcByClicksToOrder({ price: 100, commissionRatePct: 15, clicksToOrder: cto! })
    ).toBeCloseTo(0.3, 10);
  });

  it("无效输入返回 null", () => {
    expect(
      suggestCpcByClicksToOrder({ price: 0, commissionRatePct: 15, clicksToOrder: 50 })
    ).toBeNull();
    expect(
      suggestCpcByClicksToOrder({ price: 100, commissionRatePct: 15, clicksToOrder: 0 })
    ).toBeNull();
    expect(clicksToOrderFromCvr(0)).toBeNull();
    expect(clicksToOrderFromCvr(1)).toBeNull();
  });
});
