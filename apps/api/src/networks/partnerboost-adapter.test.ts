/**
 * Network API framework — PartnerBoost adapter unit tests (mock fetch, no network).
 */
import { describe, expect, it, vi } from "vitest";
import {
  PARTNERBOOST_DEFAULT_BASE_URL,
  PartnerBoostAdapter,
  NetworkAdapterError,
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
