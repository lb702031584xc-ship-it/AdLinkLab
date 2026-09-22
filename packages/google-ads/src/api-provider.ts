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
import { GoogleAdsProviderError } from "./errors.js";
import type { GoogleCredentialProvider } from "./credentials.js";
import { EnvGoogleCredentialProvider } from "./credentials.js";

export interface GoogleAdsApiProviderConfig {
  /** Opaque credential reference — never pass raw OAuth secrets into domain */
  credentialRef?: string;
  credentialProvider?: GoogleCredentialProvider;
  /**
   * @deprecated Prefer credentialRef + GoogleCredentialProvider.
   * Kept for factory wiring; values are NOT logged.
   */
  developerTokenConfigured?: boolean;
}

/**
 * Read-only skeleton adapter for the real Google Ads API.
 *
 * Phase 2:
 * - authentication / configuration hooks
 * - credential resolution via GoogleCredentialProvider
 * - read method stubs (not live calls without credentials)
 * - mutations explicitly refused
 *
 * Does NOT call production Google Ads APIs in this phase.
 */
export class GoogleAdsApiProvider implements GoogleAdsProvider {
  private readonly credentialRef: string;
  private readonly credentials: GoogleCredentialProvider;
  private readonly developerTokenConfigured: boolean;

  constructor(config: GoogleAdsApiProviderConfig = {}) {
    this.credentialRef =
      config.credentialRef ?? "env:GOOGLE_ADS_DEVELOPER_TOKEN";
    this.credentials =
      config.credentialProvider ?? new EnvGoogleCredentialProvider();
    this.developerTokenConfigured = Boolean(config.developerTokenConfigured);
  }

  /** Construction / health probe — no secrets returned. */
  async getStatus(): Promise<{
    kind: "api";
    credentialRef: string;
    isConfigured: boolean;
    liveApiEnabled: false;
    mutationsEnabled: false;
  }> {
    const handle = await this.credentials.resolve(this.credentialRef);
    return {
      kind: "api",
      credentialRef: handle.credentialRef,
      isConfigured: handle.isConfigured || this.developerTokenConfigured,
      liveApiEnabled: false,
      mutationsEnabled: false,
    };
  }

  private notImplemented(method: string): never {
    throw new GoogleAdsProviderError(
      `GoogleAdsApiProvider.${method} requires live credentials and is not enabled in Phase 2.`,
      {
        code: "NOT_IMPLEMENTED",
        details: {
          method,
          credentialRef: this.credentialRef,
          developerTokenConfigured: this.developerTokenConfigured,
        },
      }
    );
  }

  private mutationForbidden(method: string): never {
    throw new GoogleAdsProviderError(
      `GoogleAdsApiProvider.${method} mutation is forbidden in Phase 2.`,
      {
        code: "INVALID_ARGUMENT",
        details: { method, mutationsEnabled: false },
      }
    );
  }

  async getCustomer(_customerId: string): Promise<GoogleAdsCustomer> {
    this.notImplemented("getCustomer");
  }

  async listCustomers(
    _options?: GoogleAdsListOptions
  ): Promise<GoogleAdsCustomer[]> {
    this.notImplemented("listCustomers");
  }

  async getCampaign(
    _customerId: string,
    _campaignId: string
  ): Promise<GoogleAdsCampaign> {
    this.notImplemented("getCampaign");
  }

  async listCampaigns(
    _customerId: string,
    _options?: GoogleAdsListOptions
  ): Promise<GoogleAdsCampaign[]> {
    this.notImplemented("listCampaigns");
  }

  async getAdGroup(
    _campaignId: string,
    _adGroupId: string
  ): Promise<GoogleAdsAdGroup> {
    this.notImplemented("getAdGroup");
  }

  async listAdGroups(
    _campaignId: string,
    _options?: GoogleAdsListOptions
  ): Promise<GoogleAdsAdGroup[]> {
    this.notImplemented("listAdGroups");
  }

  async getAd(_adGroupId: string, _adId: string): Promise<GoogleAdsAd> {
    this.notImplemented("getAd");
  }

  async listAds(
    _adGroupId: string,
    _options?: GoogleAdsListOptions
  ): Promise<GoogleAdsAd[]> {
    this.notImplemented("listAds");
  }

  async listAdGroupCriteria(
    _adGroupId: string,
    _options?: GoogleAdsListOptions
  ): Promise<GoogleAdsAdGroupCriterion[]> {
    this.notImplemented("listAdGroupCriteria");
  }

  async updateEntityUrl(
    _input: UpdateEntityUrlInput
  ): Promise<UpdateEntityUrlResult> {
    this.mutationForbidden("updateEntityUrl");
  }

  async updateAdUrl(
    _adId: string,
    _finalUrl: string,
    _trackingTemplate?: string
  ): Promise<void> {
    this.mutationForbidden("updateAdUrl");
  }

  async uploadConversion(
    _input: ConversionUploadInput
  ): Promise<ConversionUploadResult> {
    this.mutationForbidden("uploadConversion");
  }
}
