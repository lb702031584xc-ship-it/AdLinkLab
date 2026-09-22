import type { Offer, LandingPage } from "@adlinklab/domain";

export interface OfferAssignment {
  offer: Offer;
  landingPage?: LandingPage;
}

export function describeOfferDestination(offer: Offer): string {
  return `${offer.network} → ${offer.destinationUrl}`;
}
