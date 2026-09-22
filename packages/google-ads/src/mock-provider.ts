import type {
  ConversionUploadInput,
  ConversionUploadResult,
  GoogleAdsAd,
  GoogleAdsAdGroup,
  GoogleAdsAdGroupCriterion,
  GoogleAdsCampaign,
  GoogleAdsCustomer,
  GoogleAdsListOptions,
  GoogleAdsProvider,
  UpdateEntityUrlInput,
  UpdateEntityUrlResult,
} from "./provider.js";
import {
  GoogleAdsProviderError,
  type GoogleAdsErrorCode,
} from "./errors.js";
import {
  MOCK_ADS,
  MOCK_AD_GROUPS,
  MOCK_CAMPAIGNS,
  MOCK_CRITERIA,
  MOCK_CUSTOMERS,
} from "./mock-data.js";

export type MockErrorConfig = {
  /** Method name or '*' for all methods */
  method: string | "*";
  code: GoogleAdsErrorCode;
  message?: string;
  externalCode?: string;
};

function applyPageSize<T>(items: T[], options?: GoogleAdsListOptions): T[] {
  if (options?.pageSize !== undefined && options.pageSize >= 0) {
    return items.slice(0, options.pageSize);
  }
  return items;
}

/**
 * Deterministic mock provider for research / local development.
 * Data mirrors Phase 1.3 fixture external IDs.
 * Does not contact Google Ads production APIs.
 */
export class MockGoogleAdsProvider implements GoogleAdsProvider {
  private ads = new Map(MOCK_ADS.map((ad) => [ad.adId, { ...ad }]));
  private simulatedError: MockErrorConfig | null = null;

  /**
   * Deterministic error injection — no random probability.
   * Pass null to clear.
   */
  configureError(error: MockErrorConfig | null): void {
    this.simulatedError = error;
  }

  private maybeThrow(method: string): void {
    const cfg = this.simulatedError;
    if (!cfg) return;
    if (cfg.method !== "*" && cfg.method !== method) return;
    throw new GoogleAdsProviderError(
      cfg.message ?? `Mock Google Ads error: ${cfg.code}`,
      {
        code: cfg.code,
        externalCode: cfg.externalCode,
        details: { method, simulated: true },
      }
    );
  }

  async getCustomer(customerId: string): Promise<GoogleAdsCustomer> {
    this.maybeThrow("getCustomer");
    if (!customerId) {
      throw new GoogleAdsProviderError("customerId is required", {
        code: "INVALID_ARGUMENT",
      });
    }
    const row = MOCK_CUSTOMERS.find((c) => c.customerId === customerId);
    if (!row) {
      throw new GoogleAdsProviderError(`Customer not found: ${customerId}`, {
        code: "NOT_FOUND",
        details: { customerId },
      });
    }
    return { ...row };
  }

  async listCustomers(
    options?: GoogleAdsListOptions
  ): Promise<GoogleAdsCustomer[]> {
    this.maybeThrow("listCustomers");
    return applyPageSize(
      MOCK_CUSTOMERS.map((c) => ({ ...c })),
      options
    );
  }

  async getCampaign(
    customerId: string,
    campaignId: string
  ): Promise<GoogleAdsCampaign> {
    this.maybeThrow("getCampaign");
    const row = MOCK_CAMPAIGNS.find(
      (c) => c.customerId === customerId && c.campaignId === campaignId
    );
    if (!row) {
      throw new GoogleAdsProviderError(`Campaign not found: ${campaignId}`, {
        code: "NOT_FOUND",
        details: { customerId, campaignId },
      });
    }
    return { ...row };
  }

  async listCampaigns(
    customerId: string,
    options?: GoogleAdsListOptions
  ): Promise<GoogleAdsCampaign[]> {
    this.maybeThrow("listCampaigns");
    return applyPageSize(
      MOCK_CAMPAIGNS.filter((c) => c.customerId === customerId).map((c) => ({
        ...c,
      })),
      options
    );
  }

  async getAdGroup(
    campaignId: string,
    adGroupId: string
  ): Promise<GoogleAdsAdGroup> {
    this.maybeThrow("getAdGroup");
    const row = MOCK_AD_GROUPS.find(
      (g) => g.campaignId === campaignId && g.adGroupId === adGroupId
    );
    if (!row) {
      throw new GoogleAdsProviderError(`AdGroup not found: ${adGroupId}`, {
        code: "NOT_FOUND",
        details: { campaignId, adGroupId },
      });
    }
    return { ...row };
  }

  async listAdGroups(
    campaignId: string,
    options?: GoogleAdsListOptions
  ): Promise<GoogleAdsAdGroup[]> {
    this.maybeThrow("listAdGroups");
    return applyPageSize(
      MOCK_AD_GROUPS.filter((g) => g.campaignId === campaignId).map((g) => ({
        ...g,
      })),
      options
    );
  }

  async getAd(adGroupId: string, adId: string): Promise<GoogleAdsAd> {
    this.maybeThrow("getAd");
    const row = this.ads.get(adId);
    if (!row || row.adGroupId !== adGroupId) {
      throw new GoogleAdsProviderError(`Ad not found: ${adId}`, {
        code: "NOT_FOUND",
        details: { adGroupId, adId },
      });
    }
    return { ...row };
  }

  async listAds(
    adGroupId: string,
    options?: GoogleAdsListOptions
  ): Promise<GoogleAdsAd[]> {
    this.maybeThrow("listAds");
    return applyPageSize(
      [...this.ads.values()]
        .filter((a) => a.adGroupId === adGroupId)
        .map((a) => ({ ...a })),
      options
    );
  }

  async listAdGroupCriteria(
    adGroupId: string,
    options?: GoogleAdsListOptions
  ): Promise<GoogleAdsAdGroupCriterion[]> {
    this.maybeThrow("listAdGroupCriteria");
    return applyPageSize(
      MOCK_CRITERIA.filter((c) => c.adGroupId === adGroupId).map((c) => ({
        ...c,
      })),
      options
    );
  }

  async updateEntityUrl(
    input: UpdateEntityUrlInput
  ): Promise<UpdateEntityUrlResult> {
    this.maybeThrow("updateEntityUrl");
    if (input.entityType !== "AD") {
      throw new GoogleAdsProviderError(
        "Mock provider only mutates AD entity URLs",
        { code: "INVALID_ARGUMENT", details: { entityType: input.entityType } }
      );
    }
    const existing = this.ads.get(input.adId);
    if (!existing) {
      throw new GoogleAdsProviderError(`Mock ad not found: ${input.adId}`, {
        code: "NOT_FOUND",
        details: { adId: input.adId },
      });
    }
    this.ads.set(input.adId, {
      ...existing,
      finalUrl: input.finalUrl,
      finalMobileUrl: input.finalMobileUrl ?? existing.finalMobileUrl,
      finalAppUrl: input.finalAppUrl ?? existing.finalAppUrl,
      trackingTemplate: input.trackingTemplate ?? existing.trackingTemplate,
      customParameters: input.customParameters ?? existing.customParameters,
    });
    return {
      success: true,
      providerRequestId: `mock-url-${input.adId}`,
      message: "Mock updateEntityUrl applied (no real Google Ads mutation)",
    };
  }

  async updateAdUrl(
    adId: string,
    finalUrl: string,
    trackingTemplate?: string
  ): Promise<void> {
    this.maybeThrow("updateAdUrl");
    await this.updateEntityUrl({
      entityType: "AD",
      adId,
      finalUrl,
      trackingTemplate,
    });
  }

  async uploadConversion(
    input: ConversionUploadInput
  ): Promise<ConversionUploadResult> {
    this.maybeThrow("uploadConversion");
    const clickKey =
      input.gclid ?? input.gbraid ?? input.wbraid ?? "unknown";
    return {
      success: true,
      externalId: `mock-conv-${clickKey}-fixture`,
      message: "Mock conversion accepted (no real Google Ads upload)",
    };
  }
}
