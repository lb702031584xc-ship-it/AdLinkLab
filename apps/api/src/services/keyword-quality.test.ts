/**
 * 关键词质量工具测试：一致性评分与否词建议。
 */
import { describe, expect, it } from "vitest";
import {
  checkMessageMatch,
  coreTokens,
  suggestNegatives,
  type SearchTermRow,
} from "./keyword-quality.js";

describe("coreTokens", () => {
  it("剥掉修饰词，只留核心词", () => {
    expect(coreTokens("best air purifier for pet hair")).toEqual([
      "air",
      "purifier",
      "pet",
      "hair",
    ]);
  });
});

describe("checkMessageMatch", () => {
  it("页面覆盖全部核心词 → good", () => {
    const r = checkMessageMatch({
      keyword: "best air purifier for pet hair",
      pageTitle: "Air Purifier for Pet Hair",
      pageH1: "空气净化器 · Air Purifier",
    });
    expect(r.score).toBe(1);
    expect(r.verdict).toBe("good");
    expect(r.matched).toContain("purifier");
  });

  it("只覆盖一半 → weak，并列出缺的词", () => {
    const r = checkMessageMatch({
      keyword: "air purifier for pet hair",
      pageTitle: "Air Purifier",
      pageH1: null,
    });
    expect(r.score).toBeCloseTo(0.5, 6);
    expect(r.verdict).toBe("weak");
    expect(r.missing).toContain("pet");
    expect(r.advice).toContain("pet");
  });

  it("页面完全不覆盖 → poor", () => {
    const r = checkMessageMatch({
      keyword: "diesel heater 8kw",
      pageTitle: "Home & Garden Store",
      pageH1: null,
    });
    expect(r.verdict).toBe("poor");
    expect(r.advice).toContain("必须先改页面");
  });

  it("没有页面信息 → unknown，不猜", () => {
    const r = checkMessageMatch({ keyword: "air purifier", pageTitle: null });
    expect(r.verdict).toBe("unknown");
    expect(r.score).toBeNull();
  });

  it("关键词全是修饰词 → unknown", () => {
    const r = checkMessageMatch({ keyword: "best buy", pageTitle: "Whatever" });
    expect(r.verdict).toBe("unknown");
  });
});

describe("suggestNegatives", () => {
  const rows: SearchTermRow[] = [
    { term: "free air purifier", clicks: 30, conversions: 0, spendUsd: 18 },
    { term: "air purifier repair", clicks: 25, conversions: 0, spendUsd: 12 },
    { term: "air purifier price", clicks: 40, conversions: 3, spendUsd: 20 },
    { term: "tiny sample", clicks: 5, conversions: 0, spendUsd: 2 },
  ];

  it("只挑「点击够且 0 转化」的词，有转化的不否定", () => {
    const r = suggestNegatives(rows);
    expect(r.suggestions.map((s) => s.term)).toEqual([
      "free air purifier",
      "air purifier repair",
    ]);
    expect(r.suggestions.some((s) => s.term === "air purifier price")).toBe(false);
  });

  it("样本不足的词不判（不误伤）", () => {
    const r = suggestNegatives(rows);
    expect(r.suggestions.some((s) => s.term === "tiny sample")).toBe(false);
  });

  it("按浪费金额降序，并给出总额", () => {
    const r = suggestNegatives(rows);
    expect(r.suggestions[0].wastedUsd).toBe(18);
    expect(r.totalWastedUsd).toBe(30);
  });

  it("一律建议精确否定（避免误伤长尾）", () => {
    const r = suggestNegatives(rows);
    expect(r.suggestions.every((s) => s.matchType === "exact")).toBe(true);
  });

  it("没有符合条件的词时给出原因", () => {
    const r = suggestNegatives([]);
    expect(r.suggestions).toEqual([]);
    expect(r.notes.join("")).toContain("样本不够的不判");
  });

  it("上限生效", () => {
    const r = suggestNegatives(rows, { limit: 1 });
    expect(r.suggestions).toHaveLength(1);
  });
});
