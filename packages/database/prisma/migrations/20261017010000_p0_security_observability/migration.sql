-- P0 (ANALYSIS.md §13): DB API keys, IP bans, token revocations, AI usage daily, error reports,
-- AiAnalysis cost fields, BudgetRule spend cap, KillSwitch Google-Ads flag + audit.
CREATE TABLE "api_keys" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "key_prefix" TEXT NOT NULL,
  "key_hash" TEXT NOT NULL,
  "scopes" TEXT[] NOT NULL DEFAULT '{}',
  "ip_whitelist" TEXT[] NOT NULL DEFAULT '{}',
  "expires_at" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  "grace_expires_at" TIMESTAMPTZ(3),
  "last_used_at" TIMESTAMPTZ(3),
  "rotated_from_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "api_keys_key_hash_key" UNIQUE ("key_hash"),
  CONSTRAINT "api_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "api_keys_rotated_from_id_fkey" FOREIGN KEY ("rotated_from_id") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "api_keys_tenant_id_idx" ON "api_keys"("tenant_id");

CREATE TABLE "ip_bans" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ip" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "level" TEXT NOT NULL DEFAULT 'auto',
  "expires_at" TIMESTAMPTZ(3),
  "request_count" INTEGER NOT NULL DEFAULT 0,
  "revoked_at" TIMESTAMPTZ(3),
  "created_by" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ip_bans_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ip_bans_ip_idx" ON "ip_bans"("ip");
CREATE INDEX "ip_bans_expires_at_idx" ON "ip_bans"("expires_at");

CREATE TABLE "token_revocations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "jti" TEXT,
  "token_hash" TEXT,
  "type" TEXT NOT NULL,
  "reason" TEXT,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "token_revocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "token_revocations_jti_key" UNIQUE ("jti"),
  CONSTRAINT "token_revocations_token_hash_key" UNIQUE ("token_hash")
);
CREATE INDEX "token_revocations_expires_at_idx" ON "token_revocations"("expires_at");

CREATE TABLE "ai_usage_daily" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "date" DATE NOT NULL,
  "tokens_in" INTEGER NOT NULL DEFAULT 0,
  "tokens_out" INTEGER NOT NULL DEFAULT 0,
  "cost_cents" INTEGER NOT NULL DEFAULT 0,
  "calls" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_usage_daily_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_usage_daily_tenant_id_date_key" UNIQUE ("tenant_id", "date"),
  CONSTRAINT "ai_usage_daily_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ai_usage_daily_tenant_id_date_idx" ON "ai_usage_daily"("tenant_id", "date");

CREATE TABLE "error_reports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID,
  "level" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "request_id" TEXT,
  "path" TEXT,
  "method" TEXT,
  "status_code" INTEGER,
  "count" INTEGER NOT NULL DEFAULT 1,
  "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "error_reports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "error_reports_last_seen_at_idx" ON "error_reports"("last_seen_at");
CREATE INDEX "error_reports_tenant_id_last_seen_at_idx" ON "error_reports"("tenant_id", "last_seen_at");

ALTER TABLE "ai_analyses" ADD COLUMN "model" TEXT;
ALTER TABLE "ai_analyses" ADD COLUMN "prompt_version" TEXT;
ALTER TABLE "ai_analyses" ADD COLUMN "tokens_in" INTEGER;
ALTER TABLE "ai_analyses" ADD COLUMN "tokens_out" INTEGER;
ALTER TABLE "ai_analyses" ADD COLUMN "cost_cents" INTEGER;
ALTER TABLE "ai_analyses" ADD COLUMN "latency_ms" INTEGER;
ALTER TABLE "ai_analyses" ADD COLUMN "status" TEXT DEFAULT 'success';

ALTER TABLE "budget_rules" ADD COLUMN "max_spend_cap" DOUBLE PRECISION;
ALTER TABLE "budget_rules" ADD COLUMN "auto_pause_on_breach" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "kill_switch_configs" ADD COLUMN "pause_google_ads_too" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "kill_switch_events" ADD COLUMN "google_ads_paused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "kill_switch_events" ADD COLUMN "google_ads_task_id" TEXT;
