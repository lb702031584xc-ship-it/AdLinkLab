import { randomUUID } from "node:crypto";
import type {
  AdRepository,
  SyncJobRepository,
  UnitOfWork,
  UrlChangeRequest,
  UrlChangeRequestRepository,
  UrlEntityType,
  UrlVersion,
  UrlVersionRepository,
} from "@adlinklab/domain";
import {
  assertUrlChangeRequestTransition,
  assertUrlVersionTransition,
  AuditActions,
} from "@adlinklab/domain";
import type { GoogleAdsProvider } from "@adlinklab/google-ads";
import {
  ConflictError,
  createIdempotencyKey,
  NotFoundError,
  ValidationError,
} from "@adlinklab/shared";
import {
  assertValidUrlVersionFields,
  ServingUrlResolver,
  validateUrlVersionFields,
} from "@adlinklab/tracking";
import { processIdempotentJob } from "../queue/jobs.js";
import {
  mutationLockKey,
  withMutationLock,
} from "../queue/execution-guard.js";
import { classifyJobError } from "../queue/retry-policy.js";
import type { JobProducer } from "../queue/producer.js";

export interface UrlChangeAuditWriter {
  recordUrlChange(input: {
    action?: string;
    tenantId?: string;
    entityType: UrlEntityType;
    entityId: string;
    fromVersion?: number;
    toVersion?: number;
    requestedBy: string;
    jobId?: string;
    status: string;
    error?: string;
    changeRequestId?: string;
    afterExtra?: Record<string, unknown>;
  }): Promise<unknown> | unknown;
}

const URL_CHANGE_SCOPE = "URL_CHANGE";
const ROLLBACK_REASON_PREFIX = "rollback:";

export function isRollbackReason(reason: string): boolean {
  return reason.startsWith(ROLLBACK_REASON_PREFIX);
}

export function buildRollbackReason(input: {
  ofVersionId: string;
  restoreVersionId: string;
}): string {
  return `${ROLLBACK_REASON_PREFIX}of=${input.ofVersionId};restore=${input.restoreVersionId}`;
}

type UrlFields = {
  finalUrl: string;
  finalMobileUrl?: string;
  finalAppUrl?: string;
  trackingTemplate?: string;
  customParameters: Record<string, string>;
};

function pickUrlFields(v: UrlVersion): UrlFields {
  return {
    finalUrl: v.finalUrl,
    finalMobileUrl: v.finalMobileUrl,
    finalAppUrl: v.finalAppUrl,
    trackingTemplate: v.trackingTemplate,
    customParameters: v.customParameters,
  };
}

function diffUrlFields(current: UrlFields | null, proposed: UrlFields): string[] {
  const keys: (keyof UrlFields)[] = [
    "finalUrl",
    "finalMobileUrl",
    "finalAppUrl",
    "trackingTemplate",
    "customParameters",
  ];
  const changed: string[] = [];
  for (const key of keys) {
    const a = current?.[key];
    const b = proposed[key];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) {
      changed.push(key);
    }
  }
  return changed;
}

/**
 * URL Change workflow (Phase 6):
 * Create → Validate → Preview → Queue → Provider → Result → Audit
 * Direct ad URL mutation is forbidden; all provider pushes go through UrlChangeRequest.
 */
export class UrlChangeRequestService {
  private readonly serving = new ServingUrlResolver();

  constructor(
    private readonly changeRequests: UrlChangeRequestRepository,
    private readonly urlVersions: UrlVersionRepository,
    private readonly ads: AdRepository,
    private readonly provider: GoogleAdsProvider,
    private readonly audit: UrlChangeAuditWriter,
    private readonly unitOfWork?: UnitOfWork,
    private readonly syncJobs?: SyncJobRepository,
    private readonly jobProducer?: JobProducer
  ) {}

  list(tenantId?: string, page?: number, pageSize?: number) {
    return this.changeRequests.list({ tenantId, page, pageSize });
  }

  async getById(tenantId: string, id: string): Promise<UrlChangeRequest> {
    const request = await this.changeRequests.findByIdForTenant(tenantId, id);
    if (!request) throw new NotFoundError("UrlChangeRequest", id);
    return request;
  }

  async create(input: {
    tenantId?: string;
    entityType: UrlEntityType;
    entityId: string;
    toVersionId: string;
    reason: string;
    requestedBy: string;
    idempotencyKey?: string;
    scheduledAt?: Date;
  }) {
    const toVersion = await this.urlVersions.findById(input.toVersionId);
    if (!toVersion) throw new NotFoundError("UrlVersion", input.toVersionId);
    if (
      toVersion.entityType !== input.entityType ||
      toVersion.entityId !== input.entityId
    ) {
      throw new ValidationError("toVersion does not match entity", {
        entityType: input.entityType,
        entityId: input.entityId,
        toVersionId: input.toVersionId,
      });
    }
    if (input.tenantId && input.tenantId !== toVersion.tenantId) {
      throw new NotFoundError("UrlVersion", input.toVersionId);
    }

    const idempotencyKey =
      input.idempotencyKey ??
      createIdempotencyKey(
        "urlChange",
        input.entityType,
        input.entityId,
        input.toVersionId,
        input.requestedBy
      );

    const existing = await this.changeRequests.findByIdempotencyKey(
      toVersion.tenantId,
      URL_CHANGE_SCOPE,
      idempotencyKey
    );
    if (existing) {
      return { request: existing, created: false };
    }

    const fromVersion = await this.urlVersions.findActiveByEntity(
      input.entityType,
      input.entityId
    );

    const request = await this.changeRequests.create({
      id: randomUUID(),
      tenantId: toVersion.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      fromVersionId: fromVersion?.id,
      toVersionId: input.toVersionId,
      reason: input.reason,
      requestedBy: input.requestedBy,
      status: "DRAFT",
      idempotencyScope: URL_CHANGE_SCOPE,
      idempotencyKey,
      scheduledAt: input.scheduledAt,
    });

    await this.audit.recordUrlChange({
      action: AuditActions.URL_CHANGE_REQUEST_CREATED,
      tenantId: request.tenantId,
      entityType: request.entityType,
      entityId: request.entityId,
      fromVersion: fromVersion?.version,
      toVersion: toVersion.version,
      requestedBy: request.requestedBy,
      status: request.status,
      changeRequestId: request.id,
    });

    return { request, created: true };
  }

  async validate(tenantId: string, requestId: string) {
    const request = await this.getById(tenantId, requestId);
    if (request.status !== "DRAFT" && request.status !== "FAILED") {
      throw new ConflictError("Only DRAFT/FAILED requests can be validated", {
        status: request.status,
      });
    }
    assertUrlChangeRequestTransition(
      request.status === "FAILED" ? "FAILED" : "DRAFT",
      "VALIDATED"
    );

    const toVersion = await this.urlVersions.findByIdForTenant(
      tenantId,
      request.toVersionId
    );
    if (!toVersion) throw new NotFoundError("UrlVersion", request.toVersionId);

    assertValidUrlVersionFields({
      finalUrl: toVersion.finalUrl,
      finalMobileUrl: toVersion.finalMobileUrl,
      finalAppUrl: toVersion.finalAppUrl,
      trackingTemplate: toVersion.trackingTemplate,
      customParameters: toVersion.customParameters,
    });

    if (request.entityType === "AD") {
      const ad = await this.ads.findById(request.entityId);
      if (!ad || ad.tenantId !== tenantId) {
        throw new NotFoundError("Ad", request.entityId);
      }
      if (!ad.googleAdId) {
        throw new ValidationError("Ad missing googleAdId for provider update");
      }
    }

    const updated = await this.changeRequests.update(request.id, {
      status: "VALIDATED",
      error: undefined,
    });

    await this.audit.recordUrlChange({
      action: AuditActions.URL_CHANGE_REQUEST_VALIDATED,
      tenantId: updated.tenantId,
      entityType: updated.entityType,
      entityId: updated.entityId,
      toVersion: toVersion.version,
      requestedBy: updated.requestedBy,
      status: updated.status,
      changeRequestId: updated.id,
    });

    return updated;
  }

  async preview(tenantId: string, requestId: string) {
    const request = await this.getById(tenantId, requestId);
    const toVersion = await this.urlVersions.findByIdForTenant(
      tenantId,
      request.toVersionId
    );
    if (!toVersion) throw new NotFoundError("UrlVersion", request.toVersionId);

    const fromVersion = request.fromVersionId
      ? await this.urlVersions.findByIdForTenant(tenantId, request.fromVersionId)
      : null;

    const current = fromVersion ? pickUrlFields(fromVersion) : null;
    const proposed = pickUrlFields(toVersion);
    const validation = validateUrlVersionFields(proposed);
    const changedFields = diffUrlFields(current, proposed);

    const servingPreview = this.serving.resolveServingUrl({
      levels: [
        {
          entityType: toVersion.entityType,
          entityId: toVersion.entityId,
          config: {
            finalUrl: toVersion.finalUrl,
            finalMobileUrl: toVersion.finalMobileUrl,
            finalAppUrl: toVersion.finalAppUrl,
            trackingTemplate: toVersion.trackingTemplate,
            customParameters: toVersion.customParameters,
          },
        },
      ],
    });

    return {
      request,
      entity: {
        tenantId: request.tenantId,
        entityType: request.entityType,
        entityId: request.entityId,
      },
      current,
      proposed,
      changedFields,
      validation,
      fromVersion,
      toVersion,
      /** @deprecated use servingPreview */
      preview: servingPreview,
      servingPreview,
    };
  }

  async queue(tenantId: string, requestId: string, jobId?: string) {
    const request = await this.getById(tenantId, requestId);
    if (
      request.status === "QUEUED" ||
      request.status === "RUNNING" ||
      request.status === "SUCCEEDED"
    ) {
      return request;
    }

    if (request.status !== "VALIDATED") {
      throw new ConflictError("Request must be VALIDATED before queue", {
        status: request.status,
      });
    }
    assertUrlChangeRequestTransition("VALIDATED", "QUEUED");

    const resolvedJobId = jobId ?? `urlChange:${request.idempotencyKey}`;

    let syncJobId: string | undefined;
    if (this.syncJobs) {
      const existingJob = await this.syncJobs.findByIdempotencyKey(
        tenantId,
        "SYNC_JOB",
        request.idempotencyKey
      );
      if (!existingJob) {
        const created = await this.syncJobs.create({
          id: randomUUID(),
          tenantId,
          type: "urlChange",
          status: "PENDING",
          provider: "mock",
          idempotencyScope: "SYNC_JOB",
          idempotencyKey: request.idempotencyKey,
          jobId: resolvedJobId,
          payload: {
            requestId: request.id,
            tenantId,
            idempotencyKey: request.idempotencyKey,
          },
          attempts: 0,
        });
        syncJobId = created.id;
      } else {
        syncJobId = existingJob.id;
      }
    }

    const updated = await this.changeRequests.update(request.id, {
      status: "QUEUED",
      jobId: resolvedJobId,
    });

    await this.audit.recordUrlChange({
      action: AuditActions.URL_CHANGE_REQUEST_QUEUED,
      tenantId: updated.tenantId,
      entityType: updated.entityType,
      entityId: updated.entityId,
      requestedBy: updated.requestedBy,
      status: updated.status,
      jobId: updated.jobId,
      changeRequestId: updated.id,
    });

    if (this.jobProducer) {
      await this.jobProducer.enqueueUrlChange({
        type: "urlChange",
        tenantId,
        requestId: updated.id,
        idempotencyKey: request.idempotencyKey,
        jobId: resolvedJobId,
        syncJobId,
      });
    }

    return updated;
  }

  /**
   * Process a queued URL change via SyncJob idempotency helper (Worker entry).
   */
  async processQueued(tenantId: string, requestId: string) {
    if (!this.syncJobs) {
      return this.execute(tenantId, requestId);
    }
    const request = await this.getById(tenantId, requestId);
    const result = await processIdempotentJob(this.syncJobs, {
      type: "urlChange",
      jobId: request.jobId ?? `urlChange:${request.idempotencyKey}`,
      idempotencyKey: request.idempotencyKey,
      tenantId,
      payload: {
        requestId,
        tenantId,
        idempotencyKey: request.idempotencyKey,
      },
      handler: async () => {
        const exec = await this.execute(tenantId, requestId);
        if (exec.request.status === "FAILED") {
          throw new Error(exec.request.error ?? "URL change failed");
        }
      },
    });
    const latest = await this.getById(tenantId, requestId);
    return { request: latest, sync: result };
  }

  async cancel(tenantId: string, requestId: string) {
    const request = await this.getById(tenantId, requestId);
    if (
      request.status !== "DRAFT" &&
      request.status !== "VALIDATED" &&
      request.status !== "QUEUED"
    ) {
      throw new ConflictError("Request cannot be cancelled in current status", {
        status: request.status,
      });
    }
    assertUrlChangeRequestTransition(request.status, "CANCELLED");

    const updated = await this.changeRequests.update(request.id, {
      status: "CANCELLED",
    });

    await this.audit.recordUrlChange({
      action: AuditActions.URL_CHANGE_REQUEST_CANCELLED,
      tenantId: updated.tenantId,
      entityType: updated.entityType,
      entityId: updated.entityId,
      requestedBy: updated.requestedBy,
      status: updated.status,
      changeRequestId: updated.id,
    });

    return updated;
  }

  /**
   * Rollback a SUCCEEDED change: create new DRAFT version copying prior content,
   * then a new UrlChangeRequest. Does not delete history.
   */
  async rollback(
    tenantId: string,
    succeededRequestId: string,
    input: { requestedBy: string; idempotencyKey?: string; reason?: string }
  ) {
    const prior = await this.getById(tenantId, succeededRequestId);
    if (prior.status !== "SUCCEEDED") {
      throw new ConflictError("Only SUCCEEDED requests can be rolled back", {
        status: prior.status,
      });
    }
    if (!prior.fromVersionId) {
      throw new ValidationError("Cannot rollback: missing fromVersionId");
    }

    const restore = await this.urlVersions.findByIdForTenant(
      tenantId,
      prior.fromVersionId
    );
    if (!restore) {
      throw new NotFoundError("UrlVersion", prior.fromVersionId);
    }

    const rolledBack = await this.urlVersions.findByIdForTenant(
      tenantId,
      prior.toVersionId
    );
    if (!rolledBack) {
      throw new NotFoundError("UrlVersion", prior.toVersionId);
    }

    const draft = await this.createDraftVersionCopy(restore, input.requestedBy);

    const { request, created } = await this.create({
      tenantId,
      entityType: prior.entityType,
      entityId: prior.entityId,
      toVersionId: draft.id,
      reason:
        input.reason ??
        buildRollbackReason({
          ofVersionId: rolledBack.id,
          restoreVersionId: restore.id,
        }),
      requestedBy: input.requestedBy,
      idempotencyKey:
        input.idempotencyKey ??
        createIdempotencyKey(
          "urlChange",
          "rollback",
          succeededRequestId,
          draft.id,
          input.requestedBy
        ),
    });

    await this.audit.recordUrlChange({
      action: AuditActions.URL_CHANGE_REQUEST_ROLLED_BACK,
      tenantId,
      entityType: prior.entityType,
      entityId: prior.entityId,
      fromVersion: rolledBack.version,
      toVersion: draft.version,
      requestedBy: input.requestedBy,
      status: request.status,
      changeRequestId: request.id,
      afterExtra: {
        kind: "rollback",
        rollbackOfVersionId: rolledBack.id,
        restoreVersionId: restore.id,
        priorRequestId: succeededRequestId,
      },
    });

    return {
      request,
      created,
      draftVersion: draft,
      rollbackOfVersion: rolledBack,
      restoreVersion: restore,
    };
  }

  /**
   * Executes via GoogleAdsProvider (mock in Phase 6).
   * Retries with the same request after SUCCEEDED do not double-mutate.
   * Phase 8.3.3: when jobId is set, serializes with Worker via mutation lock.
   * Phase 8.3.4: opts.softRetry keeps RUNNING on retryable provider errors (Worker).
   */
  async execute(
    tenantId: string,
    requestId: string,
    opts?: { softRetry?: boolean }
  ) {
    const request = await this.getById(tenantId, requestId);

    if (request.status === "SUCCEEDED") {
      return { request, skipped: true as const };
    }

    if (request.status !== "QUEUED" && request.status !== "RUNNING") {
      throw new ConflictError("Request must be QUEUED before execute", {
        status: request.status,
      });
    }

    const jobId = request.jobId?.trim();
    if (jobId) {
      return withMutationLock(mutationLockKey(jobId), () =>
        this.executeLocked(tenantId, requestId, opts)
      );
    }
    return this.executeLocked(tenantId, requestId, opts);
  }

  private async executeLocked(
    tenantId: string,
    requestId: string,
    opts?: { softRetry?: boolean }
  ) {
    const request = await this.getById(tenantId, requestId);

    if (request.status === "SUCCEEDED") {
      return { request, skipped: true as const };
    }

    if (request.status !== "QUEUED" && request.status !== "RUNNING") {
      throw new ConflictError("Request must be QUEUED before execute", {
        status: request.status,
      });
    }

    if (request.status === "QUEUED") {
      assertUrlChangeRequestTransition("QUEUED", "RUNNING");
    }

    const running = await this.changeRequests.update(request.id, {
      status: "RUNNING",
    });

    await this.audit.recordUrlChange({
      action: AuditActions.URL_CHANGE_REQUEST_RUNNING,
      tenantId: running.tenantId,
      entityType: running.entityType,
      entityId: running.entityId,
      requestedBy: running.requestedBy,
      status: running.status,
      jobId: running.jobId,
      changeRequestId: running.id,
    });

    const toVersion = await this.urlVersions.findByIdForTenant(
      tenantId,
      running.toVersionId
    );
    if (!toVersion) throw new NotFoundError("UrlVersion", running.toVersionId);

    try {
      if (running.entityType === "AD") {
        const ad = await this.ads.findById(running.entityId);
        if (!ad || ad.tenantId !== tenantId) {
          throw new NotFoundError("Ad", running.entityId);
        }
        if (!ad.googleAdId) {
          throw new ValidationError("Ad missing googleAdId for provider update");
        }
        await this.provider.updateEntityUrl({
          entityType: "AD",
          adId: ad.googleAdId,
          finalUrl: toVersion.finalUrl,
          finalMobileUrl: toVersion.finalMobileUrl,
          finalAppUrl: toVersion.finalAppUrl,
          trackingTemplate: toVersion.trackingTemplate,
          customParameters: toVersion.customParameters,
        });
      } else {
        throw new ValidationError(
          "Provider mutation for this entityType is not enabled in Phase 6",
          { entityType: running.entityType }
        );
      }

      const applyLocal = async (
        urlVersions: UrlVersionRepository,
        changeRequests: UrlChangeRequestRepository
      ) => {
        const active = await urlVersions.findActiveByEntity(
          running.entityType,
          running.entityId
        );
        const rollback = isRollbackReason(running.reason);
        if (active && active.id !== toVersion.id) {
          const nextStatus = rollback ? "ROLLED_BACK" : "SUPERSEDED";
          assertUrlVersionTransition(active.status, nextStatus);
          await urlVersions.updateStatus(active.id, { status: nextStatus });
          await this.audit.recordUrlChange({
            action: rollback
              ? AuditActions.URL_VERSION_ROLLED_BACK
              : AuditActions.URL_VERSION_SUPERSEDED,
            tenantId,
            entityType: running.entityType,
            entityId: running.entityId,
            requestedBy: running.requestedBy,
            status: nextStatus,
            changeRequestId: running.id,
            afterExtra: { versionId: active.id, version: active.version },
          });
        }
        if (toVersion.status !== "ACTIVE") {
          assertUrlVersionTransition(toVersion.status, "ACTIVE");
          await urlVersions.updateStatus(toVersion.id, {
            status: "ACTIVE",
            effectiveAt: new Date(),
          });
          await this.audit.recordUrlChange({
            action: AuditActions.URL_VERSION_ACTIVATED,
            tenantId,
            entityType: running.entityType,
            entityId: running.entityId,
            requestedBy: running.requestedBy,
            status: "ACTIVE",
            changeRequestId: running.id,
            afterExtra: { versionId: toVersion.id, version: toVersion.version },
          });
        }

        assertUrlChangeRequestTransition("RUNNING", "SUCCEEDED");
        return changeRequests.update(running.id, {
          status: "SUCCEEDED",
          executedAt: new Date(),
          error: undefined,
        });
      };

      const succeeded = this.unitOfWork
        ? await this.unitOfWork.transaction((ctx) =>
            applyLocal(ctx.urlVersions, ctx.urlChangeRequests)
          )
        : await applyLocal(this.urlVersions, this.changeRequests);

      await this.audit.recordUrlChange({
        action: AuditActions.URL_CHANGE_REQUEST_SUCCEEDED,
        tenantId: succeeded.tenantId,
        entityType: succeeded.entityType,
        entityId: succeeded.entityId,
        toVersion: toVersion.version,
        requestedBy: succeeded.requestedBy,
        jobId: succeeded.jobId,
        status: succeeded.status,
        changeRequestId: succeeded.id,
      });

      return { request: succeeded, skipped: false as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const classified = classifyJobError(error);

      if (opts?.softRetry && classified.retryable) {
        // Stay RUNNING so BullMQ can re-enter execute without FSM detour.
        await this.changeRequests.update(running.id, {
          error: message,
        });
        throw error;
      }

      assertUrlChangeRequestTransition("RUNNING", "FAILED");
      const failed = await this.changeRequests.update(running.id, {
        status: "FAILED",
        error: message,
      });

      await this.audit.recordUrlChange({
        action: AuditActions.URL_CHANGE_REQUEST_FAILED,
        tenantId: failed.tenantId,
        entityType: failed.entityType,
        entityId: failed.entityId,
        requestedBy: failed.requestedBy,
        jobId: failed.jobId,
        status: failed.status,
        error: message,
        changeRequestId: failed.id,
      });

      throw error;
    }
  }

  private async createDraftVersionCopy(
    source: UrlVersion,
    createdBy: string
  ): Promise<UrlVersion> {
    const create = async (urlVersions: UrlVersionRepository) => {
      const version = await urlVersions.getNextVersion(
        source.entityType,
        source.entityId
      );
      return urlVersions.create({
        id: randomUUID(),
        tenantId: source.tenantId,
        entityType: source.entityType,
        entityId: source.entityId,
        adId: source.adId,
        offerId: source.offerId,
        finalUrl: source.finalUrl,
        finalMobileUrl: source.finalMobileUrl,
        finalAppUrl: source.finalAppUrl,
        trackingTemplate: source.trackingTemplate,
        customParameters: { ...source.customParameters },
        version,
        status: "DRAFT",
        createdBy,
      });
    };

    if (this.unitOfWork) {
      return this.unitOfWork.transaction((ctx) => create(ctx.urlVersions));
    }
    return create(this.urlVersions);
  }
}
