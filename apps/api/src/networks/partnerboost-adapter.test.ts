/**
 * Network API framework — PartnerBoost adapter unit tests (mock fetch, no network).
 */
import { describe, expect, it, vi } from "vitest";
import {
  PARTNERBOOST_DEFAULT_BASE_URL,
  PartnerBoostAdapter,
  NetworkAdapterError,
  datafeedExternalId,
} from "./partnerboost-adapter.js";
import type { AdapterContext } from "./types.js";

function ctxWith(
  fetchImpl: typeof fetch,
apiKey=<redacted>"test-channel-token"
): AdapterContext {
  return {
    apiKey,
    apiBaseUrl: "https://app.partnerboost.test",
    tenantId: "tenant-1",
    fetchImpl,
    ssrfCheck: async () => {},
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    product_id: "prod-1",
    product_name: "Test Headphones",
    asin: "B0TEST1234",
    commission: "12%",
    category: "Electronics",
    brand_name: "TestBrand",
    url: "https://www.amazon.com/dp/B0TEST1234",
    currency: "USD",
    ...overrides,
  };
}

function listResponse(
  list: unknown[],
  hasMore = false,
  code = 0,
  msg = "success"
) {
  return { status: { code, msg }, data: { list, has_more: hasMore } };
}

describe("PartnerBoostAdapter.pullOffers", () => {
  it("maps products to NetworkOffer with commission parsed", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(listResponse([product()]))
    ) as unknown as typeof fetch;
    const adapter = new PartnerBoostAdapter();
    const offers = await adapter.pullOffers(ctxWith(fetchImpl));

    expect(offers).toHaveLength(1);
    expect(offers[0].externalId).toBe("prod-1");
    expect(offers[0].name).toBe("Test Headphones");
    expect(offers[0].payout).toBe(12);
    expect(offers[0].url).toBe("https://www.amazon.com/dp/B0TEST1234");
    // token sent in JSON body
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string).token).toBe(
      "test-channel-token"
    );
  });

  it("maps brand/asin/price/reviewCount from datafeed fields", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        listResponse([
          product({
            product_id: "62837599",
            brand_name: "Midea WMT",
            discount_price: "$105.99",
            original_price: "$129.99",
            reviews: "96",
            currency: "USD",
          }),
        ])
      )
    ) as unknown as typeof fetch;
    const adapter = new PartnerBoostAdapter();
    const offers = await adapter.pullOffers(ctxWith(fetchImpl));

    expect(offers).toHaveLength(1);
    expect(offers[0].brand).toBe("Midea WMT");
    expect(offers[0].asin).toBe("B0TEST1234");
    expect(offers[0].price).toBe(105.99);
    expect(offers[0].priceCurrency).toBe("USD");
    expect(offers[0].reviewCount).toBe(96);
  });

  it("falls back to original_price when discount_price missing; null when unparseable", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        listResponse([
          product({ product_id: "p1", original_price: "23.99", reviews: 489 }),
          product({
            product_id: "p2",
            original_price: "n/a",
            reviews: "unknown",
          }),
        ])
      )
    ) as unknown as typeof fetch;
    const adapter = new PartnerBoostAdapter();
    const offers = await adapter.pullOffers(ctxWith(fetchImpl));

    expect(offers[0].price).toBe(23.99);
    expect(offers[0].reviewCount).toBe(489);
    expect(offers[1].price).toBeNull();
    expect(offers[1].reviewCount).toBeNull();
  });

  it("paginates while has_more is true", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const page = JSON.parse((init?.body as string) ?? "{}").page ?? 1;
      return jsonResponse(
        listResponse([product({ product_id: `p${page}` })], page < 2)
      );
    }) as unknown as typeof fetch;
    const adapter = new PartnerBoostAdapter();
    const offers = await adapter.pullOffers(ctxWith(fetchImpl), {
      maxPages: 5,
    });
    expect(offers).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws BAD_CREDENTIALS on empty token", async () => {
    const adapter = new PartnerBoostAdapter();
    await expect(
      adapter.pullOffers(ctxWith(async () => jsonResponse({}) as Response, ""))
    ).rejects.toMatchObject({ code: "BAD_CREDENTIALS" });
  });

  it("throws API_ERROR when status.code != 0", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(listResponse([], false, 1001, "invalid token"))
    ) as unknown as typeof fetch;
    const adapter = new PartnerBoostAdapter();
    await expect(adapter.pullOffers(ctxWith(fetchImpl))).rejects.toMatchObject(
      { code: "API_ERROR" }
    );
  });

  it("throws HTTP_ERROR on non-2xx", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, 500)
    ) as unknown as typeof fetch;
    const adapter = new PartnerBoostAdapter();
    await expect(adapter.pullOffers(ctxWith(fetchImpl))).rejects.toMatchObject(
      { code: "HTTP_ERROR", status: 500 }
    );
  });
});

describe("PartnerBoostAdapter.generateLinks", () => {
  it("returns ASIN -> link map", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        status: { code: 0, msg: "success" },
        data: [
          { asin: "B0TEST1234", link: "https://amzn.to/x1" },
          { asin: "B0TEST5678", partnerboost_link: "https://pb.link/y2" },
        ],
      })
    ) as unknown as typeof fetch;
    const adapter = new PartnerBoostAdapter();
    const out = await adapter.generateLinks(ctxWith(fetchImpl), [
      "B0TEST1234",
      "B0TEST5678",
    ]);
    expect(out["B0TEST1234"]).toBe("https://amzn.to/x1");
    expect(out["B0TEST5678"]).toBe("https://pb.link/y2");
  });

  it("batches more than 50 ASINs", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ status: { code: 0 }, data: [] })
    ) as unknown as typeof fetch;
    const adapter = new PartnerBoostAdapter();
    const asins = Array.from({ length: 120 }, (_, i) => `B0ASIN${i}`);
    await adapter.generateLinks(ctxWith(fetchImpl), asins);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 50 + 50 + 20
  });
});

describe("adapter metadata", () => {
  it("has kind partnerboost", () => {
    expect(new PartnerBoostAdapter().kind).toBe("partnerboost");
  });

  it("base URL constant", () => {
    expect(PARTNERBOOST_DEFAULT_BASE_URL).toBe("https://app.partnerboost.com");
  });
});

describe("endpoint fallback", () => {
  it("falls back to api.php style when REST path 404s", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("/api/datafeed/")) {
        return jsonResponse({}, 404);
      }
      return jsonResponse(listResponse([product()]));
    }) as unknown as typeof fetch;
    const adapter = new PartnerBoostAdapter();
    const offers = await adapter.pullOffers(ctxWith(fetchImpl));
    expect(offers).toHaveLength(1);
    expect(calls[0]).toContain("/api/datafeed/get_fba_products");
    expect(calls[1]).toContain("api.php?mod=datafeed&op=get_fba_products");
  });

  it("throws helpful 404 when all candidates fail", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, 404)
    ) as unknown as typeof fetch;
    const adapter = new PartnerBoostAdapter();
    await expect(adapter.pullOffers(ctxWith(fetchImpl))).rejects.toMatchObject(
      { code: "HTTP_ERROR", status: 404 }
    );
  });
});

describe("baseUrl normalization", () => {
  it("strips trailing slashes to avoid double-slash 404", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      return jsonResponse(listResponse([product()]));
    }) as unknown as typeof fetch;
    const adapter = new PartnerBoostAdapter();
    const ctx = ctxWith(fetchImpl);
    ctx.apiBaseUrl = "https://app.partnerboost.com/";
    await adapter.pullOffers(ctx);
    expect(calls[0]).toBe(
      "https://app.partnerboost.com/api/datafeed/get_fba_products"
    );
    expect(calls[0]).not.toContain("//api/");
  });
});

/* ── Datafeed 通用 list（第二数据源：DTC + Walmart） ── */

function dfProduct(overrides: Record<string, unknown> = {}) {
  return {
    name: "Example T-Shirt",
    description: "Soft tee",
    brand_id: 66303,
    mcid: "ulike0",
    merchant_name: "Ulike Official",
    url: "https://ulike.example.com/products/tee",
    image: "https://img.example.com/tee.jpg",
    sku: "SKU12345",
    category: "Apparel",
    price: "29.99",
    currency: "USD",
    old_price: "49.99",
    brand: "Ulike",
    availability: "in stock",
    gtin: "0012345678905",
    mpn: "MPN-1",
    creative_id: 777,
    tracking_url: "https://partnerboost.com/track/tee",
    tracking_url_short: "https://pb.short/tee",
    tracking_url_smart: "https://partnerboost.com/smart/tee",
    updated_at: 1760000000,
    ...overrides,
  };
}

function dfResponse(list: unknown[], code = 0, msg = "Success") {
  // 文档口径：data 直接是商品数组。
  return { status: { code, msg }, data: list };
}

type DfHandler = (
  brandType: string,
  page: number,
  body: Record<string, unknown>
) => unknown;

/** 按请求体 brand_type/page 路由的 mock fetch（只服务 op=list 的 REST 候选）。 */
function dfFetch(handler: DfHandler) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? "{}") as Record<
      string,
      unknown
    >;
    calls.push({ url, body });
    return jsonResponse(
      handler(String(body.brand_type), Number(body.page ?? 1), body)
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("PartnerBoostAdapter.pullDatafeedOffers", () => {
  it("fetches DTC + Walmart, paginating until a short page", async () => {
    const { fetchImpl, calls } = dfFetch((brandType, page) => {
      if (brandType === "DTC") {
        return page === 1
          ? dfResponse([
              dfProduct({ sku: "D1" }),
              dfProduct({ sku: "D2", name: "DTC Two" }),
            ])
          : dfResponse([dfProduct({ sku: "D3", name: "DTC Three" })]);
      }
      return dfResponse([
        dfProduct({
          sku: "W1",
          name: "Walmart One",
          url: "https://www.walmart.com/ip/W1",
        }),
      ]);
    });
    const adapter = new PartnerBoostAdapter();
    const offers = await adapter.pullDatafeedOffers(ctxWith(fetchImpl), {
      limit: 2,
    });
    // DTC 两页（2 + 1，短页终止）+ Walmart 一页（1 < limit 直接终止）
    expect(offers).toHaveLength(4);
    expect(calls.map((c) => [c.body.brand_type, c.body.page])).toEqual([
      ["DTC", 1],
      ["DTC", 2],
      ["Walmart", 1],
    ]);
    expect(calls[0].body.limit).toBe(2);
    expect(calls[0].body.token).toBe("test-channel-token");
    // 第一候选 = REST 风格路径
    expect(calls[0].url).toBe(
      "https://app.partnerboost.test/api/datafeed/list"
    );
    const byType = (bt: string) =>
      offers.filter((o) => o.rawData.brand_type === bt);
    expect(byType("DTC")).toHaveLength(3);
    expect(byType("Walmart")).toHaveLength(1);
  });

  it("maps fields: externalId/brand/price/promoUrl priority/rawData provenance", async () => {
    const { fetchImpl } = dfFetch(() => dfResponse([dfProduct()]));
    const adapter = new PartnerBoostAdapter();
    const offers = await adapter.pullDatafeedOffers(ctxWith(fetchImpl), {
      brandTypes: ["DTC"],
    });
    expect(offers).toHaveLength(1);
    const o = offers[0];
    expect(o.externalId).toBe("df:66303:SKU12345");
    expect(o.name).toBe("Example T-Shirt");
    expect(o.brand).toBe("Ulike");
    expect(o.price).toBe(29.99);
    expect(o.priceCurrency).toBe("USD");
    expect(o.asin).toBe("SKU12345");
    // promoUrl 优先级：smart > tracking > short > 原始 url
    expect(o.url).toBe("https://partnerboost.com/smart/tee");
    // 落地页类型按原始商品链接判：品牌独立站 → dtc
    expect(o.landingPageType).toBe("dtc");
    // list 接口无国家/无佣金 → null，不编造
    expect(o.countryCode).toBeNull();
    expect(o.payout).toBeNull();
    expect(o.currency).toBeNull();
    // rawData 带溯源字段（brand_type 为注入值，其余随原始对象保留）
    expect(o.rawData.brand_type).toBe("DTC");
    expect(o.rawData.source_feed).toBe("datafeed_list");
    expect(o.rawData.mcid).toBe("ulike0");
    expect(o.rawData.merchant_name).toBe("Ulike Official");
    expect(o.rawData.gtin).toBe("0012345678905");
    expect(o.rawData.mpn).toBe("MPN-1");
    expect(o.rawData.brand_id).toBe(66303);
    expect(o.rawData.availability).toBe("in stock");
  });

  it("promoUrl falls back smart → tracking → short → product url", async () => {
    const { fetchImpl } = dfFetch(() =>
      dfResponse([
        dfProduct({ sku: "A", tracking_url_smart: "" }),
        dfProduct({ sku: "B", tracking_url_smart: "", tracking_url: "" }),
        dfProduct({
          sku: "C",
          tracking_url_smart: "",
          tracking_url: "",
          tracking_url_short: "",
        }),
      ])
    );
    const adapter = new PartnerBoostAdapter();
    const offers = await adapter.pullDatafeedOffers(ctxWith(fetchImpl), {
      brandTypes: ["DTC"],
    });
    expect(offers.map((o) => o.url)).toEqual([
      "https://partnerboost.com/track/tee",
      "https://pb.short/tee",
      "https://ulike.example.com/products/tee",
    ]);
  });

  it("externalId fallbacks: creative_id, then stable url hash; datafeedExternalId direct", async () => {
    const { fetchImpl } = dfFetch(() =>
      dfResponse([
        dfProduct({ sku: "", creative_id: 888 }),
        dfProduct({ sku: "", creative_id: "", name: "Hash Me" }),
        dfProduct({ sku: "", creative_id: "", url: "", name: "No Key" }),
      ])
    );
    const adapter = new PartnerBoostAdapter();
    const offers = await adapter.pullDatafeedOffers(ctxWith(fetchImpl), {
      brandTypes: ["DTC"],
    });
    // 无任何稳定键的一条被跳过
    expect(offers).toHaveLength(2);
    expect(offers[0].externalId).toBe("df:66303:888");
    expect(offers[1].externalId).toMatch(/^df:u:[0-9a-f]{16}$/);
    // url 哈希跨调用稳定
    expect(
      datafeedExternalId({ brand_id: 1, url: "https://x.example/p" })
    ).toBe(datafeedExternalId({ brand_id: 2, url: "https://x.example/p" }));
    expect(datafeedExternalId({ brand_id: 66303, sku: "S1" })).toBe(
      "df:66303:S1"
    );
    expect(datafeedExternalId({})).toBeNull();
  });

  it("defensive commission: maps commission key when present, null when absent", async () => {
    const { fetchImpl } = dfFetch(() =>
      dfResponse([
        dfProduct({ sku: "C1", commission: "10%" }),
        dfProduct({ sku: "C2", commission_rate: "7.5%" }),
        dfProduct({ sku: "C3" }),
      ])
    );
    const adapter = new PartnerBoostAdapter();
    const offers = await adapter.pullDatafeedOffers(ctxWith(fetchImpl), {
      brandTypes: ["DTC"],
    });
    expect(offers[0].payout).toBe(10);
    expect(offers[0].currency).toBe("%");
    expect(offers[1].payout).toBe(7.5);
    expect(offers[2].payout).toBeNull();
    expect(offers[2].currency).toBeNull();
  });

  it("brand falls back to merchant_name when brand is empty", async () => {
    const { fetchImpl } = dfFetch(() =>
      dfResponse([dfProduct({ brand: "", merchant_name: "Merchant Only" })])
    );
    const adapter = new PartnerBoostAdapter();
    const offers = await adapter.pullDatafeedOffers(ctxWith(fetchImpl), {
      brandTypes: ["DTC"],
    });
    expect(offers[0].brand).toBe("Merchant Only");
  });

  it("per-brand-type failure: callback collects, other types still return; without callback it throws", async () => {
    const handler: DfHandler = (brandType) =>
      brandType === "Walmart"
        ? dfResponse([], 1001, "brand type disabled")
        : dfResponse([dfProduct()]);
    const { fetchImpl } = dfFetch(handler);
    const adapter = new PartnerBoostAdapter();

    const errors: Array<[string, string]> = [];
    const offers = await adapter.pullDatafeedOffers(ctxWith(fetchImpl), {
      onBrandTypeError: (bt, msg) => errors.push([bt, msg]),
    });
    expect(offers).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0][0]).toBe("Walmart");
    expect(errors[0][1]).toContain("brand type disabled");

    await expect(
      adapter.pullDatafeedOffers(ctxWith(fetchImpl))
    ).rejects.toMatchObject({ code: "API_ERROR" });
  });

  it("respects the per-type page hard cap", async () => {
    const { fetchImpl, calls } = dfFetch((_bt, page) =>
      dfResponse([
        dfProduct({ sku: `P${page}-a` }),
        dfProduct({ sku: `P${page}-b` }),
      ])
    );
    const adapter = new PartnerBoostAdapter();
    const offers = await adapter.pullDatafeedOffers(ctxWith(fetchImpl), {
      brandTypes: ["DTC"],
      limit: 2,
      maxPages: 3,
    });
    expect(calls).toHaveLength(3);
    expect(offers).toHaveLength(6);
  });

  it("throws BAD_CREDENTIALS on empty token", async () => {
    const adapter = new PartnerBoostAdapter();
    await expect(
      adapter.pullDatafeedOffers(
        ctxWith(async () => jsonResponse({}) as Response, "")
      )
    ).rejects.toMatchObject({ code: "BAD_CREDENTIALS" });
  });
});
