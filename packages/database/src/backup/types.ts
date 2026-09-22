/**
 * Phase 9.4 — PostgreSQL backup / recovery types.
 * Metadata must never contain connection strings or secrets.
 */

export type BackupStatus = "STARTED" | "VALIDATING" | "VERIFIED" | "FAILED";

export type BackupFormat = "custom"; // pg_dump -Fc

export interface BackupMetadata {
  backupId: string;
  createdAt: string;
  format: BackupFormat;
  sizeBytes: number;
  sha256: string;
  status: BackupStatus;
  /** Relative artifact filename within backup directory */
  artifactFile: string;
  checksumFile: string;
  error?: string;
  /** Set after successful restore-test */
  restoreVerifiedAt?: string;
  dataVerification?: "passed" | "limited_empty" | "failed" | "skipped";
}

export interface BackupPaths {
  backupDir: string;
  artifactPath: string;
  checksumPath: string;
  metadataPath: string;
  tempArtifactPath: string;
  latestPointerPath: string;
}

export class BackupError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BackupError";
    this.code = code;
  }
}
