/**
 * Phase 9.4 — Restore target safety (never restore onto production).
 */
import { BackupError } from "./types.js";

export interface ParsedDbTarget {
  host: string;
  port: string;
  database: string;
  /** Redacted URL safe for errors (no password). */
  redacted: string;
}

/**
 * Parse DATABASE_URL without throwing password into logs.
 */
export function parseDatabaseUrl(url: string): ParsedDbTarget {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BackupError("INVALID_DATABASE_URL", "DATABASE_URL is not a valid URL");
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")).split("?")[0] ?? "";
  if (!database) {
    throw new BackupError("INVALID_DATABASE_URL", "DATABASE_URL is missing database name");
  }
  const host = parsed.hostname || "localhost";
  const port = parsed.port || "5432";
  return {
    host,
    port,
    database,
    redacted: `postgresql://${host}:${port}/${database}`,
  };
}

/**
 * Fail closed if restore target equals source (production) database.
 */
export function assertSafeRestoreTarget(
  sourceUrl: string,
  restoreUrl: string,
  env: NodeJS.ProcessEnv = process.env
): void {
  if ((env.ADLINKLAB_BACKUP_ALLOW_RESTORE ?? "").trim() !== "1") {
    throw new BackupError(
      "RESTORE_NOT_ALLOWED",
      "Set ADLINKLAB_BACKUP_ALLOW_RESTORE=1 to run isolated restore verification"
    );
  }

  const source = parseDatabaseUrl(sourceUrl);
  const target = parseDatabaseUrl(restoreUrl);

  if (
    source.host === target.host &&
    source.port === target.port &&
    source.database === target.database
  ) {
    throw new BackupError(
      "RESTORE_TARGET_IS_PRODUCTION",
      "Restore target matches source DATABASE_URL — refusing destructive restore"
    );
  }

  const blocked = (env.ADLINKLAB_BACKUP_PRODUCTION_DATABASE ?? "")
    .trim()
    .toLowerCase();
  if (blocked && target.database.toLowerCase() === blocked) {
    throw new BackupError(
      "RESTORE_TARGET_BLOCKED",
      "Restore target database is listed as production — refusing restore"
    );
  }
}

/**
 * Connection URL safe for pg_dump / pg_restore / libpq.
 * Strips Prisma-only query params (e.g. `schema=public`) that pg tools reject.
 */
export function toPgConnectionUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BackupError("INVALID_DATABASE_URL", "DATABASE_URL is not a valid URL");
  }
  parsed.searchParams.delete("schema");
  const qs = parsed.searchParams.toString();
  parsed.search = qs ? `?${qs}` : "";
  return parsed.toString();
}

/** Strip credentials from any accidental string (for log safety). */
export function redactConnectionString(text: string): string {
  return text.replace(
    /postgresql:\/\/[^/\s]+@/gi,
    "postgresql://***:***@"
  );
}
