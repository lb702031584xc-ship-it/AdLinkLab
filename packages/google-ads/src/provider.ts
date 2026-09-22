/**
 * Provider DTOs — Google external IDs only (not AdLinkLab internal UUIDs).
 * Domain maps Campaign.googleCampaignId ↔ campaignId here.
 */

export interface GoogleAdsCustomer {
  /** Google customer / MCC child ID (external) */
  customerId: string;
  descriptiveName: string;
  currencyCode: string;
  timeZone: string;
}

export interface GoogleAdsCampaign {
  /** Google external campaign ID — maps to Campaign.googleCampaignId */
  campaignId: string;
  customerId: string;
  name: string;
  status: string;
}

export interface GoogleAdsAdGroup {
  /** Google external ad group ID — maps to AdGroup.googleAdGroupId */
  adGroupId: string;
  campaignId: string;
  name: string;
  status: string;
}

export interface GoogleAdsAd {
  /** Google external ad ID — maps to Ad.googleAdId */
  adId: string;
  adGroupId: string;
  name: string;
  status: string;
  finalUrl?: string;
  finalMobileUrl?: string;
  finalAppUrl?: string;
  trackingTemplate?: string;
  customParameters?: Record<string, string>;
}

/** Provider-side mutation DTO — separate from Domain UrlVersion */
export interface UpdateEntityUrlInput {
  customerId?: string;
  entityType: "AD";
  /** Google external ad ID */
  adId: string;
  finalUrl: string;
  finalMobileUrl?: string;
  finalAppUrl?: string;
  trackingTemplate?: string;
  customParameters?: Record<string, string>;
}

export interface UpdateEntityUrlResult {
  success: boolean;
  providerRequestId?: string;
  message?: string;
}

export interface GoogleAdsAdGroupCriterion {
  /** Google external criterion ID — maps to AdGroupCriterion.googleCriterionId */
  criterionId: string;
  adGroupId: string;
  keyword?: string;
  matchType?: string;
  status: string;
}

export interface ConversionUploadInput {
  customerId: string;
  conversionAction: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  conversionDateTime: string;
  conversionValue?: number;
  currencyCode?: string;
  orderId?: string;
}

export interface ConversionUploadResult {
  success: boolean;
  externalId?: string;
  message?: string;
}

/**
 * Pagination options — SDK page tokens stay inside adapters.
 * Callers receive a flat array; adapters may internally drain pages.
 */
export interface GoogleAdsListOptions {
  /** Soft cap for returned rows after adapter-side pagination drain */
  pageSize?: number;
}

/**
 * Provider interface isolating Google Ads from application / domain code.
 *
 * Read methods are Phase 2 primary surface.
 * updateAdUrl / uploadConversion remain for Phase 0.1 mock workflows;
 * GoogleAdsApiProvider must NOT implement real mutations.
 */
export interface GoogleAdsProvider {
  getCustomer(customerId: string): Promise<GoogleAdsCustomer>;
  listCustomers(options?: GoogleAdsListOptions): Promise<GoogleAdsCustomer[]>;

  getCampaign(customerId: string, campaignId: string): Promise<GoogleAdsCampaign>;
  listCampaigns(
    customerId: string,
    options?: GoogleAdsListOptions
  ): Promise<GoogleAdsCampaign[]>;

  getAdGroup(campaignId: string, adGroupId: string): Promise<GoogleAdsAdGroup>;
  listAdGroups(
    campaignId: string,
    options?: GoogleAdsListOptions
  ): Promise<GoogleAdsAdGroup[]>;

  getAd(adGroupId: string, adId: string): Promise<GoogleAdsAd>;
  listAds(
    adGroupId: string,
    options?: GoogleAdsListOptions
  ): Promise<GoogleAdsAd[]>;

  listAdGroupCriteria(
    adGroupId: string,
    options?: GoogleAdsListOptions
  ): Promise<GoogleAdsAdGroupCriterion[]>;

  /**
   * Phase 6 preferred mutation surface — ApiProvider must refuse real mutate.
   */
  updateEntityUrl(input: UpdateEntityUrlInput): Promise<UpdateEntityUrlResult>;

  /**
   * Mock / research mutation hook — ApiProvider must refuse.
   * Thin alias of updateEntityUrl for AD finalUrl + trackingTemplate.
   */
  updateAdUrl(
    adId: string,
    finalUrl: string,
    trackingTemplate?: string
  ): Promise<void>;

  /**
   * Conversion upload — ApiProvider must refuse real upload in Phase 2.
   */
  uploadConversion(
    input: ConversionUploadInput
  ): Promise<ConversionUploadResult>;
}
