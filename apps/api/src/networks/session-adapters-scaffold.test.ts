/**
 * Session 适配器状态测试（mock fetch，不出网）。
 *
 * 要求：不为猜测的页面结构写"验证通过"的假测试。只断言：
 * - 每个适配器的 sessionKind 与官方 kind 一致；
 * - 未验证模板 + 对不上的响应 → SessionTemplateError 明错（SESSION_TEMPLATE_UNVERIFIED），
 *   由同步服务统一降级，不死循环、不伪造数据；
 * - YeahPromos 的 pullOffers(api 模式) 直接抛 NOT_IMPLEMENTED（不硬编码猜测端点）。
 */
import { describe, expect, it } from "vitest";
import { SessionTemplateError } from "./session-adapter.js";
import { NetworkAdapterError } from "./partnerboost-adapter.js";
import { YeahPromosAdapter } from "./yeahpromos-adapter.js";
import { PartnerBoostSessionAdapter } from "./partnerboost-session-adapter.js";
import { AwinSessionAdapter } from "./awin-session-adapter.js";
import { CJSessionAdapter } from "./cj-session-adapter.js";
import { ShareASaleSessionAdapter } from "./shareasale-session-adapter.js";
import { RakutenSessionAdapter } from "./rakuten-session-adapter.js";
import { FlexOffersSessionAdapter } from "./flexoffers-session-adapter.js";
import { ImpactSessionAdapter } from "./impact-session-adapter.js";
import { AmazonSessionAdapter } from "./amazon-session-adapter.js";
import { getSessionAdapter, isSessionSupported } from "./index.js";
import type { BaseSessionAdapter } from "./session-adapter.js";

function htmlResponse(): Response {
  return {
    ok: true,
    status: 200,
    url: "https://example.test/api/products?page=1",
    headers: new Headers({ "content-type": "text/html" }),
    text: async () => "<html><body><p>some portal page</p></body></html>",
    json: async () => {
      throw new Error("not json");
    },
  } as unknown as Response;
}

const CASES: Array<{ kind: string; adapter: BaseSessionAdapter }> = [
  { kind: "yeahpromos", adapter: new YeahPromosAdapter() },
  { kind: "partnerboost", adapter: new PartnerBoostSessionAdapter() },
  { kind: "awin", adapter: new AwinSessionAdapter() },
  { kind: "cj", adapter: new CJSessionAdapter() },
  { kind: "shareasale", adapter: new ShareASaleSessionAdapter() },
  { kind: "rakuten", adapter: new RakutenSessionAdapter() },
  { kind: "flexoffers", adapter: new FlexOffersSessionAdapter() },
  { kind: "impact", adapter: new ImpactSessionAdapter() },
  { kind: "amazon", adapter: new AmazonSessionAdapter() },
];

describe("session 适配器注册表", () => {
  it.each(CASES.map((c) => [c.kind]))(
    "getSessionAdapter(%s) 与 isSessionSupported 一致",
    (kind) => {
      expect(isSessionSupported(kind)).toBe(true);
      expect(getSessionAdapter(kind).sessionKind).toBe(kind);
    }
  );

  it("未知 kind → getSessionAdapter 抛错（调用方转 400）", () => {
    expect(() => getSessionAdapter("nope")).toThrow();
    expect(isSessionSupported("nope")).toBe(false);
  });
});

describe("未验证端点 → 明确错误降级（不伪造数据）", () => {
  it.each(CASES.map((c) => [c.kind, c.adapter]))(
    "%s：HTML 响应对不上模板 → SESSION_TEMPLATE_UNVERIFIED",
    async (_kind, adapter) => {
      const err = await adapter
        .pullViaSession({
          cookie: "ck=1",
          pageDelayMs: 0,
          maxPages: 1,
          ssrfCheck: async () => {},
          fetchImpl: (async () => htmlResponse()) as unknown as typeof fetch,
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(SessionTemplateError);
      expect((err as SessionTemplateError).code).toBe(
        "SESSION_TEMPLATE_UNVERIFIED"
      );
      // 明错里带展示名 + 验证指引，不含 cookie。
      expect((err as Error).message).toContain(adapter.sessionDisplayName);
      expect((err as Error).message).toContain("尚未经真实账号验证");
      expect((err as Error).message).not.toContain("ck=1");
    }
  );

  it.each(CASES.map((c) => [c.kind, c.adapter]))(
    "%s：JSON 结构对不上候选路径 → SESSION_TEMPLATE_UNVERIFIED",
    async (_kind, adapter) => {
      const fetchImpl = (async () =>
        ({
          ok: true,
          status: 200,
          url: "https://example.test/x",
          headers: new Headers({ "content-type": "application/json" }),
          text: async () => JSON.stringify({ some: { other: "shape" } }),
          json: async () => ({ some: { other: "shape" } }),
        }) as unknown as Response) as unknown as typeof fetch;
      const err = await adapter
        .pullViaSession({
          cookie: "ck=1",
          pageDelayMs: 0,
          maxPages: 1,
          ssrfCheck: async () => {},
          fetchImpl,
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(SessionTemplateError);
    }
  );
});

describe("YeahPromos 官方 API", () => {
  it("pullOffers(api 模式) 抛 NOT_IMPLEMENTED（不硬编码猜测端点）", async () => {
    const adapter = new YeahPromosAdapter();
    const err = await adapter
      .pullOffers({
        apiKey: "k",
        apiBaseUrl: "https://yeahpromos.com",
        tenantId: "t",
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(NetworkAdapterError);
    expect((err as NetworkAdapterError).code).toBe("NOT_IMPLEMENTED");
  });

  it("supportsModes 声明正确", () => {
    expect(new YeahPromosAdapter().supportsModes).toEqual(["session"]);
    expect(new PartnerBoostSessionAdapter().sessionKind).toBe("partnerboost");
  });
});
