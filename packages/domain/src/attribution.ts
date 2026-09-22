/**
 * Immutable attribution snapshot built by TrackingLinkResolver.
 * Controllers must not construct this — use the resolver / ClickService.
 */
export interface AttributionContext {
  readonly tenantId: string;
  readonly trackingLinkId: string;
  readonly offerId: string;
  readonly landingPageId: string;
  readonly campaignId: string | null;
  readonly adGroupId: string | null;
  readonly adId: string | null;
  readonly criterionId: string | null;
}

export function createAttributionContext(
  input: AttributionContext
): Readonly<AttributionContext> {
  return Object.freeze({
    tenantId: input.tenantId,
    trackingLinkId: input.trackingLinkId,
    offerId: input.offerId,
    landingPageId: input.landingPageId,
    campaignId: input.campaignId,
    adGroupId: input.adGroupId,
    adId: input.adId,
    criterionId: input.criterionId,
  });
}
