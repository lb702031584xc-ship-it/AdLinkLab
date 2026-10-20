-- 商品库同步后台任务表（2026-10-20）：POST /catalog/sync 改为建 job 行 + 后台执行，
-- 前端轮询 job 状态/阶段/结果。id/tenant_id/network_id/user_id 均为 UUID（与 schema @db.Uuid 对齐）。
CREATE TABLE "catalog_sync_jobs" (
  "id" UUID NOT NULL PRIMARY KEY,
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "network_id" UUID NOT NULL REFERENCES "affiliate_networks"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "scope" TEXT NOT NULL DEFAULT 'full',
  "brand_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "stage" TEXT,
  "result" JSONB,
  "error" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(3),
  "finished_at" TIMESTAMPTZ(3)
);
CREATE INDEX "catalog_sync_jobs_tenant_id_created_at_idx" ON "catalog_sync_jobs"("tenant_id", "created_at");
