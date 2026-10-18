import { describe, expect, it } from "vitest";
import { leg, synthesizeVerdict } from "./verdict.js";

describe("synthesizeVerdict", () => {
  it("任一 stop → stop（stop 优先）", () => {
    const r = synthesizeVerdict({
      terms: leg("go"),
      profit: leg("stop", "EPC ≤ CPC"),
      trafficGate: leg("caution", "付费弱"),
      prescreen: leg("go"),
    });
    expect(r.verdict).toBe("stop");
    expect(r.reasons).toEqual(["EPC ≤ CPC"]);
    expect(r.worstLegs).toEqual(["profit"]);
  });

  it("无 stop 有 caution → caution", () => {
    const r = synthesizeVerdict({
      terms: leg("go"),
      profit: leg("caution", "payout 薄"),
      trafficGate: leg("go"),
    });
    expect(r.verdict).toBe("caution");
    expect(r.reasons).toEqual(["payout 薄"]);
  });

  it("unknown 不降级为 stop/caution（K4）", () => {
    const r = synthesizeVerdict({
      terms: leg("unknown", "条款未提供"),
      profit: leg("go"),
      trafficGate: leg("go"),
    });
    expect(r.verdict).toBe("unknown");
    expect(r.reasons).toEqual(["条款未提供"]);
  });

  it("全 go → go", () => {
    const r = synthesizeVerdict({
      terms: leg("go"),
      profit: leg("go"),
      trafficGate: leg("go"),
      prescreen: leg("go"),
    });
    expect(r.verdict).toBe("go");
    expect(r.reasons).toEqual([]);
  });

  it("未传的腿不参与 min；空 legs → unknown", () => {
    const r = synthesizeVerdict({ terms: leg("go") });
    expect(r.verdict).toBe("go");
    const empty = synthesizeVerdict({});
    expect(empty.verdict).toBe("unknown");
  });

  it("多条腿同档最弱时 reasons 聚合", () => {
    const r = synthesizeVerdict({
      terms: leg("stop", "条款禁止"),
      profit: leg("stop", "佣金过低"),
      trafficGate: leg("go"),
    });
    expect(r.verdict).toBe("stop");
    expect(r.reasons).toEqual(["条款禁止", "佣金过低"]);
    expect(r.worstLegs).toEqual(["terms", "profit"]);
  });
});
