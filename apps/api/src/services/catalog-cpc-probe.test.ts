import { describe, expect, it, vi } from "vitest";
import {
  extractProbeKeyword,
  localeForCountry,
  probeCategoryCpc,
} from "./catalog-cpc-probe.js";

describe("extractProbeKeyword", () => {
  it("型号标题 → 品类词（不是型号全称）", () => {
    expect(
      extractProbeKeyword(
        "roborock 2026 New Qrevo Edge 3 Pro Robot Vacuum and Mop, 36000 Pa Suction"
      )
    ).toBe("robot vacuum");
  });

  it("多语言标题也能识别品类", () => {
    expect(extractProbeKeyword("Beatbot AquaSense 2 Poolroboter DE")).toBe(
      "pool cleaner"
    );
    expect(extractProbeKeyword("roborock Saugroboter mit Wischfunktion")).toBe(
      "robot vacuum"
    );
  });

  it("没有规则命中时退回 品牌+品类词", () => {
    expect(extractProbeKeyword("VEVOR 8KW Diesel Heater All in One")).toBe(
      "vevor heater"
    );
  });

  it("太短返回 null", () => {
    expect(extractProbeKeyword("Acme Widget Pro")).toBeNull();
    expect(extractProbeKeyword("")).toBeNull();
  });
});

describe("localeForCountry", () => {
  it("已知国家返回对应 locale", () => {
    expect(localeForCountry("DE").locationCode).toBe(2276);
    expect(localeForCountry("es").languageCode).toBe("es");
  });

  it("未知国家退回美国", () => {
    expect(localeForCountry("ZZ").locationCode).toBe(2840);
    expect(localeForCountry(null).locationCode).toBe(2840);
  });
});

describe("probeCategoryCpc", () => {
  const products = [
    {
      productId: "a",
      name: "Cat Litter Box Self Cleaning",
      payoutUsd: 100,
      priceUsd: 300,
      countryCode: "US",
    },
    {
      productId: "b",
      name: "Poolroboter AquaSense",
      payoutUsd: 80,
      priceUsd: 900,
      countryCode: "DE",
    },
    {
      productId: "c",
      name: "No Payout Item",
      payoutUsd: null,
      priceUsd: 100,
      countryCode: "US",
    },
  ];

  it("按国家分批，每批一次调用", async () => {
    const calls: Array<{ kws: string[]; loc: number }> = [];
    const fetchCpc = vi.fn(async (kws: string[], loc: { locationCode: number }) => {
      calls.push({ kws, loc: loc.locationCode });
      const m = new Map<string, number>();
      for (const kw of kws) m.set(kw, 0.5);
      return m;
    });
    const r = await probeCategoryCpc(products, fetchCpc);
    expect(fetchCpc).toHaveBeenCalledTimes(2); // US 与 DE 各一批
    expect(calls.map((c) => c.loc).sort()).toEqual([2276, 2840]);
    expect(r.countries).toBe(2);
    expect(r.samples).toHaveLength(2);
  });

  it("品类词去重：同类目多个商品只查一个词", async () => {
    const dup = [
      { productId: "1", name: "Robot Vacuum A", payoutUsd: 50, priceUsd: 100, countryCode: "US" },
      { productId: "2", name: "Robot Vacuum B", payoutUsd: 40, priceUsd: 100, countryCode: "US" },
    ];
    const fetchCpc = vi.fn(async (kws: string[]) => {
      const m = new Map<string, number>();
      for (const kw of kws) m.set(kw, 0.9);
      return m;
    });
    await probeCategoryCpc(dup, fetchCpc);
    const kws = (fetchCpc.mock.calls[0] as unknown[])[0] as string[];
    expect(kws).toEqual(["robot vacuum"]);
  });

  it("查不到 CPC 的词计入 misses", async () => {
    const r = await probeCategoryCpc(products, async () => new Map());
    expect(r.samples).toHaveLength(0);
    expect(r.misses).toBeGreaterThan(0);
  });

  it("没有佣金的商品不发起查询", async () => {
    const fetchCpc = vi.fn(async () => new Map<string, number>());
    const r = await probeCategoryCpc(
      [
        {
          productId: "x",
          name: "Robot Vacuum",
          payoutUsd: null,
          priceUsd: null,
          countryCode: "US",
        },
      ],
      fetchCpc
    );
    expect(fetchCpc).not.toHaveBeenCalled();
    expect(r.samples).toHaveLength(0);
  });
});
