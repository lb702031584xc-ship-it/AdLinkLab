-- Phase 4: Tracking & Click Attribution
-- Adds TrackingLink adGroup/criterion FKs and Click attribution / idempotency fields.

ALTER TABLE "tracking_links" ADD COLUMN IF NOT EXISTS "ad_group_id" UUID;
ALTER TABLE "tracking_links" ADD COLUMN IF NOT EXISTS "criterion_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tracking_links_ad_group_id_fkey'
  ) THEN
    ALTER TABLE "tracking_links"
      ADD CONSTRAINT "tracking_links_ad_group_id_fkey"
      FOREIGN KEY ("ad_group_id") REFERENCES "ad_groups"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tracking_links_criterion_id_fkey'
  ) THEN
    ALTER TABLE "tracking_links"
      ADD CONSTRAINT "tracking_links_criterion_id_fkey"
      FOREIGN KEY ("criterion_id") REFERENCES "ad_group_criteria"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "tracking_links_ad_group_id_idx" ON "tracking_links"("ad_group_id");
CREATE INDEX IF NOT EXISTS "tracking_links_criterion_id_idx" ON "tracking_links"("criterion_id");

ALTER TABLE "clicks" ADD COLUMN IF NOT EXISTS "click_id" UUID;
ALTER TABLE "clicks" ADD COLUMN IF NOT EXISTS "offer_id" UUID;
ALTER TABLE "clicks" ADD COLUMN IF NOT EXISTS "landing_page_id" UUID;
ALTER TABLE "clicks" ADD COLUMN IF NOT EXISTS "campaign_id" UUID;
ALTER TABLE "clicks" ADD COLUMN IF NOT EXISTS "ad_group_id" UUID;
ALTER TABLE "clicks" ADD COLUMN IF NOT EXISTS "ad_id" UUID;
ALTER TABLE "clicks" ADD COLUMN IF NOT EXISTS "criterion_id" UUID;
ALTER TABLE "clicks" ADD COLUMN IF NOT EXISTS "query_parameters" JSONB;
ALTER TABLE "clicks" ADD COLUMN IF NOT EXISTS "ingestion_id" TEXT;
ALTER TABLE "clicks" ADD COLUMN IF NOT EXISTS "occurred_at" TIMESTAMPTZ(3);

UPDATE "clicks"
SET "click_id" = "id"
WHERE "click_id" IS NULL;

UPDATE "clicks"
SET "occurred_at" = "created_at"
WHERE "occurred_at" IS NULL;

ALTER TABLE "clicks" ALTER COLUMN "click_id" SET NOT NULL;
ALTER TABLE "clicks" ALTER COLUMN "occurred_at" SET NOT NULL;
ALTER TABLE "clicks" ALTER COLUMN "occurred_at" SET DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "clicks_click_id_key" ON "clicks"("click_id");
CREATE UNIQUE INDEX IF NOT EXISTS "clicks_tenant_id_ingestion_id_key"
  ON "clicks"("tenant_id", "ingestion_id");

CREATE INDEX IF NOT EXISTS "clicks_offer_id_idx" ON "clicks"("offer_id");
CREATE INDEX IF NOT EXISTS "clicks_campaign_id_idx" ON "clicks"("campaign_id");
CREATE INDEX IF NOT EXISTS "clicks_occurred_at_idx" ON "clicks"("occurred_at");
