/**
 * $8 佣金门槛（commission-gate）单元测试。
 * 门槛含义是经济性判断（保本 CPC 没有操作空间），不是政策禁止。
 */
import { describe, expect, it } from "vitest";
import {
  MIN_COMMISSION_USD,
  belowMinCommission,
  estimateCommissionFigure,
  minCommissionStopReason,
} from "./commission-gate.js";

describe("MIN_COMMISSION_USD", () => {
  it("默认为 8", () => {
    expect(MIN_COMMISSION_USD).toBe(8);
  });
});

describe("estimateCommissionFigure", () => {
  it("固定佣金 → 实报（reported）", () => {
    const f = estimateCommissionFigure({ amount: 7.99 });
    expect(f.source).toBe("reported");
    expect(f.figure).toBeCloseTo(7.99, 2);
  });

  it("百分比佣金 → 价格 × 佣金率估算（estimated）", () => {
    const f = estimateCommissionFigure({ ratePct: 13, price: 180 });
    expect(f.source).toBe("estimated");
    expect(f.figure).toBeCloseTo(23.4, 2);
  });

  it("固定佣金优先于百分比（reported 优先）", () => {
    const f = estimateCommissionFigure({ amount: 23.4, ratePct: 13, price: 180 });
    expect(f.source).toBe("reported");
    expect(f.figure).toBeCloseTo(23.4, 2);
  });

  it("算不出金额 → unknown（不拦截）", () => {
    expect(estimateCommissionFigure({}).source).toBe("unknown");
    expect(estimateCommissionFigure({ ratePct: 13 }).source).toBe("unknown");
    expect(estimateCommissionFigure({ price: 100 }).source).toBe("unknown");
  });

  it("非法数字 → unknown（不误伤）", () => {
    expect(estimateCommissionFigure({ ratePct: 150, price: 100 }).source).toBe("unknown");
    expect(estimateCommissionFigure({ ratePct: 0, price: 100 }).source).toBe("unknown");
    expect(estimateCommissionFigure({ amount: -3 }).source).toBe("unknown");
  });
});

describe("belowMinCommission", () => {
  it("7.99 → 低于门槛", () => {
    expect(belowMinCommission(7.99)).toBe(true);
  });

  it("8.00 → 不低于门槛（边界不判）", () => {
    expect(belowMinCommission(8.0)).toBe(false);
  });

  it("未知金额（null/undefined/NaN）→ 不拦截", () => {
    expect(belowMinCommission(null)).toBe(false);
    expect(belowMinCommission(undefined)).toBe(false);
    expect(belowMinCommission(NaN)).toBe(false);
  });

  it("可自定义阈值（覆盖配置）", () => {
    expect(belowMinCommission(9.99, 10)).toBe(true);
    expect(belowMinCommission(9.99, 9)).toBe(false);
  });
});

describe("minCommissionStopReason", () => {
  it("中文文案说明经济性原因，不写成政策禁止", () => {
    const r = minCommissionStopReason(7.99, "USD", 8, "zh");
    expect(r).toContain("7.99");
    expect(r).toContain("$8");
    expect(r).toContain("不值得测试");
    expect(r).toContain("经济性");
    // "非政策禁止"是期望的区分表述；不出现"违反政策/违规"等字样
    expect(r).toContain("非政策禁止");
    expect(r).not.toContain("违反政策");
    expect(r).not.toContain("违规");
  });

  it("英文文案同样说明是经济性而非政策禁止", () => {
    const r = minCommissionStopReason(7.99, "USD", 8, "en");
    expect(r).toContain("7.99");
    expect(r).toContain("not worth testing");
    expect(r).toContain("economic");
    expect(r).toContain("not a policy block");
    expect(r).not.toContain("prohibited");
    expect(r).not.toContain("banned");
  });
});
