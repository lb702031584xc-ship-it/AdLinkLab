/**
 * 出价保本校验测试。
 */
import { describe, expect, it } from "vitest";
import { checkBidAgainstBreakeven } from "./bid-guard.js";

describe("checkBidAgainstBreakeven", () => {
  it("出价低于保本线 → 允许", () => {
    const r = checkBidAgainstBreakeven({ maxCpcUsd: 0.3, payoutUsd: 20 });
    // 20 × 0.85 × 0.95 × 2.5% = 0.40375
    expect(r.breakevenCpcUsd).toBe(0.4038);
    expect(r.allowed).toBe(true);
    expect(r.reason).toBeNull();
  });

  it("出价高于保本线 → 拒绝并给出超额百分比", () => {
    const r = checkBidAgainstBreakeven({ maxCpcUsd: 1.2, payoutUsd: 20 });
    expect(r.allowed).toBe(false);
    expect(r.breakevenCpcUsd).toBe(0.4038);
    expect(r.overByPct).toBeCloseTo(197.2, 1);
    expect(r.reason).toContain("必然亏损");
    expect(r.reason).toContain("$0.40");
  });

  it("刚好等于保本线 → 允许（不因浮点误差误杀）", () => {
    const r = checkBidAgainstBreakeven({ maxCpcUsd: 0.4038, payoutUsd: 20 });
    expect(r.allowed).toBe(true);
  });

  it("佣金未知 → 不拦截，也不声称校验过", () => {
    const r = checkBidAgainstBreakeven({ maxCpcUsd: 5, payoutUsd: null });
    expect(r.allowed).toBe(true);
    expect(r.breakevenCpcUsd).toBeNull();
  });

  it("出价未设置 → 不拦截", () => {
    const r = checkBidAgainstBreakeven({ maxCpcUsd: null, payoutUsd: 20 });
    expect(r.allowed).toBe(true);
    expect(r.maxCpcUsd).toBeNull();
  });

  it("目标 CVR 越高，允许的出价越高", () => {
    const low = checkBidAgainstBreakeven({
      maxCpcUsd: 0.5,
      payoutUsd: 20,
      targetCvrPct: 2.5,
    });
    const high = checkBidAgainstBreakeven({
      maxCpcUsd: 0.5,
      payoutUsd: 20,
      targetCvrPct: 5,
    });
    expect(low.allowed).toBe(false);
    expect(high.allowed).toBe(true);
  });

  it("拒单率抬高会压低保本线（更严）", () => {
    const base = checkBidAgainstBreakeven({ maxCpcUsd: 0.5, payoutUsd: 20 });
    const harsh = checkBidAgainstBreakeven({
      maxCpcUsd: 0.5,
      payoutUsd: 20,
      rejectionRate: 0.4,
    });
    expect(harsh.breakevenCpcUsd!).toBeLessThan(base.breakevenCpcUsd!);
    expect(harsh.allowed).toBe(false);
  });
});
