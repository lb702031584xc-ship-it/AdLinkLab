import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  validateCriteria,
  filterProducts,
  scoreAndExplain,
  runDiscovery,
  TRAFFIC_GATE_TOP_N,
  type AmazonProduct,
} from "./amazon-discovery.js";
import { evaluateTrafficGate } from "../traffic/gate.js";
import { getTrafficThresholds } from "../traffic/thresholds.js";
import { searchAmazonProducts } from "../networks/amazon-adapter.js";
import type { PrismaClient } from "@adlinklab/database";
import type {
  TrafficGateResult,
  TrafficThresholds,
} from "../traffic/types.js";

vi.mock("../traffic/gate.js", () => ({
  evaluateTrafficGate: vi.fn(),
}));

vi.mock("../traffic/thresholds.js", () => ({
  getTrafficThresholds: vi.fn(),
}));

vi.mock("../networks/amazon-adapter.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../networks/amazon-adapter.js")>();
  return { ...actual, searchAmazonProducts: vi.fn() };
});

const mockEvaluateGate = vi.mocked(evaluateTrafficGate);
const mockGetThresholds = vi.mocked(getTrafficThresholds);
const mockSearch = vi.mocked(searchAmazonProducts);

const MOCK_THRESHOLDS: TrafficThresholds = {
  officialSiteMonthlyVisits: 50000,
  brandInterest: 30,
  keywordInterest: 30,
  organicTrafficMin: 1000,
  paidTrafficWarnRatio: 0.05,
};

const okGate = (asin: string): TrafficGateResult => ({
  passed: true,
  reason: `gate ok for ${asin}`,
  officialSite: null,
  signals: [],
});

function makeFakePrisma() {
  return {
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
  } as unknown as PrismaClient;
}

const mockProduct = (overrides: Partial<AmazonProduct> = {}): AmazonProduct => ({
  asin: "B08N5WRWNW",
  title: "Test Product",
  detailPageUrl: "https://www.amazon.com/dp/B08N5WRWNW",
  price: 99.99,
  currency: "USD",
  rating: 4.5,
  reviewCount: 2000,
  imageUrl: null,
  isPrime: true,
  availability: "In Stock",
  brand: null,
  ...overrides,
});

describe("amazon-discovery", () => {
  it("validates criteria with keywords", () => {
    const c = validateCriteria({ keywords: ["earbuds", "keyboard"] });
    expect(c.keywords).toEqual(["earbuds", "keyboard"]);
    expect(c.minPrice).toBeNull();
  });

  it("rejects empty keywords", () => {
    expect(() => validateCriteria({ keywords: [] })).toThrow();
    expect(() => validateCriteria({})).toThrow();
  });

  it("rejects invalid rating", () => {
    expect(() =>
      validateCriteria({ keywords: ["a"], minRating: 6 })
    ).toThrow();
  });

  it("limits keywords to 10", () => {
    const kws = Array.from({ length: 15 }, (_, i) => `kw${i}`);
    const c = validateCriteria({ keywords: kws });
    expect(c.keywords).toHaveLength(10);
  });

  it("filters products by criteria", () => {
    const products = [
      mockProduct(),
      mockProduct({ asin: "B2", rating: 3.0 }), // rating too low
      mockProduct({ asin: "B3", price: 500 }), // price too high
      mockProduct({ asin: "B4", reviewCount: 10 }), // reviews too low
      mockProduct({ asin: "B5", availability: "Out of Stock" }), // OOS
    ];
    const filtered = filterProducts(products, {
      keywords: ["test"],
      minPrice: 50,
      maxPrice: 200,
      minRating: 4.3,
      minReviews: 500,
    });
    expect(filtered.map((p) => p.asin)).toEqual(["B08N5WRWNW"]);
  });

  it("scores and explains products", () => {
    const scored = scoreAndExplain(mockProduct());
    expect(scored.score).toBeGreaterThan(0);
    expect(scored.estimatedCommission).toBeCloseTo(4.0, 1); // 99.99 * 4%
    expect(scored.reasons.length).toBeGreaterThan(0);
  });
});

describe("runDiscovery traffic gate", () => {
  const products12 = () =>
    Array.from({ length: 12 }, (_, i) =>
      mockProduct({ asin: `B000000${i.toString().padStart(2, "0")}` })
    );

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetThresholds.mockResolvedValue({ ...MOCK_THRESHOLDS });
    mockEvaluateGate.mockImplementation(async (input) =>
      okGate(input.title.slice(0, 8))
    );
    mockSearch.mockResolvedValue(products12());
  });

  it("attaches trafficGate to top N products only", async () => {
    const prisma = makeFakePrisma();
    const result = await runDiscovery(
      prisma,
      "tenant-1",
      "user-1",
      "AK|SK|tag|US",
      { keywords: ["earbuds"], maxResults: 20 }
    );

    expect(result.products).toHaveLength(12);
    expect(mockEvaluateGate).toHaveBeenCalledTimes(TRAFFIC_GATE_TOP_N);
    for (let i = 0; i < TRAFFIC_GATE_TOP_N; i++) {
      expect(result.products[i].trafficGate).toBeDefined();
      expect(result.products[i].trafficGate?.passed).toBe(true);
    }
    for (let i = TRAFFIC_GATE_TOP_N; i < result.products.length; i++) {
      expect(result.products[i].trafficGate).toBeUndefined();
    }
  });

  it("passes brand/title/keywords/thresholds to the gate", async () => {
    const prisma = makeFakePrisma();
    mockSearch.mockResolvedValue([
      { ...mockProduct({ asin: "B1" }), brand: "Sony" } as AmazonProduct,
    ]);
    await runDiscovery(prisma, "tenant-1", "user-1", "AK|SK|tag|US", {
      keywords: ["headphones", "earbuds", "speaker"],
    });

    expect(mockEvaluateGate).toHaveBeenCalledTimes(1);
    const input = mockEvaluateGate.mock.calls[0][0];
    expect(input.brand).toBe("Sony");
    expect(input.title).toBe("Test Product");
    expect(input.keywords).toEqual(["headphones", "earbuds"]); // 只取前 2 个
    expect(input.thresholds).toEqual(MOCK_THRESHOLDS);
    expect(input.prisma).toBe(prisma);
  });

  it("stores thresholds in criteria for history traceability", async () => {
    const prisma = makeFakePrisma();
    const result = await runDiscovery(
      prisma,
      "tenant-1",
      "user-1",
      "AK|SK|tag|US",
      { keywords: ["earbuds"] }
    );

    expect(result.criteria.trafficThresholds).toEqual(MOCK_THRESHOLDS);
    // 持久化的 criteria JSON 里也带阈值
    const insertArgs = (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    const persistedCriteria = JSON.parse(insertArgs[5] as string);
    expect(persistedCriteria.trafficThresholds).toEqual(MOCK_THRESHOLDS);
    // 持久化的 products JSON 里 top 产品带 trafficGate
    const persistedProducts = JSON.parse(insertArgs[6] as string) as Array<{
      trafficGate?: TrafficGateResult | null;
    }>;
    expect(persistedProducts[0].trafficGate?.passed).toBe(true);
  });

  it("a failing gate does not fail the discovery run", async () => {
    const prisma = makeFakePrisma();
    mockEvaluateGate.mockRejectedValueOnce(new Error("boom"));
    const result = await runDiscovery(
      prisma,
      "tenant-1",
      "user-1",
      "AK|SK|tag|US",
      { keywords: ["earbuds"] }
    );

    expect(result.products).toHaveLength(12);
    const failed = result.products.find(
      (p) => p.trafficGate?.reason.startsWith("流量门评估异常")
    );
    expect(failed).toBeDefined();
    expect(failed?.trafficGate?.passed).toBeNull();
    expect(failed?.trafficGate?.reason).toContain("boom");
    // 其余产品正常
    expect(
      result.products.filter((p) => p.trafficGate?.passed === true)
    ).toHaveLength(TRAFFIC_GATE_TOP_N - 1);
  });

  it("limits gate concurrency to 3", async () => {
    const prisma = makeFakePrisma();
    let active = 0;
    let maxActive = 0;
    mockEvaluateGate.mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return okGate("x");
    });
    await runDiscovery(prisma, "tenant-1", "user-1", "AK|SK|tag|US", {
      keywords: ["earbuds"],
    });
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxActive).toBe(3);
  });
});

describe("机会品模式（第八批）", () => {
  const prod = (overrides: Partial<AmazonProduct> = {}): AmazonProduct => ({
    asin: "B0EXAMPLE1",
    title: "Test Product",
    detailPageUrl: "https://www.amazon.com/dp/B0EXAMPLE1",
    price: 59.99,
    rating: 3.7,
    reviewCount: 3200,
    brand: "TestBrand",
    isPrime: true,
    availability: "In Stock",
    ...overrides,
  });

  it("validateCriteria 解析机会品阈值（默认 2000 / 3.0 / 4.0）", () => {
    const c = validateCriteria({
      keywords: ["kettle"],
      opportunityMode: true,
    });
    expect(c.opportunityMode).toBe(true);
    expect(c.opportunityMinReviews).toBe(2000);
    expect(c.opportunityMinRating).toBe(3.0);
    expect(c.opportunityMaxRating).toBe(4.0);
  });

  it("validateCriteria 接受自定义阈值", () => {
    const c = validateCriteria({
      keywords: ["kettle"],
      opportunityMode: true,
      opportunityMinReviews: 5000,
      opportunityMinRating: 3.2,
      opportunityMaxRating: 4.2,
    });
    expect(c.opportunityMinReviews).toBe(5000);
    expect(c.opportunityMinRating).toBe(3.2);
    expect(c.opportunityMaxRating).toBe(4.2);
  });

  it("validateCriteria 拒绝上限 ≤ 下限", () => {
    expect(() =>
      validateCriteria({
        keywords: ["kettle"],
        opportunityMode: true,
        opportunityMinRating: 4.0,
        opportunityMaxRating: 4.0,
      })
    ).toThrow();
  });

  it("filterProducts 机会品模式：只保留 高评论+低评分", () => {
    const criteria = validateCriteria({ keywords: ["k"], opportunityMode: true });
    const list = [
      prod({ asin: "B1", rating: 3.7, reviewCount: 3200 }), // 保留
      prod({ asin: "B2", rating: 4.5, reviewCount: 5000 }), // 评分过高
      prod({ asin: "B3", rating: 3.5, reviewCount: 800 }), // 评论不足
      prod({ asin: "B4", rating: 2.9, reviewCount: 4000 }), // 评分过低
      prod({ asin: "B5", rating: 4.0, reviewCount: 4000 }), // rating=4.0 不含
    ];
    const out = filterProducts(list, criteria);
    expect(out.map((p) => p.asin)).toEqual(["B1"]);
  });

  it("scoreAndExplain 机会品模式：打 opportunity 标记 + 推断说明", () => {
    const sp = scoreAndExplain(prod(), true);
    expect(sp.opportunity).toBe(true);
    expect(
      sp.reasons.some(
        (r) => r.includes("高需求 + 低满意度") && r.includes("基于评分分布的推断")
      )
    ).toBe(true);
  });

  it("scoreAndExplain 非机会品模式：无标记无说明", () => {
    const sp = scoreAndExplain(prod(), false);
    expect(sp.opportunity).toBe(false);
    expect(sp.reasons.some((r) => r.includes("高需求 + 低满意度"))).toBe(false);
  });
});
