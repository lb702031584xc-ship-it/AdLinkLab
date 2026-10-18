import { describe, expect, it } from "vitest";
import {
  benchmarkFor,
  buildEpcReferencePrompt,
  CVR_BENCHMARKS,
  normalizeEpcReferenceLlm,
} from "./epc-reference.js";

describe("CVR_BENCHMARKS", () => {
  it("基准表非空，区间合法", () => {
    expect(CVR_BENCHMARKS.length).toBeGreaterThan(0);
    for (const b of CVR_BENCHMARKS) {
      expect(b.low).toBeGreaterThan(0);
      expect(b.high).toBeGreaterThan(b.low);
      expect(b.source).toBeTruthy();
    }
  });

  it("未知 key → general", () => {
    expect(benchmarkFor("nope").key).toBe("general");
    expect(benchmarkFor("ecommerce").key).toBe("ecommerce");
  });
});

describe("normalizeEpcReferenceLlm", () => {
  it("合法形状 → 通过", () => {
    const r = normalizeEpcReferenceLlm({
      vertical: "ecommerce",
      reasoning: "家居电商，取电商基准。",
      confidence: 60,
    });
    expect(r.vertical).toBe("ecommerce");
    expect(r.confidence).toBe(60);
  });

  it("未知 vertical → 回退 general（不抛错）", () => {
    const r = normalizeEpcReferenceLlm({
      vertical: "mars",
      reasoning: "x",
      confidence: 50,
    });
    expect(r.vertical).toBe("general");
  });

  it("reasoning 为空 → 抛错", () => {
    expect(() =>
      normalizeEpcReferenceLlm({ vertical: "general", reasoning: "  ", confidence: 50 })
    ).toThrow();
  });
});

describe("buildEpcReferencePrompt", () => {
  it("prompt 含 offer 数据与基准表，不许编造真实数", () => {
    const { system, user } = buildEpcReferencePrompt(
      {
        offerName: "Roborock S8",
        payout: 23.4,
        avgPrice: 180,
        commissionRate: 13,
        network: "PartnerBoost",
      },
      "zh"
    );
    expect(user).toContain("Roborock S8");
    expect(user).toContain("23.4");
    expect(system).toContain("绝不编造");
  });
});
