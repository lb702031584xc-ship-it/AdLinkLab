import type { GoogleAccountRepository } from "@adlinklab/domain";
import { assertSameTenant } from "@adlinklab/domain";
import type {
  GoogleAdsCampaignStats,
  GoogleAdsProvider,
} from "@adlinklab/google-ads";
import {
  NotFoundError,
  ValidationError,
} from "@adlinklab/shared";

export interface GoogleAdsStatsInput {
  tenantId: string;
  googleAccountId: string;
  startDate: string;
  endDate: string;
  campaignIds?: string[];
}

export interface GoogleAdsStatsResult {
  accountId: string;
  customerId: string;
  /** "mock" = fixture data, "api" = live Google Ads API. */
  provider: "mock" | "api";
  currency: string;
  startDate: string;
  endDate: string;
  stats: GoogleAdsCampaignStats[];
}

/**
 * Provider-backed campaign performance reads.
 *
 * Unlike GoogleAdsSyncService (which writes the hierarchy into local DB),
 * this service only reads: it resolves the tenant's Google account to its
 * customerId, then delegates to the provider's listCampaignStats. No rows
 * are written, and no mutations are possible through this path.
 */
export class GoogleAdsStatsService {
  constructor(
    private readonly googleAccounts: GoogleAccountRepository,
    private readonly provider: GoogleAdsProvider,
    private readonly providerKind: "mock" | "api"
  ) {}

  async getCampaignStats(
    input: GoogleAdsStatsInput
  ): Promise<GoogleAdsStatsResult> {
    const account = await this.googleAccounts.findByIdForTenant(
      input.tenantId,
      input.googleAccountId
    );
    if (!account) {
      throw new NotFoundError("GoogleAccount", input.googleAccountId);
    }
    assertSameTenant(input.tenantId, account.tenantId, "GoogleAccount");

    const customerId = account.customerId ?? account.googleCustomerId;
    if (!customerId) {
      throw new ValidationError("GoogleAccount missing customerId");
    }

    const stats = await this.provider.listCampaignStats(customerId, {
      startDate: input.startDate,
      endDate: input.endDate,
      campaignIds: input.campaignIds,
    });
    return {
      accountId: account.id,
      customerId,
      provider: this.providerKind,
      currency: account.currency,
      startDate: input.startDate,
      endDate: input.endDate,
      stats,
    };
  }
}
