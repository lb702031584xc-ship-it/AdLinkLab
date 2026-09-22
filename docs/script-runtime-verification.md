# Phase 8.4.8 — Script Runtime Verification (Simulator)

**TEST / LAB ONLY.** This phase does **not** execute real Google Ads Scripts, does **not** mutate production Google Ads accounts, and does **not** generate real traffic.

## Purpose

Provide a deterministic, repeatable runtime harness:

```
Script Config
  → Generated Script semantics (Runtime Adapter)
  → Mock AdsApp URL apply
  → Sync Result API
  → Applied State + ScriptSyncLog
  → Dashboard Read Model
```

## What it is / is not

| Is | Is not |
|----|--------|
| In-memory Mock `AdsApp` / `UrlFetchApp` / `Utilities` / `Logger` | Real Google Ads API mutation |
| Fastify `inject` to Config + Sync Result APIs | Real Google Ads Script execution |
| Deterministic scenarios + failure injection | Proxy / IP rotation / UA spoofing |
| Opt-in PostgreSQL suite (`PHASE848_PG=1`) | Cloaking / anti-detection / fabricated click IDs |

## Location

```
apps/api/src/test-runtime/
  assert-test-runtime.ts
  mock-ads-app.ts
  mock-url-fetch-app.ts
  mock-utilities.ts
  mock-logger.ts
  script-runtime-adapter.ts
  script-runtime-simulator.ts
  scenarios.ts
  types.ts
  index.ts
```

Production routes, workers, and app bootstrap **must not** import this tree.

`assertTestRuntime()` throws when `NODE_ENV=production`.

There is **no** production HTTP `/simulator` endpoint.

## Runtime Adapter

Generated Google Ads Script source targets the Apps Script runtime (sync `UrlFetchApp`). Node cannot `eval` it against async Fastify handlers without changing production semantics.

Phase 8.4.8 therefore uses a **Script Runtime Adapter** that mirrors `script-generator-source.ts` behavior (config → per-target apply → sync-result, including HTTP retry rules). Static tests still assert the generated source contains the required APIs and bans forbidden mechanisms.

## Scenarios

| Name | Expectation |
|------|-------------|
| SUCCESS | `appliedVersion` matches desired; SYNCED |
| NEVER_APPLIED | null → applied after SUCCESS |
| OUT_OF_SYNC | applied advances to desired |
| STALE_DESIRED | ACTIVE changes mid-run → 409; no rollback |
| VERSION_CONFLICT | applied cannot move backward |
| IDEMPOTENT_REPLAY | same idempotency key → one SyncLog |
| PARTIAL_FAILURE | one target fail does not block others |
| NO_ACTIVE_VERSION | skip apply (or equivalent skip when desired is null) |
| MULTI_TARGET | independent per-target outcomes |
| CONCURRENT_EXECUTION | one logical apply / one SyncLog |

## Safety

- **NO REAL NETWORK** — `MockUrlFetchApp` + network guard on `globalThis.fetch`
- **NO REAL GOOGLE ADS API MUTATION** — provider invocation count asserted `0`
- Token stays in runtime memory; must not appear in Logger, SyncLog, or URL query
- Generator still does **not** persist script source (no DB entity / migration)

## Tests

- Memory: `apps/api/src/services/phase8.4.8-runtime.test.ts` (≥50)
- PostgreSQL opt-in: `PHASE848_PG=1` → `phase8.4.8.pg.test.ts`

## Policy

This harness does not bypass Google Ads or affiliate policies. It only verifies AdLinkLab config → apply semantics → sync → dashboard consistency in a lab environment.
