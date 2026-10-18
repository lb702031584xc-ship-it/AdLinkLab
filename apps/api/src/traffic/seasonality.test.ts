import { describe, expect, it } from "vitest";
import {
  analyzeSeasonality,
  computeVolumeYoy,
  easterSunday,
  getSeasonalWindows,
  seasonalCountry,
  seasonalScore,
  seasonalVerdictRank,
} from "./seasonality.js";
import type { TrendsTimelinePoint } from "./trends.js";

const DAY = 86400000;
const WEEK = 7 * DAY;

/** 合成周时间线：last = now，往回 n 周；peakAtWeekAgo 周前为峰值 100，其余 50。 */
function syntheticPoints(
  now: number,
  weeks: number,
  peakAtWeekAgo: number | null,
  recent: number[] = [60, 65, 70, 75]
): TrendsTimelinePoint[] {
  const pts: TrendsTimelinePoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const time = now - i * WEEK;
    let value = 50;
    if (peakAtWeekAgo != null && i === peakAtWeekAgo) value = 100;
    pts.push({ time, value });
  }
  // 最近 4 周按 recent 覆盖（上升）
  for (let j = 0; j < 4 && j < recent.length; j++) {
    pts[pts.length - 4 + j]!.value = recent[j]!;
  }
  return pts;
}

describe("analyzeSeasonality", () => {
  const now = Date.UTC(2026, 9, 18); // 2026-10-18

  it("不足 26 周 → insufficient", () => {
    const s = analyzeSeasonality(syntheticPoints(now, 10, null), now);
    expect(s.verdict).toBe("insufficient");
  });

  it("去年峰值 +365 天在 14 天内 → approaching", () => {
    // 峰值在 52 周前：峰值 + 365 天 = now + 1 天
    const s = analyzeSeasonality(syntheticPoints(now, 60, 52), now, 14);
    expect(s.daysToPeak).toBe(1);
    expect(s.verdict).toBe("approaching");
  });

  it("去年峰值已过 29 天 → past", () => {
    // 峰值在 52 周 + 30 天前（用周近似：56 周前 ≈ 52 周 + 28 天）
    const s = analyzeSeasonality(syntheticPoints(now, 60, 56), now, 14);
    expect(s.daysToPeak).toBeLessThan(-14);
    expect(s.verdict).toBe("past");
  });

  it("YoY：当前 vs 52 周前同周", () => {
    // 52 周前同周 = 峰值 100（被 recent 覆盖前）；当前 = 75
    const s = analyzeSeasonality(syntheticPoints(now, 60, 52), now, 14);
    expect(s.yoyChangePct).toBe(-25);
  });

  it("方向：最近 4 周均值 vs 再往前 4 周", () => {
    const s = analyzeSeasonality(syntheticPoints(now, 60, null), now, 14);
    // 最近 4 周 (60+65+70+75)/4=67.5，前 4 周 50 → 上升
    expect(s.direction).toBe("rising");
  });
});

describe("easterSunday", () => {
  it("2024/2025/2026 复活节", () => {
    expect(easterSunday(2024).toISOString().slice(0, 10)).toBe("2024-03-31");
    expect(easterSunday(2025).toISOString().slice(0, 10)).toBe("2025-04-20");
    expect(easterSunday(2026).toISOString().slice(0, 10)).toBe("2026-04-05");
  });
});

describe("getSeasonalWindows", () => {
  it("美国 2026-10-18：万圣节/黑五/网一在 60 天内，圣诞超出", () => {
    const now = Date.UTC(2026, 9, 18);
    const windows = getSeasonalWindows("US", now, 60);
    const names = windows.map((w) => w.name);
    expect(names).toContain("万圣节");
    expect(names).toContain("黑五");
    expect(names).toContain("网一");
    expect(names).not.toContain("圣诞节");
    const halloween = windows.find((w) => w.name === "万圣节")!;
    expect(halloween.date).toBe("2026-10-31");
    expect(halloween.daysUntil).toBe(13);
    expect(halloween.withinLead).toBe(true); // lead 21
    const blackFriday = windows.find((w) => w.name === "黑五")!;
    expect(blackFriday.date).toBe("2026-11-27"); // 11 月第 4 个周五
    expect(blackFriday.withinLead).toBe(false); // 40 天 > lead 28
  });

  it("英国母亲节 = 复活节前 21 天（2026-03-15）", () => {
    const now = Date.UTC(2026, 1, 20);
    const windows = getSeasonalWindows("GB", now, 60);
    const mothers = windows.find((w) => w.name === "母亲节")!;
    expect(mothers.date).toBe("2026-03-15");
  });

  it("澳大利亚父亲节 = 9 月第一个周日（2026-09-06）", () => {
    const now = Date.UTC(2026, 7, 20);
    const windows = getSeasonalWindows("AU", now, 60);
    const fathers = windows.find((w) => w.name === "父亲节")!;
    expect(fathers.date).toBe("2026-09-06");
  });

  it("新加坡 2026-10-18：11.11 / 12.12 在 60 天内，9.9/10.10 已过", () => {
    const now = Date.UTC(2026, 9, 18);
    const windows = getSeasonalWindows("SG", now, 60);
    const names = windows.map((w) => w.name);
    expect(names).toContain("11.11 购物节");
    expect(names).toContain("12.12 购物节");
    expect(names).not.toContain("9.9 购物节");
    expect(names).not.toContain("10.10 购物节");
    const nov11 = windows.find((w) => w.name === "11.11 购物节")!;
    expect(nov11.date).toBe("2026-11-11");
    expect(nov11.daysUntil).toBe(24);
  });

  it("未收录国家 → 通用窗口", () => {
    const now = Date.UTC(2026, 9, 18);
    const windows = getSeasonalWindows("XX", now, 60);
    expect(windows.map((w) => w.name)).toContain("万圣节");
    expect(windows.map((w) => w.name)).not.toContain("黑五");
  });
});

describe("computeVolumeYoy", () => {
  it("最新月 vs 12 个月前同月", () => {
    const monthly = [
      { year: 2025, month: 9, volume: 10000 },
      { year: 2026, month: 9, volume: 12000 },
    ];
    expect(computeVolumeYoy(monthly, Date.UTC(2026, 9, 18))).toBe(20);
  });

  it("最新月过期超过 3 个月 → null", () => {
    const monthly = [
      { year: 2025, month: 1, volume: 10000 },
      { year: 2026, month: 1, volume: 12000 },
    ];
    expect(computeVolumeYoy(monthly, Date.UTC(2026, 9, 18))).toBeNull();
  });

  it("无同期 → null", () => {
    expect(
      computeVolumeYoy([{ year: 2026, month: 9, volume: 12000 }], Date.UTC(2026, 9, 18))
    ).toBeNull();
  });
});

describe("seasonalScore", () => {
  it("approaching + 上升 + 量 YoY 正 → 85（Trends YoY 为负时该项 0 分）", () => {
    const signal = analyzeSeasonality(
      syntheticPoints(Date.UTC(2026, 9, 18), 60, 52),
      Date.UTC(2026, 9, 18),
      14
    );
    // approaching + rising + YoY -25（峰值 100 → 当前 75）→ YoY 项 0 分
    const s = seasonalScore(signal, 20, 14);
    expect(s.score).toBe(40 + 15 + 0 + 15 + 15);
    expect(s.items.map((i) => i.key)).toEqual([
      "verdict",
      "direction",
      "yoy",
      "peak",
      "volumeYoy",
    ]);
  });

  it("insufficient → null（不编分）", () => {
    const signal = analyzeSeasonality(
      syntheticPoints(Date.UTC(2026, 9, 18), 10, null),
      Date.UTC(2026, 9, 18)
    );
    expect(seasonalScore(signal, null).score).toBeNull();
  });

  it("已过峰 + 下降 + 同比负 → 0", () => {
    const signal = analyzeSeasonality(
      syntheticPoints(Date.UTC(2026, 9, 18), 60, 56, [50, 45, 40, 35]),
      Date.UTC(2026, 9, 18),
      14
    );
    expect(signal.verdict).toBe("past");
    expect(seasonalScore(signal, -10, 14).score).toBe(0);
  });
});

describe("seasonalCountry / rank", () => {
  it("大小写不敏感，未知 → null", () => {
    expect(seasonalCountry("us")?.label).toBe("美国");
    expect(seasonalCountry("XX")).toBeNull();
  });

  it("排序：approaching 最前，insufficient 最后", () => {
    expect(seasonalVerdictRank("approaching")).toBeLessThan(
      seasonalVerdictRank("upcoming")
    );
    expect(seasonalVerdictRank("past")).toBeLessThan(
      seasonalVerdictRank("insufficient")
    );
  });
});
