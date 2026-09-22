-- Phase 1.2: tenant-scoped idempotency + ACTIVE UrlVersion partial unique

-- UrlChangeRequest: drop global unique, add scope + composite unique
ALTER TABLE "url_change_requests" ADD COLUMN IF NOT EXISTS "idempotency_scope" TEXT NOT NULL DEFAULT 'URL_CHANGE';

DROP INDEX IF EXISTS "url_change_requests_idempotency_key_key";

CREATE UNIQUE INDEX "url_change_requests_tenant_id_idempotency_scope_idempotency_key_key"
  ON "url_change_requests" ("tenant_id", "idempotency_scope", "idempotency_key");

-- SyncJob: require tenant, add scope, composite unique
ALTER TABLE "sync_jobs" ADD COLUMN IF NOT EXISTS "idempotency_scope" TEXT NOT NULL DEFAULT 'SYNC_JOB';

UPDATE "sync_jobs"
SET "tenant_id" = '00000000-0000-4000-8000-000000000001'
WHERE "tenant_id" IS NULL;

ALTER TABLE "sync_jobs" ALTER COLUMN "tenant_id" SET NOT NULL;

DROP INDEX IF EXISTS "sync_jobs_idempotency_key_key";

CREATE UNIQUE INDEX "sync_jobs_tenant_id_idempotency_scope_idempotency_key_key"
  ON "sync_jobs" ("tenant_id", "idempotency_scope", "idempotency_key");

CREATE INDEX IF NOT EXISTS "sync_jobs_tenant_id_idx" ON "sync_jobs" ("tenant_id");

-- Conversion idempotency (nullable keys — uniqueness only when both set)
ALTER TABLE "conversions" ADD COLUMN IF NOT EXISTS "idempotency_scope" TEXT;
ALTER TABLE "conversions" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;

CREATE UNIQUE INDEX "conversions_tenant_id_idempotency_scope_idempotency_key_key"
  ON "conversions" ("tenant_id", "idempotency_scope", "idempotency_key");

-- Order idempotency
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "idempotency_scope" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;

CREATE UNIQUE INDEX "orders_tenant_id_idempotency_scope_idempotency_key_key"
  ON "orders" ("tenant_id", "idempotency_scope", "idempotency_key");

-- At most one ACTIVE UrlVersion per (tenant, entityType, entityId)
CREATE UNIQUE INDEX "url_versions_one_active_per_entity"
  ON "url_versions" ("tenant_id", "entity_type", "entity_id")
  WHERE "status" = 'ACTIVE';
