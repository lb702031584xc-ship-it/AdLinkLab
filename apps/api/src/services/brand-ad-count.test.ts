/**
 * 广告投放数量服务单测：classifyAds 纯函数分类 + calcBrandAdCounts 的
 * 分组/14 天缓存/Amazon 只记 total/凭证缺失抛错/单组失败不中断。
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@adlinklab/database";
import { encryptSecret, TEST_AI_SETTINGS_PEPPER } from "../ai/crypto.js";
import {
  adBandOf,
  classifyAds,
  classifyLandingType,
  countLandingTypes,
  calcBrandAdCounts,
  deriveAdTrend,
  deriveLongtailProbes,
  extractProductCategory,
  groupAdPolicyRisk,
  hasAdPolicyRisk,
  MAX_LONGTAIL_PROBES,
  MAX_QUERIES_PER_GROUP,
  modelCandidatesOf,
  modelTokensOf,
  previewBrandAdCounts,
  tallySerpAds,
} from "./brand-ad-count.js";

function enc(plain: string): string {
  return encryptSecret(plain, TEST_AI_SETTINGS_PEPPER);
}

interface FakeProduct {
  id: string;
  brand: string | null;
  countryCode: string | null;
  landingPageType: string | null;
  adCountCheckedAt: Date | null;
  adCount?: number | null;
  adCountSelf?: number | null;
  adCountOthers?: number | null;
  adCountHome?: number | null;
  adCountProduct?: number | null;
  adCountLongtail?: number | null;
  adProbeDetail?: unknown;
  adPolicyRisk?: boolean;
  lastAdCount?: number | null;
  lastAdCountCheckedAt?: Date | null;
  screenVerdict?: string | null;
  status?: string;
  name?: string;
  recommendationScore?: number | null;
  reviewCount?: number | null;
  rawData?: unknown;
}

function makeFakePrisma(products: FakeProduct[], withCreds = true) {
  const settings: Record<string, string> = withCreds
    ? {
        "traffic.dataforseoLogin": enc("login-x"),
        "traffic.dataforseoPassword": enc("pw-x"),
      }
    : {};
  const store = new Map(products.map((p) => [p.id, { ...p }]));
  const prisma = {
    aiSetting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
        const value = settings[where.key];
        return value === undefined ? null : { key: where.key, value };
      }),
    },
    networkProduct: {
      findMany: vi.fn(
        async ({ where }: { where: { id?: { in: string[] } } }) => {
          const all = [...store.values()];
          const ids = where.id?.in;
          return ids ? all.filter((p) => ids.includes(p.id)) : all;
        }
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: { in: string[] } };
          data: Record<string, unknown>;
        }) => {
          let count = 0;
          for (const id of where.id.in) {
            const row = store.get(id);
            if (row) {
              Object.assign(row, data);
              count += 1;
            }
          }
          return { count };
        }
      ),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, store };
}

function serpFetch(paidDomains: string[]): typeof fetch {
  return (async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      tasks: [
        {
          status_code: 20000,
          result: [
            {
              items: [
                ...paidDomains.map((domain) => ({ type: "paid", domain })),
                { type: "organic", domain: "example.org" },
              ],
            },
          ],
        },
      ],
    }),
  })) as unknown as typeof fetch;
}

describe("deriveAdTrend", () => {
  it("全分支：null / first / new / stopped / active / none", () => {
    expect(deriveAdTrend(null, null)).toBeNull();
    expect(deriveAdTrend(null, 5)).toBeNull();
    expect(deriveAdTrend(5, null)).toBe("first");
    expect(deriveAdTrend(0, null)).toBe("first");
    expect(deriveAdTrend(3, 0)).toBe("new");
    expect(deriveAdTrend(0, 7)).toBe("stopped");
    expect(deriveAdTrend(2, 9)).toBe("active");
    expect(deriveAdTrend(0, 0)).toBe("none");
  });
});

describe("adBandOf", () => {
  it("分档边界：null / 0 / 1–5 / 6–20 / 21–50 / 51+", () => {
    expect(adBandOf(null)).toBeNull();
    expect(adBandOf(0)).toBe("none");
    expect(adBandOf(1)).toBe("small");
    expect(adBandOf(5)).toBe("small");
    expect(adBandOf(6)).toBe("sweet");
    expect(adBandOf(20)).toBe("sweet");
    expect(adBandOf(21)).toBe("hot");
    expect(adBandOf(50)).toBe("hot");
    expect(adBandOf(51)).toBe("redocean");
    expect(adBandOf(300)).toBe("redocean");
  });
});

describe("classifyLandingType", () => {
  it("Amazon：商品页 /dp/、/gp/product/ → product", () => {
    expect(classifyLandingType("https://www.amazon.com/dp/B0C1234567")).toBe(
      "product"
    );
    expect(
      classifyLandingType("https://www.amazon.com/gp/product/B0C1234567")
    ).toBe("product");
    expect(
      classifyLandingType("https://www.amazon.co.uk/Some-Thing/product/B0C1")
    ).toBe("product");
  });

  it("Amazon：旗舰店 /stores/、/shop/、根路径 → home", () => {
    expect(
      classifyLandingType("https://www.amazon.com/stores/Roborock/page/9F3A")
    ).toBe("home");
    expect(classifyLandingType("https://www.amazon.com/shop/roborock")).toBe(
      "home"
    );
    expect(classifyLandingType("https://www.amazon.com/")).toBe("home");
  });

  it("其他站：根路径 → home；/products/、/product、/item、/p/ → product", () => {
    expect(classifyLandingType("https://senix.com/")).toBe("home");
    expect(classifyLandingType("https://senix.com")).toBe("home");
    expect(classifyLandingType("https://senix.com/products/chainsaw-20v")).toBe(
      "product"
    );
    expect(classifyLandingType("https://shop.example.com/product/123")).toBe(
      "product"
    );
    expect(classifyLandingType("https://shop.example.com/item/9")).toBe(
      "product"
    );
    expect(classifyLandingType("https://shop.example.com/p/9")).toBe("product");
  });

  it("判不了 → other（搜索页/关于页/坏 URL/空）", () => {
    expect(classifyLandingType("https://www.amazon.com/s?k=roborock")).toBe(
      "other"
    );
    expect(classifyLandingType("https://senix.com/about-us")).toBe("other");
    expect(classifyLandingType("not a url")).toBe("other");
    expect(classifyLandingType("")).toBe("other");
  });
});

describe("countLandingTypes", () => {
  it("home/product 分别计数，other 不计入", () => {
    const r = countLandingTypes([
      "https://www.amazon.com/dp/B0C1",
      "https://www.amazon.com/stores/X/page/1",
      "https://senix.com/",
      "https://www.amazon.com/s?k=x",
      undefined,
    ]);
    expect(r).toEqual({ home: 2, product: 1 });
  });
});

describe("classifyAds", () => {
  it("品牌域名命中 → self；他域 → others", () => {
    const r = classifyAds("SENIX", [
      { domain: "senix.com" },
      { domain: "www.senix.com" },
      { domain: "review-site.net" },
    ]);
    expect(r).toEqual({ total: 3, self: 2, others: 1 });
  });

  it("品牌名归一化：去空格/符号后匹配", () => {
    const r = classifyAds("Max & Lily", [{ domain: "maxandlily.com" }]);
    // needle = "maxlily"，域名归一化 "maxandlilycom" 不含 "maxlily" 连续片段 → others
    expect(r.total).toBe(1);
    const r2 = classifyAds("MaxLily", [{ domain: "maxlily.com" }]);
    expect(r2.self).toBe(1);
  });

  it("amazon.* 域名不算 self（即使品牌名沾边）", () => {
    const r = classifyAds("Amazon Basics", [
      { domain: "amazon.com" },
      { domain: "www.amazon.co.uk" },
    ]);
    expect(r.self).toBe(0);
    expect(r.others).toBe(2);
  });

  it("空域名算 others，空数组全 0", () => {
    expect(classifyAds("X", [{}, { domain: "" }])).toEqual({
      total: 2,
      self: 0,
      others: 2,
    });
    expect(classifyAds("X", [])).toEqual({ total: 0, self: 0, others: 0 });
  });
});

describe("calcBrandAdCounts", () => {
  const base = (
    over: Partial<FakeProduct> & { id: string }
  ): FakeProduct => ({
    brand: "SENIX",
    countryCode: "US",
    landingPageType: "dtc",
    adCountCheckedAt: null,
    screenVerdict: null,
    status: "active",
    ...over,
  });

  it("凭证缺失 → 抛错（不静默）", async () => {
    const { prisma } = makeFakePrisma([base({ id: "p1" })], false);
    await expect(
      calcBrandAdCounts(prisma, "t1", undefined, { fetchImpl: serpFetch([]) })
    ).rejects.toThrow("DataForSEO credentials not configured");
  });

  it("同品牌同国家只调一次 SERP，结果写回整组", async () => {
    const { prisma, store } = makeFakePrisma([
      base({ id: "p1" }),
      base({ id: "p2" }),
      base({ id: "p3", brand: "Other", countryCode: "DE" }),
    ]);
    const fetchImpl = vi.fn(serpFetch(["senix.com", "ads.example.com"]));
    const r = await calcBrandAdCounts(prisma, "t1", undefined, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // SENIX/US + Other/DE
    expect(r.groupsQueried).toBe(2);
    expect(r.productsUpdated).toBe(3);
    expect(store.get("p1")?.adCount).toBe(2);
    expect(store.get("p1")?.adCountSelf).toBe(1);
    expect(store.get("p1")?.adCountOthers).toBe(1);
    expect(store.get("p2")?.adCount).toBe(2);
    expect(store.get("p1")?.adCountCheckedAt).toBeInstanceOf(Date);
  });

  it("14 天缓存内的组整组跳过，不调 SERP", async () => {
    const recent = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    const { prisma } = makeFakePrisma([
      // 已按明细口径算过（detail 非 null）+ 无可派生探针 → 终局新鲜
      base({
        id: "p1",
        adCountCheckedAt: recent,
        adProbeDetail: [{ q: "SENIX", kind: "bare", paid: 0, shopping: 0, total: 0 }],
      }),
      base({ id: "p2", adCountCheckedAt: null }),
    ]);
    const fetchImpl = vi.fn(serpFetch(["senix.com"]));
    const r = await calcBrandAdCounts(prisma, "t1", undefined, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.groupsSkippedCache).toBe(1);
    expect(r.productsUpdated).toBe(0);
  });

  it("超过 14 天的缓存视为过期 → 重新查询", async () => {
    const stale = new Date(Date.now() - 15 * 24 * 3600 * 1000);
    const { prisma } = makeFakePrisma([
      base({ id: "p1", adCountCheckedAt: stale }),
    ]);
    const fetchImpl = vi.fn(serpFetch(["senix.com"]));
    const r = await calcBrandAdCounts(prisma, "t1", undefined, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r.groupsQueried).toBe(1);
  });

  it("Amazon 落地页组只记 total，self/others 为 null", async () => {
    const { prisma, store } = makeFakePrisma([
      base({ id: "p1", landingPageType: "amazon_product" }),
    ]);
    const r = await calcBrandAdCounts(prisma, "t1", undefined, {
      fetchImpl: serpFetch(["amazon.com", "senix.com"]),
    });
    expect(r.productsUpdated).toBe(1);
    expect(store.get("p1")?.adCount).toBe(2);
    expect(store.get("p1")?.adCountSelf).toBeNull();
    expect(store.get("p1")?.adCountOthers).toBeNull();
  });

  it("productIds 限定范围；brand 为空的商品跳过", async () => {
    const { prisma, store } = makeFakePrisma([
      base({ id: "p1" }),
      base({ id: "p2", brand: "Other" }),
      base({ id: "p3", brand: null }),
    ]);
    const fetchImpl = vi.fn(serpFetch(["senix.com"]));
    const r = await calcBrandAdCounts(prisma, "t1", ["p1", "p3"], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r.productsUpdated).toBe(1);
    expect(store.get("p2")?.adCount).toBeUndefined();
  });

  it("重算时把旧广告数/旧查询时间写入 last* 快照（整组统一）", async () => {
    const stale = new Date(Date.now() - 15 * 24 * 3600 * 1000);
    const { prisma, store } = makeFakePrisma([
      base({ id: "p1", adCount: 5, adCountCheckedAt: stale }),
      base({ id: "p2", adCount: 5, adCountCheckedAt: stale }),
    ]);
    const r = await calcBrandAdCounts(prisma, "t1", undefined, {
      fetchImpl: serpFetch([]),
    });
    expect(r.productsUpdated).toBe(2);
    // 本次查到 0 条 → 新值 0，旧值 5 进快照 → 趋势 = stopped（疑似停投）
    expect(store.get("p1")?.adCount).toBe(0);
    expect(store.get("p1")?.lastAdCount).toBe(5);
    expect(store.get("p1")?.lastAdCountCheckedAt).toBe(stale);
    expect(store.get("p2")?.lastAdCount).toBe(5);
    expect(
      deriveAdTrend(
        store.get("p1")?.adCount ?? null,
        store.get("p1")?.lastAdCount ?? null
      )
    ).toBe("stopped");
  });

  it("首次计算（旧值为空）→ 快照仍为空，趋势 first", async () => {
    const { prisma, store } = makeFakePrisma([base({ id: "p1" })]);
    await calcBrandAdCounts(prisma, "t1", undefined, {
      fetchImpl: serpFetch(["senix.com"]),
    });
    expect(store.get("p1")?.adCount).toBe(1);
    expect(store.get("p1")?.lastAdCount ?? null).toBeNull();
    expect(store.get("p1")?.lastAdCountCheckedAt ?? null).toBeNull();
  });

  it("落地类型拆分写入 adCountHome/adCountProduct（total 不变，other 不计入）", async () => {
    const { prisma, store } = makeFakePrisma([base({ id: "p1" })]);
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        tasks: [
          {
            status_code: 20000,
            result: [
              {
                items: [
                  {
                    type: "paid",
                    domain: "amazon.com",
                    url: "https://www.amazon.com/dp/B0C1234567",
                  },
                  {
                    type: "paid",
                    domain: "amazon.com",
                    url: "https://www.amazon.com/stores/SENIX/page/9F3A",
                  },
                  {
                    type: "paid",
                    domain: "senix.com",
                    url: "https://senix.com/",
                  },
                  {
                    type: "paid",
                    domain: "senix.com",
                    url: "https://senix.com/about-us",
                  },
                ],
              },
            ],
          },
        ],
      }),
    })) as unknown as typeof fetch;
    const r = await calcBrandAdCounts(prisma, "t1", undefined, { fetchImpl });
    expect(r.productsUpdated).toBe(1);
    expect(store.get("p1")?.adCount).toBe(4);
    expect(store.get("p1")?.adCountHome).toBe(2);
    expect(store.get("p1")?.adCountProduct).toBe(1);
  });

  it("单组 SERP 失败不中断其他组，错误记入 errors", async () => {
    const { prisma } = makeFakePrisma([
      base({ id: "p1", brand: "BadBrand" }),
      base({ id: "p2", brand: "SENIX" }),
    ]);
    let call = 0;
    const fetchImpl = (async (url: unknown, init?: { body?: string }) => {
      call += 1;
      const body = String(init?.body ?? "");
      if (body.includes("BadBrand")) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return serpFetch(["senix.com"])(url as never);
    }) as unknown as typeof fetch;
    const r = await calcBrandAdCounts(prisma, "t1", undefined, { fetchImpl });
    expect(call).toBe(2);
    expect(r.groupsQueried).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.brand).toBe("BadBrand");
    expect(r.productsUpdated).toBe(1);
  });

  it("force=true 绕过 14 天缓存：新鲜组也重新查询，groupsSkippedCache 为 0", async () => {
    const recent = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    const { prisma, store } = makeFakePrisma([
      base({ id: "p1", adCount: 1, adCountCheckedAt: recent }),
    ]);
    const fetchImpl = vi.fn(serpFetch(["senix.com", "ads.example.com"]));
    const r = await calcBrandAdCounts(prisma, "t1", undefined, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      force: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r.groupsQueried).toBe(1);
    expect(r.groupsSkippedCache).toBe(0);
    expect(store.get("p1")?.adCount).toBe(2);
    // 强制重算同样把旧值挪进快照（旧 1 → lastAdCount）
    expect(store.get("p1")?.lastAdCount).toBe(1);
  });

  it("aliveOnly：整组判死（kill 或下线）→ 整组跳过、单独计 skippedDeadGroups、不调 SERP", async () => {
    const { prisma } = makeFakePrisma([
      // SENIX 组：一件初筛 kill（仍 active）+ 一件已下线 → 全组皆死
      base({ id: "p1", screenVerdict: "kill" }),
      base({ id: "p2", status: "inactive" }),
      // Other 组：活口径 → 照常查
      base({ id: "p3", brand: "Other", countryCode: "DE" }),
    ]);
    const fetchImpl = vi.fn(serpFetch(["senix.com"]));
    const r = await calcBrandAdCounts(prisma, "t1", undefined, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      aliveOnly: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // 只查 Other 组
    expect(r.groupsQueried).toBe(1);
    expect(r.skippedDeadGroups).toBe(1);
    expect(r.groupsSkippedCache).toBe(0);
    expect(r.productsUpdated).toBe(1);
  });

  it("aliveOnly：死组即使在缓存内也计死组跳过（先于缓存判定）", async () => {
    const recent = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    const { prisma } = makeFakePrisma([
      base({ id: "p1", screenVerdict: "kill", adCountCheckedAt: recent }),
    ]);
    const fetchImpl = vi.fn(serpFetch(["senix.com"]));
    const r = await calcBrandAdCounts(prisma, "t1", undefined, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      aliveOnly: true,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.skippedDeadGroups).toBe(1);
    expect(r.groupsSkippedCache).toBe(0);
  });

  it("aliveOnly：混合组（有活口径商品）照常查，写回覆盖组内死商品", async () => {
    const { prisma, store } = makeFakePrisma([
      base({ id: "p1", screenVerdict: "kill" }),
      base({ id: "p2" }), // 活口径
    ]);
    const fetchImpl = vi.fn(serpFetch(["senix.com", "ads.example.com"]));
    const r = await calcBrandAdCounts(prisma, "t1", undefined, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      aliveOnly: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r.skippedDeadGroups).toBe(0);
    expect(r.productsUpdated).toBe(2);
    // 已经查了，写回不额外花钱：被 kill 的商品也拿到新广告数
    expect(store.get("p1")?.adCount).toBe(2);
    expect(store.get("p2")?.adCount).toBe(2);
  });

  it("aliveOnly 关（默认）：死组照常查询，skippedDeadGroups 为 0", async () => {
    const { prisma } = makeFakePrisma([
      base({ id: "p1", screenVerdict: "kill", status: "inactive" }),
    ]);
    const fetchImpl = vi.fn(serpFetch(["senix.com"]));
    const r = await calcBrandAdCounts(prisma, "t1", undefined, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r.skippedDeadGroups).toBe(0);
  });
});

describe("previewBrandAdCounts", () => {
  const base = (
    over: Partial<FakeProduct> & { id: string }
  ): FakeProduct => ({
    brand: "SENIX",
    countryCode: "US",
    landingPageType: "dtc",
    adCountCheckedAt: null,
    screenVerdict: null,
    status: "active",
    ...over,
  });
  const recent = new Date(Date.now() - 3 * 24 * 3600 * 1000);
  const stale = new Date(Date.now() - 15 * 24 * 3600 * 1000);

  const detailStamp = [{ q: "X", kind: "bare", paid: 0, shopping: 0, total: 0 }];

  function seedFourGroups() {
    return makeFakePrisma(
      [
        // FreshAlive/US：新鲜（已落 detail）+ 活
        base({ id: "a1", brand: "FreshAlive", adCountCheckedAt: recent, adProbeDetail: detailStamp }),
        // StaleAlive/DE：过期 + 活
        base({ id: "b1", brand: "StaleAlive", countryCode: "DE", adCountCheckedAt: stale }),
        // DeadStale/FR：过期 + 整组死（kill）
        base({ id: "c1", brand: "DeadStale", countryCode: "FR", adCountCheckedAt: stale, screenVerdict: "kill" }),
        // DeadFresh/ES：新鲜（已落 detail）+ 整组死（下线）
        base({ id: "d1", brand: "DeadFresh", countryCode: "ES", adCountCheckedAt: recent, status: "inactive", adProbeDetail: detailStamp }),
        // 无品牌商品不入组
        base({ id: "e1", brand: null }),
      ],
      // 预估只读本地库：无凭证也必须能跑（withCreds=false 验证不抛错）
      false
    );
  }

  it("scope=all：总数 = 新鲜 + 过期，死组不单独计；带每组最坏查询数（深度 12）", async () => {
    const { prisma } = seedFourGroups();
    const p = await previewBrandAdCounts(prisma, "t1");
    expect(p).toEqual({
      groupsTotal: 4,
      groupsFresh: 2,
      groupsStale: 2,
      deadGroupsSkipped: 0,
      maxQueriesPerGroup: 12,
    });
  });

  it("aliveOnly：死组单独计（含新鲜死组），新鲜/过期口径不变", async () => {
    const { prisma } = seedFourGroups();
    const p = await previewBrandAdCounts(prisma, "t1", { aliveOnly: true });
    expect(p).toEqual({
      groupsTotal: 4,
      groupsFresh: 2,
      groupsStale: 2,
      deadGroupsSkipped: 2,
      maxQueriesPerGroup: 12,
    });
  });

  it("从未查过的组算过期（stale）", async () => {
    const { prisma } = makeFakePrisma([base({ id: "p1" })], false);
    const p = await previewBrandAdCounts(prisma, "t1", {});
    expect(p.groupsTotal).toBe(1);
    expect(p.groupsStale).toBe(1);
    expect(p.groupsFresh).toBe(0);
  });
});

/* ── 多探针口径（2026-10-21）：tallySerpAds / 探针派生 / 政策风险 / 地板 / 新鲜度 ── */

describe("tallySerpAds（文字广告＋购物广告统一计数）", () => {
  it("paid 条数 + shopping 块内 shopping_element 条数；organic/其他类型不计", () => {
    const t = tallySerpAds([
      { type: "paid", domain: "senix.com", url: "https://senix.com/" },
      { type: "paid", domain: "ads.example.com", url: "https://ads.example.com/x" },
      {
        type: "shopping",
        items: [
          { type: "shopping_element", url: "https://www.google.com/shopping/1" },
          { type: "shopping_element", url: "https://www.google.com/shopping/2" },
          { type: "shopping_element", url: "https://www.google.com/shopping/3" },
          // 块内非 shopping_element 不计
          { type: "shopping_seller", url: "https://example.com/seller" },
        ],
      },
      { type: "organic", domain: "example.org", url: "https://example.org/" },
      { type: "people_also_ask", items: [{ type: "paid", domain: "trap.example.com" }] },
      { type: "shopping" }, // 无 items 的购物块 → 0
    ]);
    expect(t.shoppingCount).toBe(3);
    expect(t.paidAds).toHaveLength(2);
    expect(t.total).toBe(5);
  });

  it("空 SERP → 全 0", () => {
    expect(tallySerpAds([])).toEqual({ paidAds: [], shoppingCount: 0, total: 0 });
  });
});

describe("modelTokensOf / deriveLongtailProbes（长尾探针派生 v2）", () => {
  it("型号 token = 同 token 内字母+数字相邻；纯数字/纯字母不算", () => {
    expect(modelTokensOf("Roborock S8 Pro Ultra")).toEqual(["s8"]);
    expect(modelTokensOf("Robot Vacuum 3000 Pro")).toEqual([]);
    expect(modelTokensOf("X40 Ultra 2in1 Kit")).toEqual(["x40", "2in1"]);
    // "Baton 4"：4 是独立纯数字 token，不算型号（与 keyword-marks 同口径）
    expect(modelTokensOf("OLIGHT Baton 4 Mini")).toEqual([]);
  });

  it("逐件按排序抽型号：第一件的型号先入队，后件的不同型号续入队", () => {
    const probes = deriveLongtailProbes("Roborock", [
      { name: "Roborock Q7 Max", recommendationScore: 80, reviewCount: 50 },
      { name: "Roborock S8 Pro", recommendationScore: 90, reviewCount: 100 },
      { name: "Roborock Dock", recommendationScore: 70, reviewCount: 10 },
    ]);
    expect(probes).toEqual([
      { q: "Roborock s8", kind: "model" },
      { q: "Roborock q7", kind: "model" },
    ]);
  });

  it("型号探针不足 4 条 → 补 1 条类目探针；无型号有类目 → 类目作唯一探针", () => {
    expect(
      deriveLongtailProbes("Roborock", [
        {
          name: "Roborock S8 Pro",
          recommendationScore: 90,
          reviewCount: 100,
          category: "Robot Vacuums",
        },
      ])
    ).toEqual([
      { q: "Roborock s8", kind: "model" },
      { q: "Roborock Robot Vacuums", kind: "category" },
    ]);
    expect(
      deriveLongtailProbes("SENIX", [
        {
          name: "Cordless Chainsaw",
          recommendationScore: 90,
          reviewCount: 100,
          category: "Chainsaws",
        },
      ])
    ).toEqual([{ q: "SENIX Chainsaws", kind: "category" }]);
  });

  it("型号探针 ≥4 条 → 不补类目探针", () => {
    const probes = deriveLongtailProbes("Roborock", [
      { name: "Roborock S8", recommendationScore: 90, reviewCount: 1, category: "Robot Vacuums" },
      { name: "Roborock Q7", recommendationScore: 80, reviewCount: 1 },
      { name: "Roborock X40", recommendationScore: 70, reviewCount: 1 },
      { name: "Roborock Z1", recommendationScore: 60, reviewCount: 1 },
    ]);
    expect(probes).toHaveLength(4);
    expect(probes.every((p) => p.kind === "model")).toBe(true);
  });

  it("无型号无类目 → 无探针（空数组，adCountLongtail 终局为 null）", () => {
    expect(
      deriveLongtailProbes("SENIX", [
        { name: "Cordless Chainsaw", recommendationScore: 90, reviewCount: 100 },
      ])
    ).toEqual([]);
    expect(
      deriveLongtailProbes("", [{ name: "X9", recommendationScore: 1, reviewCount: 1 }])
    ).toEqual([]);
  });

  it("粘连型号双形态：baton4 原文 + baton 4 带空格各入队一条（都算 model、都占预算）", () => {
    const probes = deriveLongtailProbes("OLIGHT", [
      { name: "OLIGHT Baton4 Pro", recommendationScore: 90, reviewCount: 10 },
    ]);
    expect(probes).toEqual([
      { q: "OLIGHT baton4", kind: "model" },
      { q: "OLIGHT baton 4", kind: "model" },
    ]);
  });

  it("非粘连型号（字母段 <2，如 s8）只有原文一条，不拆空格形态", () => {
    expect(modelCandidatesOf("Roborock S8 Pro", "Roborock")).toEqual([
      { token: "s8", spaced: null },
    ]);
    expect(modelCandidatesOf("OLIGHT Baton4 Pro", "OLIGHT")).toEqual([
      { token: "baton4", spaced: "baton 4" },
    ]);
  });

  it("纯数字型号：3–4 位纯数字 token 紧跟品牌 token 之后才算（Anker 737）", () => {
    expect(modelCandidatesOf("Anker 737 PowerBank", "Anker")).toEqual([
      { token: "737", spaced: null },
    ]);
    expect(
      deriveLongtailProbes("Anker", [
        { name: "Anker 737 PowerBank", recommendationScore: 90, reviewCount: 5 },
      ])
    ).toEqual([{ q: "Anker 737", kind: "model" }]);
    // 数字不在品牌之后（或位数不对）→ 不算型号
    expect(modelCandidatesOf("Anker PowerBank 737", "Anker")).toEqual([]);
    expect(modelCandidatesOf("Anker 73 PowerBank", "Anker")).toEqual([]);
    expect(modelCandidatesOf("Anker 73700 PowerBank", "Anker")).toEqual([]);
  });

  it("同一型号多件商品只入队一次（两种形态各一次）", () => {
    const probes = deriveLongtailProbes("OLIGHT", [
      { name: "OLIGHT Baton4", recommendationScore: 90, reviewCount: 1 },
      { name: "OLIGHT Baton4 Premium", recommendationScore: 80, reviewCount: 1 },
      { name: "OLIGHT Baton4 Mini", recommendationScore: 70, reviewCount: 1 },
    ]);
    expect(probes).toEqual([
      { q: "OLIGHT baton4", kind: "model" },
      { q: "OLIGHT baton 4", kind: "model" },
    ]);
  });

  it("预算上限：长尾最多 11 条（总查询 ≤12），型号再多也截断且不重复", () => {
    expect(MAX_QUERIES_PER_GROUP).toBe(12);
    expect(MAX_LONGTAIL_PROBES).toBe(11);
    const products = Array.from({ length: 8 }, (_, i) => ({
      name: `BrandX AB${100 + i} Tool`,
      recommendationScore: 100 - i,
      reviewCount: 1,
    }));
    const probes = deriveLongtailProbes("BrandX", products);
    // 每件 1 个粘连型号 × 2 形态 = 16 个候选 → 截到 11
    expect(probes).toHaveLength(11);
    expect(new Set(probes.map((p) => p.q)).size).toBe(11);
    expect(probes[0]).toEqual({ q: "BrandX ab100", kind: "model" });
    expect(probes[1]).toEqual({ q: "BrandX ab 100", kind: "model" });
  });

  it("extractProductCategory：路径取最后一段、长度 2–40、无字段为 null", () => {
    expect(extractProductCategory({ category: "Tools > Outdoor > Chainsaws" })).toBe("Chainsaws");
    expect(extractProductCategory('{"category":"Flashlights"}')).toBe("Flashlights");
    expect(extractProductCategory({})).toBeNull();
    expect(extractProductCategory(null)).toBeNull();
    expect(extractProductCategory({ category: "A" })).toBeNull();
  });
});

describe("政策风险模式（武器配件类）", () => {
  it("命中：weapon light / gun light / 枪灯 / 武器灯等确定性表述", () => {
    expect(hasAdPolicyRisk("OLIGHT Baldr Pro R Weapon Light")).toBe(true);
    expect(hasAdPolicyRisk("Tactical Gun Light for Pistol")).toBe(true);
    expect(hasAdPolicyRisk("某某品牌 枪灯 户外")).toBe(true);
    expect(hasAdPolicyRisk("战术武器灯")).toBe(true);
    expect(hasAdPolicyRisk("Weapon-Mounted Light")).toBe(true);
  });

  it("误伤防护：普通 tactical / EDC 手电不得命中", () => {
    expect(hasAdPolicyRisk("Tactical Flashlight 1000 Lumens")).toBe(false);
    expect(hasAdPolicyRisk("EDC Flashlight Rechargeable")).toBe(false);
    expect(hasAdPolicyRisk("OLIGHT Arkfeld Pro Flat EDC Flashlight")).toBe(false);
    expect(hasAdPolicyRisk("OLIGHT Baton 4 Premium Edition")).toBe(false);
  });

  it("组级：Top5 任一命中 → true；命中只在第 6 件 → false", () => {
    const mk = (name: string, score: number) => ({
      name,
      recommendationScore: score,
      reviewCount: 10,
    });
    expect(
      groupAdPolicyRisk([
        mk("Plain Light A", 90),
        mk("Streamlight Weapon Light", 80),
        mk("Plain Light B", 70),
      ])
    ).toBe(true);
    expect(
      groupAdPolicyRisk([
        mk("P1", 95),
        mk("P2", 94),
        mk("P3", 93),
        mk("P4", 92),
        mk("P5", 91),
        mk("Streamlight Weapon Light", 10),
      ])
    ).toBe(false);
  });
});

describe("adBandOf 长尾地板", () => {
  it("裸词 none/未算 + 长尾 ≥1 → small；其余情形不抬档", () => {
    expect(adBandOf(0, 3)).toBe("small");
    expect(adBandOf(null, 2)).toBe("small");
    expect(adBandOf(0, 0)).toBe("none");
    expect(adBandOf(0, null)).toBe("none");
    expect(adBandOf(null, 0)).toBeNull();
    expect(adBandOf(null, null)).toBeNull();
    expect(adBandOf(10, 1)).toBe("sweet");
    expect(adBandOf(30, 5)).toBe("hot");
  });
});

describe("calcBrandAdCounts 多探针", () => {
  const base = (
    over: Partial<FakeProduct> & { id: string }
  ): FakeProduct => ({
    brand: "SENIX",
    countryCode: "US",
    landingPageType: "dtc",
    adCountCheckedAt: null,
    screenVerdict: null,
    status: "active",
    ...over,
  });

  /** 按 keyword 返回不同 SERP items 的 fake fetch（探针各自计数用）。 */
  function serpFetchByKeyword(
    map: Record<string, Array<Record<string, unknown>>>
  ): typeof fetch {
    return (async (_url: unknown, init: { body: string }) => {
      const body = JSON.parse(init.body) as Array<{ keyword: string }>;
      const kw = body[0]?.keyword ?? "";
      return {
        ok: true,
        status: 200,
        json: async () => ({
          tasks: [
            {
              status_code: 20000,
              result: [{ items: map[kw] ?? [] }],
            },
          ],
        }),
      };
    }) as unknown as typeof fetch;
  }
  const paid = (domain: string) => ({
    type: "paid",
    domain,
    url: `https://${domain}/`,
  });
  const shoppingBlock = (n: number) => ({
    type: "shopping",
    items: Array.from({ length: n }, (_, i) => ({
      type: "shopping_element",
      url: `https://www.google.com/shopping/${i}`,
    })),
  });

  it("裸词总数含购物广告；self/others 拆分只看 paid 条目", async () => {
    const { prisma, store } = makeFakePrisma([base({ id: "p1" })]);
    const fetchImpl = serpFetchByKeyword({
      SENIX: [
        paid("senix.com"),
        shoppingBlock(2),
        { type: "organic", domain: "example.org" },
      ],
    });
    const r = await calcBrandAdCounts(prisma, "t1", undefined, { fetchImpl });
    expect(r.groupsQueried).toBe(1);
    expect(r.serpQueries).toBe(1);
    expect(store.get("p1")?.adCount).toBe(3); // 1 paid + 2 shopping
    expect(store.get("p1")?.adCountSelf).toBe(1);
    expect(store.get("p1")?.adCountOthers).toBe(0);
    // 无型号/类目 → 无长尾探针 → adCountLongtail 写 null（终局）
    expect(store.get("p1")?.adCountLongtail).toBeNull();
    // 明细：只跑了裸词一条，逐条入 detail（paid/shopping 分开记）
    expect(store.get("p1")?.adProbeDetail).toEqual([
      { q: "SENIX", kind: "bare", paid: 1, shopping: 2, total: 3 },
    ]);
  });

  it("长尾探针各自计数取 MAX（含购物口径），写回整组；serpQueries 按实际查询记", async () => {
    const { prisma, store } = makeFakePrisma([
      base({
        id: "p1",
        brand: "Roborock",
        name: "Roborock S8 Pro Ultra",
        recommendationScore: 90,
        reviewCount: 100,
      }),
      base({
        id: "p2",
        brand: "Roborock",
        name: "Roborock Q7 Max",
        recommendationScore: 80,
        reviewCount: 50,
      }),
    ]);
    const fetchImpl = serpFetchByKeyword({
      Roborock: [],
      "Roborock s8": [paid("a.example.com"), paid("b.example.com")],
      "Roborock q7": [
        paid("a.example.com"),
        paid("b.example.com"),
        paid("c.example.com"),
        paid("d.example.com"),
        shoppingBlock(1),
      ],
    });
    const r = await calcBrandAdCounts(prisma, "t1", undefined, { fetchImpl });
    expect(r.groupsQueried).toBe(1);
    expect(r.serpQueries).toBe(3); // 裸词 + 2 探针
    expect(r.productsUpdated).toBe(2);
    expect(store.get("p1")?.adCount).toBe(0);
    expect(store.get("p1")?.adCountLongtail).toBe(5); // MAX(2, 4 paid + 1 shopping)
    expect(store.get("p2")?.adCountLongtail).toBe(5);
    expect(store.get("p1")?.adPolicyRisk).toBe(false);
    // 明细逐条回写整组：裸词 + 每条长尾探针（q/kind/paid/shopping/total）
    const expectedDetail = [
      { q: "Roborock", kind: "bare", paid: 0, shopping: 0, total: 0 },
      { q: "Roborock s8", kind: "model", paid: 2, shopping: 0, total: 2 },
      { q: "Roborock q7", kind: "model", paid: 4, shopping: 1, total: 5 },
    ];
    expect(store.get("p1")?.adProbeDetail).toEqual(expectedDetail);
    expect(store.get("p2")?.adProbeDetail).toEqual(expectedDetail);
  });

  it("粘连双形态在 calc 层各查一次：detail 两条都在、记账按实际查询数", async () => {
    const { prisma, store } = makeFakePrisma([
      base({
        id: "p1",
        brand: "OLIGHT",
        name: "OLIGHT Baton4 Pro",
        recommendationScore: 90,
        reviewCount: 10,
      }),
    ]);
    const fetchImpl = serpFetchByKeyword({
      OLIGHT: [paid("olight.com"), shoppingBlock(1)],
      "OLIGHT baton4": [paid("a.example.com"), paid("b.example.com")],
      "OLIGHT baton 4": [shoppingBlock(3)],
    });
    const r = await calcBrandAdCounts(prisma, "t1", undefined, { fetchImpl });
    expect(r.serpQueries).toBe(3); // 裸词 + 粘连 + 带空格
    expect(store.get("p1")?.adCountLongtail).toBe(3); // MAX(2, 3)
    expect(store.get("p1")?.adProbeDetail).toEqual([
      { q: "OLIGHT", kind: "bare", paid: 1, shopping: 1, total: 2 },
      { q: "OLIGHT baton4", kind: "model", paid: 2, shopping: 0, total: 2 },
      { q: "OLIGHT baton 4", kind: "model", paid: 0, shopping: 3, total: 3 },
    ]);
  });

  it("深度上限：型号再多每组总查询 ≤12（裸词 1 + 长尾 11），detail 与记账一致", async () => {
    const products = Array.from({ length: 8 }, (_, i) =>
      base({
        id: `p${i}`,
        brand: "BrandX",
        name: `BrandX AB${100 + i} Tool`,
        recommendationScore: 100 - i,
        reviewCount: 1,
      })
    );
    const { prisma, store } = makeFakePrisma(products);
    const fetchImpl = vi.fn(serpFetchByKeyword({}));
    const r = await calcBrandAdCounts(prisma, "t1", undefined, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(12);
    expect(r.serpQueries).toBe(12);
    const detail = store.get("p0")?.adProbeDetail as Array<unknown>;
    expect(detail).toHaveLength(12); // 裸词 1 + 长尾 11
  });

  it("政策风险组：Top 商品名命中武器灯 → 整组 adPolicyRisk=true 写回", async () => {
    const { prisma, store } = makeFakePrisma([
      base({
        id: "p1",
        brand: "OLIGHT",
        name: "OLIGHT Baldr Pro Weapon Light",
        recommendationScore: 90,
        reviewCount: 10,
      }),
    ]);
    const fetchImpl = serpFetchByKeyword({ OLIGHT: [] });
    await calcBrandAdCounts(prisma, "t1", undefined, { fetchImpl });
    expect(store.get("p1")?.adPolicyRisk).toBe(true);
  });

  it("新鲜度：checkedAt 新鲜但长尾未探（旧印记）且有型号 → 必须重探；无探针组照常跳过", async () => {
    const recent = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    const { prisma, store } = makeFakePrisma([
      // OldBrand：广告数 3 天前查过，但 adCountLongtail 从未写过 + 有型号 → 过期
      base({
        id: "p1",
        brand: "OldBrand",
        name: "OldBrand X9 Tool",
        adCount: 4,
        adCountCheckedAt: recent,
      }),
      // PlainBrand：已按明细口径算过（detail 非 null）且派生不出探针 → 终局，算新鲜跳过
      base({
        id: "p2",
        brand: "PlainBrand",
        name: "Plain Towel Set",
        adCount: 2,
        adCountCheckedAt: recent,
        adProbeDetail: [
          { q: "PlainBrand", kind: "bare", paid: 2, shopping: 0, total: 2 },
        ],
      }),
    ]);
    const fetchImpl = vi.fn(
      serpFetchByKeyword({
        OldBrand: [paid("oldbrand.com")],
        "OldBrand x9": [paid("a.example.com"), paid("b.example.com")],
      })
    );
    const r = await calcBrandAdCounts(prisma, "t1", undefined, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.groupsQueried).toBe(1);
    expect(r.groupsSkippedCache).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // OldBrand 裸词 + 1 探针
    expect(store.get("p1")?.adCountLongtail).toBe(2);
    expect(store.get("p2")?.adCount).toBe(2); // 未被触碰
  });

  it("preview 新鲜度与 calc 同口径：旧印记 + 有型号 = stale；无探针/已探 = fresh", async () => {
    const recent = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    const detail = [{ q: "X", kind: "bare", paid: 0, shopping: 0, total: 0 }];
    const { prisma } = makeFakePrisma(
      [
        base({
          id: "p1",
          brand: "OldBrand",
          name: "OldBrand X9 Tool",
          adCountCheckedAt: recent,
        }),
        base({
          id: "p2",
          brand: "PlainBrand",
          name: "Plain Towel Set",
          adCountCheckedAt: recent,
          adProbeDetail: detail,
        }),
        base({
          id: "p3",
          brand: "DoneBrand",
          name: "DoneBrand Z1 Tool",
          adCountCheckedAt: recent,
          adCountLongtail: 3,
          adProbeDetail: detail,
        }),
      ],
      false
    );
    const p = await previewBrandAdCounts(prisma, "t1", {});
    expect(p.groupsTotal).toBe(3);
    expect(p.groupsStale).toBe(1);
    expect(p.groupsFresh).toBe(2);
  });

  it("新鲜度：长尾已探过但 detail 缺失（明细上线前印记）→ 视为待重探（stale）", async () => {
    const recent = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    const { prisma } = makeFakePrisma(
      [
        base({
          id: "p1",
          brand: "LegacyBrand",
          name: "LegacyBrand Z1 Tool",
          adCountCheckedAt: recent,
          adCountLongtail: 3,
          // adProbeDetail 缺失 = 探针明细上线前算的
        }),
      ],
      false
    );
    const p = await previewBrandAdCounts(prisma, "t1", {});
    expect(p.groupsStale).toBe(1);
    expect(p.groupsFresh).toBe(0);
  });
});
