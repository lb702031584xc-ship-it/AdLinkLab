import { describe, expect, it } from "vitest";
import {
  buildTrafficPlanPrompt,
  computeKeywordMath,
  getComboProfile,
  UNIVERSAL_NEGATIVES,
  type TrafficPlanInput,
} from "./traffic-planner.js";

const baseInput: TrafficPlanInput = {
  mode: "landing",
  brandPolicy: "allowed",
  language: "zh",
  offerName: "Test VPN",
  payout: 20,
  keywords: [
    { keyword: "best vpn 2026", volume: 10000, plannerLow: 1.5, plannerHigh: 3.0 },
    { keyword: "cheap vpn", volume: 5000, cpc: 0.8 },
  ],
  negativeKeywords: ["免费", "free"],
};

describe("getComboProfile", () => {
  it("returns 4 distinct profiles with ascending difficulty", () => {
    const a = getComboProfile("landing", "allowed");
    const d = getComboProfile("direct", "forbidden");
    expect(a.cvrMid).toBeGreaterThan(d.cvrMid);
    expect(a.key).toBe("landing_allowed");
    expect(d.key).toBe("direct_forbidden");
  });
});

describe("computeKeywordMath", () => {
  it("prefers plannerLow over SEMRUSH cpc and computes affordability", () => {
    const profile = getComboProfile("landing", "allowed"); // cvrMid 10%
    const { rows } = computeKeywordMath(baseInput, profile);
    // targetCPA = 20 * 0.5 = 10; maxBid = 10 * 0.10 = 1.00
    expect(rows[0].refCpc).toBe(1.5);
    expect(rows[0].affordable).toBe(false); // 1.5 > 1.00
    expect(rows[0].breakEvenCvrPct).toBeCloseTo(7.5);
    expect(rows[1].refCpc).toBe(0.8);
    expect(rows[1].affordable).toBe(true);
  });

  it("emits EPC verdict when EPC and payout present", () => {
    const profile = getComboProfile("landing", "allowed");
    const { epcVerdict } = computeKeywordMath(
      { ...baseInput, epc: 0.6 },
      profile
    );
    expect(epcVerdict).toContain("$0.60");
    expect(epcVerdict).toContain("$0.30"); // 0.6 * 0.5
  });

  it("handles missing data gracefully", () => {
    const profile = getComboProfile("direct", "forbidden");
    const { rows, epcVerdict } = computeKeywordMath(
      { ...baseInput, payout: undefined, keywords: [{ keyword: "x" }] },
      profile
    );
    expect(rows[0].verdict).toBe("数据不足");
    expect(epcVerdict).toBeNull();
  });
});

describe("buildTrafficPlanPrompt", () => {
  it("embeds combo strategy and 5-section output contract", () => {
    const { system, user } = buildTrafficPlanPrompt(baseInput);
    expect(system).toContain("20年");
    expect(user).toContain("落地页 + 可投品牌词");
    expect(user).toContain("一句话结论");
    expect(user).toContain("新手三步走");
    expect(user).toContain("best vpn 2026");
  });

  it("warns strongly for direct_forbidden combo", () => {
    const { user } = buildTrafficPlanPrompt({
      ...baseInput,
      mode: "direct",
      brandPolicy: "forbidden",
    });
    expect(user).toContain("地狱模式");
  });
});

describe("UNIVERSAL_NEGATIVES", () => {
  it("covers low-intent categories", () => {
    expect(UNIVERSAL_NEGATIVES["售后类"]).toContain("维修");
    expect(UNIVERSAL_NEGATIVES["白嫖类"]).toContain("免费");
    expect(Object.keys(UNIVERSAL_NEGATIVES).length).toBeGreaterThanOrEqual(6);
  });
});
