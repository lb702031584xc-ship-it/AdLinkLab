/**
 * 「按新增日期全选」的本地日期 → UTC ISO 区间换算纯函数测试：
 * 任意时区下都必须是本地 [当天 00:00, 次日 00:00)；跨月/跨年边界；
 * 非法与不存在的日期返回 null（不滚动）。外加本批 added dict 键检查。
 */
import { describe, expect, it } from "vitest";
import { en, zh } from "../../i18n/dict/catalog";
import { localDayRangeToIso, localTodayString } from "./added-date-range";

function localParts(iso: string): number[] {
  const d = new Date(iso);
  return [
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
  ];
}

describe("localDayRangeToIso", () => {
  it("普通一天：from = 本地当天 00:00，to = 本地次日 00:00", () => {
    const r = localDayRangeToIso("2026-10-20");
    expect(r).not.toBeNull();
    expect(localParts(r!.from)).toEqual([2026, 9, 20, 0, 0, 0]);
    expect(localParts(r!.to)).toEqual([2026, 9, 21, 0, 0, 0]);
  });

  it("跨月边界：1 月 31 日的次日是 2 月 1 日", () => {
    const r = localDayRangeToIso("2026-01-31");
    expect(localParts(r!.from)).toEqual([2026, 0, 31, 0, 0, 0]);
    expect(localParts(r!.to)).toEqual([2026, 1, 1, 0, 0, 0]);
  });

  it("跨年边界：12 月 31 日的次日是次年 1 月 1 日", () => {
    const r = localDayRangeToIso("2026-12-31");
    expect(localParts(r!.from)).toEqual([2026, 11, 31, 0, 0, 0]);
    expect(localParts(r!.to)).toEqual([2027, 0, 1, 0, 0, 0]);
  });

  it("闰年 2 月 29 日合法；不存在的日期（2 月 31 日/非闰年 2 月 29 日）→ null", () => {
    expect(localDayRangeToIso("2028-02-29")).not.toBeNull();
    expect(localDayRangeToIso("2026-02-31")).toBeNull();
    expect(localDayRangeToIso("2026-02-29")).toBeNull();
    expect(localDayRangeToIso("2026-13-01")).toBeNull();
  });

  it("格式非法 → null（空/垃圾/斜杠格式）", () => {
    expect(localDayRangeToIso("")).toBeNull();
    expect(localDayRangeToIso("garbage")).toBeNull();
    expect(localDayRangeToIso("2026/10/20")).toBeNull();
    expect(localDayRangeToIso("2026-1-5")).toBeNull();
  });

  it("localTodayString 输出 YYYY-MM-DD 且可被 localDayRangeToIso 接受", () => {
    const s = localTodayString(new Date(2026, 9, 5, 23, 59));
    expect(s).toBe("2026-10-05");
    expect(localDayRangeToIso(s)).not.toBeNull();
  });
});

describe("catalog dict 本批新键（added 日期全选）", () => {
  it("zh/en 都有全部新键且模板占位符完整", () => {
    const plain = [
      "addedDateLabel",
      "selectAddedByDate",
      "selectingAdded",
      "addedSelectInvalid",
    ] as const;
    for (const dict of [zh, en]) {
      for (const k of plain) {
        expect(typeof dict.products[k]).toBe("string");
        expect(dict.products[k].length).toBeGreaterThan(0);
      }
      expect(dict.products.addedSelectDone).toContain("{date}");
      expect(dict.products.addedSelectDone).toContain("{n}");
      expect(dict.products.addedSelectTruncated).toContain("{date}");
      expect(dict.products.addedSelectTruncated).toContain("{total}");
      expect(dict.products.addedSelectTruncated).toContain("{n}");
      expect(dict.products.addedSelectNone).toContain("{date}");
    }
  });
});
