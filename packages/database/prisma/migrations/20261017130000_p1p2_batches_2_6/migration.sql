-- P1/P2 batches 2-6 + §5 admin grants. All additive; no existing rows affected.
-- P1-7/P1-8: Google accounts dual type + health/appeal
ALTER TABLE "google_accounts" ADD COLUMN "account_type" TEXT NOT NULL DEFAULT 'MCC';
ALTER TABLE "google_accounts" ADD COLUMN "health_status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "google_accounts" ADD COLUMN "suspension_reason" TEXT;
ALTER TABLE "google_accounts" ADD COLUMN "appeal_status" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "google_accounts" ADD COLUMN "appeal_note" TEXT;
ALTER TABLE "google_accounts" ADD COLUMN "suspended_at" TIMESTAMPTZ(3);
CREATE TABLE "google_account_appeals" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "google_account_id" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "google_account_appeals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "google_account_appeals_tenant_idx" ON "google_account_appeals"("tenant_id");
CREATE INDEX "google_account_appeals_account_idx" ON "google_account_appeals"("google_account_id");
-- P1-4: launch archive phased budget (JSONB; null = not set)
ALTER TABLE "launch_archives" ADD COLUMN "testing_phase" JSONB;
ALTER TABLE "launch_archives" ADD COLUMN "scaling_phase" JSONB;
-- P1-6: per-offer auto-status preferences (default OFF)
CREATE TABLE "offer_preferences" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "offer_id" TEXT NOT NULL,
  "auto_status_enabled" BOOLEAN NOT NULL DEFAULT false,
  "zero_perf_days" INTEGER NOT NULL DEFAULT 5,
  "rosc_decline_days" INTEGER NOT NULL DEFAULT 7,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "offer_preferences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "offer_preferences_offer_key" UNIQUE ("offer_id")
);
CREATE INDEX "offer_preferences_tenant_idx" ON "offer_preferences"("tenant_id");
-- P1-11: attribution settings + conflicts
CREATE TABLE "attribution_settings" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "attribution_window_days" INTEGER NOT NULL DEFAULT 30,
  "gclid_dedupe_minutes" INTEGER NOT NULL DEFAULT 30,
  "duplicate_clicks_count_as_conversion" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attribution_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attribution_settings_tenant_key" UNIQUE ("tenant_id")
);
CREATE TABLE "attribution_conflicts" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "main_offer_id" TEXT,
  "conflict_offer_ids" JSONB NOT NULL DEFAULT '[]',
  "reason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "resolved_offer_id" TEXT,
  "resolved_by" TEXT,
  "resolved_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attribution_conflicts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "attribution_conflicts_tenant_idx" ON "attribution_conflicts"("tenant_id");
CREATE INDEX "attribution_conflicts_order_idx" ON "attribution_conflicts"("order_id");
-- P1-12: experiment AD_GROUP type
ALTER TABLE "experiments" ADD COLUMN "experiment_type" TEXT NOT NULL DEFAULT 'LANDING_PAGE';
ALTER TABLE "experiments" ADD COLUMN "seed_ad_group_id" TEXT;
-- P1-17: generic idempotency keys
CREATE TABLE "idempotency_keys" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "target_id" TEXT,
  "response" JSONB,
  "status_code" INTEGER,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "idempotency_keys_tenant_key_scope_key" UNIQUE ("tenant_id", "key", "scope")
);
CREATE INDEX "idempotency_keys_expires_idx" ON "idempotency_keys"("expires_at");
-- P1-18: AI prompts DB + versioning
CREATE TABLE "ai_prompts" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "model" TEXT,
  "temperature" DOUBLE PRECISION,
  "content" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_prompts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_prompts_key_version_key" UNIQUE ("key", "version")
);
CREATE INDEX "ai_prompts_key_active_idx" ON "ai_prompts"("key", "is_active");
-- P1-21: dead-letter jobs
CREATE TABLE "dead_letter_jobs" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "job_name" TEXT NOT NULL,
  "payload" JSONB,
  "error" TEXT,
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMPTZ(3),
  CONSTRAINT "dead_letter_jobs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "dead_letter_jobs_tenant_idx" ON "dead_letter_jobs"("tenant_id");
CREATE INDEX "dead_letter_jobs_status_idx" ON "dead_letter_jobs"("status");
-- P1-22: alert notification channels
ALTER TABLE "alert_rules" ADD COLUMN "channels" TEXT[] NOT NULL DEFAULT ARRAY['in_app'];
ALTER TABLE "alert_rules" ADD COLUMN "webhook_url" TEXT;
-- §5: admin grants (B1-B6) — applications + grants + audit
CREATE TABLE "admin_grant_applications" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "applicant_id" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "whitelist" JSONB NOT NULL DEFAULT '[]',
  "requested_days" INTEGER NOT NULL DEFAULT 30,
  "evidence" JSONB NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "decision_note" TEXT,
  "decided_by" TEXT,
  "decided_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_grant_applications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "admin_grant_applications_tenant_idx" ON "admin_grant_applications"("tenant_id");
CREATE TABLE "admin_grants" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "application_id" TEXT,
  "applicant_id" TEXT NOT NULL,
  "approver_id" TEXT NOT NULL,
  "whitelist" JSONB NOT NULL DEFAULT '[]',
  "usage_limit" JSONB NOT NULL DEFAULT '{}',
  "usage_count" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "starts_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ends_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_reason" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_grants_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "admin_grants_tenant_idx" ON "admin_grants"("tenant_id");
CREATE INDEX "admin_grants_status_idx" ON "admin_grants"("status");
CREATE TABLE "admin_grant_audits" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "grant_id" TEXT,
  "actor_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "detail" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_grant_audits_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "admin_grant_audits_tenant_idx" ON "admin_grant_audits"("tenant_id");
CREATE INDEX "admin_grant_audits_grant_idx" ON "admin_grant_audits"("grant_id");
-- P1-12: experiment graduation action (none | pause_loser; pause goes via Script + manual confirmation)
ALTER TABLE "experiments" ADD COLUMN "graduation_action" TEXT NOT NULL DEFAULT 'none';
