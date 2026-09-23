# AdLinkLab

Research SaaS for Google Ads API integration study, tracking links, GCLID/UTM attribution, URL versioning, Script-based URL sync, and Click → Conversion → Order experiments.

> **Current baseline: Phase 12 ACCEPTED / CLOSED** (on Phase 9–10 production hardening). **Phase 13.1** docs truth sync **CLOSED**. **Phase 13.2-CI** controlled GitHub Actions depth-gate **CLOSED / PASS**. **Phase 13.3** documentation truth sync (this update). **Mock / Adapter only** — no production Google Ads mutations, no traffic forgery / cloaking.

## Phase status

| Phase | Status |
|-------|--------|
| 9 — Production readiness foundation | **CLOSED** |
| 10 — Production hardening | **CLOSED** |
| 10.5 — Backup / restore lab validation | **CLOSED** |
| 11 — Seeded isolated restore validation | **CLOSED** |
| 12 — Seeded restore depth automation | **ACCEPTED / CLOSED** |
| 13.1 — Documentation truth sync | **CLOSED** |
| 13.2-CI — Controlled GitHub Actions depth-gate | **CLOSED / PASS** |
| 13.3 — Documentation truth sync | **CLOSED / PASS** |

## Current status

| Area | Status |
|------|--------|
| Phase 8.3 queue infrastructure | BullMQ producer + separate **worker** process |
| Implemented queues | **`urlChange`**, **`conversionUpload`** |
| Planned queues | `googleAdsSync`, `clickProcessing`, `analyticsAggregation` (not production Workers) |
| Phase 8.4 Script integration | Token, config, sync-result, dashboard, admin, generator |
| Phase 9 production foundation | Compose migrate-first, `AUTH_MODE=api_key`, observability, backup CLI |
| Google Ads mutation | Mock allowed (lab); **API provider refuses** — not production-capable |
| Auth | Production requires `api_key`; Script Bearer; **no** cookie/session SSO |
| Observability | `/health` (`phase: "10"` stamp), `/health/live`, `/health/ready`, `/metrics` |
| Backup / restore | `backup:create\|verify\|restore-test\|cleanup` + **LAB_CI_ONLY** `backup:depth-gate` (Phase 12 + 13.2-CI) |
| Phase 10 hardening | `CORS_ORIGINS` fail-closed; in-process rate limits; Traefik dashboard switch; API → `/health/ready`; worker health = `dist/worker.js` artifact |
| Traefik / TLS | HTTP `:80` only — TLS/HTTPS/ACME **not** implemented |
| Seeded restore depth | Phase 12 lab + Phase 13.2-CI GitHub Actions D1–D11 **PASS**; Script Integration / `tracking_link_offers` fixtures **not** covered |
| Controlled CI | `.github/workflows/seeded-restore-depth-gate.yml` — **`workflow_dispatch` only** (not scheduled/push) |
| Not claimed | Production restore, offsite DR, scheduled/push CI, browser E2E |

Canonical docs: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) · [docs/operations.md](./docs/operations.md) · [docs/phase-9-capability-matrix.md](./docs/phase-9-capability-matrix.md) · [packages/database/SEEDED_RESTORE_DEPTH_GATE.md](./packages/database/SEEDED_RESTORE_DEPTH_GATE.md)

## Stack

- **Web:** Next.js, TypeScript, Tailwind CSS
- **API:** Node.js, Fastify, TypeScript (strict)
- **Worker:** same API image; `node dist/worker.js` + BullMQ
- **Data:** PostgreSQL + Prisma
- **Queue:** Redis + BullMQ
- Infra: Docker Compose + Traefik (lab dashboard off by default; `TRAEFIK_DASHBOARD=true` for loopback; no TLS redesign yet)
- **Test:** Vitest (+ Fastify inject; PG/Redis opt-in)

## Monorepo

```
apps/web          Next.js UI (Script dashboard/admin + shells)
apps/api          Fastify API + BullMQ producer + worker entry
packages/domain   Entities + repository interfaces
packages/database Prisma + memory/prisma repos + backup CLI + depth gate
packages/google-ads  GoogleAdsProvider (Mock + API skeleton)
packages/tracking    URL resolvers + TrackingLinkResolver
packages/offers      Offer helpers
packages/conversions Attribution chain
packages/traffic     TrafficProvider (Mock + Database)
packages/shared      Errors, types, idempotency
infra/               postgres, redis, traefik
docs/                ARCHITECTURE, operations, feature contracts
```

## Quick start

```bash
pnpm install
pnpm --filter @adlinklab/database generate
pnpm typecheck
pnpm test
pnpm --filter @adlinklab/api dev
```

Compose (production-like lab): copy `.env.example` → `.env`, then `docker compose up --build`. See [docs/operations.md](./docs/operations.md).

## Feature docs (by phase)

| Doc | Topic |
|-----|-------|
| [docs/tracking.md](./docs/tracking.md) | Phase 4 tracking / click |
| [docs/offers.md](./docs/offers.md) | Phase 5 Offer Engine |
| [docs/url-change.md](./docs/url-change.md) | Phase 6 URL change (`urlChange`) |
| [docs/conversions.md](./docs/conversions.md) | Phase 7 conversions (`conversionUpload`) |
| [docs/script-dashboard.md](./docs/script-dashboard.md) | Phase 8.4.7 dashboard |
| [docs/script-integration-admin.md](./docs/script-integration-admin.md) | Phase 8.4 admin |
| [docs/script-runtime-verification.md](./docs/script-runtime-verification.md) | Phase 8.4 runtime verification |
| [packages/database/SEEDED_RESTORE_DEPTH_GATE.md](./packages/database/SEEDED_RESTORE_DEPTH_GATE.md) | Phase 12 LAB/CI seeded restore depth gate |

## Hard boundaries

- Do **not** enable live Google Ads mutations or treat planned queues as implemented.
- **ACTIVE UrlVersion** is Desired Authority; `desiredVersion` on Script sync targets is cache only.
- Never restore backups onto the source production database.
- Never commit `ADLINKLAB_BACKUP_ALLOW_RESTORE=1` into `.env` (process-local only).
- Shallow `dataVerification: "passed"` means **only** `tenantCount > 0` — not depth success.
