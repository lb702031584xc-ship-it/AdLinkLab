-- 补强清单基座字段（纯增量，只加列，不改不删）：
-- #1 Merchant.settlementRatePct（商家级历史结算率，%）
-- #3 NetworkProduct.poolStage（备选池阶段，存量默认 inbox）
-- #4 NetworkProduct.approvalRatePct / payoutCycleDays、Offer.payoutCycleDays / skuCommissionNote
-- #9 Offer.conversionFlow（转化流类型）
-- 本迁移不含任何外键列，无 UUID/TEXT 对齐风险。

ALTER TABLE "merchants" ADD COLUMN "settlement_rate_pct" DECIMAL(5,2);

ALTER TABLE "network_products" ADD COLUMN "pool_stage" TEXT NOT NULL DEFAULT 'inbox';
ALTER TABLE "network_products" ADD COLUMN "approval_rate_pct" DECIMAL(5,2);
ALTER TABLE "network_products" ADD COLUMN "payout_cycle_days" INTEGER;

ALTER TABLE "offers" ADD COLUMN "payout_cycle_days" INTEGER;
ALTER TABLE "offers" ADD COLUMN "sku_commission_note" TEXT;
ALTER TABLE "offers" ADD COLUMN "conversion_flow" TEXT;
