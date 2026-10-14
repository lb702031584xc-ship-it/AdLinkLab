import { describe, expect, it } from "vitest";
import {
  buildKeywordExtractPrompt,
  normalizeAiKeywordRows,
} from "./keyword-capture-ai.js";

describe("keyword-capture-ai", () => {
  it("prompt 含任务与防编造规则", () => {
    const { user } = buildKeywordExtractPrompt("max and lily 14.8K", "zh");
    expect(user).toContain("购买意图");
    expect(user).toContain("不许编造");
    expect(user).toContain("max and lily 14.8K");
  });

  it("normalize：清洗非法行、去重、上限", () => {
    const rows = normalizeAiKeywordRows({
      rows: [
        { keyword: "best bunk bed", volume: 5400, cpc: 1.2, intent: "商业调查", competition: "Medium", trend: "上升" },
        { keyword: "Best Bunk Bed", volume: 5400 },
        { keyword: "", volume: 1 },
        { keyword: "x", volume: -5, cpc: "abc", intent: "乱填" },
        { keyword: "no table here", volume: null },
      ],
    });
    expect(rows).toEqual([
      { keyword: "best bunk bed", volume: 5400, cpc: 1.2, plannerLow: null, plannerHigh: null, competition: "Medium", intent: "商业调查", trend: "up" },
      { keyword: "x", volume: null, cpc: null, plannerLow: null, plannerHigh: null, competition: null, intent: null, trend: null },
      { keyword: "no table here", volume: null, cpc: null, plannerLow: null, plannerHigh: null, competition: null, intent: null, trend: null },
    ]);
  });

  it("normalize：非数组返回空", () => {
    expect(normalizeAiKeywordRows({ rows: "oops" })).toEqual([]);
    expect(normalizeAiKeywordRows(null)).toEqual([]);
  });
});
