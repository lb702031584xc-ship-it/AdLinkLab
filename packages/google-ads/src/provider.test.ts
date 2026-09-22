import { describe, expect, it } from "vitest";
import {
  createGoogleAdsProvider,
  MockGoogleAdsProvider,
  GoogleAdsApiProvider,
} from "./index.js";

describe("createGoogleAdsProvider factory", () => {
  it("defaults to mock", async () => {
    const provider = createGoogleAdsProvider();
    expect(provider).toBeInstanceOf(MockGoogleAdsProvider);
    const customers = await provider.listCustomers();
    expect(customers[0]?.customerId).toBe("mock-customer-001");
  });

  it("creates api skeleton without throwing", () => {
    const provider = createGoogleAdsProvider("api");
    expect(provider).toBeInstanceOf(GoogleAdsApiProvider);
  });
});

describe("MockGoogleAdsProvider hierarchy", () => {
  it("walks Campaign A → AdGroup A1 → Ads → Criteria", async () => {
    const provider = new MockGoogleAdsProvider();
    const campaigns = await provider.listCampaigns("mock-customer-001");
    const campaignA = campaigns.find((c) => c.campaignId === "camp-1001")!;
    const groups = await provider.listAdGroups(campaignA.campaignId);
    const a1 = groups.find((g) => g.adGroupId === "ag-2001")!;
    const ads = await provider.listAds(a1.adGroupId);
    const criteria = await provider.listAdGroupCriteria(a1.adGroupId);
    expect(ads.length).toBeGreaterThanOrEqual(2);
    expect(criteria.length).toBeGreaterThanOrEqual(2);
  });

  it("updateAdUrl mutates mock ad for Phase 0.1 workflows", async () => {
    const provider = new MockGoogleAdsProvider();
    await provider.updateAdUrl(
      "ad-3001",
      "https://example.com/updated",
      "https://tracker.example.com/x"
    );
    const ad = await provider.getAd("ag-2001", "ad-3001");
    expect(ad.finalUrl).toBe("https://example.com/updated");
  });
});
