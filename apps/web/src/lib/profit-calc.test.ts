/**
 * calcProfit: isEstimated flag (P0-2). Math itself must stay unchanged.
 */
import { describe, expect, it } from "vitest";
import { calcProfit } from "@/lib/profit-calc";

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
