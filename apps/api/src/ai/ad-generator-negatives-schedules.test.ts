/**
 * P1-25：否词解析/合并 + 排期解析的回归测试（纯函数，无 LLM/网络）。
 */
import { describe, expect, it } from "vitest";
import {
  mergeUserNegatives,
  parseAdSchedules,
  parseNegativeKeywords,
  type AdPlan,
} from "./ad-generator.js";

describe("P1-25 parseNegativeKeywords", () => {
  it("parses bracket / quote notation", () => {
    const out = parseNegativeKeywords(["[free]", '"how to install"', "demo"]);
    expect(out).toEqual([
      { text: "free", matchType: "EXACT", dataQuality: "OBSERVED" },
      { text: "how to install", matchType: "PHRASE", dataQuality: "OBSERVED" },
      { text: "demo", matchType: "PHRASE", dataQuality: "OBSERVED" },
    ]);
  });

  it("dedupes case-insensitively and rejects a bad matchType", () => {
    expect(parseNegativeKeywords(["Demo", "demo"])).toHaveLength(1);
    expect(() =>
      parseNegativeKeywords([{ text: "x", matchType: "WIDE" }])
    ).toThrow(/matchType/);
  });
});

describe("P1-25 parseAdSchedules", () => {
  it("accepts a valid schedule", () => {
    expect(
      parseAdSchedules([
        { dayOfWeek: "MONDAY", startHour: 9, startMinute: 0, endHour: 21, endMinute: 0 },
      ])
    ).toEqual([
      { dayOfWeek: "MONDAY", startHour: 9, startMinute: 0, endHour: 21, endMinute: 0 },
    ]);
  });

  it("rejects end <= start and bad day", () => {
    expect(() =>
      parseAdSchedules([
        { dayOfWeek: "MONDAY", startHour: 21, startMinute: 0, endHour: 9, endMinute: 0 },
      ])
    ).toThrow(/end must be after start/);
    expect(() =>
      parseAdSchedules([
        { dayOfWeek: "FUNDAY", startHour: 9, startMinute: 0, endHour: 21, endMinute: 0 },
      ])
    ).toThrow(/dayOfWeek/);
  });
});

describe("P1-25 mergeUserNegatives", () => {
  it("appends user negatives to every group, deduped", () => {
    const plan = {
      adGroups: [
        { group: { negativeKeywords: [{ text: "demo", matchType: "PHRASE" }] } },
        { group: { negativeKeywords: [] } },
      ],
    } as unknown as AdPlan;
    mergeUserNegatives(plan, [
      { text: "demo", matchType: "PHRASE" },
      { text: "free", matchType: "EXACT", dataQuality: "OBSERVED" },
    ]);
    expect(plan.adGroups[0].group.negativeKeywords).toHaveLength(2);
    expect(plan.adGroups[1].group.negativeKeywords).toHaveLength(2);
  });
});
