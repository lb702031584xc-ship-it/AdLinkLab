/**
 * 复盘校准纯函数测试：k 的计算、样本门槛、亏损率、高估榜。
 */
import { describe, expect, it } from "vitest";
import { calibrateFromArchives, type CalibrationSourceRow } from "./calibration.js";

const row = (over: Partial<CalibrationSourceRow> = {}): CalibrationSourceRow => ({
  offerId: "o-1",
  offerName: "Widget",
  plannedEpcUsd: 2,
  clicks: 1000,
  revenueUsd: 1000, // actual EPC = 1.0 → ratio 2.0
  spendUsd: 800,
  ...over,
});

describe("calibrateFromArchives", () => {
  it("k = 计划 EPC ÷ 实测 EPC 的中位数", () => {
    const r = calibrateFromArchives([
      row({ offerId: "a" }), // 2 / 1 = 2
      row({ offerId: "b", plannedEpcUsd: 3 }), // 3 / 1 = 3
      row({ offerId: "c", plannedEpcUsd: 1.5 }), // 1.5
      row({ offerId: "d", plannedEpcUsd: 2 }),
      row({ offerId: "e", plannedEpcUsd: 2 }),
    ]);
    expect(r.samples).toBe(5);
    expect(r.k).toBe(2);
    expect(r.biasPct).toBe(100);
    expect(r.confidence).toBe("weak");
  });

  it("实测 EPC = 收入 ÷ 点击，不是直接取收入", () => {
    const r = calibrateFromArchives([
      row({ clicks: 2000, revenueUsd: 1000 }), // actual 0.5 → ratio 4
    ]);
    expect(r.worst[0].actualEpcUsd).toBe(0.5);
    expect(r.worst[0].ratio).toBe(4);
  });

  it("点击样本不足的归档不参与统计", () => {
    const r = calibrateFromArchives([
      row({ offerId: "big" }),
      row({ offerId: "tiny", clicks: 10 }),
    ]);
    expect(r.samples).toBe(1);
  });

  it("缺计划 EPC 或收入为 0 的行被跳过（不做除零）", () => {
    const r = calibrateFromArchives([
      row({ offerId: "no-plan", plannedEpcUsd: null }),
      row({ offerId: "no-rev", revenueUsd: 0 }),
      row({ offerId: "ok" }),
    ]);
    expect(r.samples).toBe(1);
  });

  it("高估率与亏损率分开统计", () => {
    const r = calibrateFromArchives([
      row({ offerId: "over", plannedEpcUsd: 4 }), // ratio 4 高估，spend 800 < rev 1000 不亏
      row({ offerId: "under", plannedEpcUsd: 0.5 }), // 低估
      row({ offerId: "lose", plannedEpcUsd: 2, spendUsd: 1200 }), // 亏
    ]);
    expect(r.overestimateRate).toBeCloseTo(2 / 3, 6);
    expect(r.lossRate).toBeCloseTo(1 / 3, 6);
  });

  it("样本为 0 时 k 为 null 且给出原因", () => {
    const r = calibrateFromArchives([]);
    expect(r.samples).toBe(0);
    expect(r.k).toBeNull();
    expect(r.confidence).toBe("insufficient");
    expect(r.notes.join("")).toContain("没有可用的复盘样本");
  });

  it("样本足够时 confidence 为 ok", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row({ offerId: `o${i}` }));
    expect(calibrateFromArchives(rows).confidence).toBe("ok");
  });

  it("系统性高估时给出「除以 k」的建议", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ offerId: `o${i}`, plannedEpcUsd: 4 })
    );
    const r = calibrateFromArchives(rows);
    expect(r.k).toBe(4);
    expect(r.notes.join("")).toContain("除以 4.00");
  });

  it("worst 按高估倍数降序，最多 5 条", () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      row({ offerId: `o${i}`, plannedEpcUsd: 1 + i })
    );
    const r = calibrateFromArchives(rows);
    expect(r.worst).toHaveLength(5);
    expect(r.worst[0].ratio).toBeGreaterThan(r.worst[1].ratio);
  });
});
