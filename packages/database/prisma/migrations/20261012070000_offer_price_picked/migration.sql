-- Add product average price and picked date to offers
ALTER TABLE "offers" ADD COLUMN "avg_price" DECIMAL(19,4);
ALTER TABLE "offers" ADD COLUMN "picked_at" TIMESTAMPTZ(3);
