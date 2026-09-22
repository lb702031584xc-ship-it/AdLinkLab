/**
 * Phase 8.4.4 / 8.4.5 / 9.5 — Script Sync Result + Applied State.
 * Desired Authority: ACTIVE UrlVersion (re-queried in transaction).
 * Mutates appliedVersion + ScriptSyncLog (+ optional AuditLog). Never ACTIVE / never target.desiredVersion authority.
 */
import { randomUUID } from "node:crypto";
import type { ScriptSyncLog, ScriptSyncTarget } from "@adlinklab/domain";
import {
  AuditActions,
  SCRIPT_SYNC_RESULT_SCOPE,
  ScriptSyncConflictCodes,
  assertScriptSyncTargetAdOnly,
  assertScriptSyncResultPayload,
  buildScriptSyncIdempotencyKey,
  deriveSyncState,
  idempotencyPayloadConflictError,
  logMatchesPayload,
  staleDesiredError,
  versionConflictError,
  type ScriptSyncResultRequestPayload,
} from "@adlinklab/domain";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@adlinklab/shared";
import type { IntegrationAuthContext } from "../auth/integration-auth.js";
import type { ScriptSyncTransactionRunner } from "@adlinklab/database";
import type { AuditService } from "./index.js";

export type ScriptSyncResultStatus = "APPLIED" | "ALREADY_APPLIED" | "RECORDED";

export interface ScriptSyncResultResponse {
  ok: true;
  targetId: string;
  desiredVersion: number;
  appliedVersion: number | null;
  status: ScriptSyncResultStatus;
}

type TxOutcome =
  | { kind: "ok"; response: ScriptSyncResultResponse; replayed: boolean }
  | { kind: "reject"; error: AppError };

export class ScriptSyncResultService {
  constructor(
    private readonly runner: ScriptSyncTransactionRunner,
    private readonly audit?: AuditService
  ) {}

  async submitResult(
    ctx: IntegrationAuthContext,
    raw: Partial<ScriptSyncResultRequestPayload>
  ): Promise<ScriptSyncResultResponse> {
    const payload = assertScriptSyncResultPayload(raw);
    const storageKey = buildScriptSyncIdempotencyKey(
      ctx.integrationId,
      payload.idempotencyKey
    );

    const run = async (): Promise<TxOutcome> =>
      this.runner.transaction(async (repos): Promise<TxOutcome> => {
      const existingLog = await repos.scriptSyncLogs.findByIdempotencyKey(
        ctx.tenantId,
        SCRIPT_SYNC_RESULT_SCOPE,
        storageKey
      );
      if (existingLog) {
        try {
          return {
            kind: "ok",
            response: this.handleIdempotentReplay(existingLog, payload, ctx),
            replayed: true,
          };
        } catch (error) {
          if (error instanceof AppError) {
            return { kind: "reject", error };
          }
          throw error;
        }
      }

      const target = await repos.scriptSyncTargets.findByIdForIntegration(
        ctx.tenantId,
        ctx.integrationId,
        payload.targetId
      );
      if (!target) {
        throw new NotFoundError("ScriptSyncTarget", payload.targetId);
      }

      try {
        assertScriptSyncTargetAdOnly(target.entityType);
      } catch {
        throw new ValidationError("ScriptSyncTarget entityType must be AD");
      }

      const ad = await repos.ads.findByIdForTenant(
        ctx.tenantId,
        target.entityId
      );
      if (!ad) {
        throw new NotFoundError("Ad", target.entityId);
      }

      const active = await repos.urlVersions.findActiveByEntity("AD", ad.id);
      const activeForTenant =
        active && active.tenantId === ctx.tenantId && active.status === "ACTIVE"
          ? active
          : null;

      const activeVersion = activeForTenant?.version ?? null;

      if (activeVersion === null) {
        await this.appendLog(repos, ctx, target, payload, {
          errorCode: ScriptSyncConflictCodes.NO_ACTIVE_VERSION,
          errorMessage: "No ACTIVE UrlVersion for target Ad",
        });
        return {
          kind: "reject",
          error: staleDesiredError(null, payload.desiredVersion),
        };
      }

      if (payload.desiredVersion !== activeVersion) {
        await this.appendLog(repos, ctx, target, payload, {
          errorCode: ScriptSyncConflictCodes.STALE_DESIRED,
          errorMessage:
            "Reported desiredVersion does not match current ACTIVE UrlVersion",
        });
        return {
          kind: "reject",
          error: staleDesiredError(activeVersion, payload.desiredVersion),
        };
      }

      if (
        target.appliedVersion !== undefined &&
        target.appliedVersion > payload.desiredVersion
      ) {
        await this.appendLog(repos, ctx, target, payload, {
          errorCode: ScriptSyncConflictCodes.VERSION_CONFLICT,
          errorMessage: "Applied version cannot move backward",
        });
        return {
          kind: "reject",
          error: versionConflictError(
            target.appliedVersion,
            payload.desiredVersion
          ),
        };
      }

      const now = new Date();
      let updatedTarget: ScriptSyncTarget = target;
      let status: ScriptSyncResultStatus = "RECORDED";

      if (payload.result === "SUCCESS") {
        const activeAfter = await repos.urlVersions.findActiveByEntity(
          "AD",
          ad.id
        );
        const activeVersionAfter =
          activeAfter &&
          activeAfter.tenantId === ctx.tenantId &&
          activeAfter.status === "ACTIVE"
            ? activeAfter.version
            : null;
        if (activeVersionAfter !== payload.desiredVersion) {
          await this.appendLog(repos, ctx, target, payload, {
            errorCode: ScriptSyncConflictCodes.STALE_DESIRED,
            errorMessage:
              "ACTIVE UrlVersion changed during sync-result transaction",
          });
          return {
            kind: "reject",
            error: staleDesiredError(activeVersionAfter, payload.desiredVersion),
          };
        }

        const cas = await repos.scriptSyncTargets.compareAndSetAppliedVersion({
          tenantId: ctx.tenantId,
          integrationId: ctx.integrationId,
          targetId: payload.targetId,
          // Accepted applied candidate (= ACTIVE); does not write desiredVersion column.
          desiredVersion: payload.desiredVersion,
          lastExecution: payload.result,
          syncState: deriveSyncState(payload.desiredVersion, activeVersionAfter),
          lastSyncAt: now,
          lastSuccessAt: now,
        });
        updatedTarget = cas.target;
        status = cas.updated ? "APPLIED" : "ALREADY_APPLIED";
      } else {
        updatedTarget = await repos.scriptSyncTargets.update(payload.targetId, {
          lastExecution: payload.result,
          syncState: deriveSyncState(target.appliedVersion, activeVersion),
          lastSyncAt: now,
        });
        status = "RECORDED";
      }

      try {
        await this.appendLog(repos, ctx, updatedTarget, payload);
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error;
        const raced = await repos.scriptSyncLogs.findByIdempotencyKey(
          ctx.tenantId,
          SCRIPT_SYNC_RESULT_SCOPE,
          storageKey
        );
        if (!raced) throw error;
        return {
          kind: "ok",
          response: this.handleIdempotentReplay(raced, payload, ctx),
          replayed: true,
        };
      }

      return {
        kind: "ok",
        response: {
          ok: true,
          targetId: payload.targetId,
          desiredVersion: payload.desiredVersion,
          appliedVersion: updatedTarget.appliedVersion ?? null,
          status,
        },
        replayed: false,
      };
    });

    let outcome: TxOutcome | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        outcome = await run();
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (!(error instanceof ConflictError)) throw error;
        const raced = await this.runner.transaction(async (repos) =>
          repos.scriptSyncLogs.findByIdempotencyKey(
            ctx.tenantId,
            SCRIPT_SYNC_RESULT_SCOPE,
            storageKey
          )
        );
        if (raced) {
          try {
            outcome = {
              kind: "ok",
              response: this.handleIdempotentReplay(raced, payload, ctx),
              replayed: true,
            };
            lastError = undefined;
            break;
          } catch (replayError) {
            if (replayError instanceof AppError) {
              outcome = { kind: "reject", error: replayError };
              lastError = undefined;
              break;
            }
            throw replayError;
          }
        }
        // Lost race before winner committed log — retry.
      }
    }
    if (!outcome) {
      throw lastError instanceof Error
        ? lastError
        : new ConflictError("Script sync-result concurrent conflict");
    }

    if (outcome.kind === "reject") {
      await this.safeAudit(ctx, {
        action: AuditActions.SCRIPT_SYNC_RESULT_REJECTED,
        targetId: payload.targetId,
        desiredVersion: payload.desiredVersion,
        result: payload.result,
        errorCode: outcome.error.code,
      });
      throw outcome.error;
    }

    await this.safeAudit(ctx, {
      action: outcome.replayed
        ? AuditActions.SCRIPT_SYNC_RESULT_IDEMPOTENT_REPLAY
        : outcome.response.status === "RECORDED"
          ? AuditActions.SCRIPT_SYNC_RESULT_RECORDED
          : AuditActions.SCRIPT_SYNC_RESULT_APPLIED,
      targetId: outcome.response.targetId,
      desiredVersion: outcome.response.desiredVersion,
      appliedVersion: outcome.response.appliedVersion,
      status: outcome.response.status,
      result: payload.result,
    });

    return outcome.response;
  }

  private handleIdempotentReplay(
    existingLog: ScriptSyncLog,
    payload: ScriptSyncResultRequestPayload,
    ctx: IntegrationAuthContext
  ): ScriptSyncResultResponse {
    if (existingLog.integrationId !== ctx.integrationId) {
      throw idempotencyPayloadConflictError();
    }
    if (!logMatchesPayload(existingLog, payload)) {
      throw idempotencyPayloadConflictError();
    }

    if (existingLog.errorCode === ScriptSyncConflictCodes.STALE_DESIRED) {
      throw staleDesiredError(null, payload.desiredVersion);
    }
    if (existingLog.errorCode === ScriptSyncConflictCodes.VERSION_CONFLICT) {
      throw versionConflictError(
        existingLog.reportedAppliedVersion ?? null,
        payload.desiredVersion
      );
    }
    if (existingLog.errorCode === ScriptSyncConflictCodes.NO_ACTIVE_VERSION) {
      throw staleDesiredError(null, payload.desiredVersion);
    }

    const appliedVersion =
      existingLog.result === "SUCCESS"
        ? existingLog.desiredVersion
        : (existingLog.reportedAppliedVersion ?? null);

    return {
      ok: true,
      targetId: existingLog.targetId,
      desiredVersion: existingLog.desiredVersion,
      appliedVersion,
      status:
        existingLog.result === "SUCCESS" ? "ALREADY_APPLIED" : "RECORDED",
    };
  }

  private async appendLog(
    repos: {
      scriptSyncLogs: {
        create: (
          data: Omit<ScriptSyncLog, "createdAt"> & { createdAt?: Date }
        ) => Promise<ScriptSyncLog>;
      };
    },
    ctx: IntegrationAuthContext,
    target: ScriptSyncTarget,
    payload: ScriptSyncResultRequestPayload,
    rejection?: { errorCode: string; errorMessage: string }
  ): Promise<ScriptSyncLog> {
    const storageKey = buildScriptSyncIdempotencyKey(
      ctx.integrationId,
      payload.idempotencyKey
    );
    return repos.scriptSyncLogs.create({
      id: randomUUID(),
      tenantId: ctx.tenantId,
      integrationId: ctx.integrationId,
      targetId: payload.targetId,
      desiredVersion: payload.desiredVersion,
      reportedAppliedVersion: target.appliedVersion,
      result: payload.result,
      errorCode: rejection?.errorCode,
      errorMessage: rejection?.errorMessage,
      idempotencyScope: SCRIPT_SYNC_RESULT_SCOPE,
      idempotencyKey: storageKey,
    });
  }

  /** Best-effort AuditLog — never include token / Authorization / pepper. */
  private async safeAudit(
    ctx: IntegrationAuthContext,
    metadata: Record<string, unknown>
  ): Promise<void> {
    if (!this.audit) return;
    try {
      await this.audit.record({
        tenantId: ctx.tenantId,
        actorId: ctx.tokenKeyId,
        action: String(metadata.action),
        entityType: "ScriptSyncTarget",
        entityId:
          typeof metadata.targetId === "string" ? metadata.targetId : undefined,
        resourceType: "ScriptSyncTarget",
        resourceId:
          typeof metadata.targetId === "string" ? metadata.targetId : undefined,
        after: {
          integrationId: ctx.integrationId,
          googleAccountId: ctx.googleAccountId,
          tokenKeyId: ctx.tokenKeyId,
          ...metadata,
        },
      });
    } catch {
      // Audit must not break sync-result.
    }
  }
}
