-- 品牌广告历史 + 广告落地类型 + 品牌落地页链接（additive only）：
-- 1) network_products 补 last_ad_count / last_ad_count_checked_at：重算广告数时
--    把上一次的 ad_count / ad_count_checked_at 挪作快照，供派生趋势
--    （first / new 新投 / stopped 疑似停投 / active 持续 / none）；
--    再补 ad_count_home / ad_count_product：付费广告按落地页 URL 分类
--    （落首页/旗舰店 vs 落商品页，other 不计入），看同行用哪种打法；
-- 2) brand_profiles：租户 × 网络 × 品牌（brand_key = 归一化品牌名）× 国家
--    （country_code 空串 = 未指定）的品牌档案：landing_url 品牌级落地页链接
--    （空串 = 未填）+ promo_mode 投放方式三态（brand / product / NULL 未标注；
--    无行同样视为未标注——「单品投放」必须显式标注，不由链接未填推断）。
-- id / tenant_id / network_id 均为 UUID，与 schema.prisma 的 @db.Uuid 对齐。

ALTER TABLE "network_products" ADD COLUMN "last_ad_count" INTEGER;
ALTER TABLE "network_products" ADD COLUMN "last_ad_count_checked_at" TIMESTAMPTZ(3);
ALTER TABLE "network_products" ADD COLUMN "ad_count_home" INTEGER;
ALTER TABLE "network_products" ADD COLUMN "ad_count_product" INTEGER;

CREATE TABLE "brand_profiles" (
  "id" UUID NOT NULL PRIMARY KEY,
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "network_id" UUID NOT NULL,
  "brand_key" TEXT NOT NULL,
  "country_code" TEXT NOT NULL DEFAULT '',
  "landing_url" TEXT NOT NULL,
  "promo_mode" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "brand_profiles_tenant_network_brand_country_unique" UNIQUE ("tenant_id", "network_id", "brand_key", "country_code")
);
