import type { SyncJobType } from "@adlinklab/shared";

/**
 * Phase 8.3.1 — BullMQ job.data contracts.
 * Payload lives on the queue (Prisma SyncJob has no payload column).
 * Worker (8.3.2) must still verify tenantId against DB authority.
 */
export interface UrlChangeJobData {
  type: "urlChange";
  tenantId: string;
  requestId: string;
  idempotencyKey: string;
  /** Matches SyncJob.jobId / BullMQ jobId */
  jobId: string;
  syncJobId?: string;
}

export interface ConversionUploadJobData {
  type: "conversionUpload";
  tenantId: string;
  conversionId: string;
  idempotencyKey: string;
  jobId: string;
  syncJobId?: string;
  customerId?: string;
  googleAccountId?: string;
}

export type AdLinkLabJobData = UrlChangeJobData | ConversionUploadJobData;

export type EnqueueableJobType = Extract<
  SyncJobType,
  "urlChange" | "conversionUpload"
>;

export interface EnqueueResult {
  enqueued: boolean;
  jobId: string;
  /** noop | duplicate | added | redis */
  reason: "noop" | "duplicate" | "added";
}
