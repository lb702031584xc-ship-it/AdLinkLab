/**
 * Phase 9.4 — Verify an existing backup artifact.
 */
import { basename } from "node:path";
import { existsSync } from "node:fs";
import {
  pathsForBackupId,
  resolveBackupDir,
} from "./paths.js";
import { verifyChecksum } from "./checksum.js";
import {
  assertArtifactNonEmpty,
  resolvePgTools,
  validatePostgresArchive,
  type PgToolPaths,
} from "./validate.js";
import { readMetadata, writeMetadata } from "./metadata.js";
import { BackupError, type BackupMetadata } from "./types.js";

export interface VerifyBackupOptions {
  backupId: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  tools?: PgToolPaths | null;
  runPgRestoreList?: (
    pgRestore: string,
    artifactPath: string
  ) => { status: number | null; stderr: string };
}

export async function verifyBackup(
  options: VerifyBackupOptions
): Promise<BackupMetadata> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const backupDir = resolveBackupDir(env, cwd);
  const paths = pathsForBackupId(backupDir, options.backupId);

  if (!existsSync(paths.metadataPath)) {
    throw new BackupError("METADATA_MISSING", "Backup metadata not found");
  }
  const meta = await readMetadata(paths.metadataPath);

  try {
    assertArtifactNonEmpty(paths.artifactPath);
    if (!existsSync(paths.checksumPath)) {
      throw new BackupError("CHECKSUM_MISSING", "Checksum file missing");
    }
    const checksum = await verifyChecksum(
      paths.artifactPath,
      paths.checksumPath
    );
    if (!checksum.ok) {
      throw new BackupError(
        "CHECKSUM_MISMATCH",
        "SHA-256 does not match recorded checksum"
      );
    }

    const tools =
      options.tools === undefined ? resolvePgTools(env) : options.tools;
    await validatePostgresArchive(paths.artifactPath, tools, {
      runPgRestoreList: options.runPgRestoreList,
    });

    if (meta.status === "FAILED") {
      // Re-verify can upgrade only if checks pass — but FAILED from create
      // with valid files is unusual; allow VALIDATING→VERIFIED, not silent.
    }

    const updated: BackupMetadata = {
      ...meta,
      status: "VERIFIED",
      sha256: checksum.ok ? checksum.sha256 : meta.sha256,
      sizeBytes: assertArtifactNonEmpty(paths.artifactPath),
      artifactFile: basename(paths.artifactPath),
      checksumFile: basename(paths.checksumPath),
      error: undefined,
    };
    await writeMetadata(paths.metadataPath, updated);
    return updated;
  } catch (error) {
    const message =
      error instanceof BackupError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Verify failed";
    const failed: BackupMetadata = {
      ...meta,
      status: "FAILED",
      error: message,
    };
    await writeMetadata(paths.metadataPath, failed).catch(() => undefined);
    if (error instanceof BackupError) throw error;
    throw new BackupError("VERIFY_FAILED", message);
  }
}
