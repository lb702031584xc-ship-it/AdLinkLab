/**
 * 流量门评估单测：pass / fail / unknown 三态、domain 跳过检测、
 * deriveBrandFromTitle / extractCoreKeywords。
 *
 * 下游数据源全部 mock，只验证 gate 的编排与判定逻辑。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@adlinklab/database";

vi.mock("./official-site.js", async (importOriginal) => {
  const orig =
    await importOriginal<typeof import("./official-site.js")>();
  // 只 mock 网络相关的 detectOfficialSite；isMarketplaceDomain 用真实实现。
  return { ...orig, detectOfficialSite: vi.fn() };
});
vi.mock("./trends.js", () => ({ getKeywordInterest: vi.fn() }));
vi.mock("./similarweb.js", () => ({ SimilarWebProvider: vi.fn() }));
vi.mock("./dataforseo.js", () => ({ DataForSeoProvider: vi.fn() }));

import { detectOfficialSite } from "./official-site.js";
import { getKeywordInterest } from "./trends.js";
import { SimilarWebProvider } from "./similarweb.js";
import { DataForSeoProvider } from "./dataforseo.js";
import {
  evaluateTrafficGate,
  deriveBrandFromTitle,
  extractCoreKeywords,
  type EvaluateTrafficGateInput,
} from "./gate.js";
import type { TrafficThresholds } from "./types.js";

const mockDetect = vi.mocked(detectOfficialSite);
const mockTrends = vi.mocked(getKeywordInterest);
const MockSw = vi.mocked(SimilarWebProvider);
const MockDf = vi.mocked(DataForSeoProvider);

const THRESHOLDS: TrafficThresholds = {
  officialSiteMonthlyVisits: 50000,
  brandInterest: 25,
  keywordInterest: 25,
  organicTrafficMin: 1000,
  paidTrafficWarnRatio: 0.05,
};

const fakePrisma = {} as unknown as PrismaClient;

function baseInput(
  overrides: Partial<EvaluateTrafficGateInput> = {}
): EvaluateTrafficGateInput {
  return {
    brand: "Anker",
    title: "Anker 737 Power Bank 120W Fast Charger",
    keywords: ["power bank", "fast charger"],
    thresholds: THRESHOLDS,
    prisma: fakePrisma,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDetect.mockResolvedValue({
    found: true,
    domain: "anker.com",
    confidence: "high",
  });
  MockSw.mockImplementation(
    () => ({ getMonthlyVisits: vi.fn().mockResolvedValue(null) }) as never
  );
  MockDf.mockImplementation(
    () =>
      ({
        getKeywordVolume: vi.fn().mockResolvedValue([]),
      }) as never
  );
});

function mockSwVisits(v: number | null) {
  MockSw.mockImplementation(
    () => ({ getMonthlyVisits: vi.fn().mockResolvedValue(v) }) as never
  );
}

describe("evaluateTrafficGate", () => {
  it("有官网 + SimilarWeb 达标 → pass（付费）", async () => {
    mockSwVisits(120000);
    const res = await evaluateTrafficGate(baseInput());
    expect(res.passed).toBe(true);
    expect(res.reason).toContain("通过");
    expect(res.reason).toContain("付费");
    expect(res.officialSite).toEqual({
      found: true,
      domain: "anker.com",
      confidence: "high",
    });
    const sw = res.signals.find((s) => s.source === "similarweb");
    expect(sw?.value).toBe(120000);
    expect(sw?.threshold).toBe(50000);
    expect(sw?.passed).toBe(true);
    expect(sw?.label).toContain("SimilarWeb");
  });

  it("有官网 + SimilarWeb 未达标 → fail", async () => {
    mockSwVisits(10000);
    const res = await evaluateTrafficGate(baseInput());
    expect(res.passed).toBe(false);
    expect(res.reason).toContain("未通过");
    expect(res.signals.find((s) => s.source === "similarweb")?.passed).toBe(
      false
    );
  });

  it("无 SimilarWeb key → Trends 品牌热度兜底（免费相对值，非访问量）", async () => {
    mockSwVisits(null);
    mockTrends.mockResolvedValue({ value: 60, rateLimited: false });
    const res = await evaluateTrafficGate(baseInput());
    expect(res.passed).toBe(true);
    const t = res.signals.find((s) => s.source === "trends");
    expect(t?.label).toContain("免费相对值，非访问量");
    expect(t?.passed).toBe(true);
    expect(res.reason).toContain("免费");
  });

  it("判定信号无数据 → unknown（不直接 fail），reason 写清暂无数据", async () => {
    mockSwVisits(null);
    mockTrends.mockResolvedValue({ value: null, rateLimited: false });
    const res = await evaluateTrafficGate(baseInput());
    expect(res.passed).toBe(null);
    expect(res.reason).toContain("暂无数据");
    expect(res.reason).toContain("unknown");
  });

  it("无官网 → 关键词热度判定 + DataForSEO 仅展示", async () => {
    mockDetect.mockResolvedValue({
      found: false,
      domain: null,
      confidence: "low",
    });
    mockTrends.mockResolvedValue({ value: 70, rateLimited: false });
    MockDf.mockImplementation(
      () =>
        ({
          getKeywordVolume: vi
            .fn()
            .mockResolvedValue([
              { keyword: "power bank", volume: 90500 },
              { keyword: "fast charger", volume: null },
            ]),
        }) as never
    );
    const res = await evaluateTrafficGate(baseInput());
    expect(res.passed).toBe(true);
    // 只取前 2 个关键词
    expect(mockTrends).toHaveBeenCalledWith(
      ["power bank", "fast charger"],
      "US",
      expect.anything()
    );
    const df = res.signals.filter((s) => s.source === "dataforseo");
    expect(df).toHaveLength(2);
    expect(df[0]).toMatchObject({
      value: 90500,
      threshold: null,
      passed: null,
    });
    expect(df[0]?.label).toContain("DataForSEO");
  });

  it("无官网 + 热度无数据 → unknown", async () => {
    mockDetect.mockResolvedValue({
      found: false,
      domain: null,
      confidence: "low",
    });
    mockTrends.mockResolvedValue({ value: null, rateLimited: false });
    const res = await evaluateTrafficGate(baseInput());
    expect(res.passed).toBe(null);
    expect(res.reason).toContain("暂无数据");
  });

  it("传入 domain 时跳过官网检测", async () => {
    mockSwVisits(80000);
    const res = await evaluateTrafficGate(
      baseInput({ brand: null, title: "Something", domain: "anker.com" })
    );
    expect(mockDetect).not.toHaveBeenCalled();
    expect(res.officialSite).toEqual({
      found: true,
      domain: "anker.com",
      confidence: "medium",
    });
    expect(res.reason).toContain("官网域名由调用方提供，跳过自动检测");
    expect(res.passed).toBe(true);
  });

  it("domain 归一化（去协议/路径/大小写）", async () => {
    mockSwVisits(80000);
    const res = await evaluateTrafficGate(
      baseInput({ brand: null, title: "x", domain: "https://WWW.Anker.com/shop" })
    );
    expect(res.officialSite?.domain).toBe("www.anker.com");
    expect(mockDetect).not.toHaveBeenCalled();
  });


  it("手动输入月访问量达标 → pass，以手动为准（不再 unknown）", async () => {
    mockSwVisits(null);
    mockTrends.mockResolvedValue({ value: null, rateLimited: true });
    const res = await evaluateTrafficGate(
      baseInput({ manualMonthlyVisits: 80000 })
    );
    expect(res.passed).toBe(true);
    const m = res.signals.find((s) => s.source === "manual");
    expect(m).toMatchObject({ value: 80000, threshold: 50000, passed: true });
    expect(m?.label).toContain("手动输入");
    expect(m?.label).toContain("非实测");
    expect(res.reason).toContain("手动");
    // 手动优先：Trends 不应被调用
    expect(mockTrends).not.toHaveBeenCalled();
  });

  it("手动输入月访问量未达标 → fail", async () => {
    const res = await evaluateTrafficGate(
      baseInput({ manualMonthlyVisits: 10000 })
    );
    expect(res.passed).toBe(false);
    expect(res.reason).toContain("未通过");
    expect(res.signals.find((s) => s.source === "manual")?.passed).toBe(false);
  });

  it("手动输入非法值（0/负数/NaN）→ 被忽略，走原逻辑", async () => {
    mockSwVisits(null);
    mockTrends.mockResolvedValue({ value: null, rateLimited: false });
    const res = await evaluateTrafficGate(baseInput({ manualMonthlyVisits: 0 }));
    expect(res.signals.find((s) => s.source === "manual")).toBeUndefined();
    expect(res.passed).toBe(null);
  });

  it("Trends 被限流 → unknown 的 reason 写明被限流（429）", async () => {
    mockSwVisits(null);
    mockTrends.mockResolvedValue({ value: null, rateLimited: true });
    const res = await evaluateTrafficGate(baseInput());
    expect(res.passed).toBe(null);
    expect(res.reason).toContain("被限流");
    expect(res.reason).toContain("429");
  });


  it("marketplace 域名（amazon.com）+ 有 brand → 对 brand 跑官网检测，用检出域名做流量门", async () => {
    mockDetect.mockResolvedValue({
      found: true,
      domain: "anker.com",
      confidence: "high",
    });
    mockSwVisits(90000);
    const res = await evaluateTrafficGate(
      baseInput({ brand: "Anker", title: "x", domain: "https://www.amazon.com/dp/xyz" })
    );
    // 官网检测必须用 brand 跑，而不是 amazon.com
    expect(mockDetect).toHaveBeenCalled();
    expect(res.officialSite?.found).toBe(true);
    expect(res.officialSite?.domain).toBe("anker.com");
    expect(res.officialSite?.reason).toContain("电商平台");
    expect(res.signals.find((s) => s.source === "similarweb")?.passed).toBe(true);
    expect(res.passed).toBe(true);
  });

  it("marketplace 域名 + 无 brand → unknown，reason 请补充品牌名，不硬 fail", async () => {
    const res = await evaluateTrafficGate(
      baseInput({ brand: null, title: "x", domain: "amazon.com", keywords: [] })
    );
    expect(res.officialSite?.found).toBe(false);
    expect(res.officialSite?.reason).toContain("电商平台");
    expect(res.officialSite?.reason).toContain("请补充品牌名");
    expect(res.passed).toBe(null);
    expect(res.reason).toContain("请补充品牌名");
  });

  it("marketplace 域名 + brand 但检测失败 → unknown，reason 写未能检出", async () => {
    mockDetect.mockResolvedValue({ found: false, domain: null, confidence: "low" });
    mockTrends.mockResolvedValue({ value: null, rateLimited: false });
    const res = await evaluateTrafficGate(
      baseInput({ brand: "Anker", title: "x", domain: "ebay.com", keywords: [] })
    );
    expect(res.officialSite?.found).toBe(false);
    expect(res.officialSite?.reason).toContain("未能检出品牌官网");
    expect(res.passed).toBe(null);
  });

  it("自动检测检出平台域名 → 防御性拒绝，不采信", async () => {
    mockDetect.mockResolvedValue({
      found: true,
      domain: "amazon.com",
      confidence: "high",
    });
    mockTrends.mockResolvedValue({ value: null, rateLimited: false });
    const res = await evaluateTrafficGate(baseInput({ domain: null }));
    expect(res.officialSite?.found).toBe(false);
    expect(res.officialSite?.reason).toContain("电商平台");
  });

  it("普通商家域名直给 → 保持现有行为（视为官网，跳过检测）", async () => {
    mockSwVisits(80000);
    const res = await evaluateTrafficGate(
      baseInput({ brand: null, title: "x", domain: "yeahpromos.com" })
    );
    expect(mockDetect).not.toHaveBeenCalled();
    expect(res.officialSite).toMatchObject({
      found: true,
      domain: "yeahpromos.com",
      confidence: "medium",
    });
    expect(res.passed).toBe(true);
  });

  it("内部异常 → unknown，不抛错", async () => {
    mockDetect.mockRejectedValue(new Error("unexpected"));
    // 注意：detectOfficialSite 本身永不抛错；这里模拟极端情况下 gate 仍收敛
    const res = await evaluateTrafficGate(baseInput());
    expect(res.passed).toBe(null);
    await expect(
      evaluateTrafficGate(baseInput())
    ).resolves.toBeDefined();
  });

  it("付费为零规则：自然流量 2200 + 付费 0 → fail（直接 PK）", async () => {
    const res = await evaluateTrafficGate(
      baseInput({
        manualMonthlyVisits: 80000,
        organicTraffic: 2200,
        paidTraffic: 0,
        paidKeywords: 0,
      })
    );
    expect(res.passed).toBe(false);
    expect(res.reason).toContain("直接 PK");
    expect(res.reason).toContain("付费流量为 0");
    expect(res.reason).toContain("2,200");
    const sig = res.signals.find((s) =>
      s.label.includes("付费流量为零检查")
    );
    expect(sig).toMatchObject({ passed: false, threshold: 1000 });
  });

  it("付费为零规则：自然流量 2200 + 付费 100 → 不触发（有人在投）", async () => {
    const res = await evaluateTrafficGate(
      baseInput({
        manualMonthlyVisits: 80000,
        organicTraffic: 2200,
        paidTraffic: 100,
      })
    );
    expect(res.passed).toBe(true);
    const sig = res.signals.find((s) =>
      s.label.includes("付费流量为零检查")
    );
    expect(sig).toMatchObject({ passed: true });
  });

  it("付费为零规则：organic 未知 + 付费 0 → 不触发（绝不因没数据误杀）", async () => {
    const res = await evaluateTrafficGate(
      baseInput({ manualMonthlyVisits: 80000, paidTraffic: 0 })
    );
    expect(res.passed).toBe(true);
    expect(
      res.signals.find((s) => s.label.includes("付费流量为零检查"))
    ).toBeUndefined();
    expect(res.reason).not.toContain("直接 PK");
  });

  it("付费为零规则：自然流量 500（低于阈值）+ 付费 0 → 不触发", async () => {
    const res = await evaluateTrafficGate(
      baseInput({
        manualMonthlyVisits: 80000,
        organicTraffic: 500,
        paidTraffic: 0,
      })
    );
    expect(res.passed).toBe(true);
    expect(
      res.signals.find((s) => s.label.includes("付费流量为零检查"))
    ).toBeUndefined();
  });

  it("付费为零规则：自然流量达标但付费未知 → 不加信号（不判 fail）", async () => {
    const res = await evaluateTrafficGate(
      baseInput({ manualMonthlyVisits: 80000, organicTraffic: 2200 })
    );
    expect(res.passed).toBe(true);
    expect(
      res.signals.find((s) => s.label.includes("付费流量为零检查"))
    ).toBeUndefined();
  });

  it("付费为零规则：自定义阈值 organicTrafficMin 生效", async () => {
    const res = await evaluateTrafficGate(
      baseInput({
        manualMonthlyVisits: 80000,
        organicTraffic: 2200,
        paidTraffic: 0,
        thresholds: { ...THRESHOLDS, organicTrafficMin: 5000 },
      })
    );
    expect(res.passed).toBe(true);
    expect(
      res.signals.find((s) => s.label.includes("付费流量为零检查"))
    ).toBeUndefined();
  });

  it("caution 档：自然流量 2200 + 付费 80（<5%）→ passed 但 caution（不 kill）", async () => {
    const res = await evaluateTrafficGate(
      baseInput({
        manualMonthlyVisits: 80000,
        organicTraffic: 2200,
        paidTraffic: 80,
      })
    );
    expect(res.passed).toBe(true);
    expect(res.caution).toContain("谨慎测试");
    expect(res.caution).toContain("小预算");
    expect(res.caution).toContain("2,200");
    expect(res.caution).toContain("80");
    // 判定依据说明（中英）要带上
    expect(res.caution).toContain("clickstream");
    const sig = res.signals.find((s) =>
      s.label.includes("付费流量为零检查")
    );
    expect(sig).toMatchObject({ passed: true });
  });

  it("caution 档：付费恰好 = 5% 时不触发（严格小于才警告）", async () => {
    const res = await evaluateTrafficGate(
      baseInput({
        manualMonthlyVisits: 80000,
        organicTraffic: 2000,
        paidTraffic: 100,
      })
    );
    expect(res.passed).toBe(true);
    expect(res.caution).toBeNull();
  });

  it("caution 档：付费充足（≥5%）→ 无警告", async () => {
    const res = await evaluateTrafficGate(
      baseInput({
        manualMonthlyVisits: 80000,
        organicTraffic: 2200,
        paidTraffic: 500,
      })
    );
    expect(res.passed).toBe(true);
    expect(res.caution).toBeNull();
  });

  it("caution 档：自定义比例阈值生效", async () => {
    const res = await evaluateTrafficGate(
      baseInput({
        manualMonthlyVisits: 80000,
        organicTraffic: 2200,
        paidTraffic: 150,
        thresholds: { ...THRESHOLDS, paidTrafficWarnRatio: 0.1 },
      })
    );
    expect(res.passed).toBe(true);
    expect(res.caution).toContain("谨慎测试");
    expect(res.caution).toContain("10%");
  });

  it("kill 档 reason 带判定依据说明（中英）", async () => {
    const res = await evaluateTrafficGate(
      baseInput({
        manualMonthlyVisits: 80000,
        organicTraffic: 2200,
        paidTraffic: 0,
      })
    );
    expect(res.passed).toBe(false);
    expect(res.reason).toContain("clickstream");
    expect(res.reason).toContain("购买意图");
  });
});

describe("deriveBrandFromTitle", () => {
  it("取标题前 2 个有效词", () => {
    expect(deriveBrandFromTitle("Anker 737 Power Bank 120W Fast Charger")).toBe(
      "anker 737"
    );
  });

  it("支持中文标题并过滤停用词", () => {
    expect(deriveBrandFromTitle("安克 充电宝 20000mAh 旗舰新品")).toBe(
      "安克 充电宝"
    );
  });

  it("全停用词/空标题 → null", () => {
    expect(deriveBrandFromTitle("的 和 与")).toBe(null);
    expect(deriveBrandFromTitle("")).toBe(null);
    expect(deriveBrandFromTitle("   ")).toBe(null);
  });
});

describe("extractCoreKeywords", () => {
  it("优先用调用方 keywords（前 2 个）", () => {
    expect(
      extractCoreKeywords("Some Product Title Here", ["kw1", "kw2", "kw3"])
    ).toEqual(["kw1", "kw2"]);
  });

  it("无 keywords 时从标题分词", () => {
    expect(extractCoreKeywords("Anker 737 Power Bank", [])).toEqual([
      "anker 737",
      "power bank",
    ]);
  });

  it("都没有 → 空数组", () => {
    expect(extractCoreKeywords("", [])).toEqual([]);
  });
});
