-- Catalog merchant channel lists (2026-10-18). All additive; no existing rows affected.
--
-- Complements 20261018100000: session_list_path column missed in the first
-- catalog migration; blacklist/whitelist gain channel + soft-delete/observation;
-- new tables catalog_merchant_policies + catalog_merchant_signals;
-- network_products gains merchant_id (brand+network match, nullable).
ALTER TABLE "affiliate_networks" ADD COLUMN "session_list_path" TEXT;

ALTER TABLE "catalog_blacklist" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'affiliate';
ALTER TABLE "catalog_blacklist" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "catalog_blacklist" ADD COLUMN "removed_at" TIMESTAMPTZ(3);
ALTER TABLE "catalog_blacklist" ADD COLUMN "removed_by" TEXT;
ALTER TABLE "catalog_blacklist" ADD COLUMN "remove_reason" TEXT;
ALTER TABLE "catalog_blacklist" ADD COLUMN "observation_until" TIMESTAMPTZ(3);
DROP INDEX "catalog_blacklist_tenant_entity_uniq";
CREATE UNIQUE INDEX "catalog_blacklist_tenant_channel_entity_uniq" ON "catalog_blacklist"("tenant_id", "channel", "entity_type", "entity_id");
CREATE INDEX "catalog_blacklist_tenant_channel_status_idx" ON "catalog_blacklist"("tenant_id", "channel", "status");

ALTER TABLE "catalog_whitelist" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'affiliate';
DROP INDEX "catalog_whitelist_tenant_entity_uniq";
CREATE UNIQUE INDEX "catalog_whitelist_tenant_channel_entity_uniq" ON "catalog_whitelist"("tenant_id", "channel", "entity_type", "entity_id");

ALTER TABLE "network_products" ADD COLUMN "merchant_id" TEXT;

CREATE TABLE "catalog_merchant_policies" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "shave_threshold_pct" DECIMAL(5,2) NOT NULL DEFAULT 30,
  "shave_period_days" INTEGER NOT NULL DEFAULT 7,
  "shave_periods" INTEGER NOT NULL DEFAULT 3,
  "roas_days" INTEGER NOT NULL DEFAULT 14,
  "roas_threshold" DECIMAL(5,2) NOT NULL DEFAULT 0.9,
  "non_payment_days" INTEGER NOT NULL DEFAULT 45,
  "observation_days" INTEGER NOT NULL DEFAULT 30,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "catalog_merchant_policies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "catalog_merchant_policies_tenant_id_key" ON "catalog_merchant_policies"("tenant_id");
ALTER TABLE "catalog_merchant_policies" ADD CONSTRAINT "catalog_merchant_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "catalog_merchant_signals" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "merchant_id" UUID NOT NULL,
  "channel" TEXT NOT NULL,
  "period_start" TIMESTAMPTZ(3) NOT NULL,
  "period_days" INTEGER NOT NULL,
  "own_conversions" INTEGER NOT NULL DEFAULT 0,
  "network_orders" INTEGER NOT NULL DEFAULT 0,
  "shave_pct" DECIMAL(7,2),
  "ad_spend" DECIMAL(19,4),
  "commission" DECIMAL(19,4),
  "roas" DECIMAL(9,4),
  "pending_orders" INTEGER NOT NULL DEFAULT 0,
  "oldest_pending_days" INTEGER,
  "note" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "catalog_merchant_signals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "catalog_merchant_signals_tenant_merchant_period_uniq" ON "catalog_merchant_signals"("tenant_id", "merchant_id", "channel", "period_start");
CREATE INDEX "catalog_merchant_signals_tenant_merchant_channel_idx" ON "catalog_merchant_signals"("tenant_id", "merchant_id", "channel");
ALTER TABLE "catalog_merchant_signals" ADD CONSTRAINT "catalog_merchant_signals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog_merchant_signals" ADD CONSTRAINT "catalog_merchant_signals_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
