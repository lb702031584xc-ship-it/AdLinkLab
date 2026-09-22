import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";
import type { SyncJobType } from "@adlinklab/shared";
import {
  createQueues,
  createRedisConnection,
  QUEUE_NAMES,
  type ImplementedQueueName,
} from "./jobs.js";
import type {
  ConversionUploadJobData,
  EnqueueResult,
  UrlChangeJobData,
} from "./job-data.js";
import { getBullMqJobOptions } from "./retry-policy.js";

export type QueueMode = "off" | "redis";

export interface JobProducer {
  readonly mode: QueueMode;
  enqueueUrlChange(data: UrlChangeJobData): Promise<EnqueueResult>;
  enqueueConversionUpload(data: ConversionUploadJobData): Promise<EnqueueResult>;
  close(): Promise<void>;
}

/**
 * Resolve whether API should open Redis producers.
 * Vitest / QUEUE_MODE=off → off (Phase 4–7 tests stay Redis-free).
 * QUEUE_MODE=redis or QUEUE_ENABLED=1 → redis.
 * Else: REDIS_URL present outside tests → redis.
 */
export function resolveQueueMode(
  env: NodeJS.ProcessEnv = process.env
): QueueMode {
  const explicit = (env.QUEUE_MODE ?? "").trim().toLowerCase();
  if (explicit === "off" || explicit === "redis") return explicit;
  if (env.QUEUE_ENABLED === "0") return "off";
  if (env.QUEUE_ENABLED === "1") return "redis";
  if (env.VITEST || env.NODE_ENV === "test") return "off";
  if (env.REDIS_URL && env.REDIS_URL.trim().length > 0) return "redis";
  return "off";
}

export function getDefaultJobOptions(type: SyncJobType): JobsOptions {
  return getBullMqJobOptions(type);
}

/** Test / default: SyncJob still written; no Redis. */
export class NoopJobProducer implements JobProducer {
  readonly mode = "off" as const;
  readonly calls: Array<UrlChangeJobData | ConversionUploadJobData> = [];

  async enqueueUrlChange(data: UrlChangeJobData): Promise<EnqueueResult> {
    this.calls.push(data);
    return { enqueued: false, jobId: data.jobId, reason: "noop" };
  }

  async enqueueConversionUpload(
    data: ConversionUploadJobData
  ): Promise<EnqueueResult> {
    this.calls.push(data);
    return { enqueued: false, jobId: data.jobId, reason: "noop" };
  }

  async close(): Promise<void> {}
}

/**
 * Phase 8.3.1 BullMQ producer — Queue.add only for IMPLEMENTED queues.
 */
export class BullMqJobProducer implements JobProducer {
  readonly mode = "redis" as const;
  private readonly queues: Record<ImplementedQueueName, Queue>;
  private closed = false;

  constructor(
    connection: ConnectionOptions = createRedisConnection(),
    queues?: Partial<Record<ImplementedQueueName, Queue>> &
      Partial<Record<SyncJobType, Queue>>
  ) {
    const all = queues ?? createQueues(connection);
    const urlChange = all.urlChange;
    const conversionUpload = all.conversionUpload;
    if (!urlChange || !conversionUpload) {
      throw new Error(
        "BullMqJobProducer requires urlChange and conversionUpload Queue clients"
      );
    }
    this.queues = { urlChange, conversionUpload };
  }

  async enqueueUrlChange(data: UrlChangeJobData): Promise<EnqueueResult> {
    return this.add(
      this.queues.urlChange,
      QUEUE_NAMES.urlChange,
      data,
      data.jobId,
      "urlChange"
    );
  }

  async enqueueConversionUpload(
    data: ConversionUploadJobData
  ): Promise<EnqueueResult> {
    return this.add(
      this.queues.conversionUpload,
      QUEUE_NAMES.conversionUpload,
      data,
      data.jobId,
      "conversionUpload"
    );
  }

  private async add(
    queue: Queue,
    name: string,
    data: UrlChangeJobData | ConversionUploadJobData,
    jobId: string,
    type: ImplementedQueueName
  ): Promise<EnqueueResult> {
    if (this.closed) {
      throw new Error("JobProducer is closed");
    }

    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (
        state === "waiting" ||
        state === "delayed" ||
        state === "active" ||
        state === "prioritized" ||
        state === "waiting-children"
      ) {
        return { enqueued: false, jobId, reason: "duplicate" };
      }
      // completed / failed — remove so retry can re-add with same jobId
      try {
        await existing.remove();
      } catch {
        // ignore — add may still succeed or throw
      }
    }

    await queue.add(name, data, {
      jobId,
      ...getDefaultJobOptions(type),
    });
    return { enqueued: true, jobId, reason: "added" };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.all([
      this.queues.urlChange.close(),
      this.queues.conversionUpload.close(),
    ]);
  }
}

export function createJobProducer(
  env: NodeJS.ProcessEnv = process.env,
  options?: { producer?: JobProducer }
): JobProducer {
  if (options?.producer) return options.producer;
  const mode = resolveQueueMode(env);
  if (mode === "redis") {
    return new BullMqJobProducer(createRedisConnection());
  }
  return new NoopJobProducer();
}
