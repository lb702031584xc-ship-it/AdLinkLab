-- Per-link health check interval + link source (manual/auto)
ALTER TABLE "tracking_links" ADD COLUMN "health_check_interval_sec" INTEGER NOT NULL DEFAULT 3600;
ALTER TABLE "tracking_links" ADD COLUMN "link_source" TEXT NOT NULL DEFAULT 'MANUAL';
