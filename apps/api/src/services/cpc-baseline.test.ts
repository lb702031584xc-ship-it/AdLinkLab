/**
 * CPC 基线测试：逐级降级、样本门槛、探针计划。
 */
import { describe, expect, it } from "vitest";
import {
  deriveMinCommissionAmount,
  planCpcProbe,
  resolveCpcBaseline,
  type CpcSample,
} from "./cpc-baseline.js";

const s = (category: string, cpcUsd: number, clicks = 10): CpcSample => ({
  category,
  cpcUsd,
  clicks,
});

describe("resolveCpcBaseline", () => {
  it("精确类目样本够 → exact", () => {
    const r = resolveCpcBaseline(
      [s("chamber sealer", 2.6), s("chamber sealer", 3.0), s("chamber sealer", 2.8), s("robot", 9.0)],
      { category: "chamber sealer" }
    );
    expect(r.source).toBe("exact");
    expect(r.samples).toBe(3);
    expect(r.cpcUsd).toBe(2.8);
    expect(r.confidence).toBe("medium");
  });

  it("精确类目不够 → 退大类", () => {
    const r = resolveCpcBaseline(
      [s("chamber sealer", 3.0), s("home appliance", 2.0), s("home appliance", 4.0), s("home appliance", 3.0)],
      { category: "chamber sealer", broadCategory: "home appliance", minSamples: 3 }
    );
    expect(r.source).toBe("broad");
    expect(r.samples).toBe(3);
  });

  it("大类也不够 → 退全站", () => {
    const r = resolveCpcBaseline(
      [s("a", 5), s("b", 7), s("c", 9)],
      { category: "chamber sealer", broadCategory: "home", minSamples: 3 }
    );
    expect(r.source).toBe("global");
    expect(r.confidence).toBe("low");
  });

  it("全站也不够 → 用假定值", () => {
    const r = resolveCpcBaseline([], { category: "x", assumedCpcUsd: 1.5 });
    expect(r.source).toBe("assumed");
    expect(r.cpcUsd).toBe(1.5);
  });

  it("完全没有依据 → 0 并提示跑探针", () => {
    const r = resolveCpcBaseline([]);
    expect(r.cpcUsd).toBe(0);
    expect(r.note).toContain("探针");
  });

  it("按点击量加权：点击多的样本影响更大", () => {
    const r = resolveCpcBaseline(
      [s("c", 1, 1000), s("c", 10, 1), s("c", 10, 1)],
      { category: "c" }
    );
    expect(r.cpcUsd).toBe(1);
  });

  it("样本 ≥10 时 confidence 为 high", () => {
    const rows = Array.from({ length: 10 }, (_, i) => s("c", 2 + i * 0.01));
    expect(resolveCpcBaseline(rows, { category: "c" }).confidence).toBe("high");
  });
});

describe("planCpcProbe", () => {
  it("按假定 CPC 与目标点击算预算", () => {
    const p = planCpcProbe({ assumedCpcUsd: 0.5, targetClicks: 100, days: 4 });
    expect(p.totalBudgetUsd).toBe(50);
    expect(p.dailyBudgetUsd).toBe(12.5);
  });

  it("天数与点击有下限，防呆", () => {
    const p = planCpcProbe({ assumedCpcUsd: 1, targetClicks: 1, days: 0 });
    expect(p.days).toBe(1);
    expect(p.targetClicks).toBe(20);
  });

  it("提示里带每天预算", () => {
    const p = planCpcProbe({ assumedCpcUsd: 0.34, targetClicks: 100, days: 3 });
    expect(p.note).toContain("/天");
    expect(p.note).toContain("回填");
  });
});
