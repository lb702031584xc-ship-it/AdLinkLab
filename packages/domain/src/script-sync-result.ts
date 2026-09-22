/**
 * Phase 8.4.4 — Script Sync Result domain helpers.
 */
import { AppError, ValidationError } from "@adlinklab/shared";
import type { ScriptExecutionResult } from "./statuses.js";

export const SCRIPT_SYNC_RESULT_SCOPE = "SCRIPT_SYNC_RESULT" as const;

/** Stable conflict / outcome codes for Phase 8.4.4–8.4.5 clients */
export const ScriptSyncConflictCodes = {
  STALE_DESIRED: "STALE_DESIRED",
  VERSION_CONFLICT: "VERSION_CONFLICT",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  NO_ACTIVE_VERSION: "NO_ACTIVE_VERSION",
} as const;

export type ScriptSyncConflictCode =
  (typeof ScriptSyncConflictCodes)[keyof typeof ScriptSyncConflictCodes];

const IDEMPOTENCY_KEY_MAX = 128;

/** Scope idempotency per integration within tenant (DB unique is tenant+scope+key). */
export function buildScriptSyncIdempotencyKey(
  integrationId: string,
  clientKey: string
): string {
  return `${integrationId}:${clientKey}`;
}

export interface ScriptSyncResultRequestPayload {
  targetId: string;
  desiredVersion: number;
  result: ScriptExecutionResult;
  idempotencyKey: string;
}

export function assertScriptSyncResultPayload(
  input: Partial<ScriptSyncResultRequestPayload>
): ScriptSyncResultRequestPayload {
  if (!input.targetId || typeof input.targetId !== "string") {
    throw new ValidationError("targetId is required");
  }
  if (
    input.desiredVersion === undefined ||
    !Number.isInteger(input.desiredVersion) ||
    input.desiredVersion < 1
  ) {
    throw new ValidationError("desiredVersion must be a positive integer");
  }
  if (!input.idempotencyKey || typeof input.idempotencyKey !== "string") {
    throw new ValidationError("idempotencyKey is required");
  }
  if (input.idempotencyKey.length > IDEMPOTENCY_KEY_MAX) {
    throw new ValidationError("idempotencyKey exceeds maximum length", {
      max: IDEMPOTENCY_KEY_MAX,
    });
  }
  const result = input.result;
  if (
    result !== "SUCCESS" &&
    result !== "FAILED" &&
    result !== "PARTIAL" &&
    result !== "NO_CHANGE"
  ) {
    throw new ValidationError("result must be SUCCESS, FAILED, PARTIAL, or NO_CHANGE");
  }
  return {
    targetId: input.targetId,
    desiredVersion: input.desiredVersion,
    result,
    idempotencyKey: input.idempotencyKey,
  };
}

export function staleDesiredError(
  activeVersion: number | null,
  reportedVersion: number
): AppError {
  return new AppError(
    "Reported desiredVersion does not match the current ACTIVE UrlVersion.",
    {
      code: ScriptSyncConflictCodes.STALE_DESIRED,
      statusCode: 409,
      details: {
        activeVersion,
        reportedVersion,
      },
    }
  );
}

export function versionConflictError(
  appliedVersion: number | null,
  reportedVersion: number
): AppError {
  return new AppError(
    "Applied version cannot move backward for the reported desiredVersion.",
    {
      code: ScriptSyncConflictCodes.VERSION_CONFLICT,
      statusCode: 409,
      details: {
        appliedVersion,
        reportedVersion,
      },
    }
  );
}

export function idempotencyPayloadConflictError(): AppError {
  return new AppError("Idempotency key reused with different payload.", {
    code: ScriptSyncConflictCodes.IDEMPOTENCY_CONFLICT,
    statusCode: 409,
  });
}

export function scriptSyncPayloadFingerprint(
  payload: ScriptSyncResultRequestPayload
): string {
  return JSON.stringify({
    targetId: payload.targetId,
    desiredVersion: payload.desiredVersion,
    result: payload.result,
  });
}

export function logMatchesPayload(
  log: {
    targetId: string;
    desiredVersion: number;
    result: ScriptExecutionResult;
  },
  payload: ScriptSyncResultRequestPayload
): boolean {
  return (
    log.targetId === payload.targetId &&
    log.desiredVersion === payload.desiredVersion &&
    log.result === payload.result
  );
}

export function deriveSyncState(
  appliedVersion: number | null | undefined,
  activeVersion: number | null
): "SYNCED" | "OUT_OF_SYNC" | "NEVER_APPLIED" {
  if (appliedVersion == null) return "NEVER_APPLIED";
  if (activeVersion == null) return "OUT_OF_SYNC";
  return appliedVersion === activeVersion ? "SYNCED" : "OUT_OF_SYNC";
}
