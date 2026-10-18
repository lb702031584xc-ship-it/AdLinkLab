/**
 * calcProfit: isEstimated flag (P0-2). Math itself must stay unchanged.
 */
import { describe, expect, it } from "vitest";
import { calcProfit, clicksToOrderFromCvr, maxCpcForReturnRatio, returnRatioAtCpc, suggestCpcByClicksToOrder } from "@/lib/profit-calc";

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
