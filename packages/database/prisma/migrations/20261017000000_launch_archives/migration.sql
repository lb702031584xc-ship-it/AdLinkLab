-- 投放档案（LaunchArchive）：一次投放的完整档案——决策、条款、出价、文案、投后数据。
-- 确认广告计划后自动建档（draft），投后回填 impressions/clicks/spend 等，诊断出价与展示问题。
CREATE TABLE "launch_archives" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "offer_id" UUID,
  "offer_name" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "offer_url" TEXT,
  "decision" TEXT,
  "decision_reason" TEXT,
  "terms_brand_bidding" TEXT,
  "terms_direct_linking" TEXT,
  "terms_summary" TEXT,
  "payout" DOUBLE PRECISION,
  "epc" DOUBLE PRECISION,
  "breakeven_cpc" DOUBLE PRECISION,
  "breakeven_cvr_pct" DOUBLE PRECISION,
  "recommended_bid" DOUBLE PRECISION,
  "my_bid" DOUBLE PRECISION,
  "official_bid" DOUBLE PRECISION,
  "daily_budget" DOUBLE PRECISION,
  "budget_currency" TEXT NOT NULL DEFAULT 'USD',
  "keywords" JSONB NOT NULL DEFAULT '[]',
  "ad_copy" JSONB NOT NULL DEFAULT '{}',
  "impressions" INTEGER,
  "clicks" INTEGER,
  "spend" DOUBLE PRECISION,
  "conversions" INTEGER,
  "revenue" DOUBLE PRECISION,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "notes" TEXT,
  "launched_at" TIMESTAMPTZ(3),
  "ended_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "launch_archives_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "launch_archives_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "launch_archives_tenant_created_idx" ON "launch_archives"("tenant_id", "created_at" DESC);
CREATE INDEX "launch_archives_tenant_network_idx" ON "launch_archives"("tenant_id", "network");
CREATE INDEX "launch_archives_tenant_status_idx" ON "launch_archives"("tenant_id", "status");
