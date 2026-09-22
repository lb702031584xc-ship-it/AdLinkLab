/**
 * Phase 12.2-B — LAB/CI ONLY seeded restore depth gate CLI.
 *
 * Does not change backup:create / backup:verify / restore-test semantics.
 * Does not persist ADLINKLAB_BACKUP_ALLOW_RESTORE or write secrets into .env.
 *
 * Required env:
 *   ADLINKLAB_SEEDED_DEPTH_GATE=1
 *   ADLINKLAB_BACKUP_ALLOW_RESTORE=1
 *   ADLINKLAB_BACKUP_SOURCE_DATABASE_URL  (or DATABASE_URL when gate flag is set)
 *   ADLINKLAB_BACKUP_RESTORE_DATABASE_URL
 *
 * Optional:
 *   ADLINKLAB_BACKUP_DIR
 *   ADLINKLAB_PG_BIN
 *   ADLINKLAB_BACKUP_PRODUCTION_DATABASE  (blocks restore onto that DB name)
 *   ADLINKLAB_SEEDED_DEPTH_SKIP_PREPARE=1  (skip migrate+seed)
 *
 * Usage (from packages/database):
 *   pnpm backup:depth-gate
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  BackupError,
  redactConnectionString,
  runSeededRestoreDepthGate,
} from "../src/backup/index.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function main(): Promise<void> {
  const env = process.env;
  if ((env.ADLINKLAB_SEEDED_DEPTH_GATE ?? "").trim() !== "1") {
    throw new BackupError(
      "SOURCE_CONFIG_INVALID",
      "Set ADLINKLAB_SEEDED_DEPTH_GATE=1 to run the LAB/CI seeded restore depth gate"
    );
  }

  const source = (
    env.ADLINKLAB_BACKUP_SOURCE_DATABASE_URL ??
    env.DATABASE_URL ??
    ""
  ).trim();
  const restore = (env.ADLINKLAB_BACKUP_RESTORE_DATABASE_URL ?? "").trim();

  if (!source) {
    throw new BackupError(
      "SOURCE_CONFIG_INVALID",
      "ADLINKLAB_BACKUP_SOURCE_DATABASE_URL (or DATABASE_URL) is required"
    );
  }
  if (!restore) {
    throw new BackupError(
      "RESTORE_TARGET_INVALID",
      "ADLINKLAB_BACKUP_RESTORE_DATABASE_URL is required"
    );
  }

  const result = await runSeededRestoreDepthGate({
    sourceConnectionString: source,
    restoreConnectionString: restore,
    labCiIntent: true,
    env,
    cwd: PACKAGE_ROOT,
    skipPrepareSource:
      (env.ADLINKLAB_SEEDED_DEPTH_SKIP_PREPARE ?? "").trim() === "1",
  });

  printJson(result);
  if (result.overallStatus !== "passed") {
    process.exit(1);
  }
}

try {
  await main();
} catch (error) {
  const message =
    error instanceof BackupError
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? redactConnectionString(error.message)
        : "Unknown depth gate error";
  console.error(JSON.stringify({ ok: false, error: message, scope: "LAB_CI_ONLY" }));
  process.exit(1);
}
