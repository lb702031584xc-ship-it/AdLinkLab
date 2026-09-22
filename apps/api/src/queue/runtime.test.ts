import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createSeededMemoryRepositories,
  TenantA,
  TenantB,
} from "@adlinklab/database";
import { MockGoogleAdsProvider } from "@adlinklab/google-ads";
import {
  AuditService,
  UrlChangeRequestService,
  UrlVersionService,
} from "../services/index.js";
import { OrderConversionService } from "../services/conversion-order.js";
import { createServices } from "../app.js";
import { QUEUE_NAMES } from "./jobs.js";
import { UnrecoverableError } from "bullmq";
import {
  WorkerJobError,
  createWorkerRuntime,
  parseConversionUploadJobData,
  parseUrlChangeJobData,
} from "./runtime.js";
import * as urlChangeWorker from "./url-change-worker.js";
import * as conversionUploadWorker from "./conversion-upload-worker.js";

const USER = TenantA.user;

function createRuntimeHarness() {
  const repos = createSeededMemoryRepositories();
  const provider = new MockGoogleAdsProvider();
  const audit = new AuditService(repos.auditLogs);
  const versions = new UrlVersionService(
    repos.urlVersions,
    repos.ads,
    repos.unitOfWork
  );
  const urlChangeRequests = new UrlChangeRequestService(
    repos.urlChangeRequests,
    repos.urlVersions,
    repos.ads,
    provider,
    audit,
    repos.unitOfWork,
    repos.syncJobs
  );
  const orderConversions = new OrderConversionService(
    repos.orders,
    repos.conversions,
    repos.clicks,
    repos.googleAccounts,
    provider,
    repos.unitOfWork,
    audit,
    repos.syncJobs
  );
  const runtime = createWorkerRuntime({
    syncJobs: repos.syncJobs,
    urlChangeRequests,
    orderConversions,
    log: { info: () => {}, error: () => {} },
  });
  return {
    repos,
    provider,
    versions,
    urlChangeRequests,
    orderConversions,
    runtime,
  };
}

async function queueUrlChange(
  h: ReturnType<typeof createRuntimeHarness>,
  key: string
) {
  const draft = await h.versions.createVersion({
    tenantId: TenantA.id,
    adId: TenantA.adA1,
    finalUrl: `https://example.com/w-${key}`,
    trackingTemplate:
      "https://tracker.example.com/click?cid={_clickid}&url={lpurl}",
    customParameters: { _clickid: "abc" },
    createdBy: USER,
  });
  const { request } = await h.urlChangeRequests.create({
    tenantId: TenantA.id,
    entityType: "AD",
    entityId: TenantA.adA1,
    toVersionId: draft.id,
    reason: "worker-test",
    requestedBy: USER,
    idempotencyKey: key,
  });
  await h.urlChangeRequests.validate(TenantA.id, request.id);
  const queued = await h.urlChangeRequests.queue(TenantA.id, request.id);
  const sync = await h.repos.syncJobs.findByIdempotencyKey(
    TenantA.id,
    "SYNC_JOB",
    request.idempotencyKey
  );
  return { request: queued, sync: sync! };
}

async function queueConversion(
  h: ReturnType<typeof createRuntimeHarness>,
  key: string
) {
  const { order } = await h.orderConversions.createOrder({
    tenantId: TenantA.id,
    orderId: `W-ORD-${key}`,
    clickId: TenantA.click3,
    value: "8.0000",
    currency: "USD",
    idempotencyKey: `w:order:${key}`,
  });
  const { conversion } = await h.orderConversions.createConversionFromOrder({
    tenantId: TenantA.id,
    orderId: order.id,
    conversionAction: "purchase",
    idempotencyKey: `w:conv:${key}`,
  });
  const queued = await h.orderConversions.queueUpload(TenantA.id, conversion.id);
  const sync = await h.repos.syncJobs.findByIdempotencyKey(
    TenantA.id,
    "SYNC_JOB",
    conversion.idempotencyKey!
  );
  return { conversion: queued, sync: sync! };
}

describe("Phase 8.3.2 WorkerRuntime — lifecycle", () => {
  it("1. can create WorkerRuntime without connecting Redis", () => {
    const h = createRuntimeHarness();
    expect(h.runtime.getStatus()).toBe("stopped");
    expect(h.runtime.getHealth()).toEqual({
      enabled: true,
      status: "stopped",
    });
  });

  it("2. close is idempotent when never started", async () => {
    const h = createRuntimeHarness();
    await h.runtime.close();
    await h.runtime.close();
    expect(h.runtime.getStatus()).toBe("stopped");
  });

  it("3. start/close with injected workers (no Redis)", async () => {
    const close = vi.fn(async () => {});
    const runtime = createWorkerRuntime(
      {
        syncJobs: createSeededMemoryRepositories().syncJobs,
        urlChangeRequests: {} as never,
        orderConversions: {} as never,
        log: { info: () => {}, error: () => {} },
      },
      {
        createWorkers: () => [{ close }],
      }
    );
    await runtime.start();
    expect(runtime.getStatus()).toBe("running");
    await runtime.close();
    expect(close).toHaveBeenCalledOnce();
    expect(runtime.getStatus()).toBe("stopped");
  });

  it("4. createServices without withWorker keeps worker disabled", () => {
    const services = createServices();
    expect(services.worker).toEqual({ enabled: false, status: "stopped" });
    expect(services.workerRuntime).toBeUndefined();
  });

  it("5. createServices(withWorker) attaches runtime; dispose closes it", async () => {
    const close = vi.fn(async () => {});
    const injected = createWorkerRuntime(
      {
        syncJobs: createSeededMemoryRepositories().syncJobs,
        urlChangeRequests: {} as never,
        orderConversions: {} as never,
        log: { info: () => {}, error: () => {} },
      },
      { createWorkers: () => [{ close }] }
    );
    const services = createServices({
      withWorker: true,
      workerRuntime: injected,
    });
    expect(services.worker.enabled).toBe(true);
    await injected.start();
    expect(services.worker.status).toBe("running");
    await services.dispose();
    expect(close).toHaveBeenCalled();
  });

  it("6. API ordinary createServices does not require Redis", async () => {
    const services = createServices();
    expect(services.queueMode).toBe("off");
    await services.dispose();
  });
});

describe("Phase 8.3.2 WorkerRuntime — dispatch / processors", () => {
  it("7. urlChange queue is consumed via dispatch", async () => {
    const h = createRuntimeHarness();
    const { request, sync } = await queueUrlChange(h, "p832:uc:7");
    const result = await h.runtime.dispatch(QUEUE_NAMES.urlChange, {
      type: "urlChange",
      tenantId: TenantA.id,
      requestId: request.id,
      idempotencyKey: request.idempotencyKey,
      jobId: request.jobId!,
      syncJobId: sync.id,
    });
    expect(result).toMatchObject({ status: "COMPLETED" });
    const after = await h.repos.syncJobs.findById(sync.id);
    expect(after?.status).toBe("COMPLETED");
    const ucr = await h.urlChangeRequests.getById(TenantA.id, request.id);
    expect(ucr.status).toBe("SUCCEEDED");
  });

  it("8. conversionUpload queue is consumed via dispatch", async () => {
    const h = createRuntimeHarness();
    const { conversion, sync } = await queueConversion(h, "8");
    const result = await h.runtime.dispatch(QUEUE_NAMES.conversionUpload, {
      type: "conversionUpload",
      tenantId: TenantA.id,
      conversionId: conversion.id,
      idempotencyKey: conversion.idempotencyKey!,
      jobId: `conversionUpload:${conversion.idempotencyKey}`,
      syncJobId: sync.id,
    });
    expect(result).toMatchObject({ status: "COMPLETED" });
    const after = await h.repos.syncJobs.findById(sync.id);
    expect(after?.status).toBe("COMPLETED");
    const conv = await h.orderConversions.getConversion(
      TenantA.id,
      conversion.id
    );
    expect(conv.googleUploadStatus).toBe("UPLOADED");
  });

  it("9. correctly calls processUrlChangeJob", async () => {
    const h = createRuntimeHarness();
    const { request, sync } = await queueUrlChange(h, "p832:uc:9");
    const spy = vi.spyOn(urlChangeWorker, "processUrlChangeJob");
    await h.runtime.dispatch(QUEUE_NAMES.urlChange, {
      type: "urlChange",
      tenantId: TenantA.id,
      requestId: request.id,
      idempotencyKey: request.idempotencyKey,
      jobId: request.jobId!,
      syncJobId: sync.id,
    });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0]).toMatchObject({
      tenantId: TenantA.id,
      requestId: request.id,
      jobId: request.jobId,
      idempotencyKey: request.idempotencyKey,
    });
    spy.mockRestore();
  });

  it("10. correctly calls processConversionUploadJob", async () => {
    const h = createRuntimeHarness();
    const { conversion, sync } = await queueConversion(h, "10");
    const spy = vi.spyOn(conversionUploadWorker, "processConversionUploadJob");
    await h.runtime.dispatch(QUEUE_NAMES.conversionUpload, {
      type: "conversionUpload",
      tenantId: TenantA.id,
      conversionId: conversion.id,
      idempotencyKey: conversion.idempotencyKey!,
      jobId: `conversionUpload:${conversion.idempotencyKey}`,
      syncJobId: sync.id,
    });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0]).toMatchObject({
      tenantId: TenantA.id,
      conversionId: conversion.id,
    });
    spy.mockRestore();
  });

  it("11. job data fields are passed through", async () => {
    const h = createRuntimeHarness();
    const { request, sync } = await queueUrlChange(h, "p832:uc:11");
    const spy = vi.spyOn(urlChangeWorker, "processUrlChangeJob");
    await h.runtime.dispatch(QUEUE_NAMES.urlChange, {
      type: "urlChange",
      tenantId: TenantA.id,
      requestId: request.id,
      idempotencyKey: request.idempotencyKey,
      jobId: request.jobId!,
      syncJobId: sync.id,
    });
    expect(spy.mock.calls[0]![0].syncJobs).toBe(h.repos.syncJobs);
    expect(spy.mock.calls[0]![0].urlChangeRequests).toBe(h.urlChangeRequests);
    spy.mockRestore();
  });

  it("12. processor success ends without throwing", async () => {
    const h = createRuntimeHarness();
    const { request, sync } = await queueUrlChange(h, "p832:uc:12");
    await expect(
      h.runtime.dispatch(QUEUE_NAMES.urlChange, {
        type: "urlChange",
        tenantId: TenantA.id,
        requestId: request.id,
        idempotencyKey: request.idempotencyKey,
        jobId: request.jobId!,
        syncJobId: sync.id,
      })
    ).resolves.toMatchObject({ status: "COMPLETED" });
  });

  it("13. processor throw propagates to caller", async () => {
    const h = createRuntimeHarness();
    const { request, sync } = await queueUrlChange(h, "p832:uc:13");
    vi.spyOn(urlChangeWorker, "processUrlChangeJob").mockRejectedValueOnce(
      new Error("boom-processor")
    );
    await expect(
      h.runtime.dispatch(QUEUE_NAMES.urlChange, {
        type: "urlChange",
        tenantId: TenantA.id,
        requestId: request.id,
        idempotencyKey: request.idempotencyKey,
        jobId: request.jobId!,
        syncJobId: sync.id,
      })
    ).rejects.toThrow("boom-processor");
  });

  it("14. unknown queue name is rejected", async () => {
    const h = createRuntimeHarness();
    await expect(
      h.runtime.dispatch(QUEUE_NAMES.googleAdsSync, {
        type: "urlChange",
        tenantId: TenantA.id,
        requestId: "x",
        idempotencyKey: "x",
        jobId: "x",
      })
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });
});

describe("Phase 8.3.2 WorkerRuntime — tenant isolation", () => {
  it("15. tenantId mismatch is rejected (no provider)", async () => {
    const h = createRuntimeHarness();
    const { request, sync } = await queueUrlChange(h, "p832:uc:15");
    const providerSpy = vi.spyOn(h.provider, "updateEntityUrl");
    await expect(
      h.runtime.dispatch(QUEUE_NAMES.urlChange, {
        type: "urlChange",
        tenantId: TenantB.id,
        requestId: request.id,
        idempotencyKey: request.idempotencyKey,
        jobId: request.jobId!,
        syncJobId: sync.id,
      })
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(providerSpy).not.toHaveBeenCalled();
  });

  it("16. SyncJob missing is rejected", async () => {
    const h = createRuntimeHarness();
    await expect(
      h.runtime.dispatch(QUEUE_NAMES.urlChange, {
        type: "urlChange",
        tenantId: TenantA.id,
        requestId: randomUUID(),
        idempotencyKey: "missing",
        jobId: "urlChange:missing",
        syncJobId: randomUUID(),
      })
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it("17. SyncJob tenant mismatch via wrong syncJobId is rejected", async () => {
    const h = createRuntimeHarness();
    const { request } = await queueUrlChange(h, "p832:uc:17");
    const foreign = await h.repos.syncJobs.create({
      id: randomUUID(),
      tenantId: TenantB.id,
      type: "urlChange",
      status: "PENDING",
      provider: "mock",
      idempotencyScope: "SYNC_JOB",
      idempotencyKey: "foreign:17",
      jobId: "urlChange:foreign:17",
      attempts: 0,
    });
    await expect(
      h.runtime.dispatch(QUEUE_NAMES.urlChange, {
        type: "urlChange",
        tenantId: TenantA.id,
        requestId: request.id,
        idempotencyKey: request.idempotencyKey,
        jobId: request.jobId!,
        syncJobId: foreign.id,
      })
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it("18. cancelled SyncJob is rejected without processor", async () => {
    const h = createRuntimeHarness();
    const { request, sync } = await queueUrlChange(h, "p832:uc:18");
    await h.repos.syncJobs.update(sync.id, { status: "CANCELLED" });
    const spy = vi.spyOn(urlChangeWorker, "processUrlChangeJob");
    await expect(
      h.runtime.dispatch(QUEUE_NAMES.urlChange, {
        type: "urlChange",
        tenantId: TenantA.id,
        requestId: request.id,
        idempotencyKey: request.idempotencyKey,
        jobId: request.jobId!,
        syncJobId: sync.id,
      })
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("19. completed SyncJob is skipped by processIdempotentJob", async () => {
    const h = createRuntimeHarness();
    const { request, sync } = await queueUrlChange(h, "p832:uc:19");
    await h.runtime.dispatch(QUEUE_NAMES.urlChange, {
      type: "urlChange",
      tenantId: TenantA.id,
      requestId: request.id,
      idempotencyKey: request.idempotencyKey,
      jobId: request.jobId!,
      syncJobId: sync.id,
    });
    const second = await h.runtime.dispatch(QUEUE_NAMES.urlChange, {
      type: "urlChange",
      tenantId: TenantA.id,
      requestId: request.id,
      idempotencyKey: request.idempotencyKey,
      jobId: request.jobId!,
      syncJobId: sync.id,
    });
    expect(second).toMatchObject({ skipped: true, status: "COMPLETED" });
  });
});

describe("Phase 8.3.2 WorkerRuntime — malformed / architecture", () => {
  it("20. malformed job.data is rejected", async () => {
    const h = createRuntimeHarness();
    await expect(
      h.runtime.dispatch(QUEUE_NAMES.urlChange, { type: "urlChange" })
    ).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(
      h.runtime.dispatch(QUEUE_NAMES.urlChange, null)
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it("21. parse helpers validate contracts", () => {
    expect(() => parseUrlChangeJobData({ type: "conversionUpload" })).toThrow(
      WorkerJobError
    );
    expect(
      parseConversionUploadJobData({
        type: "conversionUpload",
        tenantId: "t",
        conversionId: "c",
        idempotencyKey: "k",
        jobId: "j",
      })
    ).toMatchObject({ conversionId: "c" });
  });

  it("22. Worker uses SyncJobRepository (findById), not PrismaClient", async () => {
    const h = createRuntimeHarness();
    const { request, sync } = await queueUrlChange(h, "p832:uc:22");
    const findById = vi.spyOn(h.repos.syncJobs, "findById");
    await h.runtime.dispatch(QUEUE_NAMES.urlChange, {
      type: "urlChange",
      tenantId: TenantA.id,
      requestId: request.id,
      idempotencyKey: request.idempotencyKey,
      jobId: request.jobId!,
      syncJobId: sync.id,
    });
    expect(findById).toHaveBeenCalledWith(sync.id);
    expect((h.repos as { prisma?: unknown }).prisma).toBeUndefined();
  });

  it("23. Worker uses MockGoogleAdsProvider abstraction (updateEntityUrl)", async () => {
    const h = createRuntimeHarness();
    const { request, sync } = await queueUrlChange(h, "p832:uc:23");
    const spy = vi.spyOn(h.provider, "updateEntityUrl");
    await h.runtime.dispatch(QUEUE_NAMES.urlChange, {
      type: "urlChange",
      tenantId: TenantA.id,
      requestId: request.id,
      idempotencyKey: request.idempotencyKey,
      jobId: request.jobId!,
      syncJobId: sync.id,
    });
    expect(spy).toHaveBeenCalled();
  });

  it("24. Worker does not import or call google-ads SDK client directly", async () => {
    const src = await import("./runtime.js");
    expect(src.WorkerRuntime).toBeTruthy();
    expect("GoogleAdsApiClient" in src).toBe(false);
    expect("PrismaClient" in src).toBe(false);
  });

  it("25. graceful close timeout surfaces error", async () => {
    const runtime = createWorkerRuntime(
      {
        syncJobs: createSeededMemoryRepositories().syncJobs,
        urlChangeRequests: {} as never,
        orderConversions: {} as never,
        log: { info: () => {}, error: () => {} },
      },
      {
        closeTimeoutMs: 20,
        createWorkers: () => [
          {
            close: () => new Promise(() => {}),
          },
        ],
      }
    );
    await runtime.start();
    await expect(runtime.close()).rejects.toThrow(/timed out/);
  });

  it("26. lookup by jobId when syncJobId omitted", async () => {
    const h = createRuntimeHarness();
    const { request, sync } = await queueUrlChange(h, "p832:uc:26");
    const result = await h.runtime.dispatch(QUEUE_NAMES.urlChange, {
      type: "urlChange",
      tenantId: TenantA.id,
      requestId: request.id,
      idempotencyKey: request.idempotencyKey,
      jobId: request.jobId!,
    });
    expect(result).toMatchObject({ status: "COMPLETED" });
    expect((await h.repos.syncJobs.findById(sync.id))?.status).toBe(
      "COMPLETED"
    );
  });
});
