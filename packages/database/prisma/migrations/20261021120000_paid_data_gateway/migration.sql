-- 付费数据网关 + 一键筛选（additive only）：
-- 1) paid_data_usage 用量台账（租户 × 功能 × 日期 × key 来源 → 调用次数）；
-- 2) offers 一键初筛结论三列（verdict / reason / 时间，判停只标注不删除）；
-- 3) network_products 一键筛选结论三列（verdict / reason / 时间）。
-- tenant_id / id 均为 UUID，与 schema.prisma 的 @db.Uuid 对齐。

CREATE TABLE "paid_data_usage" (
  "id" UUID NOT NULL PRIMARY KEY,
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "feature" TEXT NOT NULL,
  "usage_date" DATE NOT NULL,
  "key_source" TEXT NOT NULL,
  "calls" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "paid_data_usage_tenant_feature_date_source_unique" UNIQUE ("tenant_id", "feature", "usage_date", "key_source")
);
CREATE INDEX "paid_data_usage_tenant_date_idx" ON "paid_data_usage" ("tenant_id", "usage_date");

ALTER TABLE "offers" ADD COLUMN "prescreen_verdict" TEXT;
ALTER TABLE "offers" ADD COLUMN "prescreen_reason" TEXT;
ALTER TABLE "offers" ADD COLUMN "prescreened_at" TIMESTAMPTZ(3);

ALTER TABLE "network_products" ADD COLUMN "screen_verdict" TEXT;
ALTER TABLE "network_products" ADD COLUMN "screen_reason" TEXT;
ALTER TABLE "network_products" ADD COLUMN "screened_at" TIMESTAMPTZ(3);

-- 投流数据人工回填快照（按档案 × 日期）；launch_archives 补止损脚本生成时间。
CREATE TABLE "ad_perf_snapshots" (
  "id" UUID NOT NULL PRIMARY KEY,
  "tenant_id" UUID NOT NULL,
  "archive_id" UUID NOT NULL REFERENCES "launch_archives"("id") ON DELETE CASCADE,
  "perf_date" DATE NOT NULL,
  "spend" DECIMAL(19, 4) NOT NULL,
  "avg_cpc" DECIMAL(19, 4),
  "impressions" INTEGER NOT NULL DEFAULT 0,
  "clicks" INTEGER NOT NULL DEFAULT 0,
  "conversions" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ad_perf_snapshots_archive_date_unique" UNIQUE ("archive_id", "perf_date")
);
CREATE INDEX "ad_perf_snapshots_tenant_archive_idx" ON "ad_perf_snapshots" ("tenant_id", "archive_id");

ALTER TABLE "launch_archives" ADD COLUMN "stop_loss_script_at" TIMESTAMPTZ(3);
