import { describe, expect, it } from "vitest";
import {
  evaluateCommissionPrescreen,
  evaluatePaidZeroPrescreen,
  initialPrescreenRows,
  prescreenOverall,
} from "./prescreen";

describe("evaluateCommissionPrescreen（$8 佣金门槛）", () => {
  it("payout 未知 → unknown，不杀", () => {
    for (const v of [undefined, null, "", "abc", 0, -5]) {
      expect(evaluateCommissionPrescreen(v, "zh").status).toBe("unknown");
    }
  });

  it("payout < 8 → kill（经济性原因）", () => {
    const r = evaluateCommissionPrescreen("7.99", "zh");
    expect(r.status).toBe("kill");
    expect(r.reason).toContain("不值得测试");
    expect(r.reason).toContain("非政策禁止");
  });

  it("payout = 8 边界 → pass", () => {
    expect(evaluateCommissionPrescreen("8", "zh").status).toBe("pass");
    expect(evaluateCommissionPrescreen(8, "zh").status).toBe("pass");
  });

  it("payout > 8 → pass", () => {
    expect(evaluateCommissionPrescreen("23.4", "zh").status).toBe("pass");
  });

  it("英文 reason 正常", () => {
    const r = evaluateCommissionPrescreen("5", "en");
    expect(r.status).toBe("kill");
    expect(r.reason).toContain("not worth testing");
  });
});

describe("evaluatePaidZeroPrescreen（付费为零规则）", () => {
  it("自然≥1000 且付费=0 → kill", () => {
    const r = evaluatePaidZeroPrescreen(2200, 0, 0, 1000, 0.05, "zh");
    expect(r.status).toBe("kill");
    expect(r.reason).toContain("直接 PK");
  });

  it("自然=1000 边界 → 参与判定", () => {
    expect(evaluatePaidZeroPrescreen(1000, 0, 0, 1000, 0.05, "zh").status).toBe(
      "kill",
    );
  });

  it("自然<1000 → unknown，不杀", () => {
    expect(evaluatePaidZeroPrescreen(500, 0, 0, 1000, 0.05, "zh").status).toBe(
      "unknown",
    );
  });

  it("paid 未知 → unknown，不杀", () => {
    expect(
      evaluatePaidZeroPrescreen(2200, undefined, undefined, 1000, 0.05, "zh")
        .status,
    ).toBe("unknown");
  });

  it("organic 未知 → unknown，不杀", () => {
    expect(
      evaluatePaidZeroPrescreen(undefined, 0, 0, 1000, 0.05, "zh").status,
    ).toBe("unknown");
  });

  it("付费>0 但 <5% → caution（不 kill）", () => {
    const r = evaluatePaidZeroPrescreen(2200, 50, 3, 1000, 0.05, "zh");
    expect(r.status).toBe("caution");
    expect(r.reason).toContain("小预算验证");
  });

  it("付费≥5% → pass", () => {
    expect(evaluatePaidZeroPrescreen(2200, 200, 10, 1000, 0.05, "zh").status).toBe(
      "pass",
    );
  });

  it("自定义阈值生效", () => {
    // 阈值 2000 时，2200 自然流量达标
    expect(evaluatePaidZeroPrescreen(2200, 0, 0, 2000, 0.05, "zh").status).toBe(
      "kill",
    );
    // 阈值 3000 时，2200 未达标 → unknown
    expect(evaluatePaidZeroPrescreen(2200, 0, 0, 3000, 0.05, "zh").status).toBe(
      "unknown",
    );
  });
});

describe("prescreenOverall", () => {
  it("初始全 idle → pending", () => {
    expect(prescreenOverall(initialPrescreenRows())).toBe("pending");
  });

  it("任一 kill → kill", () => {
    const rows = initialPrescreenRows();
    rows[1] = { ...rows[1], status: "kill", reason: "x" };
    expect(prescreenOverall(rows)).toBe("kill");
  });

  it("全部 pass → pass", () => {
    const rows = initialPrescreenRows().map((r) => ({
      ...r,
      status: "pass" as const,
    }));
    expect(prescreenOverall(rows)).toBe("pass");
  });

  it("有 unknown 无 kill → pending", () => {
    const rows = initialPrescreenRows().map((r, i) => ({
      ...r,
      status: (i === 0 ? "unknown" : "pass") as "unknown" | "pass",
    }));
    expect(prescreenOverall(rows)).toBe("pending");
  });

  it("有 caution 无 kill → pending", () => {
    const rows = initialPrescreenRows().map((r, i) => ({
      ...r,
      status: (i === 2 ? "caution" : "pass") as "caution" | "pass",
    }));
    expect(prescreenOverall(rows)).toBe("pending");
  });
});

describe("evaluatePaidZeroPrescreen 竞争红海（补强 #2）", () => {
  it("命中：付费>自然×50% 且 ≥1000 → caution 红海文案（不 kill）", () => {
    const r = evaluatePaidZeroPrescreen(2200, 1500, 10, 1000, 0.05, "zh");
    expect(r.status).toBe("caution");
    expect(r.reason).toContain("竞争红海");
    expect(r.reason).toContain("68%");
    expect(r.reason).toContain("慎入");
  });

  it("命中英文文案", () => {
    const r = evaluatePaidZeroPrescreen(2200, 1500, 10, 1000, 0.05, "en");
    expect(r.status).toBe("caution");
    expect(r.reason).toContain("Red ocean");
  });

  it("不命中：占比过半但付费 <1000", () => {
    const r = evaluatePaidZeroPrescreen(1500, 900, 5, 1000, 0.05, "zh");
    expect(r.status).toBe("pass");
    expect(r.reason).not.toContain("红海");
  });

  it("不命中：付费恰好 = 自然×50%", () => {
    expect(evaluatePaidZeroPrescreen(5000, 2500, 5, 1000, 0.05, "zh").status).toBe("pass");
  });

  it("数据不足不触发：paid 未知 → unknown；organic 未知 → unknown", () => {
    expect(evaluatePaidZeroPrescreen(2200, undefined, undefined, 1000, 0.05, "zh").status).toBe("unknown");
    expect(evaluatePaidZeroPrescreen(undefined, 5000, undefined, 1000, 0.05, "zh").status).toBe("unknown");
  });

  it("自然低于阈值但付费量与占比足够 → 仍 caution 红海（镜像后端）", () => {
    const r = evaluatePaidZeroPrescreen(800, 2000, 5, 1000, 0.05, "zh");
    expect(r.status).toBe("caution");
    expect(r.reason).toContain("250%");
  });
});
