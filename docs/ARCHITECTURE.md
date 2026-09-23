# AdLinkLab Architecture (Phase 0 → 13.2-CI)

Research SaaS for studying Google Ads tracking, URL versioning, Script-based URL sync, and Click → Conversion → Order attribution.

**Hard boundary:** Mock / Simulator providers only for production-facing mutations. No live Google Ads production mutations, no traffic forgery against third parties, no cloaking / detection bypass.

**Current baseline (Phase 12 ACCEPTED / CLOSED on Phase 9–10 foundation; Phase 13.2-CI CLOSED / PASS):** deployment, production AUTH fail-closed, observability, backup/restore gates, Desired Version hygiene, Queue Catalog honesty, CORS allowlist, HTTP rate limits, Traefik dashboard switch, Compose ready healthchecks, **LAB_CI_ONLY seeded restore depth gate** (`backup:depth-gate`, D1–D11), and **controlled GitHub Actions** (`.github/workflows/seeded-restore-depth-gate.yml`, `workflow_dispatch` only). See [phase-9-capability-matrix.md](./phase-9-capability-matrix.md), [operations.md](./operations.md), and [`packages/database/SEEDED_RESTORE_DEPTH_GATE.md`](../packages/database/SEEDED_RESTORE_DEPTH_GATE.md).

Phase milestones (summary):

- **0–7** — Domain, persistence, tracking, offers, URL change, conversions
- **8.1–8.2** — Prisma persistence mode; API key auth + tenant-scoped management APIs
- **8.3** — BullMQ producer/worker for **implemented** queues only
- **8.4** — Google Ads Script Integration (token, config, sync-result, dashboard, admin, generator)
- **9.1–9.6** — Compose deploy, AUTH production guards, observability, backup, desired authority, queue honesty
- **10** — CORS / rate-limit / Traefik switch / ready healthchecks / backup URL sanitization / migration BOM fix
- **10.5 / 11** — Lab backup/restore + seeded isolated restore validation
- **12** — Seeded restore depth automation (module + LAB/CI gate + real lab acceptance) — **CLOSED**
- **13.1** — Documentation truth sync — **CLOSED**
- **13.2-CI** — Controlled GitHub Actions execution of existing `backup:depth-gate` (Postgres 16, ephemeral source/restore DBs, D1–D11, artifacts, cleanup; CI-only trust auth after R3) — **CLOSED / PASS**
- **13.3** — Documentation truth sync (align docs with 13.2-CI) — owner track

---

## 1. System Context

```
┌─────────────┐     ┌──────────────┐     ┌────────────────────┐
│ Researcher  │────▶│ AdLinkLab    │────▶│ GoogleAdsProvider  │
│ (Browser)   │     │ Web + API    │     │ (Mock | API skeleton)│
└─────────────┘     └──────┬───────┘     └────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         PostgreSQL      Redis      TrafficProvider
                                   (Mock | Database)
```

Actors:

- **Researcher** — explores campaigns, tracking, conversions, URL versions.
- **AdLinkLab API** — Fastify application services over repository interfaces.
- **GoogleAdsProvider** — interchangeable Mock / API skeleton.
- **TrafficProvider** — records click events for later simulator use (local only).

---

## 2. Container Diagram

| Container | Tech | Responsibility |
|-----------|------|----------------|
| `apps/web` | Next.js + Tailwind | Script dashboard/admin UI + entity page shells |
| `apps/api` | Fastify + BullMQ | Controllers, services, job **producer**; separate **worker** process |
| `packages/domain` | TS | Entities + repository ports |
| `packages/database` | Prisma + memory/prisma repos | Persistence adapters + backup CLI |
| `packages/google-ads` | Provider adapters | Google Ads isolation (mock \| API skeleton) |
| `packages/tracking` | UrlResolver | Final URL / Template / Custom Params |
| `packages/traffic` | TrafficProvider | Click recording abstraction |
| `packages/conversions` | Attribution helpers | Click → Conversion → Order |
| `packages/offers` | Offer helpers | Offer / landing semantics |
| `packages/shared` | Errors, idempotency | Cross-cutting primitives |
| Postgres | 16 | System of record |
| Redis | 7 | BullMQ broker |
| Traefik | v3 | Reverse proxy (**lab**: insecure dashboard on loopback; no TLS redesign yet) |
| Compose `migrate` | one-shot | `prisma migrate deploy` before api/worker |
| Compose `worker` | `node dist/worker.js` | BullMQ `WorkerRuntime` (`urlChange` + `conversionUpload` only) |

Layering inside API:

```
Controller (routes)
  → Application Service
    → Domain (+ providers)
      → Repository interface
        → Infrastructure (Prisma / Memory)
```

---

## 3. Domain Model

Entities (all use internal UUID + timestamps; Google IDs are external):

- **User** — researcher identity
- **GoogleAccount** — `googleCustomerId` (unique)
- **Campaign** — `googleCampaignId` (unique)
- **AdGroup** — `googleAdGroupId` (unique)
- **Ad** — `googleAdId` (unique); optional current finalUrl / trackingTemplate mirrors
- **AdGroupCriterion** — `googleCriterionId` (unique); keyword/criterion under ad group
- **Offer** — network destination
- **LandingPage** — named landing URL + domain
- **TrackingLink** — `publicId` (unique), links offer / campaign / ad
- **Click** — gclid/gbraid/wbraid, UTM, IP, UA, Referer (collection only)
- **Conversion** — `conversionId` (unique external)
- **Order** — `orderId` (unique external)
- **UrlVersion** — append-only history; unique `(tenantId, entityType, entityId, version)`; **one ACTIVE** per `(tenantId, entityType, entityId)` via partial unique index
- **UrlChangeRequest** — gated mutation workflow; unique `(tenantId, idempotencyScope, idempotencyKey)`
- **SyncJob** — `jobId` + tenant-scoped idempotency `(tenantId, idempotencyScope, idempotencyKey)`; status, errors, attempts
- **AuditLog** — immutable action trail
- **GoogleAdsScriptIntegration** / **ScriptSyncTarget** / **ScriptSyncLog** — Script apply path (Phase 8.4)

`UrlEntityType`: `CUSTOMER | CAMPAIGN | AD_GROUP | AD | AD_GROUP_CRITERION`

URL configuration fields (never merged into one string):

- `finalUrl` / `finalMobileUrl` / `finalAppUrl`
- `trackingTemplate`
- `customParameters`

Domain packages **must not** import Prisma Client or Google Ads SDK.

---

## 4. Database Model

Prisma schema: `packages/database/prisma/schema.prisma`

Uniqueness:

| Field | Table |
|-------|-------|
| email | users |
| googleCustomerId | google_accounts |
| googleCampaignId | campaigns |
| googleAdGroupId | ad_groups |
| googleAdId | ads |
| publicId | tracking_links |
| conversionId | conversions |
| orderId | orders |
| (tenantId, entityType, entityId, version) | url_versions |
| (tenantId, idempotencyScope, idempotencyKey) | url_change_requests |
| (tenantId, idempotencyScope, idempotencyKey) | sync_jobs |
| jobId | sync_jobs (lookup key; not the sole uniqueness story) |

**UrlVersion ACTIVE rule:** partial unique index on `(tenant_id, entity_type, entity_id) WHERE status = 'ACTIVE'` (includes `tenant_id`). Do **not** describe uniqueness as excluding tenant.

**SyncJob / UCR idempotency:** uniqueness is **tenant-scoped** `(tenantId, scope, key)` — **not** a global unique `idempotencyKey` alone.

URL version rule: updates create a **new row** (`vN+1`) and mark prior `ACTIVE` as `SUPERSEDED`. Never overwrite historical URL content (status-only patches allowed).

Phase 0 also ships **seeded in-memory repositories** so API/tests run without a live DB.

---

## 5. Google Ads Adapter

```ts
interface GoogleAdsProvider {
  listCustomers(): Promise<Customer[]>
  listCampaigns(customerId: string): Promise<Campaign[]>
  listAdGroups(campaignId: string): Promise<AdGroup[]>
  listAds(adGroupId: string): Promise<Ad[]>
  updateAdUrl(adId, finalUrl, trackingTemplate?): Promise<void>
  uploadConversion(input): Promise<ConversionUploadResult>
}
```

Implementations:

- **MockGoogleAdsProvider** — in-memory fixtures; research/simulator mutations allowed.
- **GoogleAdsApiProvider** — skeleton only; production mutation **forbidden / not implemented** (refuse / `GOOGLE_ADS_NOT_IMPLEMENTED`).

Factory: `createGoogleAdsProvider("mock" | "api")` via `GOOGLE_ADS_PROVIDER`.

**Do not describe this project as having production Google Ads mutation capability.**

Contract tests (`provider.contract.test.ts`) assert both implementations satisfy the interface.

---

## 6. Tracking Flow

```
TrackingLink (publicId)
    → TrafficProvider.recordClick(TrafficEvent)
        → Click row (gclid, utm_*, ip, ua, referer, …)
```

`UrlResolver` remains a Phase 0 façade. Prefer `ServingUrlResolver.resolveServingUrl`.

IP / UA / Referer are **data collection fields only** — no spoofing or origin hiding.

---

## 7. Conversion Flow

```
Click (gclid)
  → Conversion (conversionId, action, value, time)
    → Order (orderId, amount)
      → (future) GoogleAdsProvider.uploadConversion  [mock only in Phase 0]
```

`packages/conversions` exposes `buildAttributionChain` / `isFullyAttributed` for the full chain.

Offline conversion upload is queued as `conversionUpload` with idempotency keys.

---

## 8. URL Version Flow

```
UrlVersionService.createVersion(...)
  1. find ACTIVE version for (entityType, entityId)
  2. mark it SUPERSEDED (status-only)
  3. allocate next version number
  4. insert new UrlVersion (DRAFT or ACTIVE)
```

Statuses: `DRAFT | ACTIVE | SUPERSEDED | ROLLED_BACK`  
History via `listByEntity` / `listByAdId`. Content is immutable after create.

---

## 9. Queue Architecture (Phase 8.3 + 9.6 honesty)

**Honesty rule:** A queue is **IMPLEMENTED** only if a BullMQ Worker is registered **and** a processor exists. Appearing in `JOB_DEFINITIONS` / `QUEUE_NAMES` alone does **not** mean IMPLEMENTED.

| Job / queue | Catalog status | Purpose | Runtime |
|-------------|----------------|---------|---------|
| `urlChange` | **IMPLEMENTED** | Apply UrlChangeRequest via mock provider path | `WorkerRuntime` + `processUrlChangeJob` |
| `conversionUpload` | **IMPLEMENTED** | Offline conversion upload via provider | `WorkerRuntime` + `processConversionUploadJob` |
| `googleAdsSync` | **PLANNED** | Named SyncJob type / in-process sync service path exists; **no** BullMQ Worker | Do not treat as production worker |
| `clickProcessing` | **PLANNED** | Catalog name only | No Worker / processor |
| `analyticsAggregation` | **PLANNED** | Catalog name only | No Worker / processor |

Production worker entry: `apps/api/src/worker.ts` → `WorkerRuntime.start()` registers **only** `urlChange` and `conversionUpload`.

API process: enqueue via BullMQ producer (`QUEUE_MODE=redis`) or noop (`QUEUE_MODE=off` / tests). API does **not** run those Workers unless `withWorker` (worker process).

Every implemented job correlates with a `SyncJob` row:

- stable `jobId`
- tenant-scoped unique `(tenantId, idempotencyScope, idempotencyKey)` (default scope `SYNC_JOB`)
- `status` + `attempts` + `errorMessage`
- BullMQ broker retries vs SyncJob business attempts are separate concepts
- Worker tenancy: `job.data.tenantId` is a claim; **SyncJob row is authoritative** for tenant isolation

See also: [phase-9-capability-matrix.md](./phase-9-capability-matrix.md), `apps/api/src/queue/queue-catalog.ts`.

---

## 10. Error Handling

Shared hierarchy (`@adlinklab/shared`):

- `AppError` — base with `code` + `statusCode`
- `NotFoundError` (404)
- `ConflictError` (409)
- `ValidationError` (400)

Fastify maps `AppError` to JSON `{ error, message, details }`. Unexpected errors → 500 `INTERNAL_ERROR`.

Provider skeleton uses `GOOGLE_ADS_NOT_IMPLEMENTED` (501).

---

## 11. Idempotency Strategy

1. Caller supplies or derives `idempotencyKey` (`createIdempotencyKey(type, …parts)`).
2. Lookups use **tenant + scope + key** (not a globally unique key alone).
3. `processIdempotentJob` / SyncJob helpers: if `COMPLETED` → skip; if `CANCELLED` → skip; `PENDING`/`FAILED`/`RUNNING` reclaim under mutation lock.
4. Unique DB constraint: `@@unique([tenantId, idempotencyScope, idempotencyKey])` on SyncJob / UrlChangeRequest / related tables.
5. **UrlChangeRequest:** duplicate create under same tenant/scope/key returns the same request; `execute` after `SUCCEEDED` is a no-op (`skipped: true`) so queue retries cannot double-mutate.

---

## 12. Testing Strategy

| Layer | Tool | Focus |
|-------|------|-------|
| Domain | Vitest | Entity shape / URL separation |
| Providers | Vitest | Mock behavior; API skeleton refuses production mutation |
| Provider contracts | Vitest | Shared contract suite for all methods |
| UrlResolver / ServingUrlResolver | Vitest | Hierarchy, params, serving URL |
| Repositories | Vitest | Seeded memory store (default); Prisma opt-in PG |
| Services | Vitest | URL version, Script sync, auth, backup safety |
| API | Vitest + Fastify inject | routes, `/health*`, `/metrics` |
| Queue | Vitest | Catalog honesty + worker processors; Redis opt-in |
| Infra | `docker compose config/build` | Compose validity + images |

Defaults: in-memory / in-process (no Redis required). Opt-in PG/Redis via `PHASE*_PG` / `PHASE83_REDIS` / `PHASE835_*` flags — see [operations.md](./operations.md).

Approximate inventory (Phase 10.1): **~66** `*.test.ts` files; **15** `*.pg.test.ts` files.

Commands:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
docker compose config
docker compose build
```

---

## 13. Google Ads URL Hierarchy (Phase 0.1)

```
CUSTOMER
  └─ CAMPAIGN
       └─ AD_GROUP
            ├─ AD
            └─ AD_GROUP_CRITERION
```

Each level may carry independent URL configuration. Inheritance: more specific levels override the same custom-parameter keys and win for final URL / tracking template when set.

---

## 14. URL Resolution Algorithm (Phase 0.1)

Public entry: `ServingUrlResolver.resolveServingUrl(input) → ResolvedServingUrl`

Internal resolvers:

1. **HierarchyResolver** — order levels Customer → … → leaf  
2. **FinalUrlResolver** — pick final / mobile / app URLs  
3. **CustomParameterResolver** — merge params (specific wins)  
4. **ValueTrackResolver** — expand supported ValueTrack tokens from provided context only  
5. **TrackingTemplateResolver** — pick most specific template  
6. **ServingUrlResolver** — substitute `{lpurl}` + custom params → serving URL  

No destination cloaking or detection bypass.

---

## 15. URL Change Request Lifecycle (Phase 0.1)

```
Create Change Request (idempotencyKey)
  → Validate
  → Preview (ServingUrlResolver)
  → Queue (jobId)
  → Provider.updateAdUrl (mock only)
  → Result (SUCCEEDED / FAILED)
  → Audit Log
```

Statuses: `DRAFT → VALIDATED → QUEUED → RUNNING → SUCCEEDED | FAILED` (+ `CANCELLED`).

**Forbidden:** direct `UPDATE ad SET url = …` outside this workflow.

Audit metadata per change: `entityType`, `entityId`, `fromVersion`, `toVersion`, `requestedBy`, `jobId`, `status`, `timestamp`, `error`.

---

## 16. Provider Contract Testing (Phase 0.1)

`packages/google-ads/src/provider.contract.test.ts` runs the same contract for:

- `MockGoogleAdsProvider` — must succeed for all methods  
- `GoogleAdsApiProvider` — must implement interface and return 501 `GOOGLE_ADS_NOT_IMPLEMENTED`

Covered methods: `listCustomers`, `listCampaigns`, `listAdGroups`, `listAds`, `updateAdUrl`, `uploadConversion`.

---

## Out of Scope (Phase 0 / 0.1 / 1.1)

- Real Google Ads production calls / mutations
- IP rotation, UA/Referer spoofing
- Third-party click simulation
- Cloaking / detection bypass
- Phase 1.2 Repository + Transactions

---

## 17. Database Foundation (Phase 1.1)

### Database ER Model (logical)

```
Tenant
 └─ User
     └─ GoogleAccount (customerId UNIQUE, oauthCredentialRef only)
         └─ Campaign (unique googleAccountId+googleCampaignId)
             └─ AdGroup (unique campaignId+googleAdGroupId)
                 ├─ Ad (unique adGroupId+googleAdId)
                 └─ AdGroupCriterion (unique adGroupId+googleCriterionId)

Offer
 └─ LandingPage
     └─ TrackingLink → Click → Conversion → Order

UrlEntity (entityType+entityId)
 └─ UrlVersion v1 → v2 → v3 (append-only)
 └─ UrlChangeRequest (tenantId + scope + idempotencyKey UNIQUE)

SyncJob (tenantId + scope + idempotencyKey UNIQUE)
AuditLog (immutable)
```

### Entity Ownership

| Entity | Owned by |
|--------|----------|
| User / GoogleAccount / Offer / Order | Tenant |
| Campaign | GoogleAccount (+ tenantId) |
| AdGroup | Campaign |
| Ad / Criterion | AdGroup |
| TrackingLink | Offer (+ optional Campaign/Ad/LandingPage) |
| Click | TrackingLink |
| Conversion | Click (required FK) |
| UrlVersion / UrlChangeRequest | Tenant + entity ref |

### External ID Strategy

- Internal PKs: UUID
- Google external IDs scoped by parent
- `GoogleAccount.customerId` globally unique
- `TrackingLink.publicId` globally unique
- `Order.orderId` unique **per tenant**
- `gclid` is **not** unique — duplicate click events allowed

### Tenant Boundary

All core business rows carry `tenantId`.  
Future path: `Tenant → User → GoogleAccount → Campaign → …`

### Attribution Chain

`Campaign → Ad → TrackingLink → Click → Conversion → Order`  
Conversion requires `clickId` (Restrict FK). Soft-delete Campaign does not cascade-delete attribution history.

### URL Version Storage

- Unique `(tenantId, entityType, entityId, version)`
- Partial unique: one `ACTIVE` per `(tenant_id, entity_type, entity_id)`
- Index `(entityType, entityId, status)` / tenant-scoped active lookup in repositories
- Content immutable after insert; only `status` / `effectiveAt` may change
- Seed: V1 `SUPERSEDED` → V2 `ACTIVE` (example fixtures)

### Idempotency Constraints

- `UrlChangeRequest`: `@@unique([tenantId, idempotencyScope, idempotencyKey])`
- `SyncJob`: `@@unique([tenantId, idempotencyScope, idempotencyKey])`
- **Not** globally unique on `idempotencyKey` alone

### Deletion Strategy

- `onDelete: Restrict` on attribution FKs
- Soft-delete via `status` + `archivedAt` / `deletedAt`

### Money Strategy

- PostgreSQL `Decimal(19,4)` only — never float
- Domain exposes decimal **strings** (e.g. `"49.9900"`)

### Time Strategy

- All timestamps `TIMESTAMPTZ` — UTC

### Migration & Seed

- Migration: `packages/database/prisma/migrations/20260909000000_phase_1_1_database_foundation`
- Seed: `pnpm --filter @adlinklab/database seed` (requires live Postgres + migrate deploy)

Phase 1.1 does **not** include Phase 1.2 (Repository + Transactions), real Google Ads API, or traffic forgery.

---

## 18. Tracking & Click Attribution (Phase 4)

See [tracking.md](./tracking.md) for the full Phase 4 contract.

```text
GET /api/v1/t/:publicId
  → TrackingLinkResolver (tenantId + publicId)
  → AttributionContext (immutable)
  → ClickIngestionService.recordClick
  → DB transaction (Click persist)
  → 302 Location: LandingPage.url
```

- Destination is never taken from query parameters (open-redirect protection).
- `ingestionId` provides request-level idempotency; identical tracking URLs without it create separate clicks.
- `MockClickGenerator` is test-only synthetic traffic (RFC 5737 TEST-NET).
- Ordinary clicks are not AuditLog events; TrackingLink create/update/status changes are.

Phase 4 does **not** include Offer Engine selection on the click path, Google Ads URL mutation, cloaking, or traffic forgery.

---

## 19. Offer Engine (Phase 5)

See [offers.md](./offers.md) for the full Phase 5 contract.

```text
Offer CRUD / status
  → OfferEligibilityService (status + schedule + ACTIVE LandingPage)
  → TrackingLinkOffer bindings (priority ASC, offerId ASC; one fallback)
  → OfferSelectionService (PRIMARY | PRIORITY | FALLBACK | NO_ELIGIBLE_OFFER)
  → dry-run POST /api/v1/tracking-links/:id/select-offer
```

- Lower `priority` number = higher preference (default `100`).
- No bindings → selection uses static `TrackingLink.offerId` (`PRIMARY`); Phase 4 click path unchanged.
- Destination remains `LandingPage.url` from DB only (no open redirect).
- Idempotent Offer create via scope `OFFER_CREATE`.
- Audit: `OFFER_*`, `TRACKING_LINK_OFFER_*`.

Phase 5 does **not** include Google Ads URL mutation, UrlChangeRequest execution, UrlVersion ACTIVE switching, or IP/UA-based selection.

---

## 20. URL Versioning & Change Workflow (Phase 6)

See [url-change.md](./url-change.md) for the full Phase 6 contract.

```text
UrlVersion (DRAFT)
  → UrlChangeRequest Create / Validate / Preview
  → Queue (SyncJob type urlChange)
  → GoogleAdsProvider.updateEntityUrl (Mock only; Api refuses)
  → SUPERSEDE prior ACTIVE + activate toVersion (UoW)
  → Audit URL_CHANGE_REQUEST_* / URL_VERSION_*
```

- Five URL fields remain separate (Final / Mobile / App / Tracking Template / Custom Parameters).
- One ACTIVE per `(tenant, entityType, entityId)` via partial unique index.
- Rollback creates a **new** version; never deletes history.
- Preview and validation never accept `?url=` / arbitrary destinations.

Phase 6 does **not** include real Google Ads mutation, cloaking, or Phase 7 Conversion upload.

---

## 21. Conversion / Order Attribution (Phase 7)

See [conversions.md](./conversions.md).

- Order-first conversion attribution chain helpers in `packages/conversions`
- Offline conversion upload queued as **IMPLEMENTED** `conversionUpload` (Worker + processor)
- Mock / provider upload path only; live Ads mutation remains forbidden

---

## 22. Desired Authority Chain (Phase 8.4 + 9.5)

**Canonical Desired Authority (do not invert):**

```text
ACTIVE UrlVersion
        ↓
Script configuration (API)
        ↓
Google Ads Script (external apply)
        ↓
ScriptSyncTarget.appliedVersion
```

Rules (actual behavior):

| Concept | Role |
|---------|------|
| **ACTIVE `UrlVersion`** | **Sole desired authority** for desired URL state |
| `ScriptSyncTarget.desiredVersion` | Projection / cache only — **not** authority |
| `ScriptSyncTarget.appliedVersion` | Integration-specific applied state |
| `compareAndSetAppliedVersion` | Prevents applied-version regression |
| Script sync / config | Must validate against **ACTIVE** UrlVersion |
| UrlChangeRequest (UCR) | Changes UrlVersion (and thus desired authority) |
| Google Ads Script | Applies; does **not** become authority for desired URL state |

UCR remains the gated path that mutates UrlVersion history. Script sync must never treat `desiredVersion` as the source of truth.

---

## 23. Tenant Isolation & Queue Tenancy

- Core business rows carry `tenantId`; management APIs require authenticated tenant context.
- **Queue tenancy:** `job.data.tenantId` is a claim, **not** authoritative by itself.
- Where the implementation loads a `SyncJob` row, **that row is authoritative** for tenant and job identity.
- Worker execution must preserve tenant isolation (no cross-tenant apply).

---

## 24. Authentication Modes (Phase 8.2 / 9.2)

| Mode | When | Production |
|------|------|------------|
| `AUTH_MODE=api_key` | Tenant via `ADLINKLAB_API_KEYS` (`key:tenantId`,…) | **Required** (`NODE_ENV=production` fail-closed) |
| Integration Bearer token | Script / dashboard APIs; peppered with `INTEGRATION_TOKEN_PEPPER` | Required for Script surfaces |
| `AUTH_MODE=disabled` | Development / test only | **Forbidden** in production |

Production also requires `PERSISTENCE=prisma` + non-empty `DATABASE_URL` (memory forbidden). See [operations.md](./operations.md).

---

## 25. Worker Runtime (Phase 8.3)

```text
apps/api/src/worker.ts
  → WorkerRuntime.start()
    → BullMQ Workers on Redis
      → processUrlChangeJob
      → processConversionUploadJob
```

- **API process:** HTTP + enqueue (producer). Does not register those Workers unless started as the worker entry.
- **Worker process:** consumes Redis queues; requires `QUEUE_MODE=redis`.
- Local/dev tests may use in-process helpers or `QUEUE_MODE=off`; **production Compose uses a separate worker service**.

---

## 26. Google Ads Provider Boundary

| Provider | Research / lab | Production mutation |
|----------|----------------|---------------------|
| **Mock** | Mutations allowed (simulator) | N/A — research only |
| **API (`GoogleAdsApiProvider`)** | Interface / skeleton | **Forbidden / not implemented** (refuse) |

**This project MUST NOT be described as having production Google Ads mutation capability.**

`GOOGLE_ADS_PROVIDER=mock` is the lab default. Do not add live Ads credentials for mutation.

---

## 27. Observability (Phase 9.3)

| Endpoint | Meaning |
|----------|---------|
| `GET /health` | Status snapshot: `phase: "10"`, persistence, authMode, queueMode, worker, **honest queue catalog** |
| `GET /health/live` | Liveness — process up; **no** dependency checks |
| `GET /health/ready` | Readiness — Postgres when `PERSISTENCE=prisma`; Redis when `QUEUE_MODE=redis`; **503** if not ready |
| `GET /metrics` | In-memory Prometheus text metrics |

Also: request IDs, structured logging, correlation across HTTP paths.

---

## 28. Backup / Restore (Phase 9.4 + Phase 12 depth)

Pipeline (conceptual):

```text
backup:create
    → backup:verify
    → backup:restore-test   (isolated target; shallow dataVerification)
    → backup:depth-gate     (LAB_CI_ONLY; Phase 1.3 fixture D1–D11)
```

Commands (via `@adlinklab/database`; root may alias create/verify/restore-test/cleanup):

| Command | Role |
|---------|------|
| `pnpm backup:create` / package `backup:create` | `pg_dump -Fc` artifact + metadata |
| `pnpm backup:verify` / package `backup:verify` | Checksum / artifact validation |
| `pnpm backup:restore-test` / package `backup:restore-test` | Isolated restore + schema/migration/shallow checks |
| `pnpm backup:cleanup` / package `backup:cleanup` | Retention (`ADLINKLAB_BACKUP_KEEP`) |
| `pnpm --filter @adlinklab/database backup:depth-gate` | **LAB_CI_ONLY** seeded depth orchestration (Phase 12) |

### Verification layers (do not conflate)

| Layer | What it proves | Notes |
|-------|----------------|-------|
| **Artifact** | Non-empty dump, SHA-256, PostgreSQL custom format | `backup:verify` |
| **Schema / migration** | Core tables present; `_prisma_migrations` / migration metadata | Part of `restore-test` |
| **Shallow data** | `dataVerification: "passed"` ⇔ **`tenantCount > 0`**; empty tenants → `limited_empty` | Unchanged Phase 9.4 semantics — **not** depth |
| **Seeded depth** | Phase 1.3 fixture contract D1–D11 on restored DB + source comparison + source unchanged | `backup:depth-gate` only |

### Depth contract (Phase 1.3 fixture — LAB/CI)

| ID | Assertion |
|----|-----------|
| D1 | Exactly 2 tenants |
| D2 | Fixed Tenant A + Tenant B IDs |
| D3 | Tenant A campaigns exactly 2 |
| D4 | Tenant A tracking publicIds exactly `trk_demo_001`..`003` |
| D5 | ORDER-001 attribution JOIN chain (Order → Conversion → Click → TrackingLink) |
| D6 | ORDER-001 belongs to Tenant A |
| D7 | Joined tracking publicId = `trk_demo_001` |
| D8 | Tenant B has ≥ 1 click |
| D9 | ACTIVE UrlVersion uniqueness violations = 0 |
| D10 | ACTIVE UrlVersion count = exactly **3** (**fixture-specific**, not a universal production invariant) |
| D11 | Source depth snapshot matches restore; source unchanged after restore |

Safety:

- Never restore onto the **source production** database
- Restore requires explicit process-local gate (`ADLINKLAB_BACKUP_ALLOW_RESTORE=1`) — **do not** commit into `.env`
- Restore target URL must differ from source
- Depth gate additionally requires `ADLINKLAB_SEEDED_DEPTH_GATE=1` and explicit source/restore URLs

Details: [operations.md](./operations.md). Depth gate: [`SEEDED_RESTORE_DEPTH_GATE.md`](../packages/database/SEEDED_RESTORE_DEPTH_GATE.md).

---

## 29. Deployment Architecture (Phase 9.1)

Compose topology (`docker-compose.yml`):

```text
traefik → api / web (HTTP :80; dashboard 127.0.0.1:8080 lab-only)
postgres ← migrate (one-shot migrate:deploy) ← api, worker
redis ← api (producer), worker (consumers)
web (Next.js)
```

| Service | Role |
|---------|------|
| `traefik` | Reverse proxy; **lab**: `--api.insecure=true`, no TLS redesign |
| `postgres` | Persistence |
| `redis` | BullMQ broker |
| `migrate` | One-shot; api/worker wait for `service_completed_successfully` |
| `api` | Fastify application |
| `worker` | Worker runtime (`node dist/worker.js`) |
| `web` | Next.js UI |

API and worker share the API image but have **different runtime responsibilities**.

---

## 30. Script Integration (Phase 8.4)

See:

- [script-dashboard.md](./script-dashboard.md)
- [script-integration-admin.md](./script-integration-admin.md)
- [script-runtime-verification.md](./script-runtime-verification.md)

Surfaces: integration token lifecycle, Script config (ACTIVE UrlVersion authority), sync-result → `appliedVersion`, dashboard read APIs, admin UI, generator. Desired authority rules in §22.

---

## 31. Phase 9 Capabilities

Consolidated matrix: [phase-9-capability-matrix.md](./phase-9-capability-matrix.md).

| Area | Status |
|------|--------|
| 9.1 Deployment foundation | **IMPLEMENTED** (Compose migrate-first) |
| 9.2 Production auth mode | **IMPLEMENTED** (fail-closed `api_key`) |
| 9.3 Observability | **IMPLEMENTED** |
| 9.4 Backup / restore safety | **IMPLEMENTED** (gates + CLI) |
| 9.5 Desired authority hygiene | **IMPLEMENTED** |
| 9.6 Queue catalog honesty | **IMPLEMENTED** |

Operational runbook: [operations.md](./operations.md).

---

## 32. Known Limitations

| Item | Classification |
|------|----------------|
| Planned queues without Workers | **PLANNED** — not production-capable |
| Live Google Ads mutation | **DEFERRED-BY-DESIGN** |
| Cookie / session SSO | **NOT IMPLEMENTED** |
| Traefik TLS / HTTPS / ACME / :443 | **LAB-ONLY** / deferred (`:80` only; dashboard off by default) |
| Web browser E2E | Gap |
| Offsite / object-storage DR | **NOT IMPLEMENTED** |
| Production restore drill | **NOT PROVEN** (lab only) |
| Scheduled GitHub Actions CI for depth-gate | **NOT IMPLEMENTED** (local/lab command exists) |
| Seeded restore depth (Phase 1.3 D1–D11) | **IMPLEMENTED** — **LAB_CI_ONLY**; Phase 12 **CLOSED**; evidence `backups-phase122c-lab/` |
| Script Integration rows in depth fixtures | **NOT COVERED** |
| `tracking_link_offers` in depth fixtures | **NOT COVERED** |
| Worker Compose healthcheck | Artifact-only (`dist/worker.js` exists) — not Redis/queue liveness |
| HTTP rate limit store | In-process — multi-replica aggregation not claimed |
| Shallow `dataVerification: "passed"` | Still **only** `tenantCount > 0` — not depth success |

---

## 33. Out of Scope (ongoing hard boundaries)

- Real Google Ads production mutations / live credentials for mutation
- Implementing `googleAdsSync` / `clickProcessing` / `analyticsAggregation` Workers without an explicit phase
- Traffic forgery, cloaking, IP/UA spoofing against third parties
- Treating `ScriptSyncTarget.desiredVersion` as Desired Authority
- Restoring backups onto source production databases
