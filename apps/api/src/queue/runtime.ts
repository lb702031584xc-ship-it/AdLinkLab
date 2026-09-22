import { Worker, type ConnectionOptions, type Job } from "bullmq";
import type { SyncJob, SyncJobRepository } from "@adlinklab/domain";
import type { OrderConversionService } from "../services/conversion-order.js";
import type { UrlChangeRequestService } from "../services/url-change-engine.js";
import {
  createRedisConnection,
  QUEUE_NAMES,
} from "./jobs.js";
import type {
  AdLinkLabJobData,
  ConversionUploadJobData,
  UrlChangeJobData,
} from "./job-data.js";
import { processConversionUploadJob } from "./conversion-upload-worker.js";
import { processUrlChangeJob } from "./url-change-worker.js";
import {
  getJobDefinition,
  throwTerminalForBullMq,
  type ProcessorRetryContext,
} from "./retry-policy.js";

export type WorkerStatus = "stopped" | "running";

export interface WorkerHealth {
  enabled: boolean;
  status: WorkerStatus;
}

export class WorkerJobError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WorkerJobError";
    this.code = code;
  }
}

export interface WorkerRuntimeDeps {
  syncJobs: SyncJobRepository;
  urlChangeRequests: UrlChangeRequestService;
  orderConversions: OrderConversionService;
  /** Optional logger — defaults to console. */
  log?: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

export interface WorkerLike {
  close(force?: boolean): Promise<void>;
}

export interface WorkerRuntimeOptions {
  connection?: ConnectionOptions;
  /**
   * Inject workers (unit tests). When omitted, start() creates BullMQ Workers.
   * Importing this module never opens Redis — only start() does.
   */
  createWorkers?: (handlers: {
    urlChange: (job: Job<UrlChangeJobData>) => Promise<unknown>;
    conversionUpload: (
      job: Job<ConversionUploadJobData>
    ) => Promise<unknown>;
    connection: ConnectionOptions;
  }) => WorkerLike[];
  /** Graceful close wait (ms). BullMQ close waits for active jobs. */
  closeTimeoutMs?: number;
}

const defaultLog = {
  info: (msg: string, meta?: Record<string, unknown>) => {
    if (meta) console.log(`[worker] ${msg}`, meta);
    else console.log(`[worker] ${msg}`);
  },
  error: (msg: string, meta?: Record<string, unknown>) => {
    if (meta) console.error(`[worker] ${msg}`, meta);
    else console.error(`[worker] ${msg}`);
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function retryContextFromBullJob(
  job: Job,
  type: "urlChange" | "conversionUpload"
): ProcessorRetryContext {
  const defAttempts = getJobDefinition(type)?.defaultAttempts ?? 3;
  const maxAttempts =
    typeof job.opts.attempts === "number" && job.opts.attempts > 0
      ? job.opts.attempts
      : defAttempts;
  return {
    softRetryEnabled: true,
    attemptsMade: job.attemptsMade ?? 0,
    maxAttempts,
  };
}

/**
 * Phase 8.3.2/8.3.4 — BullMQ Worker runtime (urlChange + conversionUpload).
 * Does not open Redis until start(). Retry classification via retry-policy.ts.
 */
export class WorkerRuntime {
  private status: WorkerStatus = "stopped";
  private workers: WorkerLike[] = [];
  private readonly log: NonNullable<WorkerRuntimeDeps["log"]>;
  private readonly closeTimeoutMs: number;
  private readonly connection: ConnectionOptions;
  private readonly createWorkers: NonNullable<WorkerRuntimeOptions["createWorkers"]>;

  constructor(
    private readonly deps: WorkerRuntimeDeps,
    options: WorkerRuntimeOptions = {}
  ) {
    this.log = deps.log ?? defaultLog;
    this.closeTimeoutMs = options.closeTimeoutMs ?? 30_000;
    this.connection = options.connection ?? createRedisConnection();
    this.createWorkers =
      options.createWorkers ??
      ((handlers) => [
        new Worker<UrlChangeJobData>(
          QUEUE_NAMES.urlChange,
          (job) => handlers.urlChange(job),
          { connection: handlers.connection, concurrency: 2 }
        ),
        new Worker<ConversionUploadJobData>(
          QUEUE_NAMES.conversionUpload,
          (job) => handlers.conversionUpload(job),
          { connection: handlers.connection, concurrency: 2 }
        ),
      ]);
  }

  getHealth(): WorkerHealth {
    return {
      enabled: true,
      status: this.status,
    };
  }

  getStatus(): WorkerStatus {
    return this.status;
  }

  /**
   * Dispatch by queue name — used by BullMQ handlers and unit tests (no Redis).
   */
  async dispatch(
    queueName: string,
    data: unknown,
    retry?: ProcessorRetryContext
  ): Promise<unknown> {
    try {
      if (queueName === QUEUE_NAMES.urlChange) {
        return await this.handleUrlChangeData(
          parseUrlChangeJobData(data),
          retry
        );
      }
      if (queueName === QUEUE_NAMES.conversionUpload) {
        return await this.handleConversionUploadData(
          parseConversionUploadJobData(data),
          retry
        );
      }
      throw new WorkerJobError(
        "UNKNOWN_QUEUE",
        `Unsupported queue for Phase 8.3.2 worker: ${queueName}`
      );
    } catch (error) {
      if (error instanceof WorkerJobError) {
        throwTerminalForBullMq(error);
      }
      throw error;
    }
  }

  async start(): Promise<void> {
    if (this.status === "running") return;

    this.workers = this.createWorkers({
      connection: this.connection,
      urlChange: async (job) => {
        this.log.info("urlChange job received", {
          bullJobId: job.id,
          jobId: job.data.jobId,
          attemptsMade: job.attemptsMade,
        });
        return this.handleUrlChangeData(
          job.data,
          retryContextFromBullJob(job, "urlChange")
        );
      },
      conversionUpload: async (job) => {
        this.log.info("conversionUpload job received", {
          bullJobId: job.id,
          jobId: job.data.jobId,
          attemptsMade: job.attemptsMade,
        });
        return this.handleConversionUploadData(
          job.data,
          retryContextFromBullJob(job, "conversionUpload")
        );
      },
    });

    this.status = "running";
    this.log.info("WorkerRuntime started", {
      queues: [QUEUE_NAMES.urlChange, QUEUE_NAMES.conversionUpload],
    });
  }

  async close(): Promise<void> {
    if (this.status === "stopped" && this.workers.length === 0) return;

    const workers = this.workers;
    this.workers = [];
    this.status = "stopped";

    const closeAll = Promise.all(workers.map((w) => w.close()));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        closeAll,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `WorkerRuntime close timed out after ${this.closeTimeoutMs}ms`
                )
              ),
            this.closeTimeoutMs
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }

    this.log.info("WorkerRuntime closed");
  }

  private async handleUrlChangeData(
    data: UrlChangeJobData,
    retry?: ProcessorRetryContext
  ) {
    const syncJob = await this.authorizeJob(data);
    return processUrlChangeJob({
      syncJobs: this.deps.syncJobs,
      urlChangeRequests: this.deps.urlChangeRequests,
      tenantId: syncJob.tenantId!,
      requestId: data.requestId,
      jobId: data.jobId,
      idempotencyKey: data.idempotencyKey,
      retry: retry ?? {
        softRetryEnabled: true,
        attemptsMade: 0,
        maxAttempts: getJobDefinition("urlChange")?.defaultAttempts ?? 3,
      },
    });
  }

  private async handleConversionUploadData(
    data: ConversionUploadJobData,
    retry?: ProcessorRetryContext
  ) {
    const syncJob = await this.authorizeJob(data);
    return processConversionUploadJob({
      syncJobs: this.deps.syncJobs,
      orderConversions: this.deps.orderConversions,
      tenantId: syncJob.tenantId!,
      conversionId: data.conversionId,
      jobId: data.jobId,
      idempotencyKey: data.idempotencyKey,
      customerId: data.customerId,
      googleAccountId: data.googleAccountId,
      retry: retry ?? {
        softRetryEnabled: true,
        attemptsMade: 0,
        maxAttempts:
          getJobDefinition("conversionUpload")?.defaultAttempts ?? 3,
      },
    });
  }

  /**
   * job.data.tenantId is untrusted — SyncJob from repository is authority.
   */
  private async authorizeJob(
    data: AdLinkLabJobData
  ): Promise<SyncJob & { tenantId: string }> {
    const claimedTenantId = data.tenantId?.trim();
    if (!claimedTenantId) {
      throw new WorkerJobError("MALFORMED_JOB", "job.data.tenantId is required");
    }

    let syncJob: SyncJob | null = null;
    if (data.syncJobId) {
      syncJob = await this.deps.syncJobs.findById(data.syncJobId);
      if (!syncJob) {
        throw new WorkerJobError(
          "SYNC_JOB_NOT_FOUND",
          `SyncJob not found: ${data.syncJobId}`
        );
      }
    } else {
      syncJob =
        (await this.deps.syncJobs.findByJobId(data.jobId)) ??
        (await this.deps.syncJobs.findByIdempotencyKey(
          claimedTenantId,
          "SYNC_JOB",
          data.idempotencyKey
        ));
      if (!syncJob) {
        throw new WorkerJobError(
          "SYNC_JOB_NOT_FOUND",
          `SyncJob not found for jobId=${data.jobId}`
        );
      }
    }

    const authoritativeTenantId = syncJob.tenantId?.trim();
    if (!authoritativeTenantId) {
      throw new WorkerJobError(
        "TENANT_MISMATCH",
        "SyncJob is missing tenantId (authority)"
      );
    }
    if (authoritativeTenantId !== claimedTenantId) {
      this.log.error("tenant isolation failure — refusing job", {
        claimedTenantId,
        authoritativeTenantId,
        syncJobId: syncJob.id,
        jobId: data.jobId,
      });
      throw new WorkerJobError(
        "TENANT_MISMATCH",
        "job.data.tenantId does not match SyncJob.tenantId"
      );
    }

    const status = syncJob.status.toUpperCase();
    if (status === "CANCELLED") {
      throw new WorkerJobError(
        "SYNC_JOB_CANCELLED",
        `SyncJob ${syncJob.id} is CANCELLED`
      );
    }

    return { ...syncJob, tenantId: authoritativeTenantId };
  }
}

export function parseUrlChangeJobData(data: unknown): UrlChangeJobData {
  if (!isRecord(data)) {
    throw new WorkerJobError("MALFORMED_JOB", "urlChange job.data must be an object");
  }
  if (data.type !== undefined && data.type !== "urlChange") {
    throw new WorkerJobError("MALFORMED_JOB", "urlChange job.data.type mismatch");
  }
  const tenantId = requireString(data, "tenantId");
  const requestId = requireString(data, "requestId");
  const idempotencyKey = requireString(data, "idempotencyKey");
  const jobId = requireString(data, "jobId");
  const syncJobId =
    data.syncJobId === undefined || data.syncJobId === null
      ? undefined
      : requireString(data, "syncJobId");
  return {
    type: "urlChange",
    tenantId,
    requestId,
    idempotencyKey,
    jobId,
    syncJobId,
  };
}

export function parseConversionUploadJobData(
  data: unknown
): ConversionUploadJobData {
  if (!isRecord(data)) {
    throw new WorkerJobError(
      "MALFORMED_JOB",
      "conversionUpload job.data must be an object"
    );
  }
  if (data.type !== undefined && data.type !== "conversionUpload") {
    throw new WorkerJobError(
      "MALFORMED_JOB",
      "conversionUpload job.data.type mismatch"
    );
  }
  const tenantId = requireString(data, "tenantId");
  const conversionId = requireString(data, "conversionId");
  const idempotencyKey = requireString(data, "idempotencyKey");
  const jobId = requireString(data, "jobId");
  const syncJobId =
    data.syncJobId === undefined || data.syncJobId === null
      ? undefined
      : requireString(data, "syncJobId");
  const customerId =
    data.customerId === undefined || data.customerId === null
      ? undefined
      : String(data.customerId);
  const googleAccountId =
    data.googleAccountId === undefined || data.googleAccountId === null
      ? undefined
      : String(data.googleAccountId);
  return {
    type: "conversionUpload",
    tenantId,
    conversionId,
    idempotencyKey,
    jobId,
    syncJobId,
    customerId,
    googleAccountId,
  };
}

function requireString(
  data: Record<string, unknown>,
  key: string
): string {
  const value = data[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WorkerJobError(
      "MALFORMED_JOB",
      `job.data.${key} must be a non-empty string`
    );
  }
  return value;
}

export function createWorkerRuntime(
  deps: WorkerRuntimeDeps,
  options?: WorkerRuntimeOptions
): WorkerRuntime {
  return new WorkerRuntime(deps, options);
}

export function stoppedWorkerHealth(): WorkerHealth {
  return { enabled: false, status: "stopped" };
}
