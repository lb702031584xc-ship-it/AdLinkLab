-- 商品库筛选预设加松绑模式（2026-10-25，additive only）。
-- mode：TEXT，默认 'regular'；'loose' = 松绑口径（价格≥$80 或佣金>$5 准入）。
-- 本 migration 只加一列，不涉及任何 FK 列（无 uuid 列改动）。
ALTER TABLE "catalog_screening_presets" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'regular';
