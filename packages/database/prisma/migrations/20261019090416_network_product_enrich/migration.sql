-- Add landingPageType, countryCode, status to network_products (additive only).
ALTER TABLE "network_products" ADD COLUMN "landing_page_type" TEXT;
ALTER TABLE "network_products" ADD COLUMN "country_code" TEXT;
ALTER TABLE "network_products" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
CREATE INDEX "network_products_tenant_status_idx" ON "network_products"("tenant_id", "status");
