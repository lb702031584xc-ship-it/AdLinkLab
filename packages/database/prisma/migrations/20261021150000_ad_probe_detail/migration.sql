-- 探针明细入库（additive only）：
-- ad_probe_detail：广告数计算时每组实际跑的全部探针（裸品牌词 + 每条
-- 长尾探针）逐条明细，JSON 数组 [{q, kind: "bare"|"model"|"category",
-- paid, shopping, total}]，随组级广告数字段同通道回写组内每个商品。
-- 用途：前端品牌行可展开逐条验真（如某品牌裸词+长尾双 0 时，看清到底
-- 查了哪些词、各词返回几条），并区分"探针词派生错"与"真的没人投"。
-- 计算时间复用既有 ad_count_checked_at，不新造时间戳字段。
-- null = 尚未按探针明细口径计算过（旧印记；新鲜度判定与 ad_count_longtail
-- 为 null 同处理，视为待重探）。

ALTER TABLE "network_products" ADD COLUMN "ad_probe_detail" JSONB;
