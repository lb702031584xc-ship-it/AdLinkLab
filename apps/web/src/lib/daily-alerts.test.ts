import { describe, expect, it } from "vitest";
import { classifyDailyAlerts, type DailyAlertsInput } from "./daily-alerts.js";

function base(overrides: Partial<DailyAlertsInput> = {}): DailyAlertsInput {
  return {
    generatedAt: new Date().toISOString(),
    hasData: true,
    archives: [],
    alerts: [],
    ...overrides,
  };
}

describe("补强 #21 daily-alerts 新类型", () => {
  it("佣金率与上次同步值不一致 → P1 commission_change", () => {
    const out = classifyDailyAlerts(
      base({
        offers: [
          {
            id: "o1",
            name: "Offer A",
            status: "ACTIVE",
            commissionRate: 12,
            previousCommissionRate: 10,
          },
        ],
      }),
    );
    const item = out.items.find((i) => i.kind === "commission_change");
    expect(item).toBeDefined();
    expect(item?.level).toBe("P1");
    expect(item?.group).toBe("佣金与上下线");
    expect(item?.title).toContain("佣金率变动");
    expect(out.counts.P1.unresolved).toBe(1);
  });

  it("佣金金额变动 → commission_change；与上次一致 → 不报", () => {
    const changed = classifyDailyAlerts(
      base({
        offers: [
          {
            id: "o1",
            name: "Offer A",
            commissionAmount: 25,
            previousCommissionAmount: 30,
          },
        ],
      }),
    );
    expect(
      changed.items.some((i) => i.kind === "commission_change"),
    ).toBe(true);
    const same = classifyDailyAlerts(
      base({
        offers: [
          {
            id: "o1",
            name: "Offer A",
            commissionRate: 10,
            previousCommissionRate: 10,
            commissionAmount: 25,
            previousCommissionAmount: 25,
          },
        ],
      }),
    );
    expect(same.items).toEqual([]);
  });

  it("拿不到历史值（previous 缺失）→ 不报佣金变动（不编造）", () => {
    const out = classifyDailyAlerts(
      base({
        offers: [{ id: "o1", name: "Offer A", commissionRate: 12 }],
      }),
    );
    expect(out.items).toEqual([]);
  });

  it("offer status 非 ACTIVE → P0 offer_offline；ACTIVE 不报", () => {
    const out = classifyDailyAlerts(
      base({
        offers: [
          { id: "o1", name: "Offer A", status: "PAUSED" },
          { id: "o2", name: "Offer B", status: "ACTIVE" },
        ],
      }),
    );
    const items = out.items.filter((i) => i.kind === "offer_offline");
    expect(items).toHaveLength(1);
    expect(items[0]?.level).toBe("P0");
    expect(items[0]?.title).toContain("Offer A");
  });

  it("商品 status=inactive → P0 offer_offline", () => {
    const out = classifyDailyAlerts(
      base({
        offers: [
          { id: "o1", name: "Offer A", status: "ACTIVE", productStatus: "inactive" },
        ],
      }),
    );
    expect(out.items.some((i) => i.kind === "offer_offline")).toBe(true);
    expect(out.counts.P0.unresolved).toBe(1);
  });

  it("无 offers 字段（旧 API 响应）→ 只出原有预警，不新增", () => {
    const out = classifyDailyAlerts(base());
    expect(out.items).toEqual([]);
  });
});
