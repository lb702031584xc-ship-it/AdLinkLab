-- YeahPromos official API products-path override (2026-10-20). Additive; no existing rows affected.
--
-- api_products_path: per-network override for the official API product-list
-- endpoint path (YeahPromos "Get Products", Amazon Api section of the YP docs).
-- NULL -> the adapter's verified default path (/index/apioffer/products).
ALTER TABLE "affiliate_networks" ADD COLUMN "api_products_path" TEXT;
