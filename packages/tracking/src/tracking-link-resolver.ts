import type {
  AttributionContext,
  LandingPage,
  LandingPageRepository,
  Offer,
  OfferRepository,
  TrackingLink,
  TrackingLinkRepository,
} from "@adlinklab/domain";
import { createAttributionContext } from "@adlinklab/domain";
import { NotFoundError, ValidationError } from "@adlinklab/shared";
import { assertSafeRedirectUrl } from "./url-validation.js";

export interface ResolvedTrackingLink {
  trackingLink: TrackingLink;
  offer: Offer;
  landingPage: LandingPage;
  attribution: AttributionContext;
  redirectUrl: string;
}

/**
 * Resolves a tenant-scoped TrackingLink into immutable attribution + redirect.
 * Controllers must not assemble AttributionContext themselves.
 */
export class TrackingLinkResolver {
  constructor(
    private readonly trackingLinks: TrackingLinkRepository,
    private readonly offers: OfferRepository,
    private readonly landingPages: LandingPageRepository
  ) {}

  async resolve(
    tenantId: string,
    publicId: string
  ): Promise<ResolvedTrackingLink> {
    const trackingLink = await this.trackingLinks.findByPublicIdForTenant(
      tenantId,
      publicId
    );
    if (!trackingLink) {
      throw new NotFoundError("TrackingLink", publicId);
    }

    return this.resolveFromLink(trackingLink);
  }

  /**
   * Public redirect entry — resolve by globally unique publicId, then tenant-scope children.
   */
  async resolveByPublicId(publicId: string): Promise<ResolvedTrackingLink> {
    const trimmed = publicId.trim();
    if (!trimmed) {
      throw new ValidationError("publicId is required");
    }
    const trackingLink = await this.trackingLinks.findByPublicId(trimmed);
    if (!trackingLink) {
      throw new NotFoundError("TrackingLink", trimmed);
    }
    return this.resolveFromLink(trackingLink);
  }

  private async resolveFromLink(
    trackingLink: TrackingLink
  ): Promise<ResolvedTrackingLink> {
    const tenantId = trackingLink.tenantId;
    const publicId = trackingLink.publicId;

    if (trackingLink.status !== "ACTIVE") {
      throw new ValidationError("TrackingLink is not active", {
        publicId,
        status: trackingLink.status,
      });
    }

    const offer = await this.offers.findByIdForTenant(
      tenantId,
      trackingLink.offerId
    );
    if (!offer || offer.status !== "ACTIVE") {
      throw new ValidationError("Offer is missing or inactive", {
        offerId: trackingLink.offerId,
      });
    }

    if (!trackingLink.landingPageId) {
      throw new ValidationError("TrackingLink has no landing page", {
        publicId,
      });
    }

    const landingPage = await this.landingPages.findByIdForTenant(
      tenantId,
      trackingLink.landingPageId
    );
    if (!landingPage || landingPage.status !== "ACTIVE") {
      throw new ValidationError("LandingPage is missing or inactive", {
        landingPageId: trackingLink.landingPageId,
      });
    }

    if (landingPage.offerId !== offer.id) {
      throw new ValidationError("LandingPage does not belong to Offer", {
        landingPageId: landingPage.id,
        offerId: offer.id,
      });
    }

    const redirectUrl = assertSafeRedirectUrl(landingPage.url);

    const attribution = createAttributionContext({
      tenantId,
      trackingLinkId: trackingLink.id,
      offerId: offer.id,
      landingPageId: landingPage.id,
      campaignId: trackingLink.campaignId ?? null,
      adGroupId: trackingLink.adGroupId ?? null,
      adId: trackingLink.adId ?? null,
      criterionId: trackingLink.criterionId ?? null,
    });

    return {
      trackingLink,
      offer,
      landingPage,
      attribution,
      redirectUrl,
    };
  }
}
