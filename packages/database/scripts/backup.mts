/**
 * Phase 9.4 — CLI entry for backup create / verify / restore-test / cleanup.
 * Usage:
 *   tsx scripts/backup.mts create
 *   tsx scripts/backup.mts verify <backupId>
 *   tsx scripts/backup.mts restore-test <backupId>
 *   tsx scripts/backup.mts cleanup
 */
import {
  cleanupRetention,
  createBackup,
  restoreVerify,
  verifyBackup,
  BackupError,
  redactConnectionString,
} from "../src/backup/index.js";

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function fail(error: unknown): never {
  const message =
    error instanceof BackupError
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? redactConnectionString(error.message)
        : "Unknown backup error";
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

async function main(): Promise<void> {
  const [, , command, arg] = process.argv;
  try {
    switch (command) {
      case "create": {
        const result = await createBackup();
        printJson({ ok: true, ...result });
        break;
      }
      case "verify": {
        if (!arg) throw new BackupError("USAGE", "verify requires <backupId>");
        const metadata = await verifyBackup({ backupId: arg });
        printJson({ ok: true, metadata });
        break;
      }
      case "restore-test": {
        if (!arg) {
          throw new BackupError("USAGE", "restore-test requires <backupId>");
        }
        const result = await restoreVerify({ backupId: arg });
        printJson({ ok: true, ...result });
        break;
      }
      case "cleanup": {
        const result = await cleanupRetention();
        printJson({ ok: true, ...result });
        break;
      }
      default:
        throw new BackupError(
          "USAGE",
          "Usage: backup.mts <create|verify|restore-test|cleanup> [backupId]"
        );
    }
  } catch (error) {
    fail(error);
  }
}

await main();
