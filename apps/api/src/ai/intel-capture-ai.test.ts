import { describe, expect, it } from "vitest";
import {
  buildIntelExtractPrompt,
  normalizeIntelResult,
} from "./intel-capture-ai.js";

describe("intel-capture-ai", () => {
  it("SpyFu 覆盖两种页面：域名概览（在投关键词+预算）与关键词概览（相似关键词）", () => {
    const zh = buildIntelExtractPrompt("x", "spyfu", "zh").user;
    expect(zh).toContain("对手在投的关键词");
    expect(zh).toContain("关键词概览页");
    expect(zh).toContain("相似/相关关键词");
    const en = buildIntelExtractPrompt("x", "spyfu", "en").user;
    expect(en).toContain("Keyword Overview");
    expect(en).toContain("similar/related keywords");
  });
  it("四种任务各有提取目标", () => {
    expect(buildIntelExtractPrompt("x", "transparency", "zh").user).toContain("广告主名称");
    expect(buildIntelExtractPrompt("x", "similarweb", "zh").user).toContain("流量结构");
    expect(buildIntelExtractPrompt("x", "negatives", "zh").user).toContain("否定关键词候选");
  });
  it("prompt 要求不把导航当内容", () => {
    expect(buildIntelExtractPrompt("x", "spyfu", "zh").user).toContain("不要把站内导航");
  });
  it("normalize：非字符串/空 → null，超长截断", () => {
    expect(normalizeIntelResult({ summary: null })).toEqual({ summary: null });
    expect(normalizeIntelResult({ summary: "  " })).toEqual({ summary: null });
    expect(normalizeIntelResult({ summary: "a".repeat(3000) }).summary?.length).toBe(2000);
    expect(normalizeIntelResult({ summary: "对手投 best vpn" })).toEqual({
      summary: "对手投 best vpn",
    });
  });
});
