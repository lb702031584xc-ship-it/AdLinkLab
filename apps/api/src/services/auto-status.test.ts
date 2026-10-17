import { describe, expect, it } from "vitest";
import { evaluateAutoStatus } from "./auto-status.js";

const DAY = 86_400_000;
const now = new Date("2026-10-17T00:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * DAY);

describe("P1-6 evaluateAutoStatus", () => {
  const prefs = { autoStatusEnabled: false, zeroPerfDays: 5, roscDeclineDays: 7 };

  it("无档案 → none，不评估", () => {
    expect(evaluateAutoStatus(prefs, [], now).suggestion).toBe("none");
  });

  it("零表现：已跑 ≥5 天且 0 点击 → pause_zero_perf；未开启时只建议不自动暂停", () => {
    const out = evaluateAutoStatus(prefs, [
      { createdAt: ago(6), clicks: 0, spend: 10, revenue: 0 },
    ], now);
    expect(out.suggestion).toBe("pause_zero_perf");
    expect(out.willAutoPause).toBe(false);
  });

  it("零表现 + 已开启 → willAutoPause=true", () => {
    const out = evaluateAutoStatus({ ...prefs, autoStatusEnabled: true }, [
      { createdAt: ago(6), clicks: 0, spend: 10, revenue: 0 },
    ], now);
    expect(out.willAutoPause).toBe(true);
  });

  it("未满零表现天数 → none（不提前暂停）", () => {
    const out = evaluateAutoStatus(prefs, [
      { createdAt: ago(3), clicks: 0, spend: 10, revenue: 0 },
    ], now);
    expect(out.suggestion).toBe("none");
  });

  it("ROAS 下滑 ≥7 天间隔 → review_rosc_decline，且永不自动暂停", () => {
    const out = evaluateAutoStatus({ ...prefs, autoStatusEnabled: true }, [
      { createdAt: ago(14), clicks: 100, spend: 50, revenue: 150 },
      { createdAt: ago(6), clicks: 100, spend: 50, revenue: 60 },
    ], now);
    expect(out.suggestion).toBe("review_rosc_decline");
    expect(out.willAutoPause).toBe(false);
  });

  it("ROAS 下滑但间隔不足 → none", () => {
    const out = evaluateAutoStatus(prefs, [
      { createdAt: ago(10), clicks: 100, spend: 50, revenue: 150 },
      { createdAt: ago(6), clicks: 100, spend: 50, revenue: 60 },
    ], now);
    expect(out.suggestion).toBe("none");
  });
});
