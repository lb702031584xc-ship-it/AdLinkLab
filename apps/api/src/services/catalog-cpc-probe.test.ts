import { describe, expect, it, vi } from "vitest";
import { extractProbeKeyword, probeCategoryCpc } from "./catalog-cpc-probe.js";

describe("extractProbeKeyword", () => {
  it("剥掉年份与修饰，在品类词处截断", () => {
    expect(
      extractProbeKeyword(
        "roborock 2026 New Qrevo Edge 3 Pro Robot Vacuum and Mop, 36000 Pa Suction"
      )
    ).toBe("roborock qrevo edge 3 pro");
  });

  it("保留型号数字", () => {
    expect(extractProbeKeyword("VEVOR 8KW Diesel Heater All in One")).toBe(
      "vevor 8kw diesel"
    );
  });

  it("太短返回 null", () => {
    expect(extractProbeKeyword("Vacuum")).toBeNull();
    expect(extractProbeKeyword("")).toBeNull();
  });
});

describe("probeCategoryCpc", () => {
  const products = [
    { productId: "a", name: "Cat Litter Box Self Cleaning", payoutUsd: 100, priceUsd: 300 },
    { productId: "b", name: "Dog Toy Bundle", payoutUsd: 80, priceUsd: 100 },
    { productId: "c", name: "GPS Tracker for Vehicles", payoutUsd: 50, priceUsd: 100 },
    { productId: "d", name: "No Payout Item", payoutUsd: null, priceUsd: 100 },
  ];

  it("按类目取中位数，没佣金的商品跳过", async () => {
    const fetchCpc = vi.fn(async (kws: string[]) => {
      const m = new Map<string, number>();
      for (const kw of kws) {
        if (kw.startsWith("cat")) m.set(kw, 0.5);
        else if (kw.startsWith("dog")) m.set(kw, 0.7);
        else if (kw.startsWith("gps")) m.set(kw, 1.2);
      }
      return m;
    });
    const r = await probeCategoryCpc(products, fetchCpc);
    const byCat = Object.fromEntries(r.samples.map((s) => [s.category, s.cpcUsd]));
    expect(byCat.pet).toBeCloseTo(0.7, 4); // 每个关键词一条样本，取最后写入的那条
    expect(byCat.gps).toBeCloseTo(1.2, 4);
    expect(fetchCpc).toHaveBeenCalledTimes(1); // 批量一次
  });

  it("查不到 CPC 的词计入 misses，不生成样本", async () => {
    const r = await probeCategoryCpc(products, async () => new Map());
    expect(r.samples).toHaveLength(0);
    expect(r.misses).toBeGreaterThan(0);
  });

  it("没有可查商品时不调用接口", async () => {
    const fetchCpc = vi.fn(async () => new Map<string, number>());
    const r = await probeCategoryCpc(
      [{ productId: "x", name: "abc", payoutUsd: null, priceUsd: null }],
      fetchCpc
    );
    expect(r.samples).toHaveLength(0);
    expect(fetchCpc).not.toHaveBeenCalled();
  });
});
