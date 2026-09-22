# URL Versioning & URL Change Workflow (Phase 6)

Append-only URL versions, gated change requests, mock provider mutation, queue, audit, and rollback.

## Scope

**In scope**

- UrlVersion lifecycle: `DRAFT` → `ACTIVE` → `SUPERSEDED` / `ROLLED_BACK`
- UrlChangeRequest: Create → Validate → Preview → Queue → Execute → Audit
- Cancel (from `DRAFT` / `VALIDATED` / `QUEUED`)
- Rollback = **new** version (copy prior content); history never deleted
- URL field separation: Final / Mobile / App / Tracking Template / Custom Parameters
- Validation: `http`/`https` only (reject `javascript:`, `data:`, `file:`)
- Preview: field diff + validation result; **no mutation**
- Idempotency: `(tenantId, scope, key)` — scope `URL_CHANGE`
- Queue: BullMQ name `urlChange` (**IMPLEMENTED** — Worker + processor). Production runtime: separate Compose **`worker`** process (`apps/api/src/worker.ts` → `WorkerRuntime` → Redis/BullMQ). Local/tests may use in-process helpers or `QUEUE_MODE=off`; do **not** describe production as “in-process worker helper only.”
- Provider: `updateEntityUrl` (Mock applies; ApiProvider **refuses**)
- Audit: `URL_CHANGE_REQUEST_*`, `URL_VERSION_*`

**Out of scope**

- Real Google Ads mutation
- Cloaking / traffic spoofing / IP rotation / UA spoofing
- Phase 7 Conversion upload pipeline → see `docs/conversions.md`
- Non-AD provider mutation (local UrlVersion only)

## Status names

Keep existing enums (no rename migration):

| Concept | Actual status |
|---------|----------------|
| Validated | `VALIDATED` |
| Executing | `RUNNING` |
| Previewed | (no status — preview is read-only) |

## ACTIVE uniqueness

Partial unique index: one `ACTIVE` per `(tenant_id, entity_type, entity_id)`.

## Rollback

1. Succeeded request V1→V2  
2. `POST .../rollback` creates V3 (copy of V1) + new DRAFT request  
3. Execute → V2 `ROLLED_BACK`, V3 `ACTIVE`

Reason convention: `rollback:of=<id>;restore=<id>`

## API (`x-tenant-id` required)

| Method | Path |
|--------|------|
| GET/POST | `/api/v1/url-change-requests` |
| GET | `/api/v1/url-change-requests/:id` |
| POST | `/api/v1/url-change-requests/:id/validate` |
| POST | `/api/v1/url-change-requests/:id/preview` |
| POST | `/api/v1/url-change-requests/:id/queue` |
| POST | `/api/v1/url-change-requests/:id/execute` |
| POST | `/api/v1/url-change-requests/:id/cancel` |
| POST | `/api/v1/url-change-requests/:id/rollback` |

## Phase 4 / 5

Click path and Offer selection are unchanged. Destination never comes from `?url=`.
