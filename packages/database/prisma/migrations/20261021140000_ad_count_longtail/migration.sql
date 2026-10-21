-- 广告数多探针口径（additive only）：
-- 1) ad_count_longtail：长尾探针（品牌+型号/品类词）SERP 广告数（文字广告
--    paid 条数＋购物广告 shopping_element 条数，同 ad_count 口径）的 MAX。
--    裸品牌词（ad_count）没人投 ≠ 品牌没人投——联盟客投的是长尾型号词；
--    null = 无可派生长尾探针或尚未按多探针口径计算（旧印记，下次计算重探）。
-- 2) ad_policy_risk：组级政策风险标记。组内 Top 商品名命中武器配件类
--    模式（weapon light / gun light / 枪灯 等）→ true：该类目付费广告
--    禁投，判停原因须用政策口径，不得读作「无人投放」。

ALTER TABLE "network_products" ADD COLUMN "ad_count_longtail" INTEGER;
ALTER TABLE "network_products" ADD COLUMN "ad_policy_risk" BOOLEAN NOT NULL DEFAULT false;
