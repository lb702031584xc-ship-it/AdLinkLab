# Offer Engine (Phase 5)

Local Offer lifecycle, eligibility, priority/fallback selection, and TrackingLink bindings.

## Scope

**In scope**

- Offer CRUD (tenant scoped)
- Offer status machine (`DRAFT` / `ACTIVE` / `PAUSED` / `ARCHIVED`)
- Eligibility (status, schedule, ACTIVE LandingPage ownership)
- `TrackingLinkOffer` bindings with priority + single fallback
- Deterministic `OfferSelectionService`
- Idempotent Offer create (`OFFER_CREATE`)
- Audit: `OFFER_*`, `TRACKING_LINK_OFFER_*`
- Dry-run `POST .../select-offer`

**Out of scope (Phase 6+)**

- Google Ads URL mutation / `updateAdUrl`
- UrlChangeRequest execution
- UrlVersion ACTIVE switching
- Pushing Offer URL to Google Ads
- IP/UA/Referer-based selection, cloaking, proxy

## Priority

Lower number = higher priority. Default `100`.

Tie-break: `offerId` ASC.

## Phase 4 compatibility

If a TrackingLink has **no** `TrackingLinkOffer` rows, selection uses static `TrackingLink.offerId` → ACTIVE LandingPage (reason `PRIMARY`).

Click ingestion path is unchanged: still Phase 4 resolver + LandingPage.url redirect.

## Selection reasons

- `PRIMARY` — default TrackingLink.offerId
- `PRIORITY` — binding winner
- `FALLBACK` — only when no eligible primary
- `NO_ELIGIBLE_OFFER` — reject (no cross-tenant / arbitrary URL)

## API

All require `x-tenant-id` (or body `tenantId`).

| Method | Path |
|--------|------|
| GET/POST | `/api/v1/offers` |
| GET/PATCH | `/api/v1/offers/:id` |
| POST | `/api/v1/offers/:id/status` |
| GET | `/api/v1/offers/:id/landing-pages` |
| GET/PUT | `/api/v1/tracking-links/:id/offers` |
| POST | `/api/v1/tracking-links/:id/select-offer` |
