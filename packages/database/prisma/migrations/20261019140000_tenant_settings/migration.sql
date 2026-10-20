-- 每租户系统设置（对标 autoads 系统设置）：AI 引擎 / 广告发布(MCC) / 代理 / 系统偏好。
-- value 存 JSON 字符串；密钥类字段（API Key、代理 URL）入库前用 AES-256-GCM 加密。
CREATE TABLE "tenant_settings" (
  "id" UUID NOT NULL PRIMARY KEY,
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_settings_tenant_key_unique" UNIQUE ("tenant_id", "key")
);
CREATE INDEX "tenant_settings_tenant_idx" ON "tenant_settings"("tenant_id");
