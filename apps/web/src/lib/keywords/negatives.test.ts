import { describe, expect, it } from "vitest";
import {
  BASE_NEGATIVE_PRESET,
  REVIEW_CLASS_NEGATIVES,
  baseNegativesForLanding,
} from "./negatives";

describe("baseNegativesForLanding (#14)", () => {
  it("基础词表含任务指定的意图词", () => {
    for (const w of [
      "free", "login", "sign in", "download", "manual", "setup", "repair",
      "support", "price", "deal", "coupon", "jobs", "salary", "what is", "how to",
    ]) {
      expect(BASE_NEGATIVE_PRESET).toContain(w);
    }
  });

  it("非评测页 / 未指定承接页：原样返回（含 review 类词）", () => {
    expect(baseNegativesForLanding("product")).toEqual(BASE_NEGATIVE_PRESET);
    expect(baseNegativesForLanding(null)).toEqual(BASE_NEGATIVE_PRESET);
    expect(baseNegativesForLanding(undefined)).toEqual(BASE_NEGATIVE_PRESET);
  });

  it("评测页承接：自动排除全部 review 类词，其余保留", () => {
    const out = baseNegativesForLanding("review");
    for (const w of REVIEW_CLASS_NEGATIVES) expect(out).not.toContain(w);
    expect(out).toContain("free");
    expect(out).toContain("how to");
    expect(out.length).toBe(
      BASE_NEGATIVE_PRESET.filter((w) => !REVIEW_CLASS_NEGATIVES.includes(w)).length
    );
    // 不改动原常量
    expect(BASE_NEGATIVE_PRESET).toContain("review");
  });
});
