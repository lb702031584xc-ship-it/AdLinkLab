/**
 * 广告投放数量服务单测：classifyAds 纯函数分类 + calcBrandAdCounts 的
 * 分组/14 天缓存/Amazon 只记 total/凭证缺失抛错/单组失败不中断。
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@adlinklab/database";
import { encryptSecret, TEST_AI_SETTINGS_PEPPER } from "../ai/crypto.js";
import { classifyAds, calcBrandAdCounts } from "./brand-ad-count.js";

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
});
