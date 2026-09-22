# Tracking & Click Attribution (Phase 4)

Research/learning pipeline for legitimate tracking links, click ingestion, and attribution persistence.

## Scope

**In scope**

- TrackingLink resolve (tenant + publicId)
- Click ingestion with crypto UUID `clickId`
- Request metadata normalization (UA / Referer / IP / query)
- Capture of `gclid` / `gbraid` / `wbraid` and UTM parameters
- Ingestion idempotency via `ingestionId`
- Tenant isolation
- Open-redirect protection (destination only from LandingPage.url)
- Minimal click statistics
- MockClickGenerator (test-only synthetic traffic)

**Out of scope**

- IP rotation / proxy pools
- Referer / UA spoofing for evasion
- Cloaking / traffic-source falsification
- Google Ads URL mutation
- Anti-detection / click simulation against ad platforms

## Pipeline

```text
HTTP Request
  → TrackingLinkResolver (tenant + publicId)
  → validate TrackingLink / Offer / LandingPage
  → AttributionContext (immutable)
  → ClickIngestionService.recordClick
  → persist Click (transaction)
  → redirect to LandingPage.url
```

## Click ID

- Generated with `crypto.randomUUID()`
- Stored as both `Click.id` and `Click.clickId` (same value)
- Used by Conversion / Order attribution (`clickId` FK)

Normal repeats of the same tracking URL **create new clicks**.  
Only an explicit `ingestionId` (or `x-ingestion-id`) replays the first result.

## Redirect safety

Destination comes **only** from `LandingPage.url` in the database.

- Query `?url=` is never used as redirect target
- Schemes other than `http:` / `https:` are rejected

## Mock traffic

`MockClickGenerator` uses RFC 5737 TEST-NET addresses (`203.0.113.x`) and clearly labeled synthetic UA/Referer. It is for tests only — not production traffic.

## API (tenant via `x-tenant-id`)

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/v1/tracking-links` | List |
| GET | `/api/v1/tracking-links/:id` | By id |
| GET | `/api/v1/tracking-links/:id/clicks` | Clicks for link |
| POST | `/api/v1/tracking-links/:publicId/click` | JSON ClickResult |
| POST | `/api/v1/tracking/click` | JSON ClickResult |
| GET | `/api/v1/t/:publicId` | 302 redirect |
| GET | `/api/v1/clicks` | List |
| GET | `/api/v1/clicks/:id` | By id |

## Audit

Ordinary clicks are **not** audited (facts in `clicks` table).  
TrackingLink create / update / status change write `TRACKING_LINK_*` AuditLog events.

## Phase 5 note

Click ingestion still uses the Phase 4 resolver (`TrackingLink.offerId` → LandingPage).  
Offer selection via bindings is a separate dry-run API — see [offers.md](./offers.md).
