-- Catalog blacklist/whitelist (2026-10-18). All additive; no existing rows affected.
--
-- AffiliateNetwork: session_expire_strikes (3 consecutive SESSION_EXPIRED -> auto blacklist).
-- NetworkProduct: sync_streak (consecutive sync appearances; 3 -> whitelist suggestion).
-- New tables: catalog_blacklist, catalog_whitelist (business lists, separate from B6 grant whitelists).
ALTER TABLE "affiliate_networks" ADD COLUMN "session_expire_strikes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "network_products" ADD COLUMN "sync_streak" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "catalog_blacklist" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "network_kind" TEXT,
  "reason" TEXT NOT NULL,
  "first_seen_at" TIMESTAMPTZ(3) NOT NULL,
  "last_confirmed_at" TIMESTAMPTZ(3) NOT NULL,
  "source" TEXT NOT NULL,
  "created_by" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "catalog_blacklist_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "catalog_blacklist_tenant_entity_uniq" ON "catalog_blacklist"("tenant_id", "entity_type", "entity_id");
CREATE INDEX "catalog_blacklist_tenant_entity_idx" ON "catalog_blacklist"("tenant_id", "entity_type");
ALTER TABLE "catalog_blacklist" ADD CONSTRAINT "catalog_blacklist_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "catalog_whitelist" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "note" TEXT,
  "source" TEXT NOT NULL,
  "suggested_at" TIMESTAMPTZ(3),
  "confirmed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "catalog_whitelist_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "catalog_whitelist_tenant_entity_uniq" ON "catalog_whitelist"("tenant_id", "entity_type", "entity_id");
ALTER TABLE "catalog_whitelist" ADD CONSTRAINT "catalog_whitelist_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
