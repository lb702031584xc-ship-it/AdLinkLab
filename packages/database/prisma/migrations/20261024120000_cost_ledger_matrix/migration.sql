-- 成本账 + 账号矩阵（2026-10-24，7 条清单，additive only）。
-- 全部 FK 与 schema 的 @db.Uuid 一致（tenant_id / offer_id / rule_id 均为 uuid）；
-- 无 polymorphic 字符串引用；不改任何现有表。
-- 账号槽位（清单 #4）：起手 10 槽位模板；1 号 1 offer；死号补位。
CREATE TABLE "account_slots" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "slot_index" INTEGER NOT NULL,
  "account_label" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "offer_id" UUID,
  "status" TEXT NOT NULL DEFAULT 'EMPTY',
  "balance_usd" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "pending_usd" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "invested_usd" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "earned_usd" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_slots_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "account_slots_tenant_id_idx" ON "account_slots"("tenant_id");
CREATE INDEX "account_slots_tenant_id_status_idx" ON "account_slots"("tenant_id", "status");
ALTER TABLE "account_slots" ADD CONSTRAINT "account_slots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_slots" ADD CONSTRAINT "account_slots_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 封号 / 拒付复盘（清单 #5）。
CREATE TABLE "ban_events" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "network" TEXT NOT NULL,
  "offer_id" UUID,
  "operation_type" TEXT NOT NULL,
  "lost_balance_usd" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "lost_pending_usd" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "recovered" BOOLEAN NOT NULL DEFAULT false,
  "recovered_usd" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "note" TEXT,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ban_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ban_events_tenant_id_idx" ON "ban_events"("tenant_id");
CREATE INDEX "ban_events_tenant_id_network_operation_type_idx" ON "ban_events"("tenant_id", "network", "operation_type");
ALTER TABLE "ban_events" ADD CONSTRAINT "ban_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ban_events" ADD CONSTRAINT "ban_events_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 品牌词分级管理（清单 #3）。
CREATE TABLE "brand_keywords" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "keyword" TEXT NOT NULL,
  "brand" TEXT,
  "offer_id" UUID,
  "bidding_enabled" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "warning_count" INTEGER NOT NULL DEFAULT 0,
  "last_warning_kind" TEXT,
  "last_warning_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "brand_keywords_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "brand_keywords_tenant_id_idx" ON "brand_keywords"("tenant_id");
CREATE INDEX "brand_keywords_tenant_id_status_idx" ON "brand_keywords"("tenant_id", "status");
ALTER TABLE "brand_keywords" ADD CONSTRAINT "brand_keywords_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "brand_keywords" ADD CONSTRAINT "brand_keywords_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 砍线规则（清单 #6）。
CREATE TABLE "kill_rules" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "offer_id" UUID,
  "name" TEXT NOT NULL,
  "clicks_threshold" INTEGER NOT NULL,
  "require_zero_conv" BOOLEAN NOT NULL DEFAULT true,
  "action" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "kill_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "kill_rules_tenant_id_idx" ON "kill_rules"("tenant_id");
ALTER TABLE "kill_rules" ADD CONSTRAINT "kill_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kill_rules" ADD CONSTRAINT "kill_rules_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 砍线执行审计（清单 #6，append-only）。
CREATE TABLE "kill_rule_events" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "rule_id" UUID NOT NULL,
  "offer_id" UUID,
  "clicks" INTEGER NOT NULL,
  "conversions" INTEGER NOT NULL,
  "action_taken" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "kill_rule_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "kill_rule_events_tenant_id_idx" ON "kill_rule_events"("tenant_id");
CREATE INDEX "kill_rule_events_rule_id_idx" ON "kill_rule_events"("rule_id");
ALTER TABLE "kill_rule_events" ADD CONSTRAINT "kill_rule_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kill_rule_events" ADD CONSTRAINT "kill_rule_events_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "kill_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kill_rule_events" ADD CONSTRAINT "kill_rule_events_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 封号概率参数（清单 #1）。
CREATE TABLE "risk_params" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "network" TEXT NOT NULL,
  "operation_type" TEXT NOT NULL,
  "ban_probability" DOUBLE PRECISION NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "risk_params_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "risk_params_tenant_id_network_operation_type_key" UNIQUE ("tenant_id", "network", "operation_type")
);
CREATE INDEX "risk_params_tenant_id_idx" ON "risk_params"("tenant_id");
ALTER TABLE "risk_params" ADD CONSTRAINT "risk_params_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
