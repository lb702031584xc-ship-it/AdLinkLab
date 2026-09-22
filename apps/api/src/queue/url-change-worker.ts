import type { SyncJobRepository } from "@adlinklab/domain";
import type { UrlChangeRequestService } from "../services/url-change-engine.js";
import { processIdempotentJob } from "./jobs.js";
import type { ProcessorRetryContext } from "./retry-policy.js";

/**
 * In-process URL change worker entry (BullMQ Worker can call this).
 * Reuses SyncJob idempotency — no second queue infrastructure.
 */
export async function processUrlChangeJob(input: {
  syncJobs: SyncJobRepository;
  urlChangeRequests: UrlChangeRequestService;
  tenantId: string;
  requestId: string;
  jobId: string;
  idempotencyKey: string;
  /** Phase 8.3.4 — when set (Worker), enables soft-retry for RATE_LIMITED etc. */
  retry?: ProcessorRetryContext;
}) {
  const retry = input.retry;
  const softRetry = Boolean(
    retry?.softRetryEnabled &&
      retry.attemptsMade + 1 < retry.maxAttempts
  );

  return processIdempotentJob(input.syncJobs, {
    type: "urlChange",
    jobId: input.jobId,
    idempotencyKey: input.idempotencyKey,
    tenantId: input.tenantId,
    payload: {
      requestId: input.requestId,
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
    },
    retry,
    handler: async () => {
      const result = await input.urlChangeRequests.execute(
        input.tenantId,
        input.requestId,
        { softRetry }
      );
      if (result.request.status === "FAILED") {
        throw new Error(result.request.error ?? "URL change failed");
      }
    },
  });
}
