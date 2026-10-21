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
  previewBrandAdCounts,
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
  lastAdCount?: number | null;
  lastAdCountCheckedAt?: Date | null;
  screenVerdict?: string | null;
  status?: string;
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
      base({ id: "p1", adCountCheckedAt: recent }),
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

  function seedFourGroups() {
    return makeFakePrisma(
      [
        // FreshAlive/US：新鲜 + 活
        base({ id: "a1", brand: "FreshAlive", adCountCheckedAt: recent }),
        // StaleAlive/DE：过期 + 活
        base({ id: "b1", brand: "StaleAlive", countryCode: "DE", adCountCheckedAt: stale }),
        // DeadStale/FR：过期 + 整组死（kill）
        base({ id: "c1", brand: "DeadStale", countryCode: "FR", adCountCheckedAt: stale, screenVerdict: "kill" }),
        // DeadFresh/ES：新鲜 + 整组死（下线）
        base({ id: "d1", brand: "DeadFresh", countryCode: "ES", adCountCheckedAt: recent, status: "inactive" }),
        // 无品牌商品不入组
        base({ id: "e1", brand: null }),
      ],
      // 预估只读本地库：无凭证也必须能跑（withCreds=false 验证不抛错）
      false
    );
  }

  it("scope=all：总数 = 新鲜 + 过期，死组不单独计", async () => {
    const { prisma } = seedFourGroups();
    const p = await previewBrandAdCounts(prisma, "t1");
    expect(p).toEqual({
      groupsTotal: 4,
      groupsFresh: 2,
      groupsStale: 2,
      deadGroupsSkipped: 0,
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
