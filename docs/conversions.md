# Conversion & Order Attribution (Phase 7)

Order-first attribution, Conversion lifecycle, offline conversion upload via Mock provider, SyncJob queue, and audit.

## Scope

**In scope**

- Order create / status FSM (`PENDING` → `CONFIRMED` → `REFUNDED` / `CANCELLED` → `ARCHIVED`)
- Conversion create from Order or Click
- Authority: **`Order.conversionId`** (not dual FK inventories)
- Google click identity from Click: **gclid → gbraid → wbraid** (never invent IDs)
- Upload FSM uses existing `GoogleUploadStatus`: `NOT_UPLOADED` / `QUEUED` / `UPLOADED` / `FAILED` / `SKIPPED`
- Business lifecycle uses existing `ConversionStatus`
- Queue: reuse `SyncJob` + BullMQ name `conversionUpload`
- Provider: `uploadConversion` (Mock applies; ApiProvider **refuses**)
- Money as decimal strings; currency ISO-4217 3-letter
- Audit: `ORDER_*`, `CONVERSION_*`

**Out of scope**

- Real Google Ads mutation / credentials
- Cloaking / traffic spoofing / IP rotation / UA spoofing
- New Prisma columns for uploadAttempts (deferred; audit carries detail)
- Changing Phase 4 click path or Phase 5/6 engines

## Flow

```
Order (clickId) → Conversion (ATTRIBUTED)
                → queue (QUEUED)
                → execute / worker → uploadConversion
                → UPLOADED | FAILED | SKIPPED
```

## API (tenant via `x-tenant-id`)

| Method | Path |
|--------|------|
| GET/POST | `/api/v1/orders` |
| GET | `/api/v1/orders/:id` |
| POST | `/api/v1/orders/:id/status` |
| GET/POST | `/api/v1/conversions` |
| POST | `/api/v1/conversions/from-order` |
| GET | `/api/v1/conversions/:id` |
| POST | `/api/v1/conversions/:id/queue` |
| POST | `/api/v1/conversions/:id/execute` |
| POST | `/api/v1/conversions/:id/retry` |
| POST | `/api/v1/conversions/:id/cancel` |

## Idempotency

- Order: scope `ORDER`, key `(tenantId, orderId)` default
- Conversion: scope `CONVERSION`
- Upload job: SyncJob scope `SYNC_JOB`, key from conversion idempotency key

## SKIPPED

Set when Click has no `gclid` / `gbraid` / `wbraid`, or upload is cancelled before success.
