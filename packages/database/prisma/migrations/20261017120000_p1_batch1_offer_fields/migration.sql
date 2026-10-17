-- P1 batch 1: Offer 品牌提取置信度 (P1-2) + 节日主题 (P1-15)。全部可空新增列，存量行不受影响。
ALTER TABLE "offers" ADD COLUMN "brand_name" TEXT;
ALTER TABLE "offers" ADD COLUMN "brand_name_source" TEXT;
ALTER TABLE "offers" ADD COLUMN "brand_name_confidence" DOUBLE PRECISION;
ALTER TABLE "offers" ADD COLUMN "festival_theme" TEXT;
