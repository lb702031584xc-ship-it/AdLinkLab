/**
 * Phase 9.4 — Path helpers for backup artifacts.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { BackupPaths } from "./types.js";

export const DEFAULT_BACKUP_DIR_NAME = "backups";

export function resolveBackupDir(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): string {
  const configured = (env.ADLINKLAB_BACKUP_DIR ?? "").trim();
  if (configured) return configured;
  return join(cwd, DEFAULT_BACKUP_DIR_NAME);
}

export function buildBackupId(now = new Date(), id = randomUUID()): string {
  const ts = now.toISOString().replace(/[:.]/g, "-");
  const short = id.replace(/-/g, "").slice(0, 12);
  return `${ts}_${short}`;
}

export function pathsForBackupId(
  backupDir: string,
  backupId: string
): BackupPaths {
  const base = join(backupDir, backupId);
  return {
    backupDir,
    artifactPath: `${base}.dump`,
    checksumPath: `${base}.dump.sha256`,
    metadataPath: `${base}.json`,
    tempArtifactPath: `${base}.dump.partial`,
    latestPointerPath: join(backupDir, "latest-verified.json"),
  };
}
