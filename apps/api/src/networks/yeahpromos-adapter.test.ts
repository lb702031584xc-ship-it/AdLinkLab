/**
 * YeahPromos 官方 API 模式（Get Products + Get Adverts）单元测试 — mock fetch，无真实网络。
 *
 * 文档约定（2026-10-20 用户在 YP 后台 Amazon Api 文档页证实）：
 *   GET https://yeahpromos.com/index/apioffer/products （商品）
 *   GET https://yeahpromos.com/index/apioffer/brands   （广告主，建 advert_id → 名称映射）
 *   Header token；参数 site_id / page / page_size（上限 200）/ relationship。
 *   结果码 code=100000 成功 / 100001 失败；限流 10 次/分钟，两拉取共享预算串行节流。
 * 信封结构已于 2026-10-20 经真实响应验证（双重编码 JSON + 字符串 code +
 * data.data 的 Laravel 分页器 + brands 的 advert_id/advert_name）：真实信封
 * 用例按该结构构造；products 字段级形状仍按文档 + 常见结构构造，验证
 * 适配器的防御式解析/映射/节流/明错行为。
 */
import { describe, expect, it, vi } from "vitest";
import { NetworkAdapterError } from "./partnerboost-adapter.js";
import {
  parseYpApiCredentials,
  YP_API_DEFAULT_TIMEOUT_MS,
  YP_API_MIN_REQUEST_INTERVAL_MS,
  YP_API_RATE_LIMIT_WAIT_MS,
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

/** 未经 JSON 编码的纯文本响应（YP 限流的另一种真实形态：整段 body 就是原文）。 */
function rawTextResponse(text: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: "",
    text: async () => text,
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

/** 把 body 编码 times 层 JSON（times=2 即 YP 真实行为：双重编码）。 */
function encodedResponse(body: unknown, times = 2): Response {
  let text = JSON.stringify(body);
  for (let i = 1; i < times; i += 1) text = JSON.stringify(text);
  return {
    ok: true,
    status: 200,
    url: "",
    text: async () => text,
    json: async () => body,
  } as unknown as Response;
}

/** 真实信封（2026-10-20 验证）：字符串 code + Laravel 分页器 data{…, data[]}。 */
function laravelBody(
  items: unknown[],
  page: number,
  lastPage: number,
  code: string = "100000"
): Record<string, unknown> {
  return {
    code,
    status: "SUCCESS",
    msg: "",
    data: {
      per_page: 200,
      current_page: page,
      last_page: lastPage,
      total: items.length,
      data: items,
    },
  };
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

  it("429 → RATE_LIMITED：等候重试同一页 3 次仍失败才整体抛错（写明页码/已等待次数）", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, 429)
    ) as unknown as typeof fetch;
    const err = await new YeahPromosAdapter()
      .pullOffers(ctxWith(fetchImpl), { pageDelayMs: 0, rateLimitWaitMs: 0 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(NetworkAdapterError);
    expect((err as NetworkAdapterError).code).toBe("RATE_LIMITED");
    expect((err as NetworkAdapterError).status).toBe(429);
    // 首拉 + 3 次等待重试 = 4 次请求，全卡在 brands 第 1 页（不往下走）。
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const msg = (err as Error).message;
    expect(msg).toContain("Get Adverts");
    expect(msg).toContain("第 1 页");
    expect(msg).toContain("已等待重试 3 次");
  });

  it("限流文案字符串（\"Request too fast\"）→ RATE_LIMITED 带原文，重试耗尽后整体抛错", async () => {
    // 真实形状：整段 body 就是限流文案再包一层 JSON 编码（双重编码的裸字符串）。
    const fetchImpl = vi.fn(async () =>
      encodedResponse("Request too fast, please request later!")
    ) as unknown as typeof fetch;
    const err = await new YeahPromosAdapter()
      .pullOffers(ctxWith(fetchImpl), { pageDelayMs: 0, rateLimitWaitMs: 0 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(NetworkAdapterError);
    expect((err as NetworkAdapterError).code).toBe("RATE_LIMITED");
    // 不再误判成"响应不是 JSON"/结构未验证。
    expect((err as NetworkAdapterError).code).not.toBe(
      "YP_API_STRUCTURE_UNVERIFIED"
    );
    const msg = (err as Error).message;
    expect(msg).toContain("Request too fast, please request later!");
    expect(msg).toContain("已等待重试 3 次");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("限流纯文本（未经 JSON 编码的 \"Request too fast\"）→ RATE_LIMITED 带原文，重试耗尽后整体抛错", async () => {
    // 2026-10-20 二次实测形状：整段 body 就是纯文本限流文案（不带引号、
    // 不是 JSON），JSON.parse 直接失败——曾被误判成"响应不是 JSON"
    // （YP_API_STRUCTURE_UNVERIFIED）整单失败，真实同步死在 brands 深页。
    const fetchImpl = vi.fn(async () =>
      rawTextResponse("Request too fast, please request later!")
    ) as unknown as typeof fetch;
    const err = await new YeahPromosAdapter()
      .pullOffers(ctxWith(fetchImpl), { pageDelayMs: 0, rateLimitWaitMs: 0 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(NetworkAdapterError);
    expect((err as NetworkAdapterError).code).toBe("RATE_LIMITED");
    expect((err as NetworkAdapterError).code).not.toBe(
      "YP_API_STRUCTURE_UNVERIFIED"
    );
    const msg = (err as Error).message;
    expect(msg).toContain("Request too fast, please request later!");
    expect(msg).toContain("已等待重试 3 次");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("brands 第 1 页先回纯文本限流、等候重试后恢复 → 拉全", async () => {
    let brandsAttempts = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/brands")) {
        brandsAttempts += 1;
        if (brandsAttempts === 1) {
          return rawTextResponse("Request too fast, please request later!");
        }
        return encodedResponse(laravelBody([brand()], 1, 1));
      }
      return encodedResponse(laravelBody([product()], 1, 1));
    }) as unknown as typeof fetch;

    const offers = await new YeahPromosAdapter().pullOffers(
      ctxWith(fetchImpl),
      { pageDelayMs: 0, rateLimitWaitMs: 0 }
    );
    expect(brandsAttempts).toBe(2);
    expect(offers).toHaveLength(1);
    expect(offers[0].externalId).toBe("yp-1001");
  });

  it("products 第 2 页先被限流（too fast 字符串）、等候重试后恢复 → 拉全且该页请求两次", async () => {
    let productsPage2Attempts = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      const u = new URL(String(url));
      const page = Number(u.searchParams.get("page"));
      if (u.pathname.endsWith("/brands")) {
        return encodedResponse(laravelBody([brand()], 1, 1));
      }
      if (page === 1) {
        return encodedResponse(laravelBody([product()], 1, 2));
      }
      productsPage2Attempts += 1;
      if (productsPage2Attempts === 1) {
        return encodedResponse("Request too fast, please request later!");
      }
      return encodedResponse(
        laravelBody(
          [product({ product_id: "yp-1002", product_name: "Recovered Gadget" })],
          2,
          2
        )
      );
    }) as unknown as typeof fetch;

    const started = Date.now();
    const offers = await new YeahPromosAdapter().pullOffers(
      ctxWith(fetchImpl),
      { pageDelayMs: 0, rateLimitWaitMs: 40 }
    );
    const elapsed = Date.now() - started;

    expect(productsPage2Attempts).toBe(2);
    // 确实等过（注入的 40ms），不是立即重试。
    expect(elapsed).toBeGreaterThanOrEqual(35);
    expect(offers).toHaveLength(2);
    expect(offers.map((o) => o.externalId)).toEqual(["yp-1001", "yp-1002"]);
    expect(offers[1].name).toBe("Recovered Gadget");
  });

  it("限流等待默认值 60s（等满一个限流窗口）", () => {
    expect(YP_API_RATE_LIMIT_WAIT_MS).toBe(60_000);
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

  it("默认超时已放宽到 45s（YP 慢接口实测超 15s）", () => {
    expect(YP_API_DEFAULT_TIMEOUT_MS).toBe(45_000);
  });

  it("fetch 阶段超时（TimeoutError）→ NETWORK_ERROR 文案开头标明接口/页码/秒数", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError"
      );
    }) as unknown as typeof fetch;
    const err = await new YeahPromosAdapter()
      .pullOffers(ctxWith(fetchImpl), { pageDelayMs: 0 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(NetworkAdapterError);
    expect((err as NetworkAdapterError).code).toBe("NETWORK_ERROR");
    const msg = (err as Error).message;
    // brands 是第一步：第 1 页超时。
    expect(msg.startsWith("YeahPromos API（Get Adverts 第 1 页）请求超时")).toBe(
      true
    );
    expect(msg).toContain("（>45s）");
    expect(msg).toContain("The operation was aborted due to timeout");
    expect(msg).not.toContain("test-website-token");
  });

  it("products 阶段超时 → 文案标明 Get Products 第 1 页", async () => {
    const { fetchImpl } = routedFetch([brand()], () => {
      throw new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError"
      );
    });
    const err = await new YeahPromosAdapter()
      .pullOffers(ctxWith(fetchImpl), { pageDelayMs: 0 })
      .catch((e) => e);
    expect((err as NetworkAdapterError).code).toBe("NETWORK_ERROR");
    const msg = (err as Error).message;
    expect(
      msg.startsWith("YeahPromos API（Get Products 第 1 页）请求超时（>45s）")
    ).toBe(true);
  });

  it("响应体读取阶段超时（回归：此前 text() 在 try 外，原始英文未包装直接透出）→ 同样带接口/页码定位", async () => {
    const fetchImpl = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          url: "https://yeahpromos.com/index/apioffer/brands",
          text: async () => {
            throw new DOMException(
              "The operation was aborted due to timeout",
              "TimeoutError"
            );
          },
          json: async () => ({}),
        }) as unknown as Response
    ) as unknown as typeof fetch;
    const err = await new YeahPromosAdapter()
      .pullOffers(ctxWith(fetchImpl), { pageDelayMs: 0 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(NetworkAdapterError);
    expect((err as NetworkAdapterError).code).toBe("NETWORK_ERROR");
    const msg = (err as Error).message;
    expect(msg).not.toBe("The operation was aborted due to timeout");
    expect(
      msg.startsWith("YeahPromos API（Get Adverts 第 1 页）请求超时（>45s）")
    ).toBe(true);
  });

  it("非超时网络错误保持现有格式（请求失败 + 原始信息，不带页码/超时字样）", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;
    const err = await new YeahPromosAdapter()
      .pullOffers(ctxWith(fetchImpl), { pageDelayMs: 0 })
      .catch((e) => e);
    expect((err as NetworkAdapterError).code).toBe("NETWORK_ERROR");
    expect((err as Error).message).toBe(
      "YeahPromos API（Get Adverts）请求失败：socket hang up"
    );
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

  it("共享节流：brands 与 products 串行、任意相邻请求间隔 ≥ 配置值（默认间隔常量 = 8000ms，滑动窗口内最多 8 个请求）", async () => {
    // 6.5s 旧值会让 60s 滑动窗口塞下 10 个请求顶穿上限，故收紧为 8000 精确值。
    expect(YP_API_MIN_REQUEST_INTERVAL_MS).toBe(8000);
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

  it("真实信封：双重编码 body + 字符串 code + data.data + Laravel 两页分页（brands/products 拉全，brands 第 2 页回填 brand）", async () => {
    const pages: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      const u = new URL(String(url));
      const page = Number(u.searchParams.get("page"));
      const isBrands = u.pathname.endsWith("/brands");
      pages.push(`${isBrands ? "brands" : "products"}:${page}`);
      if (isBrands) {
        const items =
          page === 1
            ? [brand({ advert_id: "adv-1", advert_name: "FirstPageBrand" })]
            : [brand({ advert_id: "adv-2", advert_name: "SecondPageBrand" })];
        return encodedResponse(laravelBody(items, page, 2));
      }
      const items =
        page === 1
          ? [
              product({
                product_id: "yp-2001",
                brand_name: undefined,
                advert_id: "adv-2",
              }),
            ]
          : [
              product({
                product_id: "yp-2002",
                product_name: "Second Page Gadget",
              }),
            ];
      return encodedResponse(laravelBody(items, page, 2));
    }) as unknown as typeof fetch;

    const offers = await new YeahPromosAdapter().pullOffers(
      ctxWith(fetchImpl),
      { pageDelayMs: 0 }
    );

    // 每页只有 1 条（远小于 page_size 200）：靠 Laravel current_page<last_page
    // 续拉（不是满页启发式）；顺序 brands 两页 → products 两页。
    expect(pages).toEqual([
      "brands:1",
      "brands:2",
      "products:1",
      "products:2",
    ]);
    expect(offers).toHaveLength(2);
    expect(offers.map((o) => o.externalId)).toEqual(["yp-2001", "yp-2002"]);
    // brand 由 brands 第 2 页记录的 advert_name 经 advert_id 映射回填。
    expect(offers[0].brand).toBe("SecondPageBrand");
    expect(offers[0].payout).toBe(12.5);
    expect(offers[1].name).toBe("Second Page Gadget");
  });

  it("三重编码 body 也能逐层解包", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/brands")) {
        return encodedResponse(laravelBody([brand()], 1, 1), 3);
      }
      return encodedResponse(laravelBody([product()], 1, 1), 3);
    }) as unknown as typeof fetch;
    const offers = await new YeahPromosAdapter().pullOffers(
      ctxWith(fetchImpl),
      { pageDelayMs: 0 }
    );
    expect(offers).toHaveLength(1);
    expect(offers[0].externalId).toBe("yp-1001");
  });

  it("字符串 code \"100001\" → API_ERROR 并带出原始 msg", async () => {
    const fetchImpl = vi.fn(async () =>
      encodedResponse({
        code: "100001",
        status: "ERROR",
        msg: "token mismatch",
        data: null,
      })
    ) as unknown as typeof fetch;
    const err = await new YeahPromosAdapter()
      .pullOffers(ctxWith(fetchImpl), { pageDelayMs: 0 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(NetworkAdapterError);
    expect((err as NetworkAdapterError).code).toBe("API_ERROR");
    expect((err as Error).message).toContain("token mismatch");
    expect((err as Error).message).toContain("100001");
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
