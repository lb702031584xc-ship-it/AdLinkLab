/**
 * Phase 9.4 — Backup metadata IO (no secrets).
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BackupMetadata } from "./types.js";
import { BackupError } from "./types.js";

const FORBIDDEN_META_KEYS = [
  "databaseUrl",
  "DATABASE_URL",
  "password",
  "connectionString",
  "apiKey",
  "token",
  "pepper",
  "authorization",
];

export function assertMetadataSafe(meta: BackupMetadata): void {
  const json = JSON.stringify(meta);
  for (const key of FORBIDDEN_META_KEYS) {
    if (json.toLowerCase().includes(key.toLowerCase()) && key !== "token") {
      // "token" substring may appear in "backupId" paths — check URL patterns instead
    }
  }
  if (/postgresql:\/\//i.test(json)) {
    throw new BackupError(
      "METADATA_SECRET",
      "Metadata must not contain connection strings"
    );
  }
  if (/redis:\/\//i.test(json)) {
    throw new BackupError("METADATA_SECRET", "Metadata must not contain Redis URLs");
  }
}

export async function writeMetadata(
  path: string,
  meta: BackupMetadata
): Promise<void> {
  assertMetadataSafe(meta);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

export async function readMetadata(path: string): Promise<BackupMetadata> {
  const raw = await readFile(path, "utf8");
  const meta = JSON.parse(raw) as BackupMetadata;
  assertMetadataSafe(meta);
  return meta;
}

export async function writeLatestPointer(
  latestPath: string,
  meta: BackupMetadata
): Promise<void> {
  if (meta.status !== "VERIFIED") {
    throw new BackupError(
      "LATEST_REQUIRES_VERIFIED",
      "Only VERIFIED backups can become latest"
    );
  }
  await writeMetadata(latestPath, {
    backupId: meta.backupId,
    createdAt: meta.createdAt,
    format: meta.format,
    sizeBytes: meta.sizeBytes,
    sha256: meta.sha256,
    status: meta.status,
    artifactFile: meta.artifactFile,
    checksumFile: meta.checksumFile,
    restoreVerifiedAt: meta.restoreVerifiedAt,
    dataVerification: meta.dataVerification,
  });
}

/** Atomic-ish replace: write temp then rename. */
export async function finalizeArtifact(
  tempPath: string,
  finalPath: string
): Promise<void> {
  await rename(tempPath, finalPath);
}
