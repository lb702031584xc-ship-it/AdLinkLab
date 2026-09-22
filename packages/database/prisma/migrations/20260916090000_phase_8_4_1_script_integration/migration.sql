-- Phase 8.4.1: Google Ads Script Integration data model (ADD ONLY)

CREATE TYPE "ScriptIntegrationStatus" AS ENUM ('ACTIVE', 'DISABLED', 'REVOKED');
CREATE TYPE "ScriptSyncState" AS ENUM ('SYNCED', 'OUT_OF_SYNC', 'NEVER_APPLIED');
CREATE TYPE "ScriptConnectionHealth" AS ENUM ('CONNECTED', 'STALE', 'DISABLED');
CREATE TYPE "ScriptExecutionResult" AS ENUM ('SUCCESS', 'FAILED', 'PARTIAL', 'NO_CHANGE');

CREATE TABLE "google_ads_script_integrations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "google_account_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ScriptIntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "token_key_id" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "config_generation" INTEGER NOT NULL DEFAULT 0,
    "last_seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "google_ads_script_integrations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "script_sync_targets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "entity_type" "UrlEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "google_ad_id" TEXT,
    "campaign_id" UUID,
    "ad_group_id" UUID,
    "desired_version" INTEGER,
    "applied_version" INTEGER,
    "last_sync_at" TIMESTAMPTZ(3),
    "last_success_at" TIMESTAMPTZ(3),
    "sync_state" "ScriptSyncState" NOT NULL DEFAULT 'NEVER_APPLIED',
    "connection_health" "ScriptConnectionHealth" NOT NULL DEFAULT 'STALE',
    "last_execution" "ScriptExecutionResult",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "script_sync_targets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "script_sync_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "desired_version" INTEGER NOT NULL,
    "reported_applied_version" INTEGER,
    "result" "ScriptExecutionResult" NOT NULL,
    "error_code" TEXT,
    "error_message" TEXT,
    "request_id" TEXT,
    "idempotency_scope" TEXT NOT NULL DEFAULT 'SCRIPT_SYNC_RESULT',
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "script_sync_logs_pkey" PRIMARY KEY ("id")
);

-- FKs: Restrict — preserve sync history when integration soft-deleted at app layer
ALTER TABLE "google_ads_script_integrations"
  ADD CONSTRAINT "google_ads_script_integrations_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "google_ads_script_integrations"
  ADD CONSTRAINT "google_ads_script_integrations_google_account_id_fkey"
  FOREIGN KEY ("google_account_id") REFERENCES "google_accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "script_sync_targets"
  ADD CONSTRAINT "script_sync_targets_integration_id_fkey"
  FOREIGN KEY ("integration_id") REFERENCES "google_ads_script_integrations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "script_sync_logs"
  ADD CONSTRAINT "script_sync_logs_integration_id_fkey"
  FOREIGN KEY ("integration_id") REFERENCES "google_ads_script_integrations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "script_sync_logs"
  ADD CONSTRAINT "script_sync_logs_target_id_fkey"
  FOREIGN KEY ("target_id") REFERENCES "script_sync_targets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Uniques
CREATE UNIQUE INDEX "google_ads_script_integrations_token_hash_key"
  ON "google_ads_script_integrations"("token_hash");

CREATE UNIQUE INDEX "script_sync_targets_tenant_integration_entity_key"
  ON "script_sync_targets"("tenant_id", "integration_id", "entity_type", "entity_id");

CREATE UNIQUE INDEX "script_sync_logs_tenant_id_idempotency_scope_idempotency_key_key"
  ON "script_sync_logs"("tenant_id", "idempotency_scope", "idempotency_key");

-- Indexes
CREATE INDEX "google_ads_script_integrations_tenant_id_idx"
  ON "google_ads_script_integrations"("tenant_id");

CREATE INDEX "google_ads_script_integrations_tenant_id_status_idx"
  ON "google_ads_script_integrations"("tenant_id", "status");

CREATE INDEX "google_ads_script_integrations_google_account_id_idx"
  ON "google_ads_script_integrations"("google_account_id");

CREATE INDEX "script_sync_targets_tenant_id_idx"
  ON "script_sync_targets"("tenant_id");

CREATE INDEX "script_sync_targets_integration_id_idx"
  ON "script_sync_targets"("integration_id");

CREATE INDEX "script_sync_targets_integration_id_entity_type_entity_id_idx"
  ON "script_sync_targets"("integration_id", "entity_type", "entity_id");

CREATE INDEX "script_sync_logs_tenant_id_idx"
  ON "script_sync_logs"("tenant_id");

CREATE INDEX "script_sync_logs_integration_id_idx"
  ON "script_sync_logs"("integration_id");

CREATE INDEX "script_sync_logs_target_id_idx"
  ON "script_sync_logs"("target_id");

CREATE INDEX "script_sync_logs_created_at_idx"
  ON "script_sync_logs"("created_at");
