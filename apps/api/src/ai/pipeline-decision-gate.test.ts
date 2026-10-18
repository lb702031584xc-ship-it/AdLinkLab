/**
 * 工作表盈利腿：$8 佣金门槛（任务2）单元测试。
 * synthesizeDecision 盈利腿 → 佣金低于门槛 → 最弱档 DO_NOT_RUN，
 * reason 说明经济性原因（不写成政策禁止）。
 */
import { describe, expect, it } from "vitest";
import {
  synthesizeDecision,
  type ProfitAnalystOutput,
  type RiskAnalystOutput,
  type TrafficAnalystOutput,
  type TrafficMode,
} from "./pipeline.js";

function makeRisk(over: Partial<RiskAnalystOutput> = {}): RiskAnalystOutput {
  return {
    criticalHits: [],
    criticalDecision: "PROCEED",
    riskScore: 20,
    policyScore: 80,
    merchantScore: 70,
    findings: [],
    suggestions: [],
    summary: "ok",
    analysisId: "r1",
    ...over,
  };
}

function makeProfit(commission: number | null): ProfitAnalystOutput {
  const row = { clicks: 1000, cpc: 0.5, cvr: 0.02, profit: 100 };
  return {
    model: {
      commission,
      commissionType: "fixed",
      currency: "USD",
      expectedCvr: 2,
      approvalRate: 0.9,
      attributionRate: 0.95,
      refundRate: 0.05,
      scenarios: { worst: row, base: row, best: row },
      breakEvenCpc: 0.15,
      recommendedMaxCpc: 0.07,
      dataQuality: "OBSERVED",
    },
    analysisId: "p1",
    modelId: "m1",
  };
}

function makeTraffic(): TrafficAnalystOutput {
  return {
    summary: {
      clicks: 1000,
      conversions: 20,
      cvrPct: 2,
      epc: 0.2,
      refundRatePct: 5,
      windowDays: 30,
      dataQuality: "OBSERVED",
    },
    analysisId: "t1",
  };
}

const trafficMode: TrafficMode = "DIRECT_LINK";

function decide(commission: number | null, extra: { language?: "zh" | "en" } = {}) {
  return synthesizeDecision({
    trafficMode,
    risk: makeRisk(),
    profit: makeProfit(commission),
    traffic: makeTraffic(),
    ...extra,
  });
}

describe("synthesizeDecision 佣金门槛（盈利腿）", () => {
  it("7.99 → DO_NOT_RUN，reason 说明经济性原因", () => {
    const d = decide(7.99);
    expect(d.decision).toBe("DO_NOT_RUN");
    const joined = d.reason.join("");
    expect(joined).toContain("7.99");
    expect(joined).toContain("not worth testing");
    expect(joined).toContain("economic");
    expect(joined).not.toContain("prohibited");
  });

  it("8.00 → 不触发门槛（不强制 DO_NOT_RUN）", () => {
    const d = decide(8.0);
    const joined = d.reason.join("");
    expect(joined).not.toContain("not worth testing");
    expect(d.decision).not.toBe("DO_NOT_RUN");
  });

  it("未知佣金（null）→ 不拦截", () => {
    const d = decide(null);
    const joined = d.reason.join("");
    expect(joined).not.toContain("not worth testing");
    expect(d.decision).not.toBe("DO_NOT_RUN");
  });

  it("中文 reason：说明经济性，不写成政策禁止", () => {
    const d = decide(7.99, { language: "zh" });
    expect(d.decision).toBe("DO_NOT_RUN");
    const joined = d.reason.join("");
    expect(joined).toContain("不值得测试");
    expect(joined).toContain("经济性");
    expect(joined).toContain("非政策禁止");
    expect(joined).not.toContain("违反政策");
  });

  it("门槛放在政策性 DO_NOT_RUN 之后：政策 stop 时仍以政策 reason 为主", () => {
    const d = synthesizeDecision({
      trafficMode,
      risk: makeRisk({
        criticalDecision: "DO_NOT_RUN",
        criticalHits: [{ rule: "TERMS_PROHIBITED" as never, verdict: "FORBIDDEN" as never, reason: "条款明确禁止" }],
      }),
      profit: makeProfit(7.99),
      traffic: makeTraffic(),
    });
    expect(d.decision).toBe("DO_NOT_RUN");
    const joined = d.reason.join("");
    expect(joined).toContain("条款明确禁止");
    expect(joined).not.toContain("not worth testing");
  });

  it("可通过 minCommissionUsd 覆盖阈值", () => {
    const d = synthesizeDecision({
      trafficMode,
      risk: makeRisk(),
      profit: makeProfit(9.99),
      traffic: makeTraffic(),
      minCommissionUsd: 10,
    });
    expect(d.decision).toBe("DO_NOT_RUN");
    expect(d.reason.join("")).toContain("not worth testing");
  });
});
