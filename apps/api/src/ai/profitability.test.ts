
import { describe, expect, it } from "vitest";
import { analyzeProfit, computeClickProfit } from "./profitability.js";

describe("analyzeProfit", () => {
  it("computes bid suggestions from fixed commission", () => {
    const r = analyzeProfit({ fixedAmount: 10, currency: "USD" }, 2);
    expect(r.commission.method).toBe("fixed");
    expect(r.commission.commissionMin).toBe(10);
    // break-even CPC = 10 * 2 / 100 = 0.2
    expect(r.breakEvenCpc).toBe(0.2);
    expect(r.bids).toHaveLength(3);
    expect(r.bids[0].maxCpc).toBe(0.1); // conservative 50%
    expect(r.bids[1].maxCpc).toBe(0.14); // moderate 70%
    expect(r.bids[2].maxCpc).toBe(0.18); // aggressive 90%
  });

  it("computes commission range from price x pct", () => {
    const r = analyzeProfit(
      { priceMin: 50, priceMax: 100, commissionPctMin: 5, commissionPctMax: 10, currency: "USD" },
      2
    );
    expect(r.commission.method).toBe("range");
    expect(r.commission.commissionMin).toBe(2.5); // 50 * 5%
    expect(r.commission.commissionMax).toBe(10); // 100 * 10%
  });

  it("returns unknown when no commission input", () => {
    const r = analyzeProfit({}, 2);
    expect(r.commission.method).toBe("unknown");
    expect(r.breakEvenCpc).toBeNull();
    expect(r.bids.every((b) => b.maxCpc === null)).toBe(true);
  });

  it("produces profit/loss scenarios", () => {
    const r = analyzeProfit({ fixedAmount: 10, currency: "USD" }, 2);
    expect(r.scenarios).toHaveLength(3);
    // At 1% CVR with moderate CPC 0.14: revenue = 100*0.01*10 = 10, cost = 14 → loss
    expect(r.scenarios[0].verdict).toBe("loss");
    // At 4% CVR: revenue = 40, cost = 14 → profit
    expect(r.scenarios[2].verdict).toBe("profit");
  });
});

describe("computeClickProfit（第十一批）", () => {
  it("正常：price 100 × 4% × cvr 2% → breakEven 0.08，推荐 0.056", () => {
    const r = computeClickProfit({ price: 100, commissionRate: 0.04, cvr: 0.02 });
    expect(r.viable).toBe(true);
    expect(r.commissionPerSale).toBe(4);
    expect(r.breakEvenCpc).toBe(0.08);
    // 0.08×0.7=0.056 → round2 = 0.06
    expect(r.recommendedBid).toBe(0.06);
    // 期望盈亏 = 4×0.02 − 0.06 = 0.02
    expect(r.expectedProfitPerClick).toBeCloseTo(0.02, 3);
    expect(r.note).toBeNull();
  });

  it("固定佣金优先：fixedCommission 10", () => {
    const r = computeClickProfit({ price: 100, commissionRate: 0.04, fixedCommission: 10, cvr: 0.02 });
    expect(r.commissionPerSale).toBe(10);
    expect(r.breakEvenCpc).toBe(0.2);
    expect(r.recommendedBid).toBe(0.14);
  });

  it("零佣金 → 推荐出价 0 + 数学上不可投", () => {
    const r = computeClickProfit({ price: 100, commissionRate: 0, cvr: 0.02 });
    expect(r.viable).toBe(false);
    expect(r.recommendedBid).toBe(0);
    expect(r.note).toContain("不可投");
  });

  it("零转化率 → 推荐出价 0 + 数学上不可投", () => {
    const r = computeClickProfit({ price: 100, commissionRate: 0.04, cvr: 0 });
    expect(r.viable).toBe(false);
    expect(r.recommendedBid).toBe(0);
    expect(r.note).toContain("不可投");
  });

  it("实际 CPC：cpc 0.05 时期望盈亏 = 0.08 − 0.05 = 0.03", () => {
    const r = computeClickProfit({ price: 100, commissionRate: 0.04, cvr: 0.02, cpc: 0.05 });
    expect(r.expectedProfitPerClickAtCpc).toBeCloseTo(0.03, 3);
  });

  it("缺 cpc → expectedProfitPerClickAtCpc 为 null", () => {
    const r = computeClickProfit({ price: 100, commissionRate: 0.04, cvr: 0.02 });
    expect(r.expectedProfitPerClickAtCpc).toBeNull();
  });

  it("默认 cvr 2%：不传 cvr 时", () => {
    const r = computeClickProfit({ price: 50, commissionRate: 0.04 });
    expect(r.breakEvenCpc).toBe(0.04); // 2 × 0.02
  });
});

describe("#7 到账率双口径（settlementRateF，默认 0.7）", () => {
  it("analyzeProfit：默认 0.7，场景到账利润 = revenue × 0.7 − cost；账面不变", () => {
    const r = analyzeProfit({ fixedAmount: 10, currency: "USD" }, 2);
    expect(r.settlementRateF).toBeCloseTo(0.7, 10);
    // assumed 2% CVR、moderate CPC 0.14：revenue 20、cost 14 → 账面 +6，到账 20×0.7−14 = 0
    const mid = r.scenarios[1];
    expect(mid.profitPer100Clicks).toBeCloseTo(6, 6);
    expect(mid.profitPer100ClicksNet).toBeCloseTo(0, 6);
  });

  it("analyzeProfit：自定义到账率 1 → 到账口径与账面一致；未知佣金时到账利润为 null", () => {
    const r = analyzeProfit({ fixedAmount: 10, currency: "USD" }, 2, 1);
    expect(r.settlementRateF).toBe(1);
    expect(r.scenarios[1].profitPer100ClicksNet).toBeCloseTo(
      r.scenarios[1].profitPer100Clicks as number,
      6
    );
    const unknown = analyzeProfit({}, 2);
    expect(unknown.scenarios.every((s) => s.profitPer100ClicksNet === null)).toBe(true);
  });

  it("computeClickProfit：到账口径 = 佣金 × cvr × 到账率 − cpc；缺 cpc 为 null", () => {
    const r = computeClickProfit({ price: 100, commissionRate: 0.04, cvr: 0.02, cpc: 0.05 });
    expect(r.settlementRateF).toBeCloseTo(0.7, 10);
    // 4 × 0.02 × 0.7 − 0.05 = 0.006 → round2 = 0.01
    expect(r.expectedProfitPerClickNetAtCpc).toBe(0.01);
    const noCpc = computeClickProfit({ price: 100, commissionRate: 0.04, cvr: 0.02 });
    expect(noCpc.expectedProfitPerClickNetAtCpc).toBeNull();
  });
});
