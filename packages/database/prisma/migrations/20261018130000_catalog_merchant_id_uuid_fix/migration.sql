-- Fix schema drift (2026-10-18): network_products.merchant_id was added as TEXT
-- in 20261018110000_catalog_merchant_lists, but schema.prisma declares it
-- String? @db.Uuid. The column carries no FK and the catalog sync has never
-- been deployed, so no production data exists; a direct type cast is safe.
ALTER TABLE "network_products" ALTER COLUMN "merchant_id" TYPE UUID USING "merchant_id"::uuid;
