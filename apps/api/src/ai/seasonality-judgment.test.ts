import { describe, expect, it } from "vitest";
import {
  buildSeasonalityJudgmentPrompt,
  normalizeSeasonalityJudgment,
} from "./seasonality-judgment.js";

const input = {
  keyword: "halloween costume",
  countryLabel: "美国",
  verdict: "approaching",
  direction: "rising",
  yoyChangePct: 18,
  daysToPeak: 12,
  volume: 12000,
  volumeYoyPct: 20,
  score: 85,
};

describe("normalizeSeasonalityJudgment", () => {
  it("合法形状 → 通过，置信度钳制", () => {
    const j = normalizeSeasonalityJudgment({
      suggestion: "go",
      reason: "距峰值 12 天，同比 +18%。",
      confidence: 150,
    });
    expect(j.suggestion).toBe("go");
    expect(j.confidence).toBe(100);
  });

  it("suggestion 非枚举 → 抛错", () => {
    expect(() =>
      normalizeSeasonalityJudgment({ suggestion: "maybe", reason: "x", confidence: 50 })
    ).toThrow();
  });

  it("reason 为空 → 抛错", () => {
    expect(() =>
      normalizeSeasonalityJudgment({ suggestion: "go", reason: "  ", confidence: 50 })
    ).toThrow();
  });

  it("reason 超长 → 截断 300 字", () => {
    const j = normalizeSeasonalityJudgment({
      suggestion: "watch",
      reason: "a".repeat(500),
      confidence: 50,
    });
    expect(j.reason.length).toBe(300);
  });
});

describe("buildSeasonalityJudgmentPrompt", () => {
  it("prompt 包含实测数，system 明确禁编造", () => {
    const { system, user } = buildSeasonalityJudgmentPrompt(input, "zh");
    expect(user).toContain("halloween costume");
    expect(user).toContain("12"); // daysToPeak
    expect(user).toContain("18"); // yoy
    expect(system).toContain("不许编");
  });
});
