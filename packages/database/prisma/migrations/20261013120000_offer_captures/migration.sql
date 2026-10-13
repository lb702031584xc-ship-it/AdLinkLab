-- 浏览器插件抓取的 offer 页面（用户真实浏览器抓取，绕开服务器反爬）
CREATE TABLE "offer_captures" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "url" TEXT NOT NULL,
  "title" TEXT,
  "description" TEXT,
  "price" NUMERIC,
  "currency" TEXT,
  "page_text" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'extension',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "offer_captures_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "offer_captures_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "offer_captures_tenant_created_idx" ON "offer_captures"("tenant_id", "created_at" DESC);
