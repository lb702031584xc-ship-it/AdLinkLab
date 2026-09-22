/**
 * Phase 9.4 — Retention: keep N VERIFIED backups; never delete the last one.
 */
import { readdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveBackupDir } from "./paths.js";
import type { BackupMetadata } from "./types.js";
import { BackupError } from "./types.js";

export interface RetentionOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Number of VERIFIED backups to keep (default 5). */
  keep?: number;
}

export interface RetentionResult {
  kept: string[];
  deleted: string[];
}

export async function cleanupRetention(
  options: RetentionOptions = {}
): Promise<RetentionResult> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const keep = Math.max(1, options.keep ?? Number(env.ADLINKLAB_BACKUP_KEEP ?? 5));
  const backupDir = resolveBackupDir(env, cwd);

  let entries: string[] = [];
  try {
    entries = await readdir(backupDir);
  } catch {
    return { kept: [], deleted: [] };
  }

  const metas: BackupMetadata[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json") || name === "latest-verified.json") continue;
    try {
      const raw = await readFile(join(backupDir, name), "utf8");
      const meta = JSON.parse(raw) as BackupMetadata;
      if (meta.status === "VERIFIED") metas.push(meta);
    } catch {
      /* ignore unreadable */
    }
  }

  metas.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const kept = metas.slice(0, keep).map((m) => m.backupId);
  const toDelete = metas.slice(keep);
  const deleted: string[] = [];

  // Never delete if it would leave zero VERIFIED
  if (metas.length <= keep) {
    return { kept: metas.map((m) => m.backupId), deleted: [] };
  }

  if (kept.length < 1) {
    throw new BackupError(
      "RETENTION_REFUSED",
      "Retention refused — would delete all verified backups"
    );
  }

  for (const meta of toDelete) {
    const base = join(backupDir, meta.backupId);
    await rm(`${base}.dump`, { force: true });
    await rm(`${base}.dump.sha256`, { force: true });
    await rm(`${base}.json`, { force: true });
    await rm(`${base}.dump.partial`, { force: true });
    deleted.push(meta.backupId);
  }

  return { kept, deleted };
}
