# AdLinkLab Operations Runbook

Operational baseline for the **actual** deployment through **Phase 12** (**ACCEPTED / CLOSED**) and **Phase 13.2-CI** (**CLOSED / PASS**; Phase 9–10 foundation). This document describes how to run and operate the system; it does **not** invent features.

Canonical architecture: [ARCHITECTURE.md](./ARCHITECTURE.md). Capability matrix: [phase-9-capability-matrix.md](./phase-9-capability-matrix.md). Seeded depth gate: [`packages/database/SEEDED_RESTORE_DEPTH_GATE.md`](../packages/database/SEEDED_RESTORE_DEPTH_GATE.md). Controlled CI workflow: [`.github/workflows/seeded-restore-depth-gate.yml`](../.github/workflows/seeded-restore-depth-gate.yml).

**Never put real secrets in this file or in git.** Use `.env` (gitignored); start from `.env.example`.

---

## 1. Architecture

```text
Researcher / Script
       │
       ▼
   Traefik (:80) ──► web (Next.js)
                 ──► api (Fastify producer + HTTP)
       │
       ├── postgres (system of record)
       ├── redis (BullMQ broker)
       ├── migrate (one-shot prisma migrate deploy)
       └── worker (BullMQ consumers: urlChange, conversionUpload)
```

- **API** enqueues jobs; **worker** processes implemented queues.
- **ACTIVE UrlVersion** is sole Desired Authority (see ARCHITECTURE §22).
- **Google Ads API provider** refuses production mutation.

---

## 2. Compose Services

From root `docker-compose.yml` (`name: adlinklab`):

| Service | Role | Notes |
|---------|------|-------|
| `traefik` | Reverse proxy | Dashboard off by default; set `TRAEFIK_DASHBOARD=true` for lab on `127.0.0.1:8080` |
| `postgres` | PostgreSQL 16 | Volume `postgres_data`; health: `pg_isready` |
| `redis` | Redis 7 | BullMQ broker; health: `PING` |
| `migrate` | One-shot | `pnpm --filter @adlinklab/database migrate:deploy`; `restart: "no"` |
| `api` | Fastify | Waits for healthy postgres/redis + migrate success; healthcheck hits `/health/ready` |
| `worker` | Worker runtime | `node dist/worker.js`; healthcheck verifies `dist/worker.js` exists |
| `web` | Next.js | UI |

Networks/volumes: `adlinklab` network; `postgres_data`, `redis_data`.

Do **not** use `prisma db push` for production-like deploy — Compose uses **migrate deploy** only.

---

## 3. Environment Variables

Template: `.env.example`. Values below are **names and roles only**.

### Core

| Variable | Classification | Notes |
|----------|----------------|-------|
| `COMPOSE_PROJECT_NAME` | Optional (recommended) | Use when folder name is non-ASCII (`adlinklab`) |
| `NODE_ENV` | Required (compose sets `production` for api/worker/migrate) | Production guards key off this |
| `API_PORT` | Optional | Default `3001` in compose |
| `DATABASE_URL` | **Required** (production / compose) | Prisma connection |
| `REDIS_URL` | **Required** (compose api/worker) | BullMQ |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Required for compose postgres | Password must be set |

### Persistence & queue

| Variable | Classification | Notes |
|----------|----------------|-------|
| `PERSISTENCE` | **Production-required** `prisma` | Memory **forbidden** in production |
| `QUEUE_MODE` | Compose: `redis` | `off` = no broker (dev/test). Worker requires `redis` |
| `QUEUE_ENABLED` | Optional | Alternate enable signal for redis mode |

### Authentication

| Variable | Classification | Notes |
|----------|----------------|-------|
| `AUTH_MODE` | **Production-required** `api_key` | `disabled` = **development/test only**; production fail-closed |
| `ADLINKLAB_API_KEYS` | **Production-required** | `key:tenantId[,…]` — never commit real keys |
| `ADLINKLAB_API_KEYS_NO_FIXTURES` | Optional / production hardening | Disables fixture key loading |
| `INTEGRATION_TOKEN_PEPPER` | **Required** outside test for Script tokens | Fail-closed when missing outside test |
| `ADLINKLAB_INTEGRATION_TOKEN` | Optional (web server) | Server-only; never `NEXT_PUBLIC_*` |
| `ADLINKLAB_API_KEY` | Optional (web server) | Server-only |

### Providers

| Variable | Classification | Notes |
|----------|----------------|-------|
| `GOOGLE_ADS_PROVIDER` | Lab default `mock` | `api` = skeleton; **mutation not implemented** |
| `TRAFFIC_PROVIDER` | Lab | `database` / `mock` per compose / local |
| `SCRIPT_API_BASE_URL` | Optional | Public API base for Script generator; avoid localhost outside test |

### Web

| Variable | Classification | Notes |
|----------|----------------|-------|
| `NEXT_PUBLIC_API_BASE_URL` | Required for web → API | Public URL shape only; **no secrets** |

### Backup (Phase 9.4 + Phase 12 depth gate)

| Variable | Classification | Notes |
|----------|----------------|-------|
| `ADLINKLAB_BACKUP_DIR` | Optional | Local dump dir (gitignored) |
| `ADLINKLAB_PG_BIN` | Optional | Directory with `pg_dump` / `pg_restore` |
| `ADLINKLAB_BACKUP_RESTORE_DATABASE_URL` | Required for restore-test / depth-gate | **Must differ** from source |
| `ADLINKLAB_BACKUP_ALLOW_RESTORE` | **Explicit process-local gate** | Must be `1` for restore-test / depth-gate. **Do not** write into committed `.env` |
| `ADLINKLAB_BACKUP_KEEP` | Optional | Retention count (e.g. `5`) |
| `ADLINKLAB_BACKUP_PRODUCTION_DATABASE` | Optional safety hint | Blocks restore onto that DB name |
| `ADLINKLAB_SEEDED_DEPTH_GATE` | Required for depth-gate | Must be `1` (LAB/CI intent) |
| `ADLINKLAB_BACKUP_SOURCE_DATABASE_URL` | Preferred for depth-gate | Explicit source; else `DATABASE_URL` only when depth-gate flag is set |
| `ADLINKLAB_SEEDED_DEPTH_SKIP_PREPARE` | Optional | `1` skips migrate+seed on source |
| `CORS_ORIGINS` | **Required in production** | Comma-separated allowlist; `*` / empty fail-closed |
| `RATE_LIMIT_API_MAX` / `RATE_LIMIT_SCRIPT_MAX` | Optional | Defaults 120 / 60 in production; **in-process** store |
| `RATE_LIMIT_WINDOW` | Optional | Default `1 minute` |
| `TRAEFIK_DASHBOARD` | Optional lab | `true` enables Traefik dashboard + insecure API (loopback) |

---

## 4. Startup

### Safe Compose order (actual depends_on)

1. **postgres** + **redis** become healthy  
2. **migrate** runs once (`migrate:deploy`) and exits successfully  
3. **api** and **worker** start (both wait on migrate completed + DB/Redis healthy)  
4. **web** / **traefik** serve HTTP  

Typical:

```bash
cp .env.example .env   # then edit secrets — do not commit
docker compose up --build
```

Local API without worker (dev):

```bash
pnpm --filter @adlinklab/database migrate:deploy   # if using Postgres
pnpm --filter @adlinklab/api dev
# optional worker:
pnpm --filter @adlinklab/api worker
# or: pnpm --filter @adlinklab/api worker:start
```

---

## 5. Health Checks

| Path | Purpose |
|------|---------|
| `GET /health` | Snapshot: `status`, `phase: "10"`, `persistence`, `authMode`, `queueMode`, `worker`, honest `queues[]` |
| `GET /health/live` | **Liveness** — process alive; **no** dependency probes |
| `GET /health/ready` | **Readiness** — Postgres when prisma; Redis when `QUEUE_MODE=redis`; **503** if not ready |
| `GET /metrics` | Prometheus text metrics |

**Liveness vs readiness:** use `/health/live` for “restart if dead”; use `/health/ready` for “accept traffic only when dependencies OK.” Compose **api** healthcheck probes `/health/ready`.

Also: request IDs + structured logging with correlation on HTTP paths.

---

## 6. Queue Operations

| Queue | Status | Production meaning |
|-------|--------|--------------------|
| `urlChange` | **IMPLEMENTED** | Worker + `processUrlChangeJob` |
| `conversionUpload` | **IMPLEMENTED** | Worker + `processConversionUploadJob` |
| `googleAdsSync` | **PLANNED** | Not a production-capable BullMQ Worker |
| `clickProcessing` | **PLANNED** | Not implemented |
| `analyticsAggregation` | **PLANNED** | Not implemented |

Honesty rule: catalog / `JOB_DEFINITIONS` presence ≠ IMPLEMENTED.

**Planned queues must not be treated as production-capable workers.**

Tenant rule: `job.data.tenantId` is a claim; **SyncJob row is authoritative** where loaded.

---

## 7. Backup

### Daily / production-safe commands

```bash
pnpm backup:create        # pg_dump -Fc + metadata
pnpm backup:verify        # checksum / artifact validation
pnpm backup:restore-test  # isolated restore + schema/migration/shallow verify (gated)
pnpm backup:cleanup       # retention
```

- Format: PostgreSQL custom (`pg_dump -Fc`)
- Verify before trusting an artifact
- Keep dumps out of git (`ADLINKLAB_BACKUP_DIR`)
- Shallow `dataVerification: "passed"` still means **only** `tenantCount > 0` (not seeded depth)
- `limited_empty` remains the empty-tenant restore outcome

### Seeded restore depth gate (LAB_CI_ONLY — Phase 12)

**Not** a normal production backup command. Orchestrates seed → create → verify → isolated restore → D1–D11 depth assertions. See [`SEEDED_RESTORE_DEPTH_GATE.md`](../packages/database/SEEDED_RESTORE_DEPTH_GATE.md).

```bash
ADLINKLAB_SEEDED_DEPTH_GATE=1 \
ADLINKLAB_BACKUP_ALLOW_RESTORE=1 \
ADLINKLAB_BACKUP_SOURCE_DATABASE_URL="postgresql://USER:PASS@127.0.0.1:5432/adlinklab" \
ADLINKLAB_BACKUP_RESTORE_DATABASE_URL="postgresql://USER:PASS@127.0.0.1:5432/adlinklab_restore_test" \
ADLINKLAB_BACKUP_DIR="./backups-depth-gate" \
ADLINKLAB_PG_BIN="/path/to/pg/bin" \
ADLINKLAB_BACKUP_PRODUCTION_DATABASE="adlinklab" \
pnpm --filter @adlinklab/database backup:depth-gate
```

Rules:

1. Supply `ADLINKLAB_BACKUP_ALLOW_RESTORE=1` **only for the current process/session** — **never** commit it to `.env`  
2. Source DB ≠ restore DB  
3. Phase 12 status: **ACCEPTED / CLOSED**; D1–D11 proven in lab evidence (`backups-phase122c-lab/`)  
4. D10 (`ACTIVE UrlVersion count === 3`) is a **Phase 1.3 fixture contract**, not a universal production rule  
5. Depth gate does **not** prove Script Integration rows or `tracking_link_offers` restore  
6. Phase 13.2-CI (**CLOSED / PASS**) wires the **same** gate into GitHub Actions via `.github/workflows/seeded-restore-depth-gate.yml` (`workflow_dispatch` only). That is **controlled dispatch CI**, not scheduled/push automation, not production restore, not offsite DR.

### Controlled GitHub Actions (Phase 13.2-CI)

- Workflow: `seeded-restore-depth-gate.yml` — manual `workflow_dispatch` on `main`
- Postgres **16** ephemeral service; isolated source/restore DB names per run
- CI-only trust auth (`POSTGRES_HOST_AUTH_METHOD=trust`; no service `POSTGRES_PASSWORD`; passwordless URLs) after R3 remediation
- Invokes existing `pnpm --filter @adlinklab/database backup:depth-gate` (no duplicated D1–D11)
- Acceptance evidence: run `35808897526` on commit `e95e14ce941e7564d476804bc1e8c352505941ab` — D1–D11 **PASS**, `overallStatus=passed`, `sourceUnchanged=true`, artifacts + cleanup
- **Resolved finding:** R2 exposed service-container `POSTGRES_PASSWORD` in Initialize containers `docker create` logs; R3 removed that password path

---

## 8. Restore Safety

1. Restore **only** into an **isolated** database URL  
2. Require explicit `ADLINKLAB_BACKUP_ALLOW_RESTORE=1` (process-local; not committed `.env`)  
3. **Never** restore onto the source production DB (`assertSafeRestoreTarget`)  
4. Run verify / table checks after restore-test  
5. Fail closed if target equals source or allow flag missing  
6. For business-data depth, use `backup:depth-gate` (LAB_CI_ONLY) — do not treat shallow `dataVerification: "passed"` as depth success  

Lab `pg_restore` validation: Phase 10.5 / 11 / 12.2-C evidence exists under `backups-phase111-lab/` and `backups-phase122c-lab/`. Unit tests may use injectables when tools are absent.

---

## 9. Authentication

| Mechanism | Use | Production |
|-----------|-----|------------|
| `AUTH_MODE=api_key` + `ADLINKLAB_API_KEYS` | Tenant management APIs | **Required** |
| `Authorization: Bearer <integration-token>` | Script / dashboard | Required for those surfaces; peppered |
| `AUTH_MODE=disabled` | Local/test convenience | **Forbidden** in production |

Production fail-closed: missing/invalid `AUTH_MODE`, memory persistence, or missing keys/pepper → **startup failure**.

Cookie / session SSO: **not implemented** (API key + Script Bearer only).

---

## 10. Google Ads Provider

| Value | Meaning |
|-------|---------|
| `mock` | Research/simulator mutations **allowed** (lab) |
| `api` | Interface skeleton; **mutation forbidden / not implemented** |

This project has **no** production Google Ads mutation capability. Do not add live mutation credentials.

---

## 11. Traefik / TLS Lab Limitation

**LAB-ONLY (accurate today):**

- Entry point HTTP `:80` only (no TLS redesign)
- Dashboard **off by default**; set `TRAEFIK_DASHBOARD=true` to enable dashboard + insecure API
- Dashboard published on **loopback only**: `127.0.0.1:8080:8080`

Do **not** treat this as production TLS.

---

## 12. Test Matrix

| Mode | Default | How |
|------|---------|-----|
| Unit / memory / in-process | **Yes** | `pnpm test` — no Redis required |
| Fastify inject | **Yes** | API route tests without full HTTP server |
| PostgreSQL opt-in | No | Set `PHASE*_PG=1` (see below) |
| Redis opt-in | No | `PHASE83_REDIS=1` / `PHASE835_RUNTIME=1` / `PHASE835_FULL=1` |

### Known opt-in flags (discovered in repo)

| Flag | Area |
|------|------|
| `PHASE61_PG` | Phase 6.1 / shared PG harness |
| `PHASE71_PG` | Phase 7.1 PG |
| `PHASE81_PG` | Phase 8.1 PG |
| `PHASE83_REDIS` | Phase 8.3.2 Redis |
| `PHASE835_RUNTIME` / `PHASE835_PG` / `PHASE835_FULL` | Phase 8.3.5 runtime |
| `PHASE841_PG` … `PHASE849_PG` | Script integration PG suites |
| `PHASE8410_R6_PG` | Phase 8.4.10-R6 PG |
| `PHASE8471_PG` | Dashboard PG |
| `PHASE848_PG` | Runtime verification PG |

### Inventory (Phase 10.1)

- **~66** `*.test.ts` files  
- **15** `*.pg.test.ts` files  

### Known test limitations

- Default suite does **not** require live Postgres/Redis  
- No web browser E2E in-repo (gap; not Phase 10.1)  
- Real Traefik/TLS not covered by unit tests  
- `packages/offers` has package-level unit tests (Phase 10.4)  
- Live Google Ads intentionally **absent** from tests  

---

## 13. Operational Safety Rules

1. **Never** enable live Google Ads mutations or claim API mutation works.  
2. **Never** bypass tenant isolation (including queue/worker paths).  
3. **Never** treat `ScriptSyncTarget.desiredVersion` as Desired Authority — **ACTIVE UrlVersion** only.  
4. **Never** treat planned queues as implemented Workers.  
5. **Never** restore a backup onto the source production database.  
6. **Never** expose secrets (API keys, tokens, peppers, dump contents) in logs or docs.  
7. **Never** use `prisma db push` for production-like deploy — use migrate deploy.  
8. Keep planned Workers **unimplemented** until an explicit phase owns them.  
9. **Never** commit `ADLINKLAB_BACKUP_ALLOW_RESTORE=1` into `.env` — process-local only.  
10. **Never** treat shallow `dataVerification: "passed"` as seeded depth success — use `backup:depth-gate` for D1–D11 (LAB_CI_ONLY).  
11. Compose worker healthcheck verifies `dist/worker.js` exists (artifact-level) — not Redis/queue processor liveness.  
12. HTTP rate limits are in-process — do not claim multi-replica shared throttling.
