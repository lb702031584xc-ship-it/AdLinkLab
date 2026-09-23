# Seeded Restore Depth Gate (LAB / CI ONLY)

Phase 12.2-B orchestration. Validates that backup → isolated restore preserves the Phase 1.3 fixture depth contract (D1–D11).

**Phase 12 status: ACCEPTED / CLOSED** (lab evidence under `backups-phase122c-lab/`).

**Phase 13.2-CI status: CLOSED / PASS** — controlled GitHub Actions runs the **same** command via `.github/workflows/seeded-restore-depth-gate.yml` (`workflow_dispatch` only). Acceptance run: `35808897526` on `e95e14ce941e7564d476804bc1e8c352505941ab` (D1–D11 PASS, `overallStatus=passed`, `sourceUnchanged=true`).

**Not a production backup path.** Shallow `dataVerification: "passed"` (`tenantCount > 0`) is unchanged and is not treated as depth success.

**Not scheduled / push CI** — local/lab command remains primary; repo CI is **manual `workflow_dispatch` only** (not fully automated CI).

**CI auth (R3):** ephemeral Actions Postgres uses CI-only `POSTGRES_HOST_AUTH_METHOD=trust` (no service `POSTGRES_PASSWORD`). Trust is not a production auth model.

**Resolved finding:** Phase 13.2-CI.2-R2 logged expanded service-container `POSTGRES_PASSWORD` during Initialize containers `docker create`. **Resolved** in R3 by removing the password and using trust + passwordless URLs.

## Prerequisites

- PostgreSQL source + isolated restore databases (different DB names)
- `pg_dump` / `pg_restore` on `PATH` or via `ADLINKLAB_PG_BIN`
- Explicit restore allow flag for the process only (do **not** commit to `.env`)

## Run

From repo root (or `packages/database`):

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

Optional: `ADLINKLAB_SEEDED_DEPTH_SKIP_PREPARE=1` skips migrate deploy + `SEED_RESET=1` seed (source must already satisfy Phase 1.3 fixtures). GitHub Actions CI does **not** set `SKIP_PREPARE`.

## What it does

1. Validate config + safety (`source ≠ restore`, restore gate)
2. `prisma migrate deploy` + `SEED_RESET=1` seed on **source only**
3. Depth snapshot + D1–D10 on source (fail closed if fixtures invalid)
4. Existing `createBackup` → `verifyBackup` → `restoreVerify`
5. Depth snapshot + D1–D10 on **restore** target
6. D11 source↔restore comparison
7. Re-snapshot source → prove source unchanged

Machine-readable JSON is printed to stdout; exit code `0` only when `overallStatus` is `passed`.

## Notes

- D10 (`ACTIVE UrlVersion count === 3`) is a **Phase 1.3 fixture contract**, not a general production invariant.
- `SEED_RESET=1` only deletes known fixture tenant rows (see `prisma/seed.ts`); never aimed at the restore URL.
- Script Integration rows and `tracking_link_offers` are **not** part of this depth contract (unproven, not “gate missing”).
