import { describe, expect, it } from "vitest";
import { diagnoseCpaChange } from "./cpa-diagnosis.js";

describe("补强 #22 CPA 诊断", () => {
  it("CPA = CPC ÷ 转化率；只有 CPC 上涨 → cpc_driven", () => {
    const r = diagnoseCpaChange(
      { cpc: 1, conversionRate: 0.02 },
      { cpc: 1.5, conversionRate: 0.02 },
    );
    expect(r.status).toBe("ok");
    expect(r.cpaPrev).toBeCloseTo(50);
    expect(r.cpaCurr).toBeCloseTo(75);
    expect(r.cpaChangePct).toBeCloseTo(0.5);
    expect(r.cpcShare).toBeCloseTo(1);
    expect(r.cvrShare).toBeCloseTo(0);
    expect(r.driver).toBe("cpc_driven");
  });

  it("只有转化率下降 → cvr_driven", () => {
    const r = diagnoseCpaChange(
      { cpc: 1, conversionRate: 0.02 },
      { cpc: 1, conversionRate: 0.01 },
    );
    expect(r.cpaCurr).toBeCloseTo(100);
    expect(r.driver).toBe("cvr_driven");
    expect(r.cvrShare).toBeCloseTo(1);
  });

  it("CPC 与转化率同等幅度恶化 → both，且对数分解可加", () => {
    const r = diagnoseCpaChange(
      { cpc: 1, conversionRate: 0.04 },
      { cpc: 1.5, conversionRate: 0.04 / 1.5 },
    );
    expect(r.driver).toBe("both");
    expect(r.cpcShare).toBeCloseTo(0.5);
    expect(r.cvrShare).toBeCloseTo(0.5);
    // 可加性：两贡献之和 = ln(CPA₂/CPA₁)
    expect(
      (r.cpcContribution ?? 0) + (r.cvrContribution ?? 0),
    ).toBeCloseTo(Math.log((r.cpaCurr ?? 1) / (r.cpaPrev ?? 1)));
  });

  it("可直接给 CPA（转化率由 CPC ÷ CPA 反推）", () => {
    const r = diagnoseCpaChange(
      { cpc: 1, cpa: 50 },
      { cpc: 1, cpa: 100 },
    );
    expect(r.status).toBe("ok");
    expect(r.driver).toBe("cvr_driven"); // CPC 没变，CPA 翻倍只能是转化率减半
  });

  it("数据不足不下结论：缺一期 / 缺转化率 / 非正数 / 转化率 >1", () => {
    expect(diagnoseCpaChange(null, { cpc: 1, conversionRate: 0.02 }).status).toBe("insufficient");
    expect(
      diagnoseCpaChange({ cpc: 1 }, { cpc: 1, conversionRate: 0.02 }).status,
    ).toBe("insufficient");
    expect(
      diagnoseCpaChange(
        { cpc: 0, conversionRate: 0.02 },
        { cpc: 1, conversionRate: 0.02 },
      ).status,
    ).toBe("insufficient");
    expect(
      diagnoseCpaChange(
        { cpc: 1, conversionRate: 2 },
        { cpc: 1, conversionRate: 0.02 },
      ).status,
    ).toBe("insufficient");
    const r = diagnoseCpaChange(null, null);
    expect(r.driver).toBeNull();
    expect(r.cpaCurr).toBeNull();
  });

  it("CPA 两期不变 → both、份额 null、不误判单驱动", () => {
    const r = diagnoseCpaChange(
      { cpc: 1, conversionRate: 0.02 },
      { cpc: 1, conversionRate: 0.02 },
    );
    expect(r.status).toBe("ok");
    expect(r.cpaChangePct).toBeCloseTo(0);
    expect(r.cpcShare).toBeNull();
    expect(r.driver).toBe("both");
  });

  it("反向抵消：CPC 涨但转化率涨得更多，CPA 下降由转化率驱动", () => {
    const r = diagnoseCpaChange(
      { cpc: 1, conversionRate: 0.01 },
      { cpc: 1.2, conversionRate: 0.03 },
    );
    expect(r.cpaChangePct).toBeLessThan(0);
    expect(r.driver).toBe("cvr_driven");
  });
});
