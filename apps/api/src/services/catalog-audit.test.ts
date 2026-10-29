import { describe, expect, it } from "vitest";
import { auditCatalog, inferCategory, type AuditProduct } from "./catalog-audit.js";

const p = (over: Partial<AuditProduct> = {}): AuditProduct => ({
  productId: "p1",
  name: "Generic Widget",
  brand: "BrandA",
  priceUsd: 200,
  payoutUsd: 50,
  reviewCount: 500,
  inStock: true,
  ...over,
});

describe("inferCategory", () => {
  it("按关键词推断类目", () => {
    expect(inferCategory("PetCove Self Cleaning Cat Litter Box")).toBe("pet");
    expect(inferCategory("Spytec GPS Tracker for Vehicles")).toBe("gps");
    expect(inferCategory("Vitamin D3 Gummies Supplement")).toBe("supplement");
    expect(inferCategory("HEPA Air Purifier for Home")).toBe("appliance");
  });

  it("不认识的一律 other", () => {
    expect(inferCategory("Acme Widget Pro")).toBe("other");
  });
});

describe("auditCatalog", () => {
  it("按类目取 CPC：宠物类用宠物基线，不受其它类目影响", () => {
    const r = auditCatalog(
      [
        p({ productId: "cat", name: "Cat Litter Box", payoutUsd: 40 }),
        p({ productId: "gps", name: "GPS Tracker", payoutUsd: 40 }),
      ],
      {
        cpcSamples: [
          { category: "pet", cpcUsd: 0.5, clicks: 100 },
          { category: "pet", cpcUsd: 0.6, clicks: 100 },
          { category: "pet", cpcUsd: 0.55, clicks: 100 },
          { category: "gps", cpcUsd: 2.0, clicks: 100 },
          { category: "gps", cpcUsd: 2.2, clicks: 100 },
          { category: "gps", cpcUsd: 2.1, clicks: 100 },
        ],
      }
    );
    // 宠物：40*0.6*0.8075*2.5% = 0.4845 > 0.55? 不，略低于 → 被砍
    // GPS：同样佣金，但基线 2.0+ → 必被砍
    expect(r.counts.total).toBe(2);
    expect(r.picked).toHaveLength(0);
  });

  it("佣金够高时按类目通过", () => {
    const r = auditCatalog([p({ name: "Cat Litter Box", payoutUsd: 120 })], {
      cpcSamples: [
        { category: "pet", cpcUsd: 0.5, clicks: 10 },
        { category: "pet", cpcUsd: 0.6, clicks: 10 },
        { category: "pet", cpcUsd: 0.55, clicks: 10 },
      ],
    });
    expect(r.picked).toHaveLength(1);
    expect(r.picked[0].category).toBe("pet");
    expect(r.picked[0].baselineSource).toBe("exact");
  });

  it("无类目样本时退到全站并写进 notes（不编造）", () => {
    const r = auditCatalog([p({ name: "Cat Litter Box", payoutUsd: 120 })], {
      cpcSamples: [
        { category: "other", cpcUsd: 1, clicks: 10 },
        { category: "other", cpcUsd: 1.1, clicks: 10 },
        { category: "other", cpcUsd: 1.2, clicks: 10 },
      ],
    });
    expect(r.picked[0].baselineSource).toBe("global");
    expect(r.notes.join("")).toContain("没有足够历史 CPC 样本");
  });

  it("完全没有 CPC 数据时不拿 0 当门槛", () => {
    const r = auditCatalog([p({ payoutUsd: 50 })], { cpcSamples: [] });
    expect(r.picked).toHaveLength(1);
    expect(r.picked[0].cpcUsd).toBe(0);
  });

  it("评论低于门槛的单独剔除", () => {
    const r = auditCatalog(
      [p({ name: "Cat Litter Box", payoutUsd: 120, reviewCount: 5 })],
      { minReviews: 50, cpcSamples: [] }
    );
    expect(r.picked).toHaveLength(0);
    expect(r.dropped[0].reason).toContain("评论 5 低于门槛 50");
    expect(r.dropped[0].category).toBe("pet");
  });

  it("结果按佣金降序", () => {
    const r = auditCatalog(
      [
        p({ productId: "a", name: "Cat Litter", brand: "A", payoutUsd: 60 }),
        p({ productId: "b", name: "Dog Toy", brand: "B", payoutUsd: 140 }),
      ],
      { cpcSamples: [] }
    );
    expect(r.picked.map((x) => x.productId)).toEqual(["b", "a"]);
  });
});
