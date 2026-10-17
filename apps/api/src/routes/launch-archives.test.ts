/**
 * 投放档案派生指标 + 诊断 + 自动建档推导。
 */
import { describe, expect, it } from "vitest";
import {
  buildAutoArchiveData,
  deriveArchiveMetrics,
} from "./launch-archives.js";

describe("deriveArchiveMetrics", () => {
  it("无展示 + 出价低于官方推荐 → 提价诊断（规则 1，最高优先）", () => {
    const out = deriveArchiveMetrics({
      impressions: 0,
      clicks: 0,
      myBid: 0.3,
      officialBid: 0.8,
    });
    expect(out.diagnosis).toContain("提高出价");
    expect(out.actualCpc).toBeNull();
  });

  it("无展示 + 出价不低于官方推荐 → 查关键词/状态/预算/审核（规则 2）", () => {
    const out = deriveArchiveMetrics({
      impressions: 0,
      clicks: 0,
      myBid: 1.0,
      officialBid: 0.8,
    });
    expect(out.diagnosis).toContain("检查关键词");
    // null impressions 按 0 处理。
    expect(
      deriveArchiveMetrics({ impressions: null, clicks: null }).diagnosis
    ).toContain("检查关键词");
  });

  it("亏损 → 降价/停投（规则 3）", () => {
    const out = deriveArchiveMetrics({
      impressions: 100,
      clicks: 10,
      spend: 50,
      revenue: 20,
    });
    expect(out.actualCpc).toBeCloseTo(5);
    expect(out.actualRoi).toBeCloseTo(-0.6);
    expect(out.profit).toBeCloseTo(-30);
    expect(out.diagnosis).toContain("亏损");
  });

  it("盈利 → 加预算/提价抢量（规则 4）", () => {
    const out = deriveArchiveMetrics({
      impressions: 100,
      clicks: 10,
      spend: 20,
      revenue: 80,
    });
    expect(out.actualRoi).toBeCloseTo(3);
    expect(out.profit).toBeCloseTo(60);
    expect(out.diagnosis).toContain("盈利");
  });

  it("有点击无转化 → 检查落地页/Offer转化（规则 5）", () => {
    const out = deriveArchiveMetrics({
      impressions: 100,
      clicks: 10,
      spend: 20,
      conversions: 0,
      revenue: null,
    });
    expect(out.actualCvr).toBe(0);
    expect(out.diagnosis).toContain("有点击无转化");
  });

  it("数据不足 → 暂无诊断（规则 6）", () => {
    const out = deriveArchiveMetrics({
      impressions: 100,
      clicks: 10,
      spend: 20,
      conversions: 2,
      revenue: null,
    });
    expect(out.diagnosis).toContain("数据不足");
  });

  it("规则 1 优先于规则 3（无展示时不判亏损）", () => {
    const out = deriveArchiveMetrics({
      impressions: 0,
      clicks: 0,
      spend: 10,
      revenue: 0,
      myBid: 0.1,
      officialBid: 0.5,
    });
    expect(out.diagnosis).toContain("提高出价");
  });
});

describe("buildAutoArchiveData", () => {
  const basePlan = {
    planId: "00000000-0000-0000-0000-000000000001",
    offerId: "00000000-0000-0000-0000-000000000002",
    campaignName: "Wenoker Test",
    dailyBudgetAmount: 30,
    dailyBudgetCurrency: "CNY",
    campaignMaxCpc: 1.25,
    firstAdGroupMaxCpc: 1.25,
    keywords: ["wenoker walking pad", "wenoker treadmill"],
    headlines: ["Wenoker Official Site"],
    descriptions: ["Shop home fitness."],
    finalUrl: "https://example.com/wenoker",
  };

  it("电商 Offer：payout = 均价 × 佣金率，epc = payout × CVR，推荐出价 = EPC/2", () => {
    const data = buildAutoArchiveData({
      plan: basePlan,
      offer: {
        name: "Wenoker",
        network: "PartnerBoost",
        destinationUrl: "https://example.com/wenoker",
        commissionType: "percentage",
        commissionValue: 20,
        avgPrice: 300,
      },
      plannerSnapshot: { payout: "999", networkCvr: "2" },
    });
    expect(data.payout).toBeCloseTo(60);
    expect(data.epc).toBeCloseTo(1.2);
    expect(data.breakevenCpc).toBeCloseTo(1.2);
    expect(data.recommendedBid).toBeCloseTo(0.6);
    expect(data.myBid).toBe(1.25);
    expect(data.dailyBudget).toBe(30);
    expect(data.budgetCurrency).toBe("CNY");
    expect(data.status).toBe("draft");
    expect(data.decision).toBeNull();
    expect(data.officialBid).toBeNull();
    expect(data.keywords).toEqual([
      "wenoker walking pad",
      "wenoker treadmill",
    ]);
  });

  it("固定佣金 Offer：payout = 佣金值", () => {
    const data = buildAutoArchiveData({
      plan: basePlan,
      offer: {
        name: "X",
        network: "N",
        destinationUrl: null,
        commissionType: "fixed",
        commissionValue: 26.5,
        avgPrice: null,
      },
      plannerSnapshot: null,
    });
    expect(data.payout).toBeCloseTo(26.5);
    expect(data.epc).toBeNull(); // CVR 缺失
    expect(data.recommendedBid).toBeNull();
  });

  it("Offer 缺失时 payout 取投流快照；都没有时为 null", () => {
    const fromSnapshot = buildAutoArchiveData({
      plan: basePlan,
      offer: null,
      plannerSnapshot: { payout: "45", networkCvr: "4" },
    });
    expect(fromSnapshot.payout).toBeCloseTo(45);
    expect(fromSnapshot.epc).toBeCloseTo(1.8);
    expect(fromSnapshot.network).toBe("manual");
    expect(fromSnapshot.offerName).toBe("Wenoker Test");

    const none = buildAutoArchiveData({
      plan: basePlan,
      offer: null,
      plannerSnapshot: null,
    });
    expect(none.payout).toBeNull();
    expect(none.epc).toBeNull();
    expect(none.recommendedBid).toBeNull();
  });

  it("myBid 缺失时回落第一个广告组 maxCpc", () => {
    const data = buildAutoArchiveData({
      plan: { ...basePlan, campaignMaxCpc: null, firstAdGroupMaxCpc: 0.9 },
      offer: null,
      plannerSnapshot: null,
    });
    expect(data.myBid).toBeCloseTo(0.9);
  });
});
