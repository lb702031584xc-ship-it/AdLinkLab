import { UnrecoverableError, type JobsOptions } from "bullmq";
import {
  classifyGoogleAdsError,
  type GoogleAdsErrorCode,
} from "@adlinklab/google-ads";
import type { SyncJobType } from "@adlinklab/shared";
import { JOB_DEFINITIONS, type JobDefinition } from "./jobs.js";

/**
 * Phase 8.3.4 — retry / failure classification.
 * BullMQ owns broker retries; SyncJob.attempts is business execution count.
 */

export type JobErrorClass = {
  retryable: boolean;
  code?: GoogleAdsErrorCode | string;
  message: string;
};

export function getJobDefinition(type: SyncJobType): JobDefinition | undefined {
  return JOB_DEFINITIONS.find((j) => j.name === type);
}

export function getBullMqJobOptions(type: SyncJobType): JobsOptions {
  const def = getJobDefinition(type);
  const attempts = def?.defaultAttempts ?? 3;
  const delay = def?.backoffDelayMs ?? 1_000;
  const backoffType = def?.backoffType ?? "exponential";
  return {
    attempts,
    backoff: { type: backoffType, delay },
    removeOnComplete: 100,
    removeOnFail: 200,
  };
}

function isWorkerJobError(
  error: unknown
): error is Error & { code: string } {
  return (
    error instanceof Error &&
    error.name === "WorkerJobError" &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

/** Classify provider / worker errors for retry vs terminal. */
export function classifyJobError(error: unknown): JobErrorClass {
  if (isWorkerJobError(error)) {
    return {
      retryable: false,
      code: error.code,
      message: error.message,
    };
  }
  if (error instanceof UnrecoverableError) {
    return {
      retryable: false,
      code: "UNRECOVERABLE",
      message: error.message,
    };
  }
  const ads = classifyGoogleAdsError(error);
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown error");
  if (ads.code) {
    return {
      retryable: ads.retryable,
      code: ads.code,
      message,
    };
  }
  // Unknown errors: not retryable (fail closed).
  return { retryable: false, message };
}

export function isLastBullMqAttempt(
  attemptsMade: number,
  maxAttempts: number
): boolean {
  if (maxAttempts <= 0) return true;
  return attemptsMade + 1 >= maxAttempts;
}

/**
 * Should this failure leave business soft (QUEUED/RUNNING) and ask BullMQ to retry?
 */
export function shouldSoftRetry(input: {
  error: unknown;
  /** When false/undefined (HTTP), never soft-retry. */
  softRetryEnabled?: boolean;
  attemptsMade?: number;
  maxAttempts?: number;
}): boolean {
  if (!input.softRetryEnabled) return false;
  const classified = classifyJobError(input.error);
  if (!classified.retryable) return false;
  const max = input.maxAttempts ?? 3;
  const made = input.attemptsMade ?? 0;
  return !isLastBullMqAttempt(made, max);
}

/** Throw UnrecoverableError so BullMQ will not retry. */
export function throwTerminalForBullMq(error: unknown): never {
  if (error instanceof UnrecoverableError) throw error;
  const message =
    error instanceof Error ? error.message : String(error ?? "terminal failure");
  throw new UnrecoverableError(message);
}

export type ProcessorRetryContext = {
  softRetryEnabled: boolean;
  attemptsMade: number;
  maxAttempts: number;
};
