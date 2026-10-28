/**
 * 广告活动体检测试：分组、排序、浪费金额。
 */
import { describe, expect, it } from "vitest";
import { auditCampaigns, type CampaignRow } from "./campaign-audit.js";

const base = {
  status: "ENABLED",
  impressions: 3000,
  clicks: 300,
  costUsd: 100,
  conversions: 5,
  revenueUsd: 90,
};

const row = (over: Partial<CampaignRow> = {}): CampaignRow => ({
  id: "c-1",
  name: "Campaign 1",
  ...base,
  ...over,
});

describe("auditCampaigns", () => {
  it("烧穿止损线且 0 转化 → pause，并计入浪费", () => {
    const r = auditCampaigns([
      row({ id: "dead", costUsd: 80, conversions: 0, revenueUsd: 0, payoutUsd: 20 }),
    ]);
    expect(r.items[0].action).toBe("pause");
    expect(r.items[0].wastedUsd).toBe(80);
    expect(r.summary.totalWastedUsd).toBe(80);
  });

  it("CTR 太低 → fix（改文案），不算暂停也不计浪费", () => {
    const r = auditCampaigns([
      row({ id: "ctr", impressions: 5000, clicks: 20, costUsd: 30, conversions: 0, revenueUsd: 0 }),
    ]);
    expect(r.items[0].action).toBe("fix");
    expect(r.items[0].wastedUsd).toBe(0);
  });

  it("样本不足 → keep（继续观察，不急着关）", () => {
    const r = auditCampaigns([row({ id: "early", clicks: 120 })]);
    expect(r.items[0].action).toBe("keep");
  });

  it("达标且有转化 → scale", () => {
    const r = auditCampaigns([
      row({
        id: "win",
        clicks: 400,
        conversions: 20,
        costUsd: 120,
        revenueUsd: 400,
        breakevenCvrPct: 4,
      }),
    ]);
    expect(r.items[0].action).toBe("scale");
  });

  it("排序：暂停在前，组内按花费降序", () => {
    const r = auditCampaigns([
      row({ id: "keep", clicks: 120 }),
      row({ id: "pause-small", costUsd: 60, conversions: 0, revenueUsd: 0, payoutUsd: 20 }),
      row({ id: "pause-big", costUsd: 300, conversions: 0, revenueUsd: 0, payoutUsd: 20 }),
      row({ id: "fix", impressions: 5000, clicks: 20, conversions: 0, revenueUsd: 0 }),
    ]);
    expect(r.items.map((x) => x.id)).toEqual([
      "pause-big",
      "pause-small",
      "fix",
      "keep",
    ]);
  });

  it("汇总计数与总浪费正确", () => {
    const r = auditCampaigns([
      row({ id: "a", costUsd: 60, conversions: 0, revenueUsd: 0, payoutUsd: 20 }),
      row({ id: "b", clicks: 120 }),
    ]);
    expect(r.summary.pause).toBe(1);
    expect(r.summary.keep).toBe(1);
    expect(r.summary.totalWastedUsd).toBe(60);
  });

  it("全部健康时给出「没有明显该停的项」", () => {
    const r = auditCampaigns([row({ id: "ok", clicks: 120 })]);
    expect(r.notes.join("")).toContain("没有明显该停的项");
  });

  it("没有数据时不崩，返回空汇总", () => {
    const r = auditCampaigns([]);
    expect(r.items).toEqual([]);
    expect(r.summary.totalWastedUsd).toBe(0);
  });
});
