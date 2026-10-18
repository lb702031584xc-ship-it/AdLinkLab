-- Catalog product library (2026-10-18). All additive; no existing rows affected.
--
-- AffiliateNetwork: dual sync mode (official API / logged-in session) + session state.
-- New tables: network_products (synced catalog rows), catalog_screening_presets
-- (per-tenant screening thresholds; auto-create flags admin-only at route level).
ALTER TABLE "affiliate_networks" ADD COLUMN "sync_mode" TEXT NOT NULL DEFAULT 'api';
ALTER TABLE "affiliate_networks" ADD COLUMN "session_ref" TEXT;
ALTER TABLE "affiliate_networks" ADD COLUMN "session_status" TEXT NOT NULL DEFAULT 'NEVER';
ALTER TABLE "affiliate_networks" ADD COLUMN "session_updated_at" TIMESTAMPTZ(3);
ALTER TABLE "affiliate_networks" ADD COLUMN "session_error" TEXT;

CREATE TABLE "network_products" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "network_id" TEXT NOT NULL,
  "external_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "brand" TEXT,
  "asin" TEXT,
  "price" DECIMAL(19,4),
  "commission_amount" DECIMAL(19,4),
  "commission_rate" DECIMAL(9,4),
  "currency" TEXT DEFAULT 'USD',
  "review_count" INTEGER,
  "recommended" BOOLEAN NOT NULL DEFAULT false,
  "recommendation_score" DECIMAL(9,2),
  "promo_url" TEXT,
  "raw_data" JSONB NOT NULL,
  "synced_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "network_products_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "network_products_tenant_network_external_uniq" ON "network_products"("tenant_id", "network_id", "external_id");
CREATE INDEX "network_products_tenant_network_idx" ON "network_products"("tenant_id", "network_id");
CREATE INDEX "network_products_tenant_recommended_idx" ON "network_products"("tenant_id", "recommended");
ALTER TABLE "network_products" ADD CONSTRAINT "network_products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "network_products" ADD CONSTRAINT "network_products_network_id_fkey" FOREIGN KEY ("network_id") REFERENCES "affiliate_networks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "catalog_screening_presets" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "min_reviews" INTEGER,
  "min_commission_amount" DECIMAL(19,4),
  "min_commission_rate" DECIMAL(9,4),
  "min_price" DECIMAL(19,4),
  "max_price" DECIMAL(19,4),
  "min_score" INTEGER,
  "auto_create_offer" BOOLEAN NOT NULL DEFAULT false,
  "auto_create_top_n" INTEGER NOT NULL DEFAULT 20,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "catalog_screening_presets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "catalog_screening_presets_tenant_id_key" ON "catalog_screening_presets"("tenant_id");
ALTER TABLE "catalog_screening_presets" ADD CONSTRAINT "catalog_screening_presets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
