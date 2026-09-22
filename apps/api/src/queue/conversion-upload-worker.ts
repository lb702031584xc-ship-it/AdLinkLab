import type { SyncJobRepository } from "@adlinklab/domain";
import type { OrderConversionService } from "../services/conversion-order.js";
import { processIdempotentJob } from "./jobs.js";
import type { ProcessorRetryContext } from "./retry-policy.js";

/**
 * In-process conversion upload worker (BullMQ Worker can call this).
 * Reuses SyncJob idempotency — no second queue infrastructure.
 */
export async function processConversionUploadJob(input: {
  syncJobs: SyncJobRepository;
  orderConversions: OrderConversionService;
  tenantId: string;
  conversionId: string;
  jobId: string;
  idempotencyKey: string;
  customerId?: string;
  googleAccountId?: string;
  /** Phase 8.3.4 — when set (Worker), enables soft-retry for RATE_LIMITED etc. */
  retry?: ProcessorRetryContext;
}) {
  const retry = input.retry;
  const softRetry = Boolean(
    retry?.softRetryEnabled &&
      retry.attemptsMade + 1 < retry.maxAttempts
  );

  return processIdempotentJob(input.syncJobs, {
    type: "conversionUpload",
    jobId: input.jobId,
    idempotencyKey: input.idempotencyKey,
    tenantId: input.tenantId,
    payload: {
      conversionId: input.conversionId,
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
    },
    retry,
    handler: async () => {
      const result = await input.orderConversions.executeUpload(
        input.tenantId,
        input.conversionId,
        {
          customerId: input.customerId,
          googleAccountId: input.googleAccountId,
          softRetry,
        }
      );
      if (result.conversion.googleUploadStatus === "FAILED") {
        throw new Error("Conversion upload failed");
      }
    },
  });
}
