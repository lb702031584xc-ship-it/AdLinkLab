-- Phase 5: Offer Engine — priority / schedule / idempotency + TrackingLinkOffer bindings

ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "starts_at" TIMESTAMPTZ(3);
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "ends_at" TIMESTAMPTZ(3);
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "idempotency_scope" TEXT;
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "offers_tenant_id_idempotency_scope_idempotency_key_key"
  ON "offers" ("tenant_id", "idempotency_scope", "idempotency_key");

CREATE INDEX IF NOT EXISTS "offers_priority_idx" ON "offers"("priority");

CREATE TABLE IF NOT EXISTS "tracking_link_offers" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "tracking_link_id" UUID NOT NULL,
  "offer_id" UUID NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "is_fallback" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "tracking_link_offers_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tracking_link_offers_tracking_link_id_fkey'
  ) THEN
    ALTER TABLE "tracking_link_offers"
      ADD CONSTRAINT "tracking_link_offers_tracking_link_id_fkey"
      FOREIGN KEY ("tracking_link_id") REFERENCES "tracking_links"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tracking_link_offers_offer_id_fkey'
  ) THEN
    ALTER TABLE "tracking_link_offers"
      ADD CONSTRAINT "tracking_link_offers_offer_id_fkey"
      FOREIGN KEY ("offer_id") REFERENCES "offers"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "tracking_link_offers_tenant_link_offer_key"
  ON "tracking_link_offers" ("tenant_id", "tracking_link_id", "offer_id");

-- At most one fallback binding per tracking link
CREATE UNIQUE INDEX IF NOT EXISTS "tracking_link_offers_one_fallback_per_link"
  ON "tracking_link_offers" ("tenant_id", "tracking_link_id")
  WHERE "is_fallback" = true;

CREATE INDEX IF NOT EXISTS "tracking_link_offers_tenant_id_idx" ON "tracking_link_offers"("tenant_id");
CREATE INDEX IF NOT EXISTS "tracking_link_offers_tracking_link_id_idx" ON "tracking_link_offers"("tracking_link_id");
CREATE INDEX IF NOT EXISTS "tracking_link_offers_offer_id_idx" ON "tracking_link_offers"("offer_id");
