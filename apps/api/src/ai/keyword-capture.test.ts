/**
 * 关键词抓取解析测试：SEMrush/Planner 文本启发式提取，找不到为 null。
 */
import { describe, expect, it } from "vitest";
import { parseKeywordCapture, extractKeywordFromTitle } from "./keyword-capture.js";

describe("extractKeywordFromTitle", () => {
  it("SEMrush 标题提取关键词", () => {
    expect(extractKeywordFromTitle("best vpn 2026 - Keyword Overview | SEMrush")).toBe(
      "best vpn 2026"
    );
  });
  it("纯工具标题放弃", () => {
    expect(extractKeywordFromTitle("Keyword Planner")).toBeNull();
    expect(extractKeywordFromTitle(null)).toBeNull();
  });
});

describe("parseKeywordCapture", () => {
  it("SEMrush 概览页解析", () => {
    const r = parseKeywordCapture("best vpn 2026 - Keyword Overview | SEMrush", `
      best vpn 2026
      Volume 10K
      Keyword Difficulty 35%
      CPC $1.50
      Competitive Density 0.82
    `);
    expect(r.keyword).toBe("best vpn 2026");
    expect(r.volume).toBe(10000);
    expect(r.cpc).toBe(1.5);
    expect(r.competition).toBe("High");
  });

  it("Planner 出价解析", () => {
    const r = parseKeywordCapture(null, `
      Top of page bid (low range) $0.80
      Top of page bid (high range) $2.50
      Competition Low
    `);
    expect(r.plannerLow).toBe(0.8);
    expect(r.plannerHigh).toBe(2.5);
    expect(r.competition).toBe("Low");
  });

  it("找不到全为 null（不编造）", () => {
    const r = parseKeywordCapture(null, "这里什么都没有");
    expect(r).toEqual({
      keyword: null,
      volume: null,
      cpc: null,
      plannerLow: null,
      plannerHigh: null,
      competition: null,
    });
  });
});
