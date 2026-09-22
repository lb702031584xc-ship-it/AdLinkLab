/**
 * Phase 12.2-B — Unit tests for seeded restore depth gate (no live Postgres).
 */
import { describe, expect, it } from "vitest";
import { BackupError } from "./types.js";
import {
  buildPassingSeededRestoreDepthSnapshot,
  type SeededRestoreDepthSnapshot,
} from "./seeded-restore-depth.js";
import {
  runSeededRestoreDepthGate,
  SEEDED_DEPTH_GATE_SCOPE,
  type SeededRestoreDepthGateOptions,
} from "./seeded-restore-depth-gate.js";
import type { BackupMetadata } from "./types.js";
import type { RestoreVerifyResult } from "./restore-verify.js";

const SOURCE = "postgresql://u:SuperSecretPassword99@127.0.0.1:5432/lab_src";
const RESTORE =
  "postgresql://u:SuperSecretPassword99@127.0.0.1:5432/lab_restore";

function meta(backupId = "test-backup-1"): BackupMetadata {
  return {
    backupId,
    createdAt: new Date().toISOString(),
    format: "custom",
    sizeBytes: 1024,
    sha256: "abc123",
    status: "VERIFIED",
    artifactFile: `${backupId}.dump`,
    checksumFile: `${backupId}.dump.sha256`,
  };
}

function restoreOk(): RestoreVerifyResult {
  return {
    metadata: meta(),
    schemaOk: true,
    missingTables: [],
    dataVerification: "passed",
    migrationMetadataPresent: true,
    tenantCount: 2,
  };
}

function baseOpts(
  overrides: Partial<SeededRestoreDepthGateOptions> = {}
): SeededRestoreDepthGateOptions {
  const passing = buildPassingSeededRestoreDepthSnapshot();
  return {
    sourceConnectionString: SOURCE,
    restoreConnectionString: RESTORE,
    labCiIntent: true,
    skipPrepareSource: true,
    requirePgTools: false,
    env: {
      ADLINKLAB_BACKUP_ALLOW_RESTORE: "1",
      ADLINKLAB_BACKUP_DIR: "/tmp/adlinklab-depth-gate-test",
      ADLINKLAB_BACKUP_PRODUCTION_DATABASE: "lab_src",
    },
    prepareSource: async () => undefined,
    createBackup: async () => ({ metadata: meta() }),
    verifyBackup: async () => meta(),
    restoreVerify: async () => restoreOk(),
    snapshotDepth: async () => passing,
    ...overrides,
  };
}

describe("Phase 12.2-B seeded restore depth gate", () => {
  it("happy path: overall passed with depth + D11 + sourceUnchanged", async () => {
    const result = await runSeededRestoreDepthGate(baseOpts());
    expect(result.scope).toBe(SEEDED_DEPTH_GATE_SCOPE);
    expect(result.overallStatus).toBe("passed");
    expect(result.failedStage).toBeNull();
    expect(result.backupId).toBe("test-backup-1");
    expect(result.depthVerification.status).toBe("passed");
    expect(result.depthVerification.passedCount).toBe(11);
    expect(result.sourceComparison.restoredDataMatchesSource).toBe(true);
    expect(result.sourceUnchanged).toBe(true);
    expect(result.restore.shallowDataVerification).toBe("passed");
    expect(result.fixtureVersion).toBe("phase-1.3");
  });

  it("fails without labCiIntent", async () => {
    const result = await runSeededRestoreDepthGate(
      baseOpts({ labCiIntent: false })
    );
    expect(result.overallStatus).toBe("failed");
    expect(result.failedStage).toBe("config");
    expect(result.errorCode).toBe("SOURCE_CONFIG_INVALID");
  });

  it("fails when restore allow flag missing", async () => {
    const result = await runSeededRestoreDepthGate(
      baseOpts({
        env: {
          ADLINKLAB_BACKUP_DIR: "/tmp/x",
          ADLINKLAB_BACKUP_PRODUCTION_DATABASE: "lab_src",
        },
      })
    );
    expect(result.overallStatus).toBe("failed");
    expect(result.errorCode).toBe("RESTORE_GATE_REQUIRED");
  });

  it("fails when source === restore", async () => {
    const result = await runSeededRestoreDepthGate(
      baseOpts({
        restoreConnectionString: SOURCE,
      })
    );
    expect(result.overallStatus).toBe("failed");
    expect(result.errorCode).toBe("SOURCE_RESTORE_TARGET_COLLISION");
  });

  it("fails when restore URL missing", async () => {
    const result = await runSeededRestoreDepthGate(
      baseOpts({ restoreConnectionString: "" })
    );
    expect(result.overallStatus).toBe("failed");
    expect(result.errorCode).toBe("RESTORE_TARGET_INVALID");
  });

  it("source depth failure stops before backup create", async () => {
    let createCalled = false;
    const bad = buildPassingSeededRestoreDepthSnapshot({ tenantCount: 0 });
    const result = await runSeededRestoreDepthGate(
      baseOpts({
        snapshotDepth: async () => bad,
        createBackup: async () => {
          createCalled = true;
          return { metadata: meta() };
        },
      })
    );
    expect(createCalled).toBe(false);
    expect(result.failedStage).toBe("source_depth");
    expect(result.errorCode).toBe("SOURCE_DEPTH_FAILED");
    expect(result.overallStatus).toBe("failed");
  });

  it("prepare failure maps to FIXTURE_SEED_FAILED", async () => {
    const result = await runSeededRestoreDepthGate(
      baseOpts({
        skipPrepareSource: false,
        prepareSource: async () => {
          throw new BackupError("FIXTURE_SEED_FAILED", "seed boom");
        },
      })
    );
    expect(result.failedStage).toBe("prepare_source");
    expect(result.errorCode).toBe("FIXTURE_SEED_FAILED");
  });

  it("backup create failure", async () => {
    const result = await runSeededRestoreDepthGate(
      baseOpts({
        createBackup: async () => {
          throw new BackupError("PG_DUMP_FAILED", "dump failed");
        },
      })
    );
    expect(result.failedStage).toBe("backup_create");
    expect(result.errorCode).toBe("BACKUP_CREATE_FAILED");
  });

  it("backup verify failure", async () => {
    const result = await runSeededRestoreDepthGate(
      baseOpts({
        verifyBackup: async () => {
          throw new BackupError("CHECKSUM_MISMATCH", "bad checksum");
        },
      })
    );
    expect(result.failedStage).toBe("backup_verify");
    expect(result.errorCode).toBe("BACKUP_VERIFY_FAILED");
  });

  it("restore-test failure", async () => {
    const result = await runSeededRestoreDepthGate(
      baseOpts({
        restoreVerify: async () => {
          throw new BackupError("PG_RESTORE_FAILED", "restore failed");
        },
      })
    );
    expect(result.failedStage).toBe("restore_test");
    expect(result.errorCode).toBe("RESTORE_TEST_FAILED");
  });

  it("source depth pass + restore depth fail ⇒ overall fail (no false positive)", async () => {
    const good = buildPassingSeededRestoreDepthSnapshot();
    const badRestore = buildPassingSeededRestoreDepthSnapshot({
      campaignCountTenantA: 0,
    });
    let calls = 0;
    const result = await runSeededRestoreDepthGate(
      baseOpts({
        snapshotDepth: async ({ connectionString }) => {
          calls += 1;
          // 1 source before, 2 restore
          if (connectionString.includes("lab_restore")) return badRestore;
          return good;
        },
      })
    );
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(result.failedStage).toBe("restore_depth");
    expect(result.errorCode).toBe("RESTORE_DEPTH_FAILED");
    expect(result.restore.shallowDataVerification).toBe("passed");
    expect(result.overallStatus).toBe("failed");
  });

  it("shallow dataVerification passed alone does not imply overall passed", async () => {
    // Same as above: shallow passed but depth fails
    const good = buildPassingSeededRestoreDepthSnapshot();
    const emptyTracking = buildPassingSeededRestoreDepthSnapshot({
      trackingPublicIdsTenantA: [],
    });
    const result = await runSeededRestoreDepthGate(
      baseOpts({
        restoreVerify: async () => ({
          ...restoreOk(),
          dataVerification: "passed",
          tenantCount: 2,
        }),
        snapshotDepth: async ({ connectionString }) =>
          connectionString.includes("lab_restore") ? emptyTracking : good,
      })
    );
    expect(result.restore.shallowDataVerification).toBe("passed");
    expect(result.overallStatus).toBe("failed");
    expect(result.failedStage).toBe("restore_depth");
  });

  it("D11 mismatch ⇒ SOURCE_COMPARE_FAILED", async () => {
    const source = buildPassingSeededRestoreDepthSnapshot();
    // Restore still passes D1–D10 but differs on a compared field that... wait,
    // if campaignCount differs, D3 fails on restore. Need restore that passes
    // D1–D10 but differs from source — impossible if both pass same contract
    // unless we use a field that both can pass with different values.
    // tenantBClickCount >= 1: source=1, restore=5 both pass D8 but D11 fails.
    const restore = buildPassingSeededRestoreDepthSnapshot({
      tenantBClickCount: 5,
    });
    const result = await runSeededRestoreDepthGate(
      baseOpts({
        snapshotDepth: async ({ connectionString }) =>
          connectionString.includes("lab_restore") ? restore : source,
      })
    );
    expect(result.failedStage).toBe("source_compare");
    expect(result.errorCode).toBe("SOURCE_COMPARE_FAILED");
    expect(result.sourceComparison.restoredDataMatchesSource).toBe(false);
  });

  it("source mutated after restore ⇒ SOURCE_MUTATED", async () => {
    const snapshots: SeededRestoreDepthSnapshot[] = [
      buildPassingSeededRestoreDepthSnapshot(), // source before
      buildPassingSeededRestoreDepthSnapshot(), // restore
      buildPassingSeededRestoreDepthSnapshot({ tenantBClickCount: 99 }), // source after
    ];
    let i = 0;
    const result = await runSeededRestoreDepthGate(
      baseOpts({
        snapshotDepth: async () => snapshots[i++]!,
      })
    );
    expect(result.failedStage).toBe("source_unchanged");
    expect(result.errorCode).toBe("SOURCE_MUTATED");
    expect(result.sourceUnchanged).toBe(false);
    expect(result.sourceComparison.restoredDataMatchesSource).toBe(true);
  });

  it("SEED_RESET prepare is only invoked for source (never restore URL)", async () => {
    const seen: string[] = [];
    await runSeededRestoreDepthGate(
      baseOpts({
        skipPrepareSource: false,
        prepareSource: async ({ sourceConnectionString }) => {
          seen.push(sourceConnectionString);
        },
      })
    );
    expect(seen).toEqual([SOURCE]);
    expect(seen.some((u) => u.includes("lab_restore"))).toBe(false);
  });

  it("result / errors never include password or credential URL", async () => {
    const result = await runSeededRestoreDepthGate(
      baseOpts({
        createBackup: async () => {
          throw new Error(
            `failed connecting ${SOURCE} with SuperSecretPassword99`
          );
        },
      })
    );
    const blob = JSON.stringify(result);
    expect(blob).not.toMatch(/SuperSecretPassword99/);
    expect(blob).not.toMatch(
      /postgresql:\/\/u:SuperSecretPassword99@/i
    );
    expect(result.errorMessage).not.toMatch(/SuperSecretPassword99/);
  });

  it("passes explicit source/restore into backup APIs", async () => {
    let seenCreateUrl: string | undefined;
    let seenRestoreSource: string | undefined;
    let seenRestoreTarget: string | undefined;
    await runSeededRestoreDepthGate(
      baseOpts({
        createBackup: async (opts) => {
          seenCreateUrl = opts.databaseUrl;
          return { metadata: meta() };
        },
        restoreVerify: async (opts) => {
          seenRestoreSource = opts.sourceDatabaseUrl;
          seenRestoreTarget = opts.restoreDatabaseUrl;
          return restoreOk();
        },
      })
    );
    expect(seenCreateUrl).toBe(SOURCE);
    expect(seenRestoreSource).toBe(SOURCE);
    expect(seenRestoreTarget).toBe(RESTORE);
  });
});
