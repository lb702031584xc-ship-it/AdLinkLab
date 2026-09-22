-- Phase 1.2-R1: UrlVersion ACTIVE partial unique index (verification + idempotent ensure)
--
-- Confirmed column names from schema.prisma / Phase 1.1 foundation:
--   tenant_id, entity_type, entity_id, status, version
--
-- Does NOT delete or rewrite historical UrlVersion rows.
-- If duplicate ACTIVE groups exist, migration FAILS with an explicit report.

DO $$
DECLARE
  conflict_count integer;
  conflict_report text;
BEGIN
  SELECT COUNT(*)::integer INTO conflict_count
  FROM (
    SELECT "tenant_id", "entity_type", "entity_id"
    FROM "url_versions"
    WHERE "status" = 'ACTIVE'
    GROUP BY "tenant_id", "entity_type", "entity_id"
    HAVING COUNT(*) > 1
  ) AS duplicates;

  IF conflict_count > 0 THEN
    SELECT string_agg(
      format(
        'tenant=%s entityType=%s entityId=%s activeCount=%s',
        d."tenant_id",
        d."entity_type",
        d."entity_id",
        d.cnt
      ),
      '; '
    )
    INTO conflict_report
    FROM (
      SELECT
        "tenant_id",
        "entity_type",
        "entity_id",
        COUNT(*)::text AS cnt
      FROM "url_versions"
      WHERE "status" = 'ACTIVE'
      GROUP BY "tenant_id", "entity_type", "entity_id"
      HAVING COUNT(*) > 1
    ) AS d;

    RAISE EXCEPTION
      'PHASE 1.2-R1 BLOCKED: % duplicate ACTIVE UrlVersion group(s) detected. Do not auto-delete. Conflicts: %',
      conflict_count,
      COALESCE(conflict_report, '(unknown)');
  END IF;
END $$;

-- Idempotent: Phase 1.2 migration may already have created this index.
CREATE UNIQUE INDEX IF NOT EXISTS "url_versions_one_active_per_entity"
  ON "url_versions" ("tenant_id", "entity_type", "entity_id")
  WHERE "status" = 'ACTIVE';

-- Tenant-scope version uniqueness (replaces global entity_type+entity_id+version)
DROP INDEX IF EXISTS "url_versions_entity_type_entity_id_version_key";

CREATE UNIQUE INDEX IF NOT EXISTS "url_versions_tenant_id_entity_type_entity_id_version_key"
  ON "url_versions" ("tenant_id", "entity_type", "entity_id", "version");
