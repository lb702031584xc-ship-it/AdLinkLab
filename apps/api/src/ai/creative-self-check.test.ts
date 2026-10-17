import { describe, expect, it } from "vitest";
import { creativeSelfCheck } from "./creative-self-check.js";

describe("P1-9 creativeSelfCheck", () => {
  it("干净文案 → pass；品牌命中 → brand 1；品牌搜索量永远 unknown", () => {
    const r = creativeSelfCheck({
      headlines: ["Buy Running Shoes - Free Shipping", "Top Rated Sneakers 2026"],
      descriptions: ["Shop the new collection today. Save 20% on all running shoes."],
      keywords: ["running shoes", "sneakers"],
      brandTerms: ["Nike"],
    });
    expect(r.verdict).toBe("pass");
    expect(r.brandSearchVolume).toBe("unknown");
    expect(r.source).toBe("heuristic-self-check");
    expect(r.overall).toBeGreaterThan(0);
    expect(r.overall).toBeLessThanOrEqual(1);
  });

  it("命中敏感词（GUN/DRUG）→ sensitivity 0 且整体 fail", () => {
    const r = creativeSelfCheck({
      headlines: ["Buy Guns Online - Best Prices"],
      descriptions: ["Top drug store deals."],
      keywords: ["guns"],
      brandTerms: [],
    });
    expect(r.dimensions.sensitivity.score).toBe(0);
    expect(r.verdict).toBe("fail");
    expect(r.sensitiveHits.length).toBeGreaterThan(0);
  });

  it("文案未命中品牌词 → brand 0 但不 fail", () => {
    const r = creativeSelfCheck({
      headlines: ["Best Running Shoes"],
      descriptions: ["Great comfort and style."],
      keywords: ["running shoes"],
      brandTerms: ["Nike"],
    });
    expect(r.dimensions.brand.score).toBe(0);
    expect(r.verdict).toBe("pass");
  });

  it("输出严格数值，无金额字符串", () => {
    const r = creativeSelfCheck({
      headlines: ["Shoes $1.20-$2.80"],
      descriptions: ["Buy now."],
      keywords: ["shoes"],
      brandTerms: [],
    });
    expect(JSON.stringify(r)).not.toContain("$1.20");
    expect(typeof r.overall).toBe("number");
  });
});
