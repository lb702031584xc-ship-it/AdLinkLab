import { describe, expect, it } from "vitest";
import {
  evaluateAdPerformance,
  STOP_LOSS_PAYOUT_MULTIPLE,
} from "./perf-verdict.js";

const base = {
  spend: null,
  avgCpc: null,
  impressions: null,
  clicks: null,
  conversions: null,
} as const;

describe("evaluateAdPerformance（止损/低价判断边界）", () => {
  it("止损倍数常量 = 2.5", () => {
    expect(STOP_LOSS_PAYOUT_MULTIPLE).toBe(2.5);
  });

  it("无回填 → 数据不足（不猜）", () => {
    const v = evaluateAdPerformance(null, {
      payout: 100,
      breakevenCpc: 2,
      topOfPageFloor: 3,
    });
    expect(v.level).toBe("insufficient");
  });

  it("花费恰好 2.5×payout 且 0 转化 → 必须止损", () => {
    const v = evaluateAdPerformance(
      { ...base, spend: 250, impressions: 900, clicks: 40, conversions: 0 },
      { payout: 100, breakevenCpc: 2, topOfPageFloor: null }
    );
    expect(v.level).toBe("stop");
    expect(v.basis.spendPayoutRatio).toBe(2.5);
    expect(v.basis.stopLossThreshold).toBe(250);
  });

  it("花费超过 2.5×payout 但转化 = 1 → 不触发止损", () => {
    const v = evaluateAdPerformance(
      { ...base, spend: 300, avgCpc: 1.5, impressions: 900, clicks: 200, conversions: 1 },
      { payout: 100, breakevenCpc: 2, topOfPageFloor: null }
    );
    expect(v.level).toBe("ok");
  });

  it("花费未达 2.5 倍且 0 转化 → 不判止损（数据不足）", () => {
    const v = evaluateAdPerformance(
      { ...base, spend: 249.99, impressions: 900, clicks: 40, conversions: 0 },
      { payout: 100, breakevenCpc: 2, topOfPageFloor: null }
    );
    expect(v.level).toBe("insufficient");
  });

  it("payout 未知 → 止损规则不触发（不猜）", () => {
    const v = evaluateAdPerformance(
      { ...base, spend: 9999, impressions: 900, clicks: 40, conversions: 0 },
      { payout: null, breakevenCpc: 2, topOfPageFloor: null }
    );
    expect(v.level).toBe("insufficient");
    expect(v.basis.stopLossThreshold).toBeNull();
  });

  it("展示 = 0、出价 < 页首下限、页首下限 <= 经济上限 → 出价太低（琥珀）", () => {
    const v = evaluateAdPerformance(
      { ...base, spend: 0, avgCpc: 0.5, impressions: 0, clicks: 0, conversions: 0 },
      { payout: 100, breakevenCpc: 20, topOfPageFloor: 14.62 }
    );
    expect(v.level).toBe("low_bid");
  });

  it("展示 = 0、页首下限 > 经济上限 → 市场价高于经济上限（红，建议停）", () => {
    const v = evaluateAdPerformance(
      { ...base, spend: 0, avgCpc: 0.5, impressions: 0, clicks: 0, conversions: 0 },
      { payout: 100, breakevenCpc: 0.56, topOfPageFloor: 19.69 }
    );
    expect(v.level).toBe("market_too_high");
  });

  it("展示 = 0 但页首下限缺失 → 只给灰（不判低价）", () => {
    const v = evaluateAdPerformance(
      { ...base, spend: 0, avgCpc: 0.5, impressions: 0, clicks: 0, conversions: 0 },
      { payout: 100, breakevenCpc: 0.56, topOfPageFloor: null }
    );
    expect(v.level).toBe("insufficient");
  });

  it("展示 = 0、页首下限有、出价未回填 → 不判低价（灰）", () => {
    const v = evaluateAdPerformance(
      { ...base, spend: 0, avgCpc: null, impressions: 0, clicks: 0, conversions: 0 },
      { payout: 100, breakevenCpc: 20, topOfPageFloor: 14.62 }
    );
    expect(v.level).toBe("insufficient");
  });

  it("有转化且实际 CPC 超经济上限 → 不是绿色（灰，继续观察口径）", () => {
    const v = evaluateAdPerformance(
      { ...base, spend: 120, avgCpc: 3, impressions: 900, clicks: 40, conversions: 2 },
      { payout: 100, breakevenCpc: 2, topOfPageFloor: null }
    );
    expect(v.level).toBe("insufficient");
  });
});
