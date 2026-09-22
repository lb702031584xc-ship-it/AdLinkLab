import type {
  OfferRepository,
  OfferSelectionCandidate,
  OfferSelectionResult,
  TrackingLinkOffer,
  TrackingLinkOfferRepository,
  TrackingLinkRepository,
} from "@adlinklab/domain";
import { NotFoundError } from "@adlinklab/shared";
import { assertSafeRedirectUrl } from "@adlinklab/tracking";
import { OfferEligibilityService } from "./eligibility.js";

export interface SelectOfferInput {
  tenantId: string;
  trackingLinkId: string;
  now?: Date;
}

/**
 * Deterministic Offer selection.
 * Phase 4 compatible: no bindings → use TrackingLink.offerId as primary.
 * Does not mutate Google Ads / UrlVersion / TrackingLink.offerId.
 */
export class OfferSelectionService {
  constructor(
    private readonly trackingLinks: TrackingLinkRepository,
    private readonly offers: OfferRepository,
    private readonly bindings: TrackingLinkOfferRepository,
    private readonly eligibility: OfferEligibilityService
  ) {}

  async select(input: SelectOfferInput): Promise<OfferSelectionResult> {
    const now = input.now ?? new Date();
    const link = await this.trackingLinks.findByIdForTenant(
      input.tenantId,
      input.trackingLinkId
    );
    if (!link) {
      throw new NotFoundError("TrackingLink", input.trackingLinkId);
    }

    const bindings = await this.bindings.findByTrackingLinkForTenant(
      input.tenantId,
      input.trackingLinkId
    );

    type Row = {
      offerId: string;
      priority: number;
      isFallback: boolean;
      fromBinding: boolean;
    };

    let rows: Row[];
    if (bindings.length === 0) {
      // Phase 4 default — static TrackingLink.offerId
      const offer = await this.offers.findByIdForTenant(
        input.tenantId,
        link.offerId
      );
      rows = [
        {
          offerId: link.offerId,
          priority: offer?.priority ?? 100,
          isFallback: false,
          fromBinding: false,
        },
      ];
    } else {
      rows = bindings.map((b: TrackingLinkOffer) => ({
        offerId: b.offerId,
        priority: b.priority,
        isFallback: b.isFallback,
        fromBinding: true,
      }));
    }

    const candidates: OfferSelectionCandidate[] = [];
    const eligiblePrimary: Array<{
      offerId: string;
      priority: number;
      landingPageId: string;
      redirectUrl: string;
      fromBinding: boolean;
    }> = [];
    let eligibleFallback:
      | {
          offerId: string;
          priority: number;
          landingPageId: string;
          redirectUrl: string;
        }
      | undefined;

    for (const row of rows) {
      const result = await this.eligibility.evaluate(
        input.tenantId,
        row.offerId,
        now
      );
      candidates.push({
        offerId: row.offerId,
        priority: row.priority,
        isFallback: row.isFallback,
        eligible: result.eligible,
        ineligibleReason: result.reason,
      });

      if (!result.eligible || !result.landingPage) continue;

      let redirectUrl: string;
      try {
        redirectUrl = assertSafeRedirectUrl(result.landingPage.url);
      } catch {
        candidates[candidates.length - 1] = {
          ...candidates[candidates.length - 1]!,
          eligible: false,
          ineligibleReason: "UNSAFE_LANDING_URL",
        };
        continue;
      }

      if (row.isFallback) {
        if (!eligibleFallback) {
          eligibleFallback = {
            offerId: row.offerId,
            priority: row.priority,
            landingPageId: result.landingPage.id,
            redirectUrl,
          };
        }
      } else {
        eligiblePrimary.push({
          offerId: row.offerId,
          priority: row.priority,
          landingPageId: result.landingPage.id,
          redirectUrl,
          fromBinding: row.fromBinding,
        });
      }
    }

    eligiblePrimary.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.offerId.localeCompare(b.offerId);
    });

    const primary = eligiblePrimary[0];
    if (primary) {
      const reason =
        !primary.fromBinding
          ? ("PRIMARY" as const)
          : ("PRIORITY" as const);
      return {
        selectedOfferId: primary.offerId,
        selectedLandingPageId: primary.landingPageId,
        reason,
        candidates,
        fallbackUsed: false,
        redirectUrl: primary.redirectUrl,
      };
    }

    if (eligibleFallback) {
      return {
        selectedOfferId: eligibleFallback.offerId,
        selectedLandingPageId: eligibleFallback.landingPageId,
        reason: "FALLBACK",
        candidates,
        fallbackUsed: true,
        redirectUrl: eligibleFallback.redirectUrl,
      };
    }

    return {
      selectedOfferId: null,
      selectedLandingPageId: null,
      reason: "NO_ELIGIBLE_OFFER",
      candidates,
      fallbackUsed: false,
      redirectUrl: null,
    };
  }
}
