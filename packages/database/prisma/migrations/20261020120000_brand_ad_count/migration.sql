-- Add brand ad-count fields to network_products (additive only).
-- 广告投放数量：按品牌+国家查 Google SERP 付费广告数；ad_count_checked_at 做 14 天缓存。
ALTER TABLE "network_products" ADD COLUMN "ad_count" INTEGER;
ALTER TABLE "network_products" ADD COLUMN "ad_count_self" INTEGER;
ALTER TABLE "network_products" ADD COLUMN "ad_count_others" INTEGER;
ALTER TABLE "network_products" ADD COLUMN "ad_count_checked_at" TIMESTAMPTZ(3);
