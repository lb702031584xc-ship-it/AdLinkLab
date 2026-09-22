import type {
  LandingPage,
  LandingPageRepository,
  Offer,
  OfferRepository,
} from "@adlinklab/domain";

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
  landingPage?: LandingPage;
}

/**
 * Deterministic Offer eligibility — no IP/UA/Referer/device selection.
 */
export class OfferEligibilityService {
  constructor(
    private readonly offers: OfferRepository,
    private readonly landingPages: LandingPageRepository
  ) {}

  async evaluate(
    tenantId: string,
    offerId: string,
    now: Date = new Date()
  ): Promise<EligibilityResult> {
    const offer = await this.offers.findByIdForTenant(tenantId, offerId);
    if (!offer) {
      return { eligible: false, reason: "OFFER_NOT_FOUND" };
    }
    return this.evaluateOffer(tenantId, offer, now);
  }

  async evaluateOffer(
    tenantId: string,
    offer: Offer,
    now: Date = new Date()
  ): Promise<EligibilityResult> {
    if (offer.tenantId !== tenantId) {
      return { eligible: false, reason: "TENANT_MISMATCH" };
    }
    if (offer.deletedAt) {
      return { eligible: false, reason: "OFFER_DELETED" };
    }
    if (offer.status !== "ACTIVE") {
      return { eligible: false, reason: `OFFER_STATUS_${offer.status}` };
    }
    if (offer.startsAt && now < offer.startsAt) {
      return { eligible: false, reason: "BEFORE_STARTS_AT" };
    }
    if (offer.endsAt && !(now < offer.endsAt)) {
      return { eligible: false, reason: "AFTER_ENDS_AT" };
    }

    const landingPage = await this.resolveActiveLandingPage(tenantId, offer.id);
    if (!landingPage) {
      return { eligible: false, reason: "NO_ACTIVE_LANDING_PAGE" };
    }
    if (landingPage.offerId !== offer.id) {
      return { eligible: false, reason: "LANDING_PAGE_OWNERSHIP_MISMATCH" };
    }

    return { eligible: true, landingPage };
  }

  /**
   * Deterministic LandingPage pick: ACTIVE, belonging to offer, id ASC.
   */
  async resolveActiveLandingPage(
    tenantId: string,
    offerId: string
  ): Promise<LandingPage | null> {
    const listed = await this.landingPages.list({
      tenantId,
      offerId,
      pageSize: 500,
    });
    const active = listed.items
      .filter(
        (lp) =>
          lp.status === "ACTIVE" &&
          !lp.deletedAt &&
          lp.offerId === offerId &&
          lp.tenantId === tenantId
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    return active[0] ?? null;
  }
}
