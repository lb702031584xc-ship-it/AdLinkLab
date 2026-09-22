/**
 * Phase 9.4 — Artifact validation (existence, size, PG custom format).
 */
import { existsSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { BackupError } from "./types.js";

/** PostgreSQL custom-format archive magic (pg_dump -Fc). */
export const PG_CUSTOM_MAGIC = "PGDMP";

export function assertArtifactNonEmpty(artifactPath: string): number {
  if (!existsSync(artifactPath)) {
    throw new BackupError("ARTIFACT_MISSING", "Backup artifact does not exist");
  }
  const size = statSync(artifactPath).size;
  if (size <= 0) {
    throw new BackupError(
      "ARTIFACT_ZERO_BYTE",
      "Backup artifact is empty (zero-byte fail-closed)"
    );
  }
  return size;
}

/**
 * Validate PG custom-format magic header without requiring pg_restore.
 */
export async function assertPgCustomFormatMagic(
  artifactPath: string
): Promise<void> {
  assertArtifactNonEmpty(artifactPath);
  const fh = await open(artifactPath, "r");
  try {
    const buf = Buffer.alloc(5);
    const { bytesRead } = await fh.read(buf, 0, 5, 0);
    if (bytesRead < 5 || buf.toString("utf8") !== PG_CUSTOM_MAGIC) {
      throw new BackupError(
        "ARTIFACT_INVALID_FORMAT",
        "Artifact is not a valid PostgreSQL custom-format archive"
      );
    }
  } finally {
    await fh.close();
  }
}

export interface PgToolPaths {
  pgDump: string;
  pgRestore: string;
  psql?: string;
}

/**
 * Resolve pg_dump / pg_restore from env or PATH.
 */
export function resolvePgTools(
  env: NodeJS.ProcessEnv = process.env
): PgToolPaths | null {
  const binDir = (env.ADLINKLAB_PG_BIN ?? env.PG_BIN_DIR ?? "").trim();
  const dump =
    (env.ADLINKLAB_PG_DUMP ?? "").trim() ||
    (binDir ? joinBin(binDir, "pg_dump") : "pg_dump");
  const restore =
    (env.ADLINKLAB_PG_RESTORE ?? "").trim() ||
    (binDir ? joinBin(binDir, "pg_restore") : "pg_restore");
  const psql =
    (env.ADLINKLAB_PSQL ?? "").trim() ||
    (binDir ? joinBin(binDir, "psql") : "psql");

  if (!toolExists(dump) || !toolExists(restore)) {
    return null;
  }
  return { pgDump: dump, pgRestore: restore, psql: toolExists(psql) ? psql : undefined };
}

function joinBin(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  const exe = process.platform === "win32" && !name.endsWith(".exe") ? `${name}.exe` : name;
  return `${dir.replace(/[/\\]$/, "")}${sep}${exe}`;
}

function toolExists(command: string): boolean {
  if (command.includes("/") || command.includes("\\")) {
    return existsSync(command);
  }
  const which = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(which, [command], {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
  return result.status === 0;
}

/**
 * Prefer pg_restore --list when available; else magic-byte validation.
 */
export async function validatePostgresArchive(
  artifactPath: string,
  tools: PgToolPaths | null,
  options: {
    runPgRestoreList?: (
      pgRestore: string,
      artifactPath: string
    ) => { status: number | null; stderr: string };
  } = {}
): Promise<void> {
  await assertPgCustomFormatMagic(artifactPath);
  if (!tools) return;

  const run =
    options.runPgRestoreList ??
    ((pgRestore, path) => {
      const result = spawnSync(pgRestore, ["--list", path], {
        encoding: "utf8",
        windowsHide: true,
        shell: false,
        timeout: 60_000,
      });
      return { status: result.status, stderr: result.stderr ?? "" };
    });

  const listed = run(tools.pgRestore, artifactPath);
  if (listed.status !== 0) {
    throw new BackupError(
      "ARTIFACT_PG_RESTORE_LIST_FAILED",
      "pg_restore --list failed — archive is not a readable PostgreSQL backup"
    );
  }
}
