/**
 * 关键词抓取解析测试：SEMrush/Planner 文本启发式提取，找不到为 null。
 */
import { describe, expect, it } from "vitest";
import {
  parseKeywordCapture,
  parseKeywordTable,
  extractKeywordFromTitle,
} from "./keyword-capture.js";

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

  it("SEMrush 关键词变化表（制表符分隔）解析多行", () => {
    const r = parseKeywordCapture("Max & Lily - Keyword Overview | SEMrush", `
关键词\t搜索量\tKD (%)
max and lily\t14.8K\t49
max and lily bunk bed\t5.4K\t33
max & lily upholstered twin bed frame\t2.4K\t7
max and lily loft bed\t2.4K\t14
    `);
    expect(r.rows.map((x) => x.keyword)).toEqual([
      "max and lily",
      "max and lily bunk bed",
      "max & lily upholstered twin bed frame",
      "max and lily loft bed",
    ]);
    expect(r.rows[0]).toMatchObject({ volume: 14800, kd: 49, competition: "Medium" });
    expect(r.rows[2]).toMatchObject({ volume: 2400, kd: 7, competition: "Low" });
  });

  it("逐行排列的三元组（有表头）解析", () => {
    const rows = parseKeywordTable(`
关键词
搜索量
KD (%)
max and lily
14.8K
49
max and lily bunk bed
5.4K
33
    `);
    expect(rows.map((x) => x.keyword)).toEqual([
      "max and lily",
      "max and lily bunk bed",
    ]);
    expect(rows[1]).toMatchObject({ volume: 5400, kd: 33, competition: "Medium" });
  });

  it("Planner 式表格：Volume + CPC + 竞争度", () => {
    const rows = parseKeywordTable("best vpn\t10K\t$1.50\tHigh");
    expect(rows[0]).toMatchObject({
      keyword: "best vpn",
      volume: 10000,
      cpc: 1.5,
      competition: "High",
    });
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
      rows: [],
    });
  });
});
