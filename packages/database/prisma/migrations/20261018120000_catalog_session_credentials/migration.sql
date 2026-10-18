-- Catalog session credentials (2026-10-18). All additive; no existing rows affected.
--
-- Per-network login credentials for session-mode sync:
-- - session_username: plaintext username (displayable)
-- - session_password_ref: AES-256-GCM encrypted password (network-crypto; never plaintext)
-- - session_valid_days: configurable session validity in days (null -> default 30)
-- - last_login_at: when credentials/session were last saved (fresh login marker)
-- sessionExpiresAt is computed (last_login_at + session_valid_days), not stored.
ALTER TABLE "affiliate_networks" ADD COLUMN "session_username" TEXT;
ALTER TABLE "affiliate_networks" ADD COLUMN "session_password_ref" TEXT;
ALTER TABLE "affiliate_networks" ADD COLUMN "session_valid_days" INTEGER;
ALTER TABLE "affiliate_networks" ADD COLUMN "last_login_at" TIMESTAMPTZ(3);
