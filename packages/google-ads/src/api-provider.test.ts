import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GoogleAdsApiProvider,
  type ApiFetchFn,
} from "./api-provider.js";
import { MockGoogleAdsProvider } from "./mock-provider.js";

const ENV_VARS = [
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_REFRESH_TOKEN",
] as const;

type StubResponse = {
  ok: boolean;
  status: number;
  jsonData?: unknown;
  textData?: string;
};

function stubFetch(
  handler: (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string }
  ) => StubResponse
): ApiFetchFn {
  return async (url, init) => {
    const r = handler(url, init);
    return {
      ok: r.ok,
      status: r.status,
      json: async () => r.jsonData,
      text: async () => r.textData ?? "",
    };
  };
}

function jsonOk(jsonData: unknown): StubResponse {
  return { ok: true, status: 200, jsonData };
}

describe("GoogleAdsApiProvider live reads (stubbed fetch)", () => {
  const savedEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of ENV_VARS) {
      savedEnv.set(key, process.env[key]);
      process.env[key] = `test-${key}`;
    }
  });

  afterEach(() => {
    for (const key of ENV_VARS) {
      const value = savedEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function tokenAndGaql(
    gaqlHandler: (body: Record<string, unknown>) => StubResponse
  ): { fetchFn: ApiFetchFn; calls: { token: number; gaql: number } } {
    const calls = { token: 0, gaql: 0 };
    const fetchFn = stubFetch((url, init) => {
      if (url === "https://oauth2.googleapis.com/token") {
        calls.token += 1;
        expect(init.body ?? "").toContain("grant_type=refresh_token");
        return jsonOk({ access_token: "tok-test", expires_in: 3600 });
      }
      calls.gaql += 1;
      expect(url).toContain("/v22/customers/1234567890/googleAds:search");
      expect(init.headers["developer-token"]).toBe(
        "test-GOOGLE_ADS_DEVELOPER_TOKEN"
      );
      expect(init.headers["Authorization"]).toBe("Bearer tok-test");
      const body = JSON.parse(init.body ?? "{}") as Record<string, unknown>;
      expect(typeof body.query).toBe("string");
      return gaqlHandler(body);
    });
    return { fetchFn, calls };
  }

  it("refreshes OAuth token once and reuses it across calls", async () => {
    const { fetchFn, calls } = tokenAndGaql(() =>
      jsonOk({
        results: [
          { campaign: { id: "111", name: "Alpha", status: "ENABLED" } },
        ],
      })
    );
    const provider = new GoogleAdsApiProvider({
      apiVersion: "v22",
      fetchFn,
    });
    await provider.listCampaigns("1234567890");
    await provider.listCampaigns("1234567890");
    expect(calls.token).toBe(1);
    expect(calls.gaql).toBe(2);
  });

  it("drains GAQL pages via nextPageToken", async () => {
    const { fetchFn } = tokenAndGaql((body) => {
      if (body.pageToken === "p2") {
        return jsonOk({
          results: [
            { campaign: { id: "222", name: "Beta", status: "PAUSED" } },
          ],
        });
      }
      return jsonOk({
        results: [
          { campaign: { id: "111", name: "Alpha", status: "ENABLED" } },
        ],
        nextPageToken: "p2",
      });
    });
    const provider = new GoogleAdsApiProvider({
      apiVersion: "v22",
      fetchFn,
    });
    const campaigns = await provider.listCampaigns("1234567890");
    expect(campaigns.map((c) => c.campaignId)).toEqual(["111", "222"]);
    expect(campaigns[1]?.status).toBe("PAUSED");
  });

  it("aggregates daily stats rows per campaign", async () => {
    const { fetchFn } = tokenAndGaql(() =>
      jsonOk({
        results: [
          {
            campaign: { id: "111", name: "Alpha" },
            metrics: {
              impressions: "100",
              clicks: "5",
              cost_micros: "1000000",
              conversions: 1,
            },
          },
          {
            campaign: { id: "111", name: "Alpha" },
            metrics: {
              impressions: "50",
              clicks: "2",
              cost_micros: "500000",
              conversions: 0,
            },
          },
          {
            campaign: { id: "222", name: "Beta" },
            metrics: {
              impressions: "10",
              clicks: "1",
              cost_micros: "100000",
              conversions: 0.5,
            },
          },
        ],
      })
    );
    const provider = new GoogleAdsApiProvider({
      apiVersion: "v22",
      fetchFn,
    });
    const stats = await provider.listCampaignStats("1234567890", {
      startDate: "2026-10-20",
      endDate: "2026-10-27",
    });
    expect(stats).toEqual([
      {
        campaignId: "111",
        campaignName: "Alpha",
        impressions: 150,
        clicks: 7,
        costMicros: 1500000,
        conversions: 1,
      },
      {
        campaignId: "222",
        campaignName: "Beta",
        impressions: 10,
        clicks: 1,
        costMicros: 100000,
        conversions: 0.5,
      },
    ]);
  });

  it("rejects bad date ranges before any network call", async () => {
    const { fetchFn, calls } = tokenAndGaql(() => jsonOk({ results: [] }));
    const provider = new GoogleAdsApiProvider({
      apiVersion: "v22",
      fetchFn,
    });
    await expect(
      provider.listCampaignStats("1234567890", {
        startDate: "2026-10-27",
        endDate: "2026-10-20",
      })
    ).rejects.toMatchObject({ googleCode: "INVALID_ARGUMENT" });
    await expect(
      provider.listCampaignStats("1234567890", {
        startDate: "10/20/2026",
        endDate: "2026-10-27",
      })
    ).rejects.toMatchObject({ googleCode: "INVALID_ARGUMENT" });
    expect(calls.token).toBe(0);
    expect(calls.gaql).toBe(0);
  });

  it("maps HTTP errors to stable provider codes", async () => {
    const cases: Array<{
      status: number;
      body: string;
      code: string;
    }> = [
      {
        status: 401,
        body: JSON.stringify({
          error: { message: "Request had invalid authentication credentials." },
        }),
        code: "UNAUTHORIZED",
      },
      { status: 429, body: "too many requests", code: "RATE_LIMITED" },
      { status: 500, body: "internal error", code: "TEMPORARY_ERROR" },
    ];
    for (const c of cases) {
      const { fetchFn } = tokenAndGaql(() => ({
        ok: false,
        status: c.status,
        textData: c.body,
      }));
      const provider = new GoogleAdsApiProvider({
        apiVersion: "v22",
        fetchFn,
      });
      await expect(provider.listCampaigns("1234567890")).rejects.toMatchObject(
        { googleCode: c.code }
      );
    }
  });

  it("names missing credential variables, never their values", async () => {
    for (const key of ENV_VARS) delete process.env[key];
    const provider = new GoogleAdsApiProvider({
      apiVersion: "v22",
      fetchFn: stubFetch(() => {
        throw new Error("must not be called without credentials");
      }),
    });
    await expect(provider.listCampaigns("1234567890")).rejects.toMatchObject({
      googleCode: "UNAUTHORIZED",
    });
    try {
      await provider.listCampaigns("1234567890");
      expect.unreachable();
    } catch (err) {
      const error = err as { details?: { missing?: string[] } };
      expect(error.details?.missing).toEqual([...ENV_VARS]);
    }
  });

  it("lists accessible customers then resolves each one", async () => {
    const calls = { token: 0 };
    const fetchFn = stubFetch((url, init) => {
      if (url === "https://oauth2.googleapis.com/token") {
        calls.token += 1;
        return jsonOk({ access_token: "tok-test", expires_in: 3600 });
      }
      if (url.endsWith("/customers:listAccessibleCustomers")) {
        return jsonOk({
          resourceNames: ["customers/111", "customers/222"],
        });
      }
      const body = JSON.parse(init.body ?? "{}") as Record<string, unknown>;
      expect(body.query).toContain("FROM customer");
      const customerId = url.split("/customers/")[1]?.split("/")[0];
      return jsonOk({
        results: [
          {
            customer: {
              id: customerId,
              descriptive_name: `Acct ${customerId}`,
              currency_code: "CNY",
              time_zone: "Asia/Shanghai",
            },
          },
        ],
      });
    });
    const provider = new GoogleAdsApiProvider({
      apiVersion: "v22",
      fetchFn,
    });
    const customers = await provider.listCustomers();
    expect(customers.map((c) => c.customerId)).toEqual(["111", "222"]);
    expect(customers[0]?.descriptiveName).toBe("Acct 111");
    expect(customers[0]?.currencyCode).toBe("CNY");
    expect(calls.token).toBe(1);
  });

  it("still refuses mutations by design", async () => {
    const provider = new GoogleAdsApiProvider({
      apiVersion: "v22",
      fetchFn: stubFetch(() => jsonOk({})),
    });
    await expect(
      provider.updateEntityUrl({
        entityType: "AD",
        adId: "1",
        finalUrl: "https://example.com/",
      })
    ).rejects.toMatchObject({ googleCode: "INVALID_ARGUMENT" });
    await expect(
      provider.uploadConversion({
        customerId: "1234567890",
        conversionAction: "x",
        conversionDateTime: "2026-10-28 00:00:00+08:00",
      })
    ).rejects.toMatchObject({ googleCode: "INVALID_ARGUMENT" });
  });
});

describe("MockGoogleAdsProvider campaign stats", () => {
  it("returns deterministic rows for the customer's campaigns", async () => {
    const provider = new MockGoogleAdsProvider();
    const stats = await provider.listCampaignStats("mock-customer-001", {
      startDate: "2026-10-20",
      endDate: "2026-10-27",
    });
    expect(stats.map((s) => s.campaignId)).toEqual([
      "camp-1001",
      "mock-campaign-002",
    ]);
    expect(stats[0]?.impressions).toBe(1000);
    expect(stats[0]?.conversions).toBe(2);
    const again = await provider.listCampaignStats("mock-customer-001", {
      startDate: "2026-10-20",
      endDate: "2026-10-27",
    });
    expect(again).toEqual(stats);
  });

  it("filters by campaignIds", async () => {
    const provider = new MockGoogleAdsProvider();
    const stats = await provider.listCampaignStats("mock-customer-001", {
      startDate: "2026-10-20",
      endDate: "2026-10-27",
      campaignIds: ["mock-campaign-002"],
    });
    expect(stats.map((s) => s.campaignId)).toEqual(["mock-campaign-002"]);
  });
});
