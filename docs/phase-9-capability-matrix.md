# Phase Capability Matrix

Evidence-based status for AdLinkLab through **Phase 12** (**ACCEPTED / CLOSED**) and **Phase 13.2-CI** (**CLOSED / PASS**). Status vocabulary:

| Status | Meaning |
|--------|---------|
| **IMPLEMENTED** | Present in runtime with tests/ops path; safe to operate within documented limits |
| **PLANNED** | Named / catalogued; **no** production Worker (or equivalent) yet |
| **LAB-ONLY** / **LAB_CI_ONLY** | Works for local/lab and/or **controlled** GitHub Actions (`workflow_dispatch`); not a production hardening claim |
| **PARTIAL** | Present with explicit limitations (e.g. dispatch-only CI, not scheduled) |
| **DEFERRED-BY-DESIGN** | Intentionally absent (hard boundary) |

Canonical architecture: [ARCHITECTURE.md](./ARCHITECTURE.md). Operations: [operations.md](./operations.md). Depth gate runbook: [`packages/database/SEEDED_RESTORE_DEPTH_GATE.md`](../packages/database/SEEDED_RESTORE_DEPTH_GATE.md). Workflow: [`.github/workflows/seeded-restore-depth-gate.yml`](../.github/workflows/seeded-restore-depth-gate.yml).

---

## Phase 9 workstreams

| Capability | Status | Evidence | Production meaning |
|------------|--------|----------|-------------------|
| 9.1 Deployment foundation | **IMPLEMENTED** | `docker-compose.yml` (traefik, postgres, redis, migrate, api, worker, web); migrate-first `depends_on` | Can bring up lab/prod-like stack; Traefik TLS not included |
| 9.2 Production auth mode | **IMPLEMENTED** | `AUTH_MODE=api_key` fail-closed for `NODE_ENV=production`; `ADLINKLAB_API_KEYS`; pepper for integration tokens | Production must use api_key; disabled mode forbidden |
| 9.3 Observability | **IMPLEMENTED** | `GET /health` (`phase: "10"`), `/health/live`, `/health/ready`, `/metrics`; request IDs; structured logs | Liveness ≠ readiness; use ready for traffic gates |
| 9.4 Backup / restore safety | **IMPLEMENTED** | `pnpm backup:create\|verify\|restore-test\|cleanup`; `pg_dump -Fc`; restore gates | Isolated restore only; never onto source prod DB — **not** production restore drill |
| 9.5 Desired authority hygiene | **IMPLEMENTED** | ACTIVE UrlVersion sole desired authority; `desiredVersion` cache; `compareAndSetAppliedVersion` | Script must not become desired-URL authority |
| 9.6 Queue catalog honesty | **IMPLEMENTED** | `queue-catalog.ts` / `WORKER_REGISTRY`; `/health` exposes per-queue status | Catalog name ≠ IMPLEMENTED |

---

## Phase 10–12 (post–Phase 9)

| Capability | Status | Evidence | Production meaning |
|------------|--------|----------|-------------------|
| Phase 10 CORS / rate limit | **IMPLEMENTED** (limitations) | `CORS_ORIGINS` fail-closed; `@fastify/rate-limit` (in-process store) | Production require allowlist; multi-replica aggregation not claimed |
| Phase 10 Compose healthchecks | **IMPLEMENTED** | API → `/health/ready`; worker → `dist/worker.js` **artifact** check | Ready ≠ live; worker check is not Redis/queue liveness |
| Phase 10.5 / 11 seeded restore lab | **IMPLEMENTED** (lab) | Lab evidence under `backups-phase111-lab/` | Populated Phase 1.3 restore proven in lab |
| Phase 12 Seeded Restore Depth Gate | **IMPLEMENTED** (**LAB_CI_ONLY**) | `backup:depth-gate`; module + gate tests; `backups-phase122c-lab/` — Phase 12 **ACCEPTED / CLOSED**; D1–D11 **PASS** | Not a production backup path |

Honesty: missing Script Integration / `tracking_link_offers` fixtures means those shapes are **unproven**, not that the depth gate is unimplemented. D10 (`activeUrlVersionCount === 3`) is a **Phase 1.3 fixture contract**, not a universal production invariant.

---

## Phase 13.2-CI (controlled GitHub Actions)

| Capability | Status | Evidence | Production meaning |
|------------|--------|----------|-------------------|
| Controlled depth-gate CI | **PARTIAL** — **CONTROLLED DISPATCH CI** | `.github/workflows/seeded-restore-depth-gate.yml`; `on: workflow_dispatch` only; Postgres **16** service; ephemeral `adlinklab_ci_src_<run_id>` / `adlinklab_ci_rst_<run_id>`; existing `pnpm --filter @adlinklab/database backup:depth-gate`; artifacts + cleanup | Manual/controlled LAB/CI only — **not** scheduled/push CI; **not** production restore; **not** offsite DR |
| Phase 13.2-CI acceptance | **CLOSED / PASS** | Final Acceptance Audit; acceptance run `35808897526` on commit `e95e14ce941e7564d476804bc1e8c352505941ab`; D1–D11 **11/11 PASS**; `overallStatus=passed`; `sourceUnchanged=true` | Evidence of controlled CI execution of the Phase 12 gate |
| CI Postgres auth (R3) | **IMPLEMENTED** (CI-only) | Service uses `POSTGRES_HOST_AUTH_METHOD: trust`; no `POSTGRES_PASSWORD`; passwordless `postgresql://user@host:port/db` URLs | Trust is **ephemeral CI service only** — never for production |

### Resolved historical finding (retain)

Phase 13.2-CI.2-R2 run `35804597456` was functionally green but failed security review: GitHub Actions **Initialize containers** logged an expanded service-container `POSTGRES_PASSWORD` from `docker create`.

**Resolved** in Phase 13.2-CI.2-R3 (commit `e95e14c`, run `35808897526`): removed service password; CI-only trust authentication; no credential-bearing URLs in workflow.

---

## Queue capabilities

| Capability | Status | Evidence | Production meaning |
|------------|--------|----------|-------------------|
| `urlChange` | **IMPLEMENTED** | `WORKER_REGISTRY` + `processUrlChangeJob` + Compose `worker` | Production worker processes this queue |
| `conversionUpload` | **IMPLEMENTED** | `WORKER_REGISTRY` + `processConversionUploadJob` + Compose `worker` | Production worker processes this queue |
| `googleAdsSync` | **PLANNED** | In `JOB_DEFINITIONS` / SyncJob type; **no** BullMQ Worker in `WorkerRuntime` | Do **not** treat as production-capable |
| `clickProcessing` | **PLANNED** | Catalog name only | Not implemented |
| `analyticsAggregation` | **PLANNED** | Catalog name only | Not implemented |

Honesty rule: **IMPLEMENTED ⇔ Worker registered ∧ processor exists.**

---

## Related boundaries

| Capability | Status | Evidence | Production meaning |
|------------|--------|----------|-------------------|
| Live Google Ads mutation | **DEFERRED-BY-DESIGN** | API provider refuses; mock only for research | Must remain absent |
| Traefik dashboard / no TLS | **LAB-ONLY** | Off by default; `TRAEFIK_DASHBOARD=true` for lab; `:80` only | Not production TLS / HTTPS / ACME |
| Cookie / session SSO | **NOT IMPLEMENTED** | API key + Script Bearer only | Do not claim browser SSO |
| Web browser E2E | **NOT IMPLEMENTED** | Absent | Not claimed |
| Offsite / object-storage DR | **NOT IMPLEMENTED** | Local dump artifacts only | Not claimed |
| Production restore drill | **NOT PROVEN** | Lab / CI isolated restore only | Not claimed |
| Scheduled / push GitHub Actions CI | **NOT IMPLEMENTED** | Depth-gate workflow is **`workflow_dispatch` only** | Controlled CI ≠ scheduled automation |
| Script Integration (runtime) | **IMPLEMENTED** | Phase 8.4 admin/dashboard/generator | Runtime present |
| Script Integration in depth fixtures | **NOT COVERED** | Not seeded in Phase 1.3 depth contract | Depth PASS ≠ SI row restore proof |
| `tracking_link_offers` in depth fixtures | **NOT COVERED** | Empty in Phase 1.3 dataset | Depth PASS ≠ offer-link restore proof |

---

## Documentation note

`/health` still reports `phase: "10"` (historical stamp). That does **not** mean Phase 11–13 work is absent.

**Phase 13.3** = Documentation Truth Sync (align docs with Phase 13.2-CI closure).

**Remaining gaps (honest — not Phase 13.2-CI failures):** TLS/HTTPS, browser E2E, scheduled/push CI, offsite DR, production restore drill, broader restore fixtures (Script Integration, `tracking_link_offers`), multi-replica rate-limit store, worker Redis/queue-ready health.
