-- 透明中心旁证印记（additive only）：
-- tc_advertisers_count：DataForSEO Ads Advertisers（Google 广告透明中心
-- 数据源）按品牌词+国家查到的广告主总数，组级口径随广告数字段同通道
-- 回写组内每个商品。背景（2026-10-21 实证）：SERP 快照对 "olight" 反复
-- 抓 0，但透明中心返回 11 家广告主——SERP 快照只能证"有"不能证"无"，
-- 初筛「裸词+长尾双 0 → 无人投放判停」会冤杀，故仅当 SERP 双 0 时补查
-- 本字段做旁证：≥1 翻案通过，=0 才与 SERP 合并判停，null 不判停。
-- null = 从未查过；0 = 查过且透明中心无广告主。
-- tc_top_advertisers：头部广告主 [{name, approxAds}] 最多 3 条，仅展示。
-- tc_checked_at：TC 专用新鲜度（14 天），与 ad_count_checked_at 分开——
-- TC 可在 SERP 侧新鲜时单独补查，不必重跑 SERP。

ALTER TABLE "network_products" ADD COLUMN "tc_advertisers_count" INTEGER;
ALTER TABLE "network_products" ADD COLUMN "tc_top_advertisers" JSONB;
ALTER TABLE "network_products" ADD COLUMN "tc_checked_at" TIMESTAMPTZ(3);
