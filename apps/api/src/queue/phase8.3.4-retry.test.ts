import { describe, expect, it, beforeEach } from "vitest";
import { UnrecoverableError } from "bullmq";
import {
  createSeededMemoryRepositories,
  TenantA,
} from "@adlinklab/database";
import {
  GoogleAdsProviderError,
  MockGoogleAdsProvider,
} from "@adlinklab/google-ads";
import {
  AuditService,
  UrlChangeRequestService,
  UrlVersionService,
} from "../services/index.js";
import { OrderConversionService } from "../services/conversion-order.js";
import { processIdempotentJob, JOB_DEFINITIONS } from "./jobs.js";
import { processUrlChangeJob } from "./url-change-worker.js";
import { processConversionUploadJob } from "./conversion-upload-worker.js";
import { getDefaultJobOptions } from "./producer.js";
import {
  classifyJobError,
  getBullMqJobOptions,
  isLastBullMqAttempt,
  shouldSoftRetry,
  throwTerminalForBullMq,
} from "./retry-policy.js";
import { resetMutationLocksForTests } from "./execution-guard.js";
import { WorkerJobError } from "./runtime.js";
import { buildApp, createServices } from "../app.js";

const USER = TenantA.user;

beforeEach(() => {
  resetMutationLocksForTests();
});

describe("Phase 8.3.4 retry policy config", () => {
  it("1. urlChange attempts=3 backoff 1000ms exponential", () => {
    const def = JOB_DEFINITIONS.find((j) => j.name === "urlChange")!;
    expect(def.defaultAttempts).toBe(3);
    expect(def.backoffDelayMs).toBe(1_000);
    expect(getBullMqJobOptions("urlChange")).toMatchObject({
      attempts: 3,
      backoff: { type: "exponential", delay: 1_000 },
    });
    expect(getDefaultJobOptions("urlChange")).toEqual(
      getBullMqJobOptions("urlChange")
    );
  });

  it("2. conversionUpload attempts=3 backoff 1000ms", () => {
    expect(getBullMqJobOptions("conversionUpload")).toMatchObject({
      attempts: 3,
      backoff: { type: "exponential", delay: 1_000 },
    });
  });

  it("3. googleAdsSync keeps higher attempts", () => {
    expect(getBullMqJobOptions("googleAdsSync").attempts).toBe(5);
  });
});

describe("Phase 8.3.4 classifyJobError", () => {
  it("4. RATE_LIMITED is retryable", () => {
    const err = new GoogleAdsProviderError("rate", { code: "RATE_LIMITED" });
    expect(classifyJobError(err)).toMatchObject({
      retryable: true,
      code: "RATE_LIMITED",
    });
  });

  it("5. TEMPORARY_ERROR is retryable", () => {
    const err = new GoogleAdsProviderError("tmp", { code: "TEMPORARY_ERROR" });
    expect(classifyJobError(err).retryable).toBe(true);
  });

  it("6. INVALID_ARGUMENT is terminal", () => {
    const err = new GoogleAdsProviderError("bad", {
      code: "INVALID_ARGUMENT",
    });
    expect(classifyJobError(err).retryable).toBe(false);
  });

  it("7. UNAUTHORIZED is terminal", () => {
    const err = new GoogleAdsProviderError("auth", { code: "UNAUTHORIZED" });
    expect(classifyJobError(err).retryable).toBe(false);
  });

  it("8. WorkerJobError is never retryable", () => {
    expect(
      classifyJobError(new WorkerJobError("TENANT_MISMATCH", "x")).retryable
    ).toBe(false);
  });

  it("9. unknown Error is not retryable (fail closed)", () => {
    expect(classifyJobError(new Error("boom")).retryable).toBe(false);
  });

  it("10. shouldSoftRetry respects last attempt", () => {
    const err = new GoogleAdsProviderError("rate", { code: "RATE_LIMITED" });
    expect(
      shouldSoftRetry({
        error: err,
        softRetryEnabled: true,
        attemptsMade: 0,
        maxAttempts: 3,
      })
    ).toBe(true);
    expect(
      shouldSoftRetry({
        error: err,
        softRetryEnabled: true,
        attemptsMade: 2,
        maxAttempts: 3,
      })
    ).toBe(false);
    expect(isLastBullMqAttempt(2, 3)).toBe(true);
  });

  it("11. throwTerminalForBullMq wraps UnrecoverableError", () => {
    expect(() => throwTerminalForBullMq(new Error("x"))).toThrow(
      UnrecoverableError
    );
  });
});

function createUrlHarness(provider = new MockGoogleAdsProvider()) {
  const repos = createSeededMemoryRepositories();
  const audit = new AuditService(repos.auditLogs);
  const versions = new UrlVersionService(
    repos.urlVersions,
    repos.ads,
    repos.unitOfWork
  );
  const changes = new UrlChangeRequestService(
    repos.urlChangeRequests,
    repos.urlVersions,
    repos.ads,
    provider,
    audit,
    repos.unitOfWork,
    repos.syncJobs
  );
  return { repos, provider, versions, changes };
}

async function queueUrl(h: ReturnType<typeof createUrlHarness>, key: string) {
  const draft = await h.versions.createVersion({
    tenantId: TenantA.id,
    adId: TenantA.adA1,
    finalUrl: `https://example.com/${key}`,
    trackingTemplate:
      "https://tracker.example.com/click?cid={_clickid}&url={lpurl}",
    customParameters: { _clickid: "x" },
    createdBy: USER,
  });
  const { request } = await h.changes.create({
    tenantId: TenantA.id,
    entityType: "AD",
    entityId: TenantA.adA1,
    toVersionId: draft.id,
    reason: "834",
    requestedBy: USER,
    idempotencyKey: key,
  });
  await h.changes.validate(TenantA.id, request.id);
  return h.changes.queue(TenantA.id, request.id);
}

describe("Phase 8.3.4 Worker soft-retry vs terminal", () => {
  it("12. HTTP RATE_LIMITED still marks UCR FAILED", async () => {
    const provider = new MockGoogleAdsProvider();
    provider.configureError({
      method: "updateEntityUrl",
      code: "RATE_LIMITED",
    });
    const h = createUrlHarness(provider);
    const queued = await queueUrl(h, "834:http:rate");
    await expect(h.changes.execute(TenantA.id, queued.id)).rejects.toBeTruthy();
    expect((await h.changes.getById(TenantA.id, queued.id)).status).toBe(
      "FAILED"
    );
  });

  it("13. Worker soft-retry RATE_LIMITED keeps RUNNING + SyncJob PENDING", async () => {
    const provider = new MockGoogleAdsProvider();
    provider.configureError({
      method: "updateEntityUrl",
      code: "RATE_LIMITED",
    });
    const h = createUrlHarness(provider);
    const queued = await queueUrl(h, "834:worker:rate");
    await expect(
      processUrlChangeJob({
        syncJobs: h.repos.syncJobs,
        urlChangeRequests: h.changes,
        tenantId: TenantA.id,
        requestId: queued.id,
        jobId: queued.jobId!,
        idempotencyKey: queued.idempotencyKey,
        retry: { softRetryEnabled: true, attemptsMade: 0, maxAttempts: 3 },
      })
    ).rejects.toBeInstanceOf(GoogleAdsProviderError);

    expect((await h.changes.getById(TenantA.id, queued.id)).status).toBe(
      "RUNNING"
    );
    const sync = await h.repos.syncJobs.findByIdempotencyKey(
      TenantA.id,
      "SYNC_JOB",
      queued.idempotencyKey
    );
    expect(sync?.status).toBe("PENDING");
    expect(sync?.attempts).toBeGreaterThanOrEqual(1);
  });

  it("14. Worker last attempt RATE_LIMITED is terminal FAILED", async () => {
    const provider = new MockGoogleAdsProvider();
    provider.configureError({
      method: "updateEntityUrl",
      code: "RATE_LIMITED",
    });
    const h = createUrlHarness(provider);
    const queued = await queueUrl(h, "834:worker:last");
    await expect(
      processUrlChangeJob({
        syncJobs: h.repos.syncJobs,
        urlChangeRequests: h.changes,
        tenantId: TenantA.id,
        requestId: queued.id,
        jobId: queued.jobId!,
        idempotencyKey: queued.idempotencyKey,
        retry: { softRetryEnabled: true, attemptsMade: 2, maxAttempts: 3 },
      })
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect((await h.changes.getById(TenantA.id, queued.id)).status).toBe(
      "FAILED"
    );
    const sync = await h.repos.syncJobs.findByIdempotencyKey(
      TenantA.id,
      "SYNC_JOB",
      queued.idempotencyKey
    );
    expect(sync?.status).toBe("FAILED");
  });

  it("15. Worker INVALID_ARGUMENT is terminal immediately", async () => {
    const provider = new MockGoogleAdsProvider();
    provider.configureError({
      method: "updateEntityUrl",
      code: "INVALID_ARGUMENT",
    });
    const h = createUrlHarness(provider);
    const queued = await queueUrl(h, "834:worker:inv");
    await expect(
      processUrlChangeJob({
        syncJobs: h.repos.syncJobs,
        urlChangeRequests: h.changes,
        tenantId: TenantA.id,
        requestId: queued.id,
        jobId: queued.jobId!,
        idempotencyKey: queued.idempotencyKey,
        retry: { softRetryEnabled: true, attemptsMade: 0, maxAttempts: 3 },
      })
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect((await h.changes.getById(TenantA.id, queued.id)).status).toBe(
      "FAILED"
    );
  });

  it("16. soft-retry then success on next attempt", async () => {
    const provider = new MockGoogleAdsProvider();
    provider.configureError({
      method: "updateEntityUrl",
      code: "TEMPORARY_ERROR",
    });
    const h = createUrlHarness(provider);
    const queued = await queueUrl(h, "834:worker:recover");
    await expect(
      processUrlChangeJob({
        syncJobs: h.repos.syncJobs,
        urlChangeRequests: h.changes,
        tenantId: TenantA.id,
        requestId: queued.id,
        jobId: queued.jobId!,
        idempotencyKey: queued.idempotencyKey,
        retry: { softRetryEnabled: true, attemptsMade: 0, maxAttempts: 3 },
      })
    ).rejects.toBeTruthy();

    provider.configureError(null);
    const ok = await processUrlChangeJob({
      syncJobs: h.repos.syncJobs,
      urlChangeRequests: h.changes,
      tenantId: TenantA.id,
      requestId: queued.id,
      jobId: queued.jobId!,
      idempotencyKey: queued.idempotencyKey,
      retry: { softRetryEnabled: true, attemptsMade: 1, maxAttempts: 3 },
    });
    expect(ok.status).toBe("COMPLETED");
    expect((await h.changes.getById(TenantA.id, queued.id)).status).toBe(
      "SUCCEEDED"
    );
  });
});

describe("Phase 8.3.4 conversion soft-retry", () => {
  function createConv(provider = new MockGoogleAdsProvider()) {
    const repos = createSeededMemoryRepositories();
    const audit = new AuditService(repos.auditLogs);
    const svc = new OrderConversionService(
      repos.orders,
      repos.conversions,
      repos.clicks,
      repos.googleAccounts,
      provider,
      repos.unitOfWork,
      audit,
      repos.syncJobs
    );
    return { repos, provider, svc };
  }

  async function queueConv(h: ReturnType<typeof createConv>, key: string) {
    const { order } = await h.svc.createOrder({
      tenantId: TenantA.id,
      orderId: `834-${key}`,
      clickId: TenantA.click3,
      value: "1.0000",
      currency: "USD",
      idempotencyKey: `834:o:${key}`,
    });
    const { conversion } = await h.svc.createConversionFromOrder({
      tenantId: TenantA.id,
      orderId: order.id,
      conversionAction: "purchase",
      idempotencyKey: `834:c:${key}`,
    });
    return h.svc.queueUpload(TenantA.id, conversion.id);
  }

  it("17. Worker RATE_LIMITED keeps QUEUED for retry", async () => {
    const provider = new MockGoogleAdsProvider();
    provider.configureError({
      method: "uploadConversion",
      code: "RATE_LIMITED",
    });
    const h = createConv(provider);
    const queued = await queueConv(h, "17");
    await expect(
      processConversionUploadJob({
        syncJobs: h.repos.syncJobs,
        orderConversions: h.svc,
        tenantId: TenantA.id,
        conversionId: queued.id,
        jobId: `conversionUpload:${queued.idempotencyKey}`,
        idempotencyKey: queued.idempotencyKey!,
        retry: { softRetryEnabled: true, attemptsMade: 0, maxAttempts: 3 },
      })
    ).rejects.toBeInstanceOf(GoogleAdsProviderError);

    expect(
      (await h.svc.getConversion(TenantA.id, queued.id)).googleUploadStatus
    ).toBe("QUEUED");
  });

  it("18. HTTP RATE_LIMITED still marks FAILED", async () => {
    const provider = new MockGoogleAdsProvider();
    provider.configureError({
      method: "uploadConversion",
      code: "RATE_LIMITED",
    });
    const h = createConv(provider);
    const queued = await queueConv(h, "18");
    await expect(
      h.svc.executeUpload(TenantA.id, queued.id)
    ).rejects.toBeTruthy();
    expect(
      (await h.svc.getConversion(TenantA.id, queued.id)).googleUploadStatus
    ).toBe("FAILED");
  });
});

describe("Phase 8.3.4 SyncJob attempts vs BullMQ", () => {
  it("19. SyncJob.attempts increments on each process claim", async () => {
    const repos = createSeededMemoryRepositories();
    const key = "834:attempts";
    await processIdempotentJob(repos.syncJobs, {
      type: "urlChange",
      jobId: `urlChange:${key}`,
      idempotencyKey: key,
      tenantId: TenantA.id,
      payload: { tenantId: TenantA.id },
      handler: async () => {
        throw new GoogleAdsProviderError("r", { code: "RATE_LIMITED" });
      },
      retry: { softRetryEnabled: true, attemptsMade: 0, maxAttempts: 3 },
    }).catch(() => undefined);

    let job = await repos.syncJobs.findByIdempotencyKey(
      TenantA.id,
      "SYNC_JOB",
      key
    );
    expect(job?.attempts).toBe(1);
    expect(job?.status).toBe("PENDING");

    await processIdempotentJob(repos.syncJobs, {
      type: "urlChange",
      jobId: `urlChange:${key}`,
      idempotencyKey: key,
      tenantId: TenantA.id,
      payload: { tenantId: TenantA.id },
      handler: async () => {
        throw new GoogleAdsProviderError("r", { code: "RATE_LIMITED" });
      },
      retry: { softRetryEnabled: true, attemptsMade: 1, maxAttempts: 3 },
    }).catch(() => undefined);

    job = await repos.syncJobs.findByIdempotencyKey(
      TenantA.id,
      "SYNC_JOB",
      key
    );
    expect(job?.attempts).toBe(2);
  });

  it("20. health phase 8.3.4", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.json()).toMatchObject({ phase: "10", queueMode: "off" });
    await app.close();
  });

  it("21. Vitest still Redis-free", async () => {
    const s = createServices();
    expect(s.queueMode).toBe("off");
    await s.dispose();
  });
});
