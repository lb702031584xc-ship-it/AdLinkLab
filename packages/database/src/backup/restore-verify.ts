/**
 * Phase 9.4 — Isolated restore verification.
 */
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { verifyBackup } from "./verify.js";
import {
  assertSafeRestoreTarget,
  parseDatabaseUrl,
  redactConnectionString,
  toPgConnectionUrl,
} from "./safety.js";
import { resolvePgTools, type PgToolPaths } from "./validate.js";
import { pathsForBackupId, resolveBackupDir } from "./paths.js";
import { readMetadata, writeMetadata, writeLatestPointer } from "./metadata.js";
import { BackupError, type BackupMetadata } from "./types.js";

/** Core tables from Prisma @@map (public schema). */
export const CORE_TABLES = [
  "tenants",
  "users",
  "google_accounts",
  "campaigns",
  "ad_groups",
  "ads",
  "ad_group_criteria",
  "offers",
  "landing_pages",
  "tracking_links",
  "tracking_link_offers",
  "clicks",
  "conversions",
  "orders",
  "url_versions",
  "url_change_requests",
  "sync_jobs",
  "audit_logs",
  "google_ads_script_integrations",
  "script_sync_targets",
  "script_sync_logs",
] as const;

export interface RestoreVerifyOptions {
  backupId: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  sourceDatabaseUrl?: string;
  restoreDatabaseUrl?: string;
  tools?: PgToolPaths | null;
  runPgRestoreList?: (
    pgRestore: string,
    artifactPath: string
  ) => { status: number | null; stderr: string };
  /** Drop+create target database before restore (isolated only). */
  recreateTargetDatabase?: boolean;
  runPgRestore?: (
    pgRestore: string,
    artifactPath: string,
    restoreUrl: string
  ) => { status: number | null; stderr: string };
  /** Inject query client for tests. */
  queryFn?: (sql: string) => Promise<unknown[]>;
}

export interface RestoreVerifyResult {
  metadata: BackupMetadata;
  schemaOk: boolean;
  missingTables: string[];
  dataVerification: "passed" | "limited_empty" | "failed";
  migrationMetadataPresent: boolean;
  tenantCount: number;
}

function defaultRunPgRestore(
  pgRestore: string,
  artifactPath: string,
  restoreUrl: string
): { status: number | null; stderr: string } {
  const result = spawnSync(
    pgRestore,
    [
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-acl",
      `--dbname=${restoreUrl}`,
      artifactPath,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      shell: false,
      timeout: 600_000,
    }
  );
  return {
    status: result.status,
    stderr: redactConnectionString(result.stderr ?? ""),
  };
}

async function withClient<T>(
  url: string,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function restoreVerify(
  options: RestoreVerifyOptions
): Promise<RestoreVerifyResult> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const sourceUrl = (
    options.sourceDatabaseUrl ??
    env.DATABASE_URL ??
    ""
  ).trim();
  const restoreUrl = (
    options.restoreDatabaseUrl ??
    env.ADLINKLAB_BACKUP_RESTORE_DATABASE_URL ??
    ""
  ).trim();

  if (!sourceUrl) {
    throw new BackupError("MISSING_DATABASE_URL", "DATABASE_URL is required");
  }
  if (!restoreUrl) {
    throw new BackupError(
      "MISSING_RESTORE_URL",
      "ADLINKLAB_BACKUP_RESTORE_DATABASE_URL is required for restore verification"
    );
  }

  assertSafeRestoreTarget(sourceUrl, restoreUrl, env);
  const pgSourceUrl = toPgConnectionUrl(sourceUrl);
  const pgRestoreUrl = toPgConnectionUrl(restoreUrl);

  // Must be VERIFIED (checksum + format) before restore
  await verifyBackup({
    backupId: options.backupId,
    env,
    cwd,
    tools: options.tools,
    runPgRestoreList: options.runPgRestoreList,
  });

  const tools =
    options.tools === undefined ? resolvePgTools(env) : options.tools;
  if (!tools && !options.runPgRestore && !options.queryFn) {
    throw new BackupError(
      "PG_TOOLS_MISSING",
      "pg_restore not found — cannot run restore verification"
    );
  }

  const backupDir = resolveBackupDir(env, cwd);
  const paths = pathsForBackupId(backupDir, options.backupId);
  let meta = await readMetadata(paths.metadataPath);

  try {
    if (options.recreateTargetDatabase !== false && !options.queryFn) {
      await recreateDatabase(pgSourceUrl, pgRestoreUrl);
    }

    if (!options.queryFn) {
      if (!tools) {
        throw new BackupError("PG_TOOLS_MISSING", "pg_restore not found");
      }
      const run = options.runPgRestore ?? defaultRunPgRestore;
      const restored = run(tools.pgRestore, paths.artifactPath, pgRestoreUrl);
      if (restored.status !== 0) {
        throw new BackupError(
          "PG_RESTORE_FAILED",
          `pg_restore failed (exit ${restored.status ?? "null"})`
        );
      }
    }

    const query =
      options.queryFn ??
      (async (sql: string) => {
        return withClient(pgRestoreUrl, async (client) => {
          const res = await client.query(sql);
          return res.rows as unknown[];
        });
      });

    const checkTable = async (table: string): Promise<boolean> => {
      if (options.queryFn) {
        const rows = await options.queryFn(
          `SELECT 1 AS ok FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${table.replace(/'/g, "''")}' LIMIT 1`
        );
        return rows.length > 0;
      }
      return withClient(pgRestoreUrl, async (client) => {
        const res = await client.query(
          `SELECT 1 AS ok FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
          [table]
        );
        return res.rowCount !== null && res.rowCount > 0;
      });
    };

    const missingTables: string[] = [];
    for (const table of CORE_TABLES) {
      if (!(await checkTable(table))) missingTables.push(table);
    }
    const schemaOk = missingTables.length === 0;
    if (!schemaOk) {
      throw new BackupError(
        "SCHEMA_VERIFY_FAILED",
        `Missing tables after restore: ${missingTables.join(", ")}`
      );
    }

    const migrationRows = await query(
      `SELECT 1 AS ok FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_prisma_migrations' LIMIT 1`
    );
    const migrationMetadataPresent = migrationRows.length > 0;

    const tenantRows = (await query(
      `SELECT id FROM tenants ORDER BY id ASC`
    )) as Array<{ id: string }>;
    const tenantCount = tenantRows.length;

    let dataVerification: RestoreVerifyResult["dataVerification"] = "limited_empty";
    if (tenantCount > 0) {
      dataVerification = "passed";
    }

    meta = {
      ...meta,
      status: "VERIFIED",
      restoreVerifiedAt: new Date().toISOString(),
      dataVerification,
      error: undefined,
    };
    await writeMetadata(paths.metadataPath, meta);
    await writeLatestPointer(paths.latestPointerPath, meta);

    return {
      metadata: meta,
      schemaOk,
      missingTables,
      dataVerification,
      migrationMetadataPresent,
      tenantCount,
    };
  } catch (error) {
    const message =
      error instanceof BackupError
        ? error.message
        : error instanceof Error
          ? redactConnectionString(error.message)
          : "Restore verification failed";
    meta = {
      ...meta,
      status: "FAILED",
      error: message,
      dataVerification: "failed",
    };
    await writeMetadata(paths.metadataPath, meta).catch(() => undefined);
    if (error instanceof BackupError) throw error;
    throw new BackupError("RESTORE_VERIFY_FAILED", message);
  }
}

/**
 * Drop+create restore DB using admin connection to source host's `postgres` db.
 * Uses source URL host credentials but forces database name from restore URL.
 */
async function recreateDatabase(
  sourceUrl: string,
  restoreUrl: string
): Promise<void> {
  const source = parseDatabaseUrl(sourceUrl);
  const target = parseDatabaseUrl(restoreUrl);

  if (
    target.database === source.database &&
    target.host === source.host &&
    target.port === source.port
  ) {
    throw new BackupError(
      "RESTORE_TARGET_IS_PRODUCTION",
      "Refusing to drop/recreate source database"
    );
  }

  const src = new URL(sourceUrl);
  src.pathname = "/postgres";
  const adminUrl = src.toString();

  await withClient(adminUrl, async (client) => {
    const db = target.database.replace(/"/g, '""');
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [target.database]
    );
    await client.query(`DROP DATABASE IF EXISTS "${db}"`);
    await client.query(`CREATE DATABASE "${db}"`);
  });
}
