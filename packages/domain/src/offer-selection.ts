/**
 * Phase 5 — Offer selection result (immutable DTO).
 * Controllers must not invent selection — use OfferSelectionService.
 */
export type OfferSelectionReason =
  | "PRIMARY"
  | "PRIORITY"
  | "FALLBACK"
  | "NO_ELIGIBLE_OFFER";

export interface OfferSelectionCandidate {
  readonly offerId: string;
  readonly priority: number;
  readonly isFallback: boolean;
  readonly eligible: boolean;
  readonly ineligibleReason?: string;
}

export interface OfferSelectionResult {
  readonly selectedOfferId: string | null;
  readonly selectedLandingPageId: string | null;
  readonly reason: OfferSelectionReason;
  readonly candidates: readonly OfferSelectionCandidate[];
  readonly fallbackUsed: boolean;
  readonly redirectUrl: string | null;
}
