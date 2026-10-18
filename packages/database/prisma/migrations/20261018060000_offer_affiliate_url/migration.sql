-- Offer 双链接：新增 affiliate_url（联盟后台给的带参跟踪链接，可空）。
-- Additive；无 FK；不影响现有行。
ALTER TABLE "offers" ADD COLUMN "affiliate_url" TEXT;
