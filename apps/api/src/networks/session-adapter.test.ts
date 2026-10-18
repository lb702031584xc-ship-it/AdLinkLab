/**
 * BaseSessionAdapter / TemplateSessionAdapter 单元测试（mock fetch，不出网）。
 *
 * 覆盖：分页+页间延迟、401/403→SessionExpiredError（403 带 restricted）、
 * 429→SessionRateLimitedError（不重试）、登录页重定向→过期、Cookie 只进请求头、
 * 模板未验证→SESSION_TEMPLATE_UNVERIFIED 明错、已验证模板解析失败→SESSION_PARSE_FAILED。
 */
import { describe, expect, it, vi } from "vitest";
import {
  BaseSessionAdapter,
  SessionExpiredError,
  SessionParseError,
  SessionRateLimitedError,
  SessionTemplateError,
  TemplateSessionAdapter,
  type SessionListTemplate,
  type SessionPageInput,
  type SessionPageResult,
  type SessionProduct,
} from "./session-adapter.js";

function textResponse(
  body: string,
  opts: { status?: number; url?: string; contentType?: string } = {}
): Response {
  const status = opts.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    url: opts.url ?? "https://example.test/api/products?page=1",
    headers: new Headers({ "content-type": opts.contentType ?? "application/json" }),
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

function product(id: string): SessionProduct {
  return { externalId: id, name: `Product ${id}`, rawData: { id } };
}

/** 可编排每页响应的测试子类。 */
class ScriptedAdapter extends BaseSessionAdapter {
  readonly sessionKind = "test";
  readonly sessionDisplayName = "TestNet";
  readonly defaultSessionBaseUrl = "https://example.test";
  script: Array<(input: SessionPageInput) => Promise<SessionPageResult>> = [];
  seenCookies: string[] = [];

  protected async fetchSessionPage(
    input: SessionPageInput
  ): Promise<SessionPageResult> {
    this.seenCookies.push(input.cookie);
    const fn = this.script[Math.min(input.page - 1, this.script.length - 1)];
    return fn(input);
  }
}

class JsonTemplateAdapter extends TemplateSessionAdapter {
  readonly sessionKind = "tpl";
  readonly sessionDisplayName = "TplNet";
  readonly defaultSessionBaseUrl = "https://example.test";
  constructor(
    protected readonly defaultSessionListPath: string,
    protected readonly listTemplate: SessionListTemplate
  ) {
    super();
  }
  protected mapSessionItem(item: Record<string, unknown>): SessionProduct {
    return {
      externalId: String(item.id ?? ""),
      name: String(item.name ?? "x"),
      rawData: item,
    };
  }
}

const UNVERIFIED: SessionListTemplate = {
  verified: false,
  jsonListPaths: ["data.list"],
  jsonHasMorePaths: ["data.has_more"],
  description: "test",
};
const VERIFIED: SessionListTemplate = { ...UNVERIFIED, verified: true };

describe("BaseSessionAdapter.pullViaSession", () => {
  it("分页拉取：hasMore 为 true 继续，false 停止", async () => {
    const adapter = new ScriptedAdapter();
    adapter.script = [
      async () => ({ products: [product("p1")], hasMore: true }),
      async () => ({ products: [product("p2")], hasMore: false }),
      async () => ({ products: [product("p3")], hasMore: false }),
    ];
    const out = await adapter.pullViaSession({
      cookie: "ck=1",
      pageDelayMs: 0,
      ssrfCheck: async () => {},
      fetchImpl: (async () => textResponse("{}")) as unknown as typeof fetch,
    });
    expect(out.map((p) => p.externalId)).toEqual(["p1", "p2"]);
  });

  it("页间延迟：第一页前不延迟，页间延迟生效", async () => {
    const adapter = new ScriptedAdapter();
    const times: number[] = [];
    adapter.script = [
      async () => {
        times.push(Date.now());
        return { products: [product("p1")], hasMore: true };
      },
      async () => {
        times.push(Date.now());
        return { products: [product("p2")], hasMore: false };
      },
    ];
    await adapter.pullViaSession({
      cookie: "ck=1",
      pageDelayMs: 60,
      ssrfCheck: async () => {},
      fetchImpl: (async () => textResponse("{}")) as unknown as typeof fetch,
    });
    expect(times).toHaveLength(2);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(40);
  });

  it("maxPages 上限生效", async () => {
    const adapter = new ScriptedAdapter();
    adapter.script = [async () => ({ products: [product("p")], hasMore: true })];
    const out = await adapter.pullViaSession({
      cookie: "ck=1",
      maxPages: 3,
      pageDelayMs: 0,
      ssrfCheck: async () => {},
      fetchImpl: (async () => textResponse("{}")) as unknown as typeof fetch,
    });
    expect(out).toHaveLength(3);
  });

  it("空 Cookie 直接抛 SessionExpiredError", async () => {
    const adapter = new ScriptedAdapter();
    await expect(
      adapter.pullViaSession({ cookie: "  ", ssrfCheck: async () => {} })
    ).rejects.toThrow(SessionExpiredError);
  });
});

describe("BaseSessionAdapter.sessionFetch 守卫", () => {
  class ProbeAdapter extends BaseSessionAdapter {
    readonly sessionKind = "probe";
    readonly sessionDisplayName = "ProbeNet";
    readonly defaultSessionBaseUrl = "https://example.test";
    protected async fetchSessionPage(): Promise<SessionPageResult> {
      throw new Error("not used");
    }
    async probe(
      cookie: string,
      url: string,
      fetchImpl: typeof fetch
    ): Promise<Response> {
      return this.sessionFetch({ cookie, fetchImpl, timeoutMs: 5000 }, url);
    }
  }

  it("401 → SessionExpiredError（非 restricted）", async () => {
    const fetchImpl = (async () =>
      textResponse("unauthorized", { status: 401 })) as unknown as typeof fetch;
    const err = await new ProbeAdapter()
      .probe("ck=1", "https://example.test/x", fetchImpl)
      .catch((e) => e);
    expect(err).toBeInstanceOf(SessionExpiredError);
    expect((err as SessionExpiredError).code).toBe("SESSION_EXPIRED");
    expect((err as SessionExpiredError).restricted).toBe(false);
  });

  it("403 → SessionExpiredError（restricted=true，账号受限语义）", async () => {
    const fetchImpl = (async () =>
      textResponse("forbidden", { status: 403 })) as unknown as typeof fetch;
    const err = await new ProbeAdapter()
      .probe("ck=1", "https://example.test/x", fetchImpl)
      .catch((e) => e);
    expect(err).toBeInstanceOf(SessionExpiredError);
    expect((err as SessionExpiredError).restricted).toBe(true);
  });

  it("429 → SessionRateLimitedError（不重试：只发一次请求）", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return textResponse("too many", { status: 429 });
    }) as unknown as typeof fetch;
    const err = await new ProbeAdapter()
      .probe("ck=1", "https://example.test/x", fetchImpl)
      .catch((e) => e);
    expect(err).toBeInstanceOf(SessionRateLimitedError);
    expect((err as SessionRateLimitedError).code).toBe("SESSION_RATE_LIMITED");
    expect(calls).toBe(1);
  });

  it("重定向到登录页 → SessionExpiredError", async () => {
    const fetchImpl = (async () =>
      textResponse("{}", {
        url: "https://example.test/login?next=/api/products",
      })) as unknown as typeof fetch;
    const err = await new ProbeAdapter()
      .probe("ck=1", "https://example.test/x", fetchImpl)
      .catch((e) => e);
    expect(err).toBeInstanceOf(SessionExpiredError);
  });

  it("Cookie 只放在 Cookie 请求头", async () => {
    let seenCookie: string | null = null;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seenCookie = (init?.headers as Record<string, string>)?.["Cookie"] ?? null;
      return textResponse(JSON.stringify({ data: { list: [], has_more: false } }));
    }) as unknown as typeof fetch;
    const adapter = new JsonTemplateAdapter("/api/products", VERIFIED);
    await adapter.pullViaSession({
      cookie: "session=secret-cookie-value",
      pageDelayMs: 0,
      ssrfCheck: async () => {},
      fetchImpl,
    });
    expect(seenCookie).toBe("session=secret-cookie-value");
  });

  it("baseUrl 先过 SSRF 检查", async () => {
    const adapter = new ScriptedAdapter();
    adapter.script = [async () => ({ products: [], hasMore: false })];
    const ssrfCheck = vi.fn(async () => {});
    await adapter.pullViaSession({
      cookie: "ck=1",
      baseUrl: "https://example.test",
      pageDelayMs: 0,
      ssrfCheck,
      fetchImpl: (async () => textResponse("{}")) as unknown as typeof fetch,
    });
    expect(ssrfCheck).toHaveBeenCalledWith("https://example.test");
  });
});

describe("TemplateSessionAdapter", () => {
  const fetchJson = (body: unknown) =>
    (async () =>
      textResponse(JSON.stringify(body))) as unknown as typeof fetch;

  it("JSON 命中候选路径 → 解析商品 + hasMore", async () => {
    const adapter = new JsonTemplateAdapter("/api/products", UNVERIFIED);
    const out = await adapter.pullViaSession({
      cookie: "ck=1",
      pageDelayMs: 0,
      maxPages: 1,
      ssrfCheck: async () => {},
      fetchImpl: fetchJson({ data: { list: [{ id: "a", name: "A" }], has_more: false } }),
    });
    expect(out).toHaveLength(1);
    expect(out[0].externalId).toBe("a");
  });

  it("未验证模板 + 结构对不上 → SessionTemplateError 明错（含 kind）", async () => {
    const adapter = new JsonTemplateAdapter("/api/products", UNVERIFIED);
    const err = await adapter
      .pullViaSession({
        cookie: "ck=1",
        pageDelayMs: 0,
        maxPages: 1,
        ssrfCheck: async () => {},
        fetchImpl: fetchJson({ unexpected: { shape: true } }),
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(SessionTemplateError);
    expect((err as SessionTemplateError).code).toBe("SESSION_TEMPLATE_UNVERIFIED");
    expect((err as Error).message).toContain("TplNet");
    expect((err as Error).message).toContain("尚未经真实账号验证");
  });

  it("未验证模板 + 纯 HTML → SessionTemplateError（不伪造数据）", async () => {
    const adapter = new JsonTemplateAdapter("/api/products", UNVERIFIED);
    const err = await adapter
      .pullViaSession({
        cookie: "ck=1",
        pageDelayMs: 0,
        maxPages: 1,
        ssrfCheck: async () => {},
        fetchImpl: (async () =>
          textResponse("<html><body>login page</body></html>", {
            contentType: "text/html",
          })) as unknown as typeof fetch,
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(SessionTemplateError);
  });

  it("已验证模板 + 结构对不上 → SessionParseError", async () => {
    const adapter = new JsonTemplateAdapter("/api/products", VERIFIED);
    const err = await adapter
      .pullViaSession({
        cookie: "ck=1",
        pageDelayMs: 0,
        maxPages: 1,
        ssrfCheck: async () => {},
        fetchImpl: fetchJson({ unexpected: { shape: true } }),
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(SessionParseError);
    expect((err as SessionParseError).code).toBe("SESSION_PARSE_FAILED");
  });

  it("sessionListPath 可被覆盖", async () => {
    let seenUrl = "";
    const fetchImpl = (async (url: string) => {
      seenUrl = url;
      return textResponse(JSON.stringify({ data: { list: [], has_more: false } }));
    }) as unknown as typeof fetch;
    const adapter = new JsonTemplateAdapter("/api/products", VERIFIED);
    await adapter.pullViaSession({
      cookie: "ck=1",
      pageDelayMs: 0,
      maxPages: 1,
      ssrfCheck: async () => {},
      fetchImpl,
      sessionListPath: "/custom/list",
    });
    expect(seenUrl).toContain("/custom/list");
  });
});
