import { describe, expect, it } from "vitest";
import {
  creativeDifference,
  creativeDifferenceSufficient,
  checkAdGroupCreatives,
} from "./creative-difference.js";

describe("P1-12 creativeDifference", () => {
  it("完全相同 → 0；完全不同 → 1", () => {
    expect(creativeDifference("buy running shoes now", "buy running shoes now")).toBe(0);
    expect(creativeDifference("apple orange banana", "car train plane")).toBe(1);
  });

  it("部分重叠 → 0–1 之间", () => {
    const d = creativeDifference("buy running shoes free shipping", "buy trail shoes discount");
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(1);
  });

  it("差异 ≥50% 才足够做 A/B", () => {
    expect(creativeDifferenceSufficient(0.5)).toBe(true);
    expect(creativeDifferenceSufficient(0.49)).toBe(false);
  });

  it("同一广告反复投 → 滥用（禁止）", () => {
    const r = checkAdGroupCreatives(["Buy shoes now", "Buy shoes now"]);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("滥用");
  });

  it("3 创意 A/B：某对差异 <50% → 不合规", () => {
    const r = checkAdGroupCreatives([
      "Buy running shoes free shipping",
      "Buy running shoes free shipping today",
      "Luxury watches gold premium edition",
    ]);
    expect(r.ok).toBe(false);
  });
});
