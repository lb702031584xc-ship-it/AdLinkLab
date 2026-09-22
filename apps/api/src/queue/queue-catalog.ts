/**
 * Phase 9.6 — Queue Catalog Honesty.
 *
 * Single source of truth for “does this queue have a real Worker?”
 * IMPLEMENTED ⇔ Queue defined AND Worker registered AND Processor exists.
 * Queue existence alone must never imply IMPLEMENTED.
 */
import {
  JOB_DEFINITIONS,
  QUEUE_NAMES,
  type JobDefinition,
} from "./jobs.js";

/** Production worker capability — never FAKE_READY / STUB. */
export type QueueCapabilityStatus = "IMPLEMENTED" | "PLANNED" | "DISABLED";

export interface WorkerRegistryEntry {
  /** Must match QUEUE_NAMES / BullMQ Worker queue name. */
  queueName: string;
  /** Processor module under apps/api/src/queue/ */
  processorModule: string;
  /** Exported processor function name. */
  processorExport: string;
  /** Runtime registration site. */
  entryPoint: "WorkerRuntime.start";
}

/**
 * Queues with real BullMQ Worker registration + processor.
 * Must stay aligned with WorkerRuntime.createWorkers / start().
 */
export const WORKER_REGISTRY: readonly WorkerRegistryEntry[] = [
  {
    queueName: QUEUE_NAMES.urlChange,
    processorModule: "url-change-worker.ts",
    processorExport: "processUrlChangeJob",
    entryPoint: "WorkerRuntime.start",
  },
  {
    queueName: QUEUE_NAMES.conversionUpload,
    processorModule: "conversion-upload-worker.ts",
    processorExport: "processConversionUploadJob",
    entryPoint: "WorkerRuntime.start",
  },
] as const;

export interface QueueCatalogEntry {
  queueName: string;
  jobType: JobDefinition["name"];
  status: QueueCapabilityStatus;
  workerRegistered: boolean;
  processor: string | null;
  entryPoint: string | null;
  defaultAttempts: number;
}

const REGISTERED_BY_QUEUE = new Map(
  WORKER_REGISTRY.map((w) => [w.queueName, w] as const)
);

export function isWorkerRegistered(queueName: string): boolean {
  return REGISTERED_BY_QUEUE.has(queueName);
}

export function resolveQueueCapability(
  queueName: string
): QueueCapabilityStatus {
  return isWorkerRegistered(queueName) ? "IMPLEMENTED" : "PLANNED";
}

/**
 * Catalog for all JOB_DEFINITIONS — status derived from WORKER_REGISTRY only.
 */
export function getQueueCatalog(): QueueCatalogEntry[] {
  return JOB_DEFINITIONS.map((def) => {
    const worker = REGISTERED_BY_QUEUE.get(def.queueName);
    const workerRegistered = Boolean(worker);
    return {
      queueName: def.queueName,
      jobType: def.name,
      status: workerRegistered ? "IMPLEMENTED" : "PLANNED",
      workerRegistered,
      processor: worker
        ? `${worker.processorModule}#${worker.processorExport}`
        : null,
      entryPoint: worker?.entryPoint ?? null,
      defaultAttempts: def.defaultAttempts,
    };
  });
}

export function getImplementedQueueNames(): string[] {
  return getQueueCatalog()
    .filter((e) => e.status === "IMPLEMENTED")
    .map((e) => e.queueName);
}

export function getPlannedQueueNames(): string[] {
  return getQueueCatalog()
    .filter((e) => e.status === "PLANNED")
    .map((e) => e.queueName);
}
