-- Offer 来源：affiliate（联盟）| amazon（亚马逊选品）| cashback（返利网）；老数据默认 affiliate
ALTER TABLE "offers" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'affiliate';
