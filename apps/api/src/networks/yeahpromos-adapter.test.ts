/**
 * YeahPromos 官方 API 模式（Get Products + Get Adverts）单元测试 — mock fetch，无真实网络。
 *
 * 文档约定（2026-10-20 用户在 YP 后台 Amazon Api 文档页证实）：
 *   GET https://yeahpromos.com/index/apioffer/products （商品）
 *   GET https://yeahpromos.com/index/apioffer/brands   （广告主，建 advert_id → 名称映射）
 *   Header token；参数 site_id / page / page_size（上限 200）/ relationship。
 *   结果码 code=100000 成功 / 100001 失败；限流 10 次/分钟，两拉取共享预算串行节流。
 * ⚠️ 返回字段清单未经真实响应验证：本测试的响应形状按文档 + 常见结构构造，
 * 只验证适配器的防御式解析/映射/节流/明错行为，不代表真实字段已核实。
 */
import { describe, expect, it, vi } from "vitest";
import { NetworkAdapterError } from "./partnerboost-adapter.js";
import {
  parseYpApiCredentials,
  YP_API_MIN_REQUEST_INTERVAL_MS,
  YP_API_USER_AGENT,
  YeahPromosAdapter,
} from "./yeahpromos-adapter.js";
import type { AdapterContext } from "./types.js";

const CREDS = JSON.stringify({ token: "test-website-token", siteId: "12345" });

function ctxWith(
  fetchImpl: typeof fetch,
  overrides: Partial<AdapterContext> = {}
): AdapterContext {
  return {
    apiKey: CREDS,
    apiBaseUrl: "https://yeahpromos.com",
    tenantId: "tenant-1",
    fetchImpl,
    ssrfCheck: async () => {},
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

/** 非 JSON 响应（登录页/WAF 挑战页）：带最终 URL（fetch 跟随重定向后的 res.url）。 */
function htmlResponse(html: string, finalUrl: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: finalUrl,
    text: async () => html,
    json: async () => {
      throw new Error("not json");
    },
  } as unknown as Response;
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    product_id: "yp-1001",
    product_name: "Test Blender",
    asin: "B0YPTEST01",
    brand_name: "YPBrand",
    price: "59.99",
    commission_amount: 12.5,
    currency: "USD",
    promo_url: "https://www.amazon.com/dp/B0YPTEST01",
    review_count: 321,
    ...overrides,
  };
}

function brand(overrides: Record<string, unknown> = {}) {
  return { advert_id: "adv-9", advert_name: "MappedBrand", ...overrides };
}

function listBody(
  list: unknown[],
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return { code: 100000, msg: "success", data: { list, ...extra } };
}

/**
 * 按路径分流的 mock：brands 默认一页（给定 brands 列表），products 走 productsHandler。
 */
function routedFetch(
  brandsList: unknown[],
  productsHandler: (url: URL) => Response
) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl = vi.fn(
    async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url: String(url), headers: init?.headers ?? {} });
      const u = new URL(String(url));
      if (u.pathname.endsWith("/brands")) {
        return jsonResponse(listBody(brandsList, { PageTotal: 1, PageNow: 1 }));
      }
      return productsHandler(u);
    }
  ) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("YeahPromosAdapter.pullOffers (api 模式)", () => {
  it("supportsModes 包含 api 与 session", () => {
    expect(new YeahPromosAdapter().supportsModes).toEqual(["api", "session"]);
  });

  it("先拉 brands 再分页拉 products：请求参数/请求头正确，字段映射与 PB payout 口径一致，advert_id 回填 brand", async () => {
    const { fetchImpl, calls } = routedFetch([brand()], (u) => {
      const page = u.searchParams.get("page");
      if (page === "1") {
        return jsonResponse(listBody([product()], { PageTotal: 2, PageNow: 1 }));
      }
      return jsonResponse(
        listBody(
          [
            product({
              product_id: "yp-1002",
              product_name: "Rate Only Lamp",
              brand_name: undefined,
              advert_id: "adv-9",
              commission_amount: undefined,
              commission: undefined,
              commission_rate: 15,
            }),
          ],
          { PageTotal: 2, PageNow: 2 }
        )
      );
    });

    const adapter = new YeahPromosAdapter();
    const offers = await adapter.pullOffers(ctxWith(fetchImpl), {
      pageDelayMs: 0,
    });

    // brands 1 页 + products 2 页，brands 在最前。
    expect(calls).toHaveLength(3);
    expect(new URL(calls[0].url).pathname).toBe("/index/apioffer/brands");
    const pu = new URL(calls[1].url);
    expect(pu.pathname).toBe("/index/apioffer/products");
    expect(pu.searchParams.get("site_id")).toBe("12345");
    expect(pu.searchParams.get("page")).toBe("1");
    expect(pu.searchParams.get("page_size")).toBe("200");
    expect(pu.searchParams.get("relationship")).toBe("0");
    expect(calls[1].headers.token).toBe("test-website-token");

    expect(offers).toHaveLength(2);
    expect(offers[0]).toMatchObject({
      externalId: "yp-1001",
      name: "Test Blender",
      payout: 12.5,
      currency: "USD",
      brand: "YPBrand",
      asin: "B0YPTEST01",
      price: 59.99,
      reviewCount: 321,
      url: "https://www.amazon.com/dp/B0YPTEST01",
      landingPageType: "amazon_product",
    });
    // 只有佣金率 → payout=率、currency="%"（同步服务据此写 commissionRate）。
    expect(offers[1].payout).toBe(15);
    expect(offers[1].currency).toBe("%");
    // 商品自带品牌名缺失 → advert_id 查 brands 映射回填；广告主原始记录存 rawData。
    expect(offers[1].brand).toBe("MappedBrand");
    expect(
      (offers[1].rawData as Record<string, unknown>).__yp_brand
    ).toMatchObject({ advert_id: "adv-9", advert_name: "MappedBrand" });
  });

  it("apiProductsPath 覆盖生效", async () => {
    const { fetchImpl, calls } = routedFetch([], () =>
      jsonResponse(listBody([product()], { PageTotal: 1 }))
    );
    const adapter = new YeahPromosAdapter();
    await adapter.pullOffers(
      ctxWith(fetchImpl, { apiProductsPath: "/index/apioffer/products2" }),
      { pageDelayMs: 0 }
    );
    const productCall = calls.find((c) => !c.url.includes("/brands"));
    expect(new URL(productCall!.url).pathname).toBe(
      "/index/apioffer/products2"
    );
  });

  it("401 → BAD_CREDENTIALS 明错（token 无效）", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ code: 100001, msg: "unauthorized" }, 401)
    ) as unknown as typeof fetch;
    const err = await new YeahPromosAdapter()
      .pullOffers(ctxWith(fetchImpl), { pageDelayMs: 0 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(NetworkAdapterError);
    expect((err as NetworkAdapterError).code).toBe("BAD_CREDENTIALS");
    expect((err as NetworkAdapterError).status).toBe(401);
  });

  it("429 → RATE_LIMITED 降级且不重试（只请求一次）", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, 429)
    ) as unknown as typeof fetch;
    const err = await new YeahPromosAdapter()
      .pullOffers(ctxWith(fetchImpl), { pageDelayMs: 0 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(NetworkAdapterError);
    expect((err as NetworkAdapterError).code).toBe("RATE_LIMITED");
    expect((err as NetworkAdapterError).status).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("code=100001 → API_ERROR 并带出原始 msg", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ code: 100001, msg: "site_id invalid" })
    ) as unknown as typeof fetch;
    const err = await new YeahPromosAdapter()
      .pullOffers(ctxWith(fetchImpl), { pageDelayMs: 0 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(NetworkAdapterError);
    expect((err as NetworkAdapterError).code).toBe("API_ERROR");
    expect((err as Error).message).toContain("site_id invalid");
    expect((err as Error).message).toContain("100001");
  });

  it("结构对不上（code 成功但无列表）→ YP_API_STRUCTURE_UNVERIFIED 明错", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ code: 100000, data: { unexpected: [] } })
    ) as unknown as typeof fetch;
    const err = await new YeahPromosAdapter()
      .pullOffers(ctxWith(fetchImpl), { pageDelayMs: 0 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(NetworkAdapterError);
    expect((err as NetworkAdapterError).code).toBe(
      "YP_API_STRUCTURE_UNVERIFIED"
    );
  });

  it("缺少结果码 code → YP_API_STRUCTURE_UNVERIFIED 明错", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: { list: [product()] } })
    ) as unknown as typeof fetch;
    const err = await new YeahPromosAdapter()
      .pullOffers(ctxWith(fetchImpl), { pageDelayMs: 0 })
      .catch((e) => e);
    expect((err as NetworkAdapterError).code).toBe(
      "YP_API_STRUCTURE_UNVERIFIED"
    );
  });

  it("200+HTML（被重定向到登录页）→ 明错带最终 URL/状态/body 净化片段，且请求带浏览器 UA、错误不含 token", async () => {
    const loginUrl = "https://yeahpromos.com/index/login";
    const html =
      "<html>\n  <head><title>Login</title></head>\n" +
      "  <body> Please   sign in </body></html>";
    const seenHeaders: Array<Record<string, string>> = [];
    const fetchImpl = vi.fn(
      async (
        _url: string,
        init?: { headers?: Record<string, string> }
      ) => {
        seenHeaders.push(init?.headers ?? {});
        return htmlResponse(html, loginUrl);
      }
    ) as unknown as typeof fetch;
    const err = await new YeahPromosAdapter()
      .pullOffers(ctxWith(fetchImpl), { pageDelayMs: 0 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(NetworkAdapterError);
    expect((err as NetworkAdapterError).code).toBe(
      "YP_API_STRUCTURE_UNVERIFIED"
    );
    const msg = (err as Error).message;
    // 最终 URL + 重定向明示 + 状态。
    expect(msg).toContain(loginUrl);
    expect(msg).toContain(`请求被重定向到：${loginUrl}`);
    expect(msg).toContain("HTTP 200");
    // body 片段：多余空白已折叠为单空格。
    expect(msg).toContain("<title>Login</title>");
    expect(msg).toContain("Please sign in");
    // 凭证绝不进错误信息。
    expect(msg).not.toContain("test-website-token");
    // 请求头带真实浏览器风格 UA（排除 WAF 按 UA 拦截）。
    expect(seenHeaders[0]?.["User-Agent"]).toBe(YP_API_USER_AGENT);
    expect(seenHeaders[0]?.["User-Agent"]).toContain("Chrome/");
  });

  it("200+HTML（无重定向，挑战页）→ 明错带最终 URL，body 片段截断在 200 字符内", async () => {
    const finalUrl =
      "https://yeahpromos.com/index/apioffer/brands?site_id=12345&page=1" +
      "&page_size=200&relationship=0";
    const longBody = `<html><body>${"x".repeat(300)}TAILMARKER</body></html>`;
    const fetchImpl = vi.fn(async () =>
      htmlResponse(longBody, finalUrl)
    ) as unknown as typeof fetch;
    const err = await new YeahPromosAdapter()
      .pullOffers(ctxWith(fetchImpl), { pageDelayMs: 0 })
      .catch((e) => e);
    expect((err as NetworkAdapterError).code).toBe(
      "YP_API_STRUCTURE_UNVERIFIED"
    );
    const msg = (err as Error).message;
    expect(msg).toContain(finalUrl);
    expect(msg).not.toContain("请求被重定向到：");
    // 200 字符之后的尾部标记已被截断，不出现。
    expect(msg).not.toContain("TAILMARKER");
  });

  it("纯 token 凭证（缺 site_id）→ BAD_CREDENTIALS 且不发请求", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(listBody([]))
    ) as unknown as typeof fetch;
    const err = await new YeahPromosAdapter()
      .pullOffers(ctxWith(fetchImpl, { apiKey: "bare-token" }), {
        pageDelayMs: 0,
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(NetworkAdapterError);
    expect((err as NetworkAdapterError).code).toBe("BAD_CREDENTIALS");
    expect((err as Error).message).toContain("site_id");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("共享节流：brands 与 products 串行、任意相邻请求间隔 ≥ 配置值（默认 ≥6.5s）", async () => {
    expect(YP_API_MIN_REQUEST_INTERVAL_MS).toBeGreaterThanOrEqual(6500);
    const { fetchImpl, calls } = routedFetch([brand()], (u) => {
      const page = u.searchParams.get("page");
      return jsonResponse(
        listBody([product()], { PageTotal: 2, PageNow: Number(page) })
      );
    });
    const started = Date.now();
    await new YeahPromosAdapter().pullOffers(ctxWith(fetchImpl), {
      pageDelayMs: 80,
    });
    // brands 1 页 + products 2 页 = 3 次请求、2 个间隔，每个 ≥80ms。
    expect(calls).toHaveLength(3);
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });
});

describe("parseYpApiCredentials", () => {
  it("解析 JSON 凭证与 site_id 别名", () => {
    expect(
      parseYpApiCredentials('{"token":"t1","site_id":"42"}')
    ).toEqual({ token: "t1", siteId: "42" });
    expect(parseYpApiCredentials('{"token":"t2","siteId":"7"}')).toEqual({
      token: "t2",
      siteId: "7",
    });
  });

  it("空 token → BAD_CREDENTIALS", () => {
    expect(() => parseYpApiCredentials("")).toThrowError(
      expect.objectContaining({ code: "BAD_CREDENTIALS" })
    );
  });
});
