import type {
  Ad,
  AdGroup,
  AdGroupCriterion,
  Campaign,
  CampaignStatus,
  AdGroupStatus,
  AdStatus,
  CriterionStatus,
} from "@adlinklab/domain";
import type {
  GoogleAdsAd,
  GoogleAdsAdGroup,
  GoogleAdsAdGroupCriterion,
  GoogleAdsCampaign,
} from "@adlinklab/google-ads";

/** Map Google Ads resource status → local status enums (reuse existing). */
export function mapGoogleResourceStatus(
  status: string
): "ACTIVE" | "PAUSED" | "ARCHIVED" | "REMOVED" {
  const s = status.toUpperCase();
  if (s === "ENABLED" || s === "ACTIVE") return "ACTIVE";
  if (s === "PAUSED") return "PAUSED";
  if (s === "REMOVED") return "ARCHIVED";
  return "PAUSED";
}

export function mapCampaignFromGoogle(
  dto: GoogleAdsCampaign,
  ids: { id: string; tenantId: string; googleAccountId: string }
): Omit<Campaign, "createdAt" | "updatedAt"> {
  return {
    id: ids.id,
    tenantId: ids.tenantId,
    googleAccountId: ids.googleAccountId,
    googleCampaignId: dto.campaignId,
    name: dto.name,
    status: mapGoogleResourceStatus(dto.status) as CampaignStatus,
  };
}

export function mapAdGroupFromGoogle(
  dto: GoogleAdsAdGroup,
  ids: { id: string; tenantId: string; campaignId: string }
): Omit<AdGroup, "createdAt" | "updatedAt"> {
  return {
    id: ids.id,
    tenantId: ids.tenantId,
    campaignId: ids.campaignId,
    googleAdGroupId: dto.adGroupId,
    name: dto.name,
    status: mapGoogleResourceStatus(dto.status) as AdGroupStatus,
  };
}

export function mapAdFromGoogle(
  dto: GoogleAdsAd,
  ids: { id: string; tenantId: string; adGroupId: string }
): Omit<Ad, "createdAt" | "updatedAt"> {
  return {
    id: ids.id,
    tenantId: ids.tenantId,
    adGroupId: ids.adGroupId,
    googleAdId: dto.adId,
    name: dto.name,
    status: mapGoogleResourceStatus(dto.status) as AdStatus,
    finalUrl: dto.finalUrl,
    trackingTemplate: dto.trackingTemplate,
  };
}

export function mapCriterionFromGoogle(
  dto: GoogleAdsAdGroupCriterion,
  ids: { id: string; tenantId: string; adGroupId: string }
): Omit<AdGroupCriterion, "createdAt" | "updatedAt"> {
  return {
    id: ids.id,
    tenantId: ids.tenantId,
    adGroupId: ids.adGroupId,
    googleCriterionId: dto.criterionId,
    keyword: dto.keyword,
    keywordText: dto.keyword,
    matchType: dto.matchType,
    status: mapGoogleResourceStatus(dto.status) as CriterionStatus,
  };
}
