# Phase Capability Matrix

Evidence-based status for AdLinkLab through **Phase 12** (Phase 12 **ACCEPTED / CLOSED**). Status vocabulary:

| Status | Meaning |
|--------|---------|
| **IMPLEMENTED** | Present in runtime with tests/ops path; safe to operate within documented limits |
| **PLANNED** | Named / catalogued; **no** production Worker (or equivalent) yet |
| **LAB-ONLY** / **LAB_CI_ONLY** | Works for local/lab (and optional future CI wiring); not a production hardening claim |
| **DEFERRED-BY-DESIGN** | Intentionally absent (hard boundary) |

Canonical architecture: [ARCHITECTURE.md](./ARCHITECTURE.md). Operations: [operations.md](./operations.md). Depth gate runbook: [`packages/database/SEEDED_RESTORE_DEPTH_GATE.md`](../packages/database/SEEDED_RESTORE_DEPTH_GATE.md).

---

## Phase 9 workstreams

| Capability | Status | Evidence | Production meaning |
|------------|--------|----------|-------------------|
| 9.1 Deployment foundation | **IMPLEMENTED** | `docker-compose.yml` (traefik, postgres, redis, migrate, api, worker, web); migrate-first `depends_on` | Can bring up lab/prod-like stack; Traefik TLS not included |
| 9.2 Production auth mode | **IMPLEMENTED** | `AUTH_MODE=api_key` fail-closed for `NODE_ENV=production`; `ADLINKLAB_API_KEYS`; pepper for integration tokens | Production must use api_key; disabled mode forbidden |
| 9.3 Observability | **IMPLEMENTED** | `GET /health` (`phase: "10"`), `/health/live`, `/health/ready`, `/metrics`; request IDs; structured logs | Liveness ≠ readiness; use ready for traffic gates |
| 9.4 Backup / restore safety | **IMPLEMENTED** | `pnpm backup:create\|verify\|restore-test\|cleanup`; `pg_dump -Fc`; restore gates | Isolated restore only; never onto source prod DB |
| 9.5 Desired authority hygiene | **IMPLEMENTED** | ACTIVE UrlVersion sole desired authority; `desiredVersion` cache; `compareAndSetAppliedVersion` | Script must not become desired-URL authority |
| 9.6 Queue catalog honesty | **IMPLEMENTED** | `queue-catalog.ts` / `WORKER_REGISTRY`; `/health` exposes per-queue status | Catalog name ≠ IMPLEMENTED |

---

## Phase 10–12 (post–Phase 9)

| Capability | Status | Evidence | Production meaning |
|------------|--------|----------|-------------------|
| Phase 10 CORS / rate limit | **IMPLEMENTED** | `CORS_ORIGINS` fail-closed; `@fastify/rate-limit` (in-process store) | Production require allowlist; multi-replica aggregation not claimed |
| Phase 10 Compose healthchecks | **IMPLEMENTED** | API → `/health/ready`; worker → `dist/worker.js` **artifact** check | Ready ≠ live; worker check is not Redis/queue liveness |
| Phase 10.5 / 11 seeded restore lab | **IMPLEMENTED** (lab) | Lab evidence under `backups-phase111-lab/` | Populated Phase 1.3 restore proven in lab |
| Phase 12 Seeded Restore Depth Gate | **IMPLEMENTED** (**LAB_CI_ONLY**) | `backup:depth-gate`; module + gate tests; `backups-phase122c-lab/` — Phase 12 **ACCEPTED / CLOSED**; D1–D11 **PASS** | Not a production backup path; not scheduled GitHub Actions CI |

Honesty: missing Script Integration / `tracking_link_offers` fixtures means those shapes are **unproven**, not that the depth gate is unimplemented.

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
| Web browser E2E | **PLANNED** / gap | Absent | Not claimed |
| Offsite / object-storage DR | **NOT IMPLEMENTED** | Local dump artifacts only | Not claimed |
| Production restore drill | **NOT PROVEN** | Lab restore only | Not claimed |
| Scheduled GitHub Actions CI | **NOT IMPLEMENTED** | No project `.github/workflows` for depth-gate | Local/lab gate exists; CI wiring is future work |
| Script Integration in depth fixtures | **NOT COVERED** | Not seeded in Phase 1.3 depth contract | Depth PASS ≠ SI row restore proof |
| `tracking_link_offers` in depth fixtures | **NOT COVERED** | Empty in Phase 1.3 dataset | Depth PASS ≠ offer-link restore proof |

---

## Documentation note

`/health` still reports `phase: "10"` (historical stamp). That does **not** mean Phase 11–12 work is absent.

**Remaining gaps (honest):** TLS/HTTPS, browser E2E, repo CI automation, offsite DR, production restore drill, broader restore fixtures (Script Integration, `tracking_link_offers`), multi-replica rate-limit store, worker Redis/queue-ready health.
