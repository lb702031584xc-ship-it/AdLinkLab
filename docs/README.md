# Documentation

Canonical architecture and operations for AdLinkLab through **Phase 12** (**ACCEPTED / CLOSED**), **Phase 13.1** docs sync (**CLOSED**), **Phase 13.2-CI** controlled GitHub Actions depth-gate (**CLOSED / PASS**), and **Phase 13.3** documentation truth sync.

## Architecture & operations

| Document | Purpose |
|----------|---------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | **Canonical architecture** (Phase 0 → 13.2-CI) |
| [operations.md](./operations.md) | **Operations runbook** (Compose, env, health, backup, depth-gate, auth, test matrix) |
| [phase-9-capability-matrix.md](./phase-9-capability-matrix.md) | Capability matrix (Phase 9–13.2-CI + boundaries) |
| [../packages/database/SEEDED_RESTORE_DEPTH_GATE.md](../packages/database/SEEDED_RESTORE_DEPTH_GATE.md) | Phase 12 **LAB_CI_ONLY** seeded restore depth gate (+ 13.2-CI wiring) |

## Domain / feature contracts

| Document | Phase |
|----------|-------|
| [tracking.md](./tracking.md) | 4 — TrackingLink / Click / Attribution |
| [offers.md](./offers.md) | 5 — Offer Engine |
| [url-change.md](./url-change.md) | 6 — URL Versioning & Change Workflow (`urlChange` queue) |
| [conversions.md](./conversions.md) | 7 — Conversion / Order attribution (`conversionUpload` queue) |

## Script integration (Phase 8.4)

| Document | Purpose |
|----------|---------|
| [script-dashboard.md](./script-dashboard.md) | Dashboard read API |
| [script-integration-admin.md](./script-integration-admin.md) | Admin / integration management |
| [script-runtime-verification.md](./script-runtime-verification.md) | Runtime verification notes |

## Planning / hardening notes

| Document | Purpose |
|----------|---------|
| [PHASE10_HARDENING_PROMPT.md](./PHASE10_HARDENING_PROMPT.md) | Historical Phase 10 hardening prompt (superseded by implemented Phase 10–12 work) |

## Honesty rules (quick)

- A queue is **IMPLEMENTED** only if Worker + processor exist → currently `urlChange`, `conversionUpload`.
- `googleAdsSync`, `clickProcessing`, `analyticsAggregation` are **PLANNED**.
- **ACTIVE UrlVersion** is sole Desired Authority; `ScriptSyncTarget.desiredVersion` is cache only.
- No production Google Ads mutation capability.
- Shallow `dataVerification: "passed"` ⇔ `tenantCount > 0` only; depth = `backup:depth-gate` (LAB_CI_ONLY).
- TLS, offsite DR, production restore, **scheduled/push** CI, and browser E2E are **not** claimed.
- Controlled **`workflow_dispatch`** depth-gate CI exists (Phase 13.2-CI **CLOSED / PASS**); that is **not** fully automated/scheduled CI.
