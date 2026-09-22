/**
 * Phase 12.2-B — Seeded restore depth gate orchestration (LAB / CI ONLY).
 *
 * Wires: prepare/seed → backup:create → backup:verify → restore-test →
 * Phase 12.2-A depth assertions on restore + source comparison + source-unchanged.
 *
 * Does NOT change production backup semantics or shallow dataVerification.
 * Depth SQL/assertions live only in seeded-restore-depth.ts.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  createBackup,
  type CreateBackupOptions,
  type CreateBackupResult,
} from "./create.js";
import { verifyBackup, type VerifyBackupOptions } from "./verify.js";
import {
  restoreVerify,
  type RestoreVerifyOptions,
  type RestoreVerifyResult,
} from "./restore-verify.js";
import {
  assertSeededRestoreDepth,
  compareSeededRestoreDepthSnapshots,
  evaluateSeededRestoreDepth,
  evaluateSeededRestoreDepthWithSourceCompare,
  snapshotSeededRestoreDepth,
  SEEDED_RESTORE_DEPTH_FIXTURE_VERSION,
  type SeededRestoreDepthResult,
  type SeededRestoreDepthSnapshot,
} from "./seeded-restore-depth.js";
import { pathsForBackupId, resolveBackupDir } from "./paths.js";
import {
  assertSafeRestoreTarget,
  parseDatabaseUrl,
  redactConnectionString,
} from "./safety.js";
import { resolvePgTools, type PgToolPaths } from "./validate.js";
import { BackupError, type BackupMetadata } from "./types.js";

/** Explicit LAB/CI intent marker — never a production backup path. */
export const SEEDED_DEPTH_GATE_SCOPE = "LAB_CI_ONLY" as const;

export type SeededDepthGateFailedStage =
  | "config"
  | "prepare_source"
  | "source_depth"
  | "backup_create"
  | "backup_verify"
  | "restore_test"
  | "restore_depth"
  | "source_compare"
  | "source_unchanged"
  | null;

export interface SeededRestoreDepthGateOptions {
  /** Explicit source DB — required; module does not invent one. */
  sourceConnectionString: string;
  /** Explicit restore target — required; must differ from source. */
  restoreConnectionString: string;
  /**
   * Must be true. Marks this run as LAB/CI-only seeded depth gate.
   * CLI sets this when ADLINKLAB_SEEDED_DEPTH_GATE=1.
   */
  labCiIntent: boolean;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  tools?: PgToolPaths | null;
  /** When true, skip migrate+seed (source already prepared). */
  skipPrepareSource?: boolean;
  /** Injectable prepare (migrate deploy + SEED_RESET seed against source only). */
  prepareSource?: (ctx: {
    sourceConnectionString: string;
    env: NodeJS.ProcessEnv;
    cwd: string;
  }) => Promise<void>;
  createBackup?: (
    options: CreateBackupOptions
  ) => Promise<CreateBackupResult>;
  verifyBackup?: (
    options: VerifyBackupOptions
  ) => Promise<BackupMetadata>;
  restoreVerify?: (
    options: RestoreVerifyOptions
  ) => Promise<RestoreVerifyResult>;
  snapshotDepth?: (opts: {
    connectionString: string;
  }) => Promise<SeededRestoreDepthSnapshot>;
  /** Require pg tools when using default backup/restore runners. Default true. */
  requirePgTools?: boolean;
}

export interface SeededRestoreDepthGateResult {
  scope: typeof SEEDED_DEPTH_GATE_SCOPE;
  runId: string;
  backupId: string | null;
  fixtureVersion: typeof SEEDED_RESTORE_DEPTH_FIXTURE_VERSION;
  artifact: {
    path: string | null;
    sizeBytes: number | null;
    sha256: string | null;
  };
  source: {
    verification: "passed" | "failed" | "skipped";
  };
  restore: {
    schemaVerification: "passed" | "failed" | "skipped";
    migrationVerification: "passed" | "failed" | "skipped";
    /** Shallow Layer 3 only — NOT depth. */
    shallowDataVerification: "passed" | "limited_empty" | "failed" | "skipped";
  };
  depthVerification: {
    status: "passed" | "failed" | "skipped";
    passedCount: number;
    failedCount: number;
    assertions?: SeededRestoreDepthResult["assertions"];
  };
  sourceComparison: {
    status: "passed" | "failed" | "skipped";
    /** Restored depth snapshot matches pre-backup source snapshot (D11). */
    restoredDataMatchesSource: boolean | null;
  };
  sourceUnchanged: boolean | null;
  overallStatus: "passed" | "failed";
  failedStage: SeededDepthGateFailedStage;
  errorCode: string | null;
  errorMessage: string | null;
  timestamp: string;
}

function failResult(
  base: Partial<SeededRestoreDepthGateResult>,
  stage: Exclude<SeededDepthGateFailedStage, null>,
  code: string,
  message: string,
  redactExtra?: (text: string) => string
): SeededRestoreDepthGateResult {
  const safe = redactExtra
    ? redactExtra(message)
    : redactConnectionString(message);
  return {
    scope: SEEDED_DEPTH_GATE_SCOPE,
    runId: base.runId ?? randomUUID(),
    backupId: base.backupId ?? null,
    fixtureVersion: SEEDED_RESTORE_DEPTH_FIXTURE_VERSION,
    artifact: base.artifact ?? { path: null, sizeBytes: null, sha256: null },
    source: base.source ?? { verification: "skipped" },
    restore: base.restore ?? {
      schemaVerification: "skipped",
      migrationVerification: "skipped",
      shallowDataVerification: "skipped",
    },
    depthVerification: base.depthVerification ?? {
      status: "skipped",
      passedCount: 0,
      failedCount: 0,
    },
    sourceComparison: base.sourceComparison ?? {
      status: "skipped",
      restoredDataMatchesSource: null,
    },
    sourceUnchanged: base.sourceUnchanged ?? null,
    overallStatus: "failed",
    failedStage: stage,
    errorCode: code,
    errorMessage: safe,
    timestamp: new Date().toISOString(),
  };
}

/** Redact credential-bearing URLs and passwords known from supplied URLs. */
function buildGateRedactor(urls: string[]): (text: string) => string {
  const secrets = new Set<string>();
  for (const raw of urls) {
    try {
      const u = new URL(raw);
      if (u.password) {
        secrets.add(u.password);
        try {
          secrets.add(decodeURIComponent(u.password));
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }
  return (text: string) => {
    let out = redactConnectionString(text);
    for (const secret of secrets) {
      if (secret.length >= 4) {
        out = out.split(secret).join("***");
      }
    }
    return out;
  };
}

function snapshotsEqual(
  a: SeededRestoreDepthSnapshot,
  b: SeededRestoreDepthSnapshot
): boolean {
  return compareSeededRestoreDepthSnapshots(a, b).status === "passed";
}

/**
 * Default prepare: migrate deploy + SEED_RESET=1 seed against SOURCE only.
 * Never targets restore URL. Never persists allow-restore flags.
 */
export async function defaultPrepareSeededDepthSource(ctx: {
  sourceConnectionString: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
}): Promise<void> {
  const databaseUrl = ctx.sourceConnectionString.trim();
  const childEnv = {
    ...ctx.env,
    DATABASE_URL: databaseUrl,
    SEED_RESET: "1",
  };

  const migrate = spawnSync(
    "pnpm",
    ["exec", "prisma", "migrate", "deploy"],
    {
      cwd: ctx.cwd,
      env: childEnv,
      encoding: "utf8",
      shell: true,
      windowsHide: true,
      timeout: 600_000,
    }
  );
  if (migrate.status !== 0) {
    throw new BackupError(
      "FIXTURE_SEED_FAILED",
      redactConnectionString(
        `migrate deploy failed (exit ${migrate.status ?? "null"}): ${migrate.stderr ?? migrate.stdout ?? ""}`
      )
    );
  }

  const seed = spawnSync("pnpm", ["exec", "tsx", "prisma/seed.ts"], {
    cwd: ctx.cwd,
    env: childEnv,
    encoding: "utf8",
    shell: true,
    windowsHide: true,
    timeout: 600_000,
  });
  if (seed.status !== 0) {
    throw new BackupError(
      "FIXTURE_SEED_FAILED",
      redactConnectionString(
        `seed failed (exit ${seed.status ?? "null"}): ${seed.stderr ?? seed.stdout ?? ""}`
      )
    );
  }
}

function validateGateConfig(
  options: SeededRestoreDepthGateOptions,
  env: NodeJS.ProcessEnv
): BackupError | null {
  if (!options.labCiIntent) {
    return new BackupError(
      "SOURCE_CONFIG_INVALID",
      "Seeded depth gate requires labCiIntent=true (LAB/CI only)"
    );
  }
  const source = (options.sourceConnectionString ?? "").trim();
  const restore = (options.restoreConnectionString ?? "").trim();
  if (!source) {
    return new BackupError(
      "SOURCE_CONFIG_INVALID",
      "sourceConnectionString is required"
    );
  }
  if (!restore) {
    return new BackupError(
      "RESTORE_TARGET_INVALID",
      "restoreConnectionString is required"
    );
  }

  let sourceParsed;
  let restoreParsed;
  try {
    sourceParsed = parseDatabaseUrl(source);
    restoreParsed = parseDatabaseUrl(restore);
  } catch (error) {
    return error instanceof BackupError
      ? error
      : new BackupError("SOURCE_CONFIG_INVALID", "Invalid connection string");
  }

  if (
    sourceParsed.host === restoreParsed.host &&
    sourceParsed.port === restoreParsed.port &&
    sourceParsed.database === restoreParsed.database
  ) {
    return new BackupError(
      "SOURCE_RESTORE_TARGET_COLLISION",
      "source and restore database targets must differ"
    );
  }

  if ((env.ADLINKLAB_BACKUP_ALLOW_RESTORE ?? "").trim() !== "1") {
    return new BackupError(
      "RESTORE_GATE_REQUIRED",
      "ADLINKLAB_BACKUP_ALLOW_RESTORE=1 is required for seeded depth restore-test (do not persist)"
    );
  }

  // Reuse existing restore safety (allow flag, source≠restore, production-named restore blocked).
  // Lab may seed a source DB whose name equals ADLINKLAB_BACKUP_PRODUCTION_DATABASE;
  // that flag protects the restore target, not the lab source seed.
  try {
    assertSafeRestoreTarget(source, restore, env);
  } catch (error) {
    if (error instanceof BackupError) {
      if (error.code === "RESTORE_NOT_ALLOWED") {
        return new BackupError("RESTORE_GATE_REQUIRED", error.message);
      }
      if (error.code === "RESTORE_TARGET_IS_PRODUCTION") {
        return new BackupError("SOURCE_RESTORE_TARGET_COLLISION", error.message);
      }
      return error;
    }
    return new BackupError("RESTORE_TARGET_INVALID", String(error));
  }

  return null;
}

/**
 * Run the LAB/CI seeded restore depth gate.
 * Returns a machine-readable result; does not write secrets or .env files.
 */
export async function runSeededRestoreDepthGate(
  options: SeededRestoreDepthGateOptions
): Promise<SeededRestoreDepthGateResult> {
  const runId = randomUUID();
  const env = { ...(options.env ?? process.env) };
  const cwd = options.cwd ?? process.cwd();

  const base: Partial<SeededRestoreDepthGateResult> = { runId };
  const redact = buildGateRedactor([
    options.sourceConnectionString ?? "",
    options.restoreConnectionString ?? "",
  ]);
  const fail = (
    partial: Partial<SeededRestoreDepthGateResult>,
    stage: Exclude<SeededDepthGateFailedStage, null>,
    code: string,
    message: string
  ) => failResult(partial, stage, code, message, redact);

  const configError = validateGateConfig(options, env);
  if (configError) {
    return fail(base, "config", configError.code, configError.message);
  }

  const sourceUrl = options.sourceConnectionString.trim();
  const restoreUrl = options.restoreConnectionString.trim();

  // Process-local only — never persist allow-restore into repo/.env.
  env.DATABASE_URL = sourceUrl;
  env.ADLINKLAB_BACKUP_RESTORE_DATABASE_URL = restoreUrl;
  env.ADLINKLAB_BACKUP_ALLOW_RESTORE = "1";

  const usingInjectedRunners = Boolean(
    options.createBackup && options.verifyBackup && options.restoreVerify
  );
  const requireTools = options.requirePgTools !== false && !usingInjectedRunners;
  const tools =
    options.tools === undefined
      ? requireTools
        ? resolvePgTools(env)
        : null
      : options.tools;
  if (requireTools && !tools) {
    return fail(
      base,
      "config",
      "SOURCE_CONFIG_INVALID",
      "pg_dump/pg_restore not found — set ADLINKLAB_PG_BIN"
    );
  }

  const snapshot =
    options.snapshotDepth ??
    ((opts: { connectionString: string }) =>
      snapshotSeededRestoreDepth({ connectionString: opts.connectionString }));

  // --- prepare source (migrate + seed) ---
  if (!options.skipPrepareSource) {
    try {
      const prepare = options.prepareSource ?? defaultPrepareSeededDepthSource;
      await prepare({
        sourceConnectionString: sourceUrl,
        env,
        cwd,
      });
    } catch (error) {
      const code =
        error instanceof BackupError ? error.code : "FIXTURE_SEED_FAILED";
      const message =
        error instanceof Error ? error.message : "prepare source failed";
      return fail(base, "prepare_source", code, message);
    }
  }

  // --- source snapshot + D1–D10 ---
  let sourceBefore: SeededRestoreDepthSnapshot;
  try {
    sourceBefore = await snapshot({ connectionString: sourceUrl });
  } catch (error) {
    return fail(
      { ...base, source: { verification: "failed" } },
      "source_depth",
      "SOURCE_DEPTH_FAILED",
      error instanceof Error ? error.message : "source snapshot failed"
    );
  }

  const sourceEval = evaluateSeededRestoreDepth(sourceBefore);
  try {
    assertSeededRestoreDepth(sourceBefore);
  } catch (error) {
    return fail(
      {
        ...base,
        source: { verification: "failed" },
        depthVerification: {
          status: "failed",
          passedCount: sourceEval.passedCount,
          failedCount: sourceEval.failedCount,
          assertions: sourceEval.assertions,
        },
      },
      "source_depth",
      "SOURCE_DEPTH_FAILED",
      error instanceof Error ? error.message : "source depth failed"
    );
  }

  // --- backup create ---
  let backupMeta: BackupMetadata;
  try {
    const runCreate = options.createBackup ?? createBackup;
    const created = await runCreate({
      env,
      cwd,
      databaseUrl: sourceUrl,
      tools: tools ?? undefined,
    });
    backupMeta = created.metadata;
  } catch (error) {
    return fail(
      {
        ...base,
        source: { verification: "passed" },
        depthVerification: {
          status: "passed",
          passedCount: sourceEval.passedCount,
          failedCount: 0,
          assertions: sourceEval.assertions,
        },
      },
      "backup_create",
      "BACKUP_CREATE_FAILED",
      error instanceof Error ? error.message : "backup create failed"
    );
  }

  const backupDir = resolveBackupDir(env, cwd);
  const paths = pathsForBackupId(backupDir, backupMeta.backupId);
  const artifactInfo = {
    path: paths.artifactPath,
    sizeBytes: backupMeta.sizeBytes,
    sha256: backupMeta.sha256,
  };

  // --- backup verify ---
  try {
    const runVerify = options.verifyBackup ?? verifyBackup;
    backupMeta = await runVerify({
      backupId: backupMeta.backupId,
      env,
      cwd,
      tools: tools ?? undefined,
    });
  } catch (error) {
    return fail(
      {
        ...base,
        backupId: backupMeta.backupId,
        artifact: artifactInfo,
        source: { verification: "passed" },
      },
      "backup_verify",
      "BACKUP_VERIFY_FAILED",
      error instanceof Error ? error.message : "backup verify failed"
    );
  }

  // --- restore-test (existing isolated restoreVerify) ---
  let restoreResult: RestoreVerifyResult;
  try {
    const runRestore = options.restoreVerify ?? restoreVerify;
    restoreResult = await runRestore({
      backupId: backupMeta.backupId,
      env,
      cwd,
      sourceDatabaseUrl: sourceUrl,
      restoreDatabaseUrl: restoreUrl,
      tools: tools ?? undefined,
    });
  } catch (error) {
    return fail(
      {
        ...base,
        backupId: backupMeta.backupId,
        artifact: artifactInfo,
        source: { verification: "passed" },
      },
      "restore_test",
      "RESTORE_TEST_FAILED",
      error instanceof Error ? error.message : "restore-test failed"
    );
  }

  const shallow = restoreResult.dataVerification;
  // Shallow pass alone is NEVER overall success — depth must still pass.

  const restoreLayer = {
    schemaVerification: (restoreResult.schemaOk
      ? "passed"
      : "failed") as "passed" | "failed",
    migrationVerification: (restoreResult.migrationMetadataPresent
      ? "passed"
      : "failed") as "passed" | "failed",
    shallowDataVerification: shallow,
  };

  // --- restore depth D1–D10 ---
  let restoreSnap: SeededRestoreDepthSnapshot;
  try {
    restoreSnap = await snapshot({ connectionString: restoreUrl });
  } catch (error) {
    return fail(
      {
        ...base,
        backupId: backupMeta.backupId,
        artifact: artifactInfo,
        source: { verification: "passed" },
        restore: restoreLayer,
      },
      "restore_depth",
      "RESTORE_DEPTH_FAILED",
      error instanceof Error ? error.message : "restore snapshot failed"
    );
  }

  const restoreDepthEval = evaluateSeededRestoreDepth(restoreSnap);
  try {
    assertSeededRestoreDepth(restoreSnap);
  } catch (error) {
    return fail(
      {
        ...base,
        backupId: backupMeta.backupId,
        artifact: artifactInfo,
        source: { verification: "passed" },
        restore: restoreLayer,
        depthVerification: {
          status: "failed",
          passedCount: restoreDepthEval.passedCount,
          failedCount: restoreDepthEval.failedCount,
          assertions: restoreDepthEval.assertions,
        },
      },
      "restore_depth",
      "RESTORE_DEPTH_FAILED",
      error instanceof Error ? error.message : "restore depth failed"
    );
  }

  // --- D11 source vs restore ---
  const withD11 = evaluateSeededRestoreDepthWithSourceCompare(
    sourceBefore,
    restoreSnap
  );
  const d11 = withD11.assertions.find((a) => a.id === "D11");
  if (!d11 || d11.status !== "passed") {
    return fail(
      {
        ...base,
        backupId: backupMeta.backupId,
        artifact: artifactInfo,
        source: { verification: "passed" },
        restore: restoreLayer,
        depthVerification: {
          status: restoreDepthEval.status,
          passedCount: restoreDepthEval.passedCount,
          failedCount: restoreDepthEval.failedCount,
          assertions: withD11.assertions,
        },
        sourceComparison: {
          status: "failed",
          restoredDataMatchesSource: false,
        },
      },
      "source_compare",
      "SOURCE_COMPARE_FAILED",
      d11?.message ?? "source vs restore depth snapshot mismatch (D11)"
    );
  }

  // --- source unchanged after restore ---
  let sourceAfter: SeededRestoreDepthSnapshot;
  try {
    sourceAfter = await snapshot({ connectionString: sourceUrl });
  } catch (error) {
    return fail(
      {
        ...base,
        backupId: backupMeta.backupId,
        artifact: artifactInfo,
        source: { verification: "passed" },
        restore: restoreLayer,
        depthVerification: {
          status: "passed",
          passedCount: withD11.passedCount,
          failedCount: 0,
          assertions: withD11.assertions,
        },
        sourceComparison: {
          status: "passed",
          restoredDataMatchesSource: true,
        },
      },
      "source_unchanged",
      "SOURCE_MUTATED",
      error instanceof Error
        ? error.message
        : "failed to re-snapshot source after restore"
    );
  }

  if (!snapshotsEqual(sourceBefore, sourceAfter)) {
    const cmp = compareSeededRestoreDepthSnapshots(sourceBefore, sourceAfter);
    return fail(
      {
        ...base,
        backupId: backupMeta.backupId,
        artifact: artifactInfo,
        source: { verification: "passed" },
        restore: restoreLayer,
        depthVerification: {
          status: "passed",
          passedCount: withD11.passedCount,
          failedCount: 0,
          assertions: withD11.assertions,
        },
        sourceComparison: {
          status: "passed",
          restoredDataMatchesSource: true,
        },
        sourceUnchanged: false,
      },
      "source_unchanged",
      "SOURCE_MUTATED",
      cmp.message ?? "source depth snapshot changed after restore-test"
    );
  }

  return {
    scope: SEEDED_DEPTH_GATE_SCOPE,
    runId,
    backupId: backupMeta.backupId,
    fixtureVersion: SEEDED_RESTORE_DEPTH_FIXTURE_VERSION,
    artifact: artifactInfo,
    source: { verification: "passed" },
    restore: restoreLayer,
    depthVerification: {
      status: "passed",
      passedCount: withD11.passedCount,
      failedCount: 0,
      assertions: withD11.assertions,
    },
    sourceComparison: {
      status: "passed",
      restoredDataMatchesSource: true,
    },
    sourceUnchanged: true,
    overallStatus: "passed",
    failedStage: null,
    errorCode: null,
    errorMessage: null,
    timestamp: new Date().toISOString(),
  };
}
