import type {
  GoogleAdsAd,
  GoogleAdsAdGroup,
  GoogleAdsAdGroupCriterion,
  GoogleAdsCampaign,
  GoogleAdsCustomer,
} from "./provider.js";

/**
 * Deterministic mock hierarchy aligned with Phase 1.3 fixtures (Tenant A).
 * No Math.random / Date.now.
 */
export const MOCK_CUSTOMERS: GoogleAdsCustomer[] = [
  {
    customerId: "mock-customer-001",
    descriptiveName: "Mock Google Ads Account A",
    currencyCode: "USD",
    timeZone: "America/Los_Angeles",
  },
  {
    customerId: "mock-customer-002",
    descriptiveName: "Mock Google Ads Account B",
    currencyCode: "USD",
    timeZone: "UTC",
  },
];

export const MOCK_CAMPAIGNS: GoogleAdsCampaign[] = [
  {
    campaignId: "camp-1001",
    customerId: "mock-customer-001",
    name: "Campaign A",
    status: "ENABLED",
  },
  {
    campaignId: "mock-campaign-002",
    customerId: "mock-customer-001",
    name: "Campaign B",
    status: "ENABLED",
  },
  {
    campaignId: "mock-campaign-b-001",
    customerId: "mock-customer-002",
    name: "Tenant B Campaign",
    status: "ENABLED",
  },
];

export const MOCK_AD_GROUPS: GoogleAdsAdGroup[] = [
  {
    adGroupId: "ag-2001",
    campaignId: "camp-1001",
    name: "AdGroup A1",
    status: "ENABLED",
  },
  {
    adGroupId: "mock-adgroup-002",
    campaignId: "camp-1001",
    name: "AdGroup A2",
    status: "ENABLED",
  },
  {
    adGroupId: "mock-adgroup-003",
    campaignId: "mock-campaign-002",
    name: "AdGroup B1",
    status: "ENABLED",
  },
  {
    adGroupId: "mock-adgroup-b-001",
    campaignId: "mock-campaign-b-001",
    name: "Tenant B AdGroup",
    status: "ENABLED",
  },
];

export const MOCK_ADS: GoogleAdsAd[] = [
  {
    adId: "ad-3001",
    adGroupId: "ag-2001",
    name: "Ad A1",
    status: "ENABLED",
    finalUrl: "https://example.com/landing-v2",
    trackingTemplate:
      "https://tracker.example.com/click?cid={_clickid}&url={lpurl}",
  },
  {
    adId: "mock-ad-001b",
    adGroupId: "ag-2001",
    name: "Ad A1b",
    status: "ENABLED",
    finalUrl: "https://example.com/offer-a",
  },
  {
    adId: "mock-ad-002",
    adGroupId: "mock-adgroup-002",
    name: "Ad A2",
    status: "ENABLED",
    finalUrl: "https://example.com/offer-b",
  },
  {
    adId: "mock-ad-003",
    adGroupId: "mock-adgroup-003",
    name: "Ad B1",
    status: "ENABLED",
    finalUrl: "https://example.com/offer-a",
  },
  {
    adId: "mock-ad-b-001",
    adGroupId: "mock-adgroup-b-001",
    name: "Tenant B Ad",
    status: "ENABLED",
    finalUrl: "https://example.com/tenant-b/ad",
  },
];

export const MOCK_CRITERIA: GoogleAdsAdGroupCriterion[] = [
  {
    criterionId: "mock-criterion-001",
    adGroupId: "ag-2001",
    keyword: "adlinklab research",
    matchType: "PHRASE",
    status: "ENABLED",
  },
  {
    criterionId: "mock-criterion-001b",
    adGroupId: "ag-2001",
    keyword: "adlinklab demo",
    matchType: "EXACT",
    status: "ENABLED",
  },
  {
    criterionId: "mock-criterion-002",
    adGroupId: "mock-adgroup-002",
    keyword: "offer landing",
    matchType: "BROAD",
    status: "ENABLED",
  },
  {
    criterionId: "mock-criterion-003",
    adGroupId: "mock-adgroup-003",
    keyword: "campaign b keyword",
    matchType: "PHRASE",
    status: "ENABLED",
  },
  {
    criterionId: "mock-criterion-b-001",
    adGroupId: "mock-adgroup-b-001",
    keyword: "isolation keyword",
    matchType: "EXACT",
    status: "ENABLED",
  },
];
