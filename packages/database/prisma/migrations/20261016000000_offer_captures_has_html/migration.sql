-- 抓取记录列表不再拉整页 HTML：加 has_html 布尔列，列表只查它；
-- 旧数据按现有 page_html 回填（落地页“有 HTML”徽章用）。
ALTER TABLE "offer_captures" ADD COLUMN "has_html" BOOLEAN NOT NULL DEFAULT false;
UPDATE "offer_captures" SET "has_html" = ("page_html" IS NOT NULL AND "page_html" <> '');
