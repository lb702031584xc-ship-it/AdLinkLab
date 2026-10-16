/**
 * 关键词 AI 检查单元测试：prompt 构建、strict JSON 校验、空列表不调 LLM。
 * 不发真实 LLM 请求；checkKeywords 的空列表分支用会抛错的 mock impl 验证。
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildKeywordCheckPrompt,
  checkKeywords,
  normalizeCheckKeywords,
  validateKeywordCheckShape,
} from "./keyword-check.js";
import { AiError, chatJson } from "./llm.js";

const baseInput = {
  productDescription: "Home fitness equipment: walking pads, treadmills and rowing machines for home workouts.",
  offerName: "Wenoker Home Fitness Equipment",
  keywords: ["walking pad", "dive knife", "treadmill for home"],
  language: "en" as const,
};

describe("buildKeywordCheckPrompt", () => {
  it("asks for strict JSON with the three verdicts", () => {
    const { system, user } = buildKeywordCheckPrompt(baseInput);
    expect(system).toContain("STRICT JSON");
    expect(system).toContain("relevant");
    expect(system).toContain("irrelevant");
    expect(system).toContain("risky");
    expect(system).toContain("dive knife");
    expect(system).toContain("Risky beats relevant");
    expect(user).toContain("Wenoker Home Fitness Equipment");
    expect(user).toContain("walking pad");
    expect(user).toContain("Home fitness equipment");
  });

  it("writes reasons in the requested language", () => {
    const en = buildKeywordCheckPrompt(baseInput);
    expect(en.system).toContain("English");
    const zh = buildKeywordCheckPrompt({ ...baseInput, language: "zh" });
    expect(zh.system).toContain("Simplified Chinese");
  });

  it("omits the URL line when offerUrl is absent", () => {
    const { user } = buildKeywordCheckPrompt(baseInput);
    expect(user).not.toContain("Offer URL");
    const withUrl = buildKeywordCheckPrompt({
      ...baseInput,
      offerUrl: "https://example.com/offer",
    });
    expect(withUrl.user).toContain("Offer URL: https://example.com/offer");
  });
});

describe("validateKeywordCheckShape", () => {
  it("accepts a valid shape", () => {
    const out = validateKeywordCheckShape({
      results: [
        { keyword: "walking pad", verdict: "relevant", reason: "Directly matches the product." },
        { keyword: "dive knife", verdict: "irrelevant", reason: "A knife has nothing to do with fitness equipment." },
        { keyword: "buy replica rolex", verdict: "risky", reason: "Counterfeit goods are policy-sensitive." },
      ],
    });
    expect(out.results).toHaveLength(3);
    expect(out.results[1]?.verdict).toBe("irrelevant");
  });

  it("rejects an illegal verdict", () => {
    expect(() =>
      validateKeywordCheckShape({
        results: [{ keyword: "walking pad", verdict: "maybe", reason: "Unclear." }],
      })
    ).toThrow(AiError);
  });

  it("rejects a missing reason", () => {
    expect(() =>
      validateKeywordCheckShape({
        results: [{ keyword: "walking pad", verdict: "relevant", reason: "   " }],
      })
    ).toThrow(AiError);
  });

  it("rejects a non-array results field", () => {
    expect(() => validateKeywordCheckShape({ results: "nope" })).toThrow(AiError);
  });

  it("rejects an empty keyword", () => {
    expect(() =>
      validateKeywordCheckShape({
        results: [{ keyword: "  ", verdict: "relevant", reason: "Fine." }],
      })
    ).toThrow(AiError);
  });
});

describe("normalizeCheckKeywords", () => {
  it("trims and drops empties", () => {
    expect(normalizeCheckKeywords(["  walking pad ", "", "   ", "treadmill"])).toEqual([
      "walking pad",
      "treadmill",
    ]);
  });

  it("returns [] for non-array input", () => {
    expect(normalizeCheckKeywords("walking pad")).toEqual([]);
    expect(normalizeCheckKeywords(null)).toEqual([]);
  });
});

describe("checkKeywords", () => {
  it("returns empty results without calling the LLM when keywords are empty", async () => {
    const impl = vi.fn(async (_args: Parameters<typeof chatJson>[0]) => {
      throw new Error("LLM must not be called");
    });
    const out = await checkKeywords(
      { ...baseInput, keywords: ["  ", ""] },
      { baseUrl: "https://example.invalid", model: "test", apiKey: "k" },
      impl as typeof chatJson
    );
    expect(out).toEqual({ results: [] });
    expect(impl).not.toHaveBeenCalled();
  });
});
