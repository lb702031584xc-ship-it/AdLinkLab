import { describe, expect, it } from "vitest";
import type { GoogleAdsProvider } from "./provider.js";
import { MockGoogleAdsProvider } from "./mock-provider.js";
import { GoogleAdsApiProvider } from "./api-provider.js";
import {
  classifyGoogleAdsError,
  GoogleAdsProviderError,
  isRetryableGoogleAdsCode,
} from "./errors.js";
import { MockGoogleCredentialProvider } from "./credentials.js";

/**
 * Phase 2 provider contract suite — Mock must pass fully.
 * ApiProvider: construction + type surface + explicit mutation refusal.
 */
function runGoogleAdsProviderContract(
  label: string,
  createProvider: () => GoogleAdsProvider,
  mode: "mock" | "api-skeleton"
) {
  describe(`GoogleAdsProvider contract (${label})`, () => {
    it("exposes required read methods", () => {
      const provider = createProvider();
      expect(typeof provider.getCustomer).toBe("function");
      expect(typeof provider.listCustomers).toBe("function");
      expect(typeof provider.getCampaign).toBe("function");
      expect(typeof provider.listCampaigns).toBe("function");
      expect(typeof provider.getAdGroup).toBe("function");
      expect(typeof provider.listAdGroups).toBe("function");
      expect(typeof provider.getAd).toBe("function");
      expect(typeof provider.listAds).toBe("function");
      expect(typeof provider.listAdGroupCriteria).toBe("function");
    });

    if (mode === "api-skeleton") {
      it("read methods return NOT_IMPLEMENTED without live credentials", async () => {
        const provider = createProvider();
        await expect(provider.listCustomers()).rejects.toMatchObject({
          googleCode: "NOT_IMPLEMENTED",
        });
        await expect(
          provider.getCustomer("mock-customer-001")
        ).rejects.toMatchObject({ googleCode: "NOT_IMPLEMENTED" });
      });

      it("refuses mutations in Phase 2", async () => {
        const provider = createProvider();
        await expect(
          provider.updateAdUrl("ad-3001", "https://example.com/x")
        ).rejects.toMatchObject({ googleCode: "INVALID_ARGUMENT" });
        await expect(
          provider.updateEntityUrl({
            entityType: "AD",
            adId: "ad-3001",
            finalUrl: "https://example.com/x",
          })
        ).rejects.toMatchObject({ googleCode: "INVALID_ARGUMENT" });
        await expect(
          provider.uploadConversion({
            customerId: "mock-customer-001",
            conversionAction: "purchase",
            conversionDateTime: "2026-01-01T00:00:00+00:00",
          })
        ).rejects.toMatchObject({ googleCode: "INVALID_ARGUMENT" });
      });

      it("getStatus reports credential ref without secrets", async () => {
        const provider = createProvider() as GoogleAdsApiProvider;
        const status = await provider.getStatus();
        expect(status.kind).toBe("api");
        expect(status.liveApiEnabled).toBe(false);
        expect(status.mutationsEnabled).toBe(false);
        expect(status.credentialRef).toBeTruthy();
        expect(JSON.stringify(status)).not.toMatch(/secret|token|password/i);
      });

      return;
    }

    it("getCustomer returns fixture-aligned customer", async () => {
      const provider = createProvider();
      const customer = await provider.getCustomer("mock-customer-001");
      expect(customer.customerId).toBe("mock-customer-001");
      expect(customer.descriptiveName).toContain("Mock");
    });

    it("listCustomers returns deterministic customers", async () => {
      const provider = createProvider();
      const customers = await provider.listCustomers();
      expect(customers.map((c) => c.customerId).sort()).toEqual([
        "mock-customer-001",
        "mock-customer-002",
      ]);
    });

    it("listCampaigns maps external campaign IDs for customer", async () => {
      const provider = createProvider();
      const campaigns = await provider.listCampaigns("mock-customer-001");
      expect(campaigns.map((c) => c.campaignId).sort()).toEqual([
        "camp-1001",
        "mock-campaign-002",
      ]);
      expect(campaigns.every((c) => c.customerId === "mock-customer-001")).toBe(
        true
      );
    });

    it("listCampaigns empty result for unknown customer", async () => {
      const provider = createProvider();
      const campaigns = await provider.listCampaigns("unknown-customer");
      expect(campaigns).toEqual([]);
    });

    it("getCampaign returns Campaign A", async () => {
      const provider = createProvider();
      const campaign = await provider.getCampaign(
        "mock-customer-001",
        "camp-1001"
      );
      expect(campaign.name).toBe("Campaign A");
      expect(campaign.campaignId).toBe("camp-1001");
    });

    it("listAdGroups returns A1 and A2 under Campaign A", async () => {
      const provider = createProvider();
      const groups = await provider.listAdGroups("camp-1001");
      expect(groups.map((g) => g.adGroupId).sort()).toEqual([
        "ag-2001",
        "mock-adgroup-002",
      ]);
    });

    it("getAdGroup returns AdGroup A1", async () => {
      const provider = createProvider();
      const group = await provider.getAdGroup("camp-1001", "ag-2001");
      expect(group.name).toBe("AdGroup A1");
    });

    it("listAds returns ads for AdGroup A1", async () => {
      const provider = createProvider();
      const ads = await provider.listAds("ag-2001");
      expect(ads.map((a) => a.adId).sort()).toEqual([
        "ad-3001",
        "mock-ad-001b",
      ]);
    });

    it("getAd returns external ad id ad-3001", async () => {
      const provider = createProvider();
      const ad = await provider.getAd("ag-2001", "ad-3001");
      expect(ad.adId).toBe("ad-3001");
      expect(ad.finalUrl).toContain("example.com");
    });

    it("listAdGroupCriteria returns criteria for AdGroup A1", async () => {
      const provider = createProvider();
      const criteria = await provider.listAdGroupCriteria("ag-2001");
      expect(criteria.map((c) => c.criterionId).sort()).toEqual([
        "mock-criterion-001",
        "mock-criterion-001b",
      ]);
      expect(criteria[0]?.keyword).toBeTruthy();
    });

    it("listAds with pageSize applies soft pagination cap", async () => {
      const provider = createProvider();
      const ads = await provider.listAds("ag-2001", { pageSize: 1 });
      expect(ads).toHaveLength(1);
    });

    it("getCustomer NOT_FOUND is non-retryable", async () => {
      const provider = createProvider();
      try {
        await provider.getCustomer("missing-customer");
        expect.fail("expected error");
      } catch (error) {
        expect(error).toBeInstanceOf(GoogleAdsProviderError);
        const e = error as GoogleAdsProviderError;
        expect(e.googleCode).toBe("NOT_FOUND");
        expect(e.retryable).toBe(false);
        expect(classifyGoogleAdsError(e).retryable).toBe(false);
      }
    });

    it("getCampaign NOT_FOUND", async () => {
      const provider = createProvider();
      await expect(
        provider.getCampaign("mock-customer-001", "missing")
      ).rejects.toMatchObject({ googleCode: "NOT_FOUND", retryable: false });
    });

    it("getAd NOT_FOUND", async () => {
      const provider = createProvider();
      await expect(provider.getAd("ag-2001", "missing-ad")).rejects.toMatchObject(
        { googleCode: "NOT_FOUND" }
      );
    });
  });
}

runGoogleAdsProviderContract(
  "MockGoogleAdsProvider",
  () => new MockGoogleAdsProvider(),
  "mock"
);

runGoogleAdsProviderContract(
  "GoogleAdsApiProvider skeleton",
  () =>
    new GoogleAdsApiProvider({
      credentialRef: "vault:ref:test-only",
      credentialProvider: new MockGoogleCredentialProvider(),
      developerTokenConfigured: false,
    }),
  "api-skeleton"
);

describe("MockGoogleAdsProvider error simulation", () => {
  it("configureError UNAUTHORIZED is non-retryable", async () => {
    const provider = new MockGoogleAdsProvider();
    provider.configureError({
      method: "listCampaigns",
      code: "UNAUTHORIZED",
      message: "mock unauthorized",
    });
    await expect(
      provider.listCampaigns("mock-customer-001")
    ).rejects.toMatchObject({
      googleCode: "UNAUTHORIZED",
      retryable: false,
    });
  });

  it("configureError RATE_LIMITED is retryable", async () => {
    const provider = new MockGoogleAdsProvider();
    provider.configureError({
      method: "*",
      code: "RATE_LIMITED",
      externalCode: "RESOURCE_EXHAUSTED",
    });
    await expect(provider.listCustomers()).rejects.toMatchObject({
      googleCode: "RATE_LIMITED",
      retryable: true,
      externalCode: "RESOURCE_EXHAUSTED",
    });
    expect(isRetryableGoogleAdsCode("RATE_LIMITED")).toBe(true);
  });

  it("configureError TEMPORARY_ERROR is retryable", async () => {
    const provider = new MockGoogleAdsProvider();
    provider.configureError({ method: "getAd", code: "TEMPORARY_ERROR" });
    await expect(provider.getAd("ag-2001", "ad-3001")).rejects.toMatchObject({
      googleCode: "TEMPORARY_ERROR",
      retryable: true,
    });
  });

  it("configureError INVALID_ARGUMENT is non-retryable", async () => {
    const provider = new MockGoogleAdsProvider();
    provider.configureError({
      method: "listAdGroups",
      code: "INVALID_ARGUMENT",
    });
    await expect(provider.listAdGroups("camp-1001")).rejects.toMatchObject({
      googleCode: "INVALID_ARGUMENT",
      retryable: false,
    });
  });

  it("configureError null clears simulation", async () => {
    const provider = new MockGoogleAdsProvider();
    provider.configureError({ method: "*", code: "TEMPORARY_ERROR" });
    provider.configureError(null);
    await expect(provider.listCustomers()).resolves.toHaveLength(2);
  });

  it("method-scoped error does not affect other methods", async () => {
    const provider = new MockGoogleAdsProvider();
    provider.configureError({ method: "getCustomer", code: "UNAUTHORIZED" });
    await expect(provider.listCampaigns("mock-customer-001")).resolves.toHaveLength(
      2
    );
    await expect(
      provider.getCustomer("mock-customer-001")
    ).rejects.toMatchObject({ googleCode: "UNAUTHORIZED" });
  });
});

describe("Credential abstraction", () => {
  it("MockGoogleCredentialProvider never exposes secrets", async () => {
    const creds = new MockGoogleCredentialProvider();
    const handle = await creds.resolve("vault:ref:mock-google-ads-oauth-a");
    expect(handle.isConfigured).toBe(true);
    expect(handle.credentialRef).toBe("vault:ref:mock-google-ads-oauth-a");
    expect(Object.keys(handle).sort()).toEqual([
      "credentialRef",
      "isConfigured",
    ]);
  });
});

describe("Live Google API integration", () => {
  const live =
    process.env.GOOGLE_ADS_LIVE === "1" &&
    Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN);

  it.skipIf(live)("NOT RUN without live credentials", () => {
    // Google live API integration: NOT RUN
    // Reason: no live credentials configured
    expect(live).toBe(false);
  });
});
