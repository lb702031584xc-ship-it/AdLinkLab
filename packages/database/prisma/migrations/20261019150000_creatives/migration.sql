-- 创意管理库：租户自有 RSA 文案资产（标题+描述），可手动建、AI 生成后入库、从投放档案导入。
CREATE TYPE "CreativeStatus" AS ENUM ('DRAFT', 'USED', 'ARCHIVED');
CREATE TYPE "CreativeSource" AS ENUM ('MANUAL', 'AI', 'ARCHIVE');
CREATE TABLE "creatives" (
  "id" UUID NOT NULL PRIMARY KEY,
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "offer_id" UUID REFERENCES "offers"("id") ON DELETE SET NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "final_url" TEXT,
  "angle" TEXT,
  "status" "CreativeStatus" NOT NULL DEFAULT 'DRAFT',
  "source" "CreativeSource" NOT NULL DEFAULT 'MANUAL',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(3)
);
CREATE INDEX "creatives_tenant_idx" ON "creatives"("tenant_id");
CREATE INDEX "creatives_tenant_status_idx" ON "creatives"("tenant_id", "status");
CREATE INDEX "creatives_offer_idx" ON "creatives"("offer_id");
