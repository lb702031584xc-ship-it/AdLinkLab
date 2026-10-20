-- Offer 申请状态：offer 入库 ≠ 能推，记录向网络申请 program 的状态维度
-- （not_applied 未申请 / applied 已申请待审核 / approved 已批准 / rejected 被拒）。
-- Additive；无 FK；存量行默认 not_applied，不影响现有数据。
ALTER TABLE "offers" ADD COLUMN "application_status" TEXT NOT NULL DEFAULT 'not_applied';
ALTER TABLE "offers" ADD COLUMN "applied_at" TIMESTAMP(3);
ALTER TABLE "offers" ADD COLUMN "application_note" TEXT;
