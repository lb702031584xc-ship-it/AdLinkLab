-- 插件抓取同时存真实 HTML（落地页结构拆解用；用户主动触发，量小）
ALTER TABLE "offer_captures" ADD COLUMN "page_html" TEXT;
