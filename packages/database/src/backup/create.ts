/**
 * Phase 9.4 — Create PostgreSQL backup (pg_dump -Fc).
 */
import { basename } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  buildBackupId,
  pathsForBackupId,
  resolveBackupDir,
} from "./paths.js";
import { sha256File, writeChecksumFile } from "./checksum.js";
import {
  assertArtifactNonEmpty,
  resolvePgTools,
  validatePostgresArchive,
  type PgToolPaths,
} from "./validate.js";
import { finalizeArtifact, writeLatestPointer, writeMetadata } from "./metadata.js";
import { BackupError, type BackupMetadata } from "./types.js";
import { redactConnectionString, toPgConnectionUrl } from "./safety.js";

export interface CreateBackupOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  databaseUrl?: string;
  tools?: PgToolPaths | null;
  /** Injectable dump runner for tests. */
  runPgDump?: (
    pgDump: string,
    databaseUrl: string,
    outputPath: string
  ) => { status: number | null; stderr: string };
  /** Injectable pg_restore --list for tests. */
  runPgRestoreList?: (
    pgRestore: string,
    artifactPath: string
  ) => { status: number | null; stderr: string };
  /** Skip promoting to latest (default: promote when VERIFIED). */
  updateLatest?: boolean;
}

export interface CreateBackupResult {
  metadata: BackupMetadata;
}

function defaultRunPgDump(
  pgDump: string,
  databaseUrl: string,
  outputPath: string
): { status: number | null; stderr: string } {
  const result = spawnSync(
    pgDump,
    [
      "--format=custom",
      "--no-owner",
      "--no-acl",
      `--file=${outputPath}`,
      databaseUrl,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      shell: false,
      timeout: 600_000,
      env: {
        ...process.env,
        // Avoid leaking via child PGDATABASE prompts; URL carries auth.
      },
    }
  );
  return {
    status: result.status,
    stderr: redactConnectionString(result.stderr ?? ""),
  };
}

export async function createBackup(
  options: CreateBackupOptions = {}
): Promise<CreateBackupResult> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const databaseUrlRaw = (options.databaseUrl ?? env.DATABASE_URL ?? "").trim();
  if (!databaseUrlRaw) {
    throw new BackupError("MISSING_DATABASE_URL", "DATABASE_URL is required for backup");
  }
  const databaseUrl = toPgConnectionUrl(databaseUrlRaw);

  const tools =
    options.tools === undefined ? resolvePgTools(env) : options.tools;
  if (!tools) {
    throw new BackupError(
      "PG_TOOLS_MISSING",
      "pg_dump/pg_restore not found — set ADLINKLAB_PG_BIN or install PostgreSQL client tools"
    );
  }

  const backupDir = resolveBackupDir(env, cwd);
  await mkdir(backupDir, { recursive: true });

  const backupId = buildBackupId();
  const paths = pathsForBackupId(backupDir, backupId);

  let meta: BackupMetadata = {
    backupId,
    createdAt: new Date().toISOString(),
    format: "custom",
    sizeBytes: 0,
    sha256: "",
    status: "STARTED",
    artifactFile: basename(paths.artifactPath),
    checksumFile: basename(paths.checksumPath),
  };
  await writeMetadata(paths.metadataPath, meta);

  try {
    if (existsSync(paths.tempArtifactPath)) {
      await rm(paths.tempArtifactPath, { force: true });
    }

    const run = options.runPgDump ?? defaultRunPgDump;
    const dumped = run(tools.pgDump, databaseUrl, paths.tempArtifactPath);
    if (dumped.status !== 0) {
      throw new BackupError(
        "PG_DUMP_FAILED",
        `pg_dump failed (exit ${dumped.status ?? "null"})`
      );
    }

    meta = { ...meta, status: "VALIDATING" };
    await writeMetadata(paths.metadataPath, meta);

    const sizeBytes = assertArtifactNonEmpty(paths.tempArtifactPath);
    await validatePostgresArchive(paths.tempArtifactPath, tools, {
      runPgRestoreList: options.runPgRestoreList,
    });
    const sha256 = await sha256File(paths.tempArtifactPath);
    await writeChecksumFile(
      paths.checksumPath,
      sha256,
      basename(paths.artifactPath)
    );
    await finalizeArtifact(paths.tempArtifactPath, paths.artifactPath);

    meta = {
      ...meta,
      status: "VERIFIED",
      sizeBytes,
      sha256,
    };
    await writeMetadata(paths.metadataPath, meta);

    if (options.updateLatest !== false) {
      await writeLatestPointer(paths.latestPointerPath, meta);
    }

    return { metadata: meta };
  } catch (error) {
    const message =
      error instanceof BackupError
        ? error.message
        : error instanceof Error
          ? redactConnectionString(error.message)
          : "Backup failed";
    meta = {
      ...meta,
      status: "FAILED",
      error: message,
    };
    await writeMetadata(paths.metadataPath, meta).catch(() => undefined);
    await rm(paths.tempArtifactPath, { force: true }).catch(() => undefined);
    if (error instanceof BackupError) throw error;
    throw new BackupError("BACKUP_FAILED", message);
  }
}
