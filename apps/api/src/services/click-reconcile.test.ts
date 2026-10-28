/**
 * 点击对账测试：损耗率、判定档位、时区错位检测。
 */
import { describe, expect, it } from "vitest";
import { reconcileClicks } from "./click-reconcile.js";

describe("reconcileClicks", () => {
  it("正常损耗（≤15%）→ ok", () => {
    const r = reconcileClicks({ googleClicks: 100, networkClicks: 90 });
    expect(r.lossRatePct).toBe(10);
    expect(r.verdict).toBe("ok");
  });

  it("偏高（15–30%）→ warning", () => {
    const r = reconcileClicks({ googleClicks: 100, networkClicks: 75 });
    expect(r.lossRatePct).toBe(25);
    expect(r.verdict).toBe("warning");
  });

  it("结构性损耗（>30%）→ critical，并给出排查顺序", () => {
    const r = reconcileClicks({ googleClicks: 126, networkClicks: 56 });
    expect(r.lossRatePct).toBe(55.6);
    expect(r.verdict).toBe("critical");
    expect(r.causes[0].likelihood).toBe("high");
    expect(r.actions.join("")).toContain("4G");
  });

  it("按天求和", () => {
    const r = reconcileClicks({
      days: [
        { date: "2026-10-24", googleClicks: 55, networkClicks: 32 },
        { date: "2026-10-25", googleClicks: 69, networkClicks: 20 },
      ],
    });
    expect(r.googleClicks).toBe(124);
    expect(r.networkClicks).toBe(52);
  });

  it("某天联盟点击多于 Google → 检测到时区错位，但不当成异常", () => {
    const r = reconcileClicks({
      days: [
        { date: "2026-10-24", googleClicks: 55, networkClicks: 32 },
        { date: "2026-10-26", googleClicks: 0, networkClicks: 2 },
      ],
    });
    expect(r.timezoneSuspected).toBe(true);
    expect(r.notes.join("")).toContain("时区");
  });

  it("Google 点击为 0 → 无法对账", () => {
    const r = reconcileClicks({ googleClicks: 0, networkClicks: 5 });
    expect(r.lossRatePct).toBeNull();
    expect(r.verdict).toBe("unknown");
  });

  it("联盟多于 Google 时损耗率为负，不判 critical", () => {
    const r = reconcileClicks({ googleClicks: 50, networkClicks: 60 });
    expect(r.lossRatePct).toBe(-20);
    expect(r.verdict).toBe("ok");
  });
});
