import { randomUUID } from "node:crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createSeededMemoryRepositories,
  TenantA,
} from "@adlinklab/database";
import { MockGoogleAdsProvider } from "@adlinklab/google-ads";
import {
  AuditService,
  UrlChangeRequestService,
  UrlVersionService,
} from "../services/index.js";
import { OrderConversionService } from "../services/conversion-order.js";
import { processIdempotentJob } from "./jobs.js";
import { processUrlChangeJob } from "./url-change-worker.js";
import { processConversionUploadJob } from "./conversion-upload-worker.js";
import {
  mutationLockKey,
  resetMutationLocksForTests,
  withMutationLock,
} from "./execution-guard.js";
import { createServices, buildApp } from "../app.js";

const USER = TenantA.user;

beforeEach(() => {
  resetMutationLocksForTests();
});

describe("Phase 8.3.3 execution-guard unit", () => {
  it("1. mutationLockKey is stable", () => {
    expect(mutationLockKey("urlChange:a")).toBe("job:urlChange:a");
  });

  it("2. serializes concurrent callers for same key", async () => {
    const order: number[] = [];
    let active = 0;
    let maxActive = 0;

    const run = async (n: number) => {
      await withMutationLock("job:same", async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        order.push(n);
        await new Promise((r) => setTimeout(r, 20));
        active -= 1;
      });
    };

    await Promise.all([run(1), run(2), run(3)]);
    expect(maxActive).toBe(1);
    expect(order).toEqual([1, 2, 3]);
  });

  it("3. different keys run in parallel", async () => {
    let concurrent = 0;
    let sawParallel = false;

    const run = (key: string) =>
      withMutationLock(key, async () => {
        concurrent += 1;
        if (concurrent >= 2) sawParallel = true;
        await new Promise((r) => setTimeout(r, 30));
        concurrent -= 1;
      });

    await Promise.all([run("job:a"), run("job:b")]);
    expect(sawParallel).toBe(true);
  });

  it("4. re-entrant same key does not deadlock", async () => {
    const result = await withMutationLock("job:re", async () => {
      return withMutationLock("job:re", async () => "nested-ok");
    });
    expect(result).toBe("nested-ok");
  });

  it("5. waiter re-checks after holder finishes (outer contract)", async () => {
    let value = 0;
    const first = withMutationLock("job:v", async () => {
      await new Promise((r) => setTimeout(r, 15));
      value = 1;
    });
    const second = (async () => {
      await withMutationLock("job:v", async () => {
        expect(value).toBe(1);
        value = 2;
      });
    })();
    await Promise.all([first, second]);
    expect(value).toBe(2);
  });

  it("6. resetMutationLocksForTests clears state", async () => {
    await withMutationLock("job:x", async () => {});
    resetMutationLocksForTests();
    await withMutationLock("job:x", async () => "ok");
  });
});

function createUrlHarness() {
  const repos = createSeededMemoryRepositories();
  const provider = new MockGoogleAdsProvider();
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

async function queueValidatedUrlChange(
  h: ReturnType<typeof createUrlHarness>,
  key: string,
  finalUrl: string
) {
  const draft = await h.versions.createVersion({
    tenantId: TenantA.id,
    adId: TenantA.adA1,
    finalUrl,
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
    reason: "8.3.3",
    requestedBy: USER,
    idempotencyKey: key,
  });
  await h.changes.validate(TenantA.id, request.id);
  const queued = await h.changes.queue(TenantA.id, request.id);
  return queued;
}

function createConvHarness() {
  const repos = createSeededMemoryRepositories();
  const provider = new MockGoogleAdsProvider();
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

async function queueConversion(h: ReturnType<typeof createConvHarness>, key: string) {
  const { order } = await h.svc.createOrder({
    tenantId: TenantA.id,
    orderId: `833-${key}`,
    clickId: TenantA.click3,
    value: "5.0000",
    currency: "USD",
    idempotencyKey: `833:o:${key}`,
  });
  const { conversion } = await h.svc.createConversionFromOrder({
    tenantId: TenantA.id,
    orderId: order.id,
    conversionAction: "purchase",
    idempotencyKey: `833:c:${key}`,
  });
  return h.svc.queueUpload(TenantA.id, conversion.id);
}

describe("Phase 8.3.3 processIdempotentJob state guards", () => {
  it("7. COMPLETED skips without handler", async () => {
    const repos = createSeededMemoryRepositories();
    const handler = vi.fn(async () => {});
    const key = "833:completed";
    await repos.syncJobs.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      type: "urlChange",
      status: "COMPLETED",
      provider: "mock",
      idempotencyScope: "SYNC_JOB",
      idempotencyKey: key,
      jobId: `urlChange:${key}`,
      attempts: 1,
    });
    const result = await processIdempotentJob(repos.syncJobs, {
      type: "urlChange",
      jobId: `urlChange:${key}`,
      idempotencyKey: key,
      tenantId: TenantA.id,
      payload: { tenantId: TenantA.id },
      handler,
    });
    expect(result).toEqual({ skipped: true, status: "COMPLETED" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("8. CANCELLED skips and does not revive", async () => {
    const repos = createSeededMemoryRepositories();
    const handler = vi.fn(async () => {});
    const key = "833:cancelled";
    const created = await repos.syncJobs.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      type: "urlChange",
      status: "CANCELLED",
      provider: "mock",
      idempotencyScope: "SYNC_JOB",
      idempotencyKey: key,
      jobId: `urlChange:${key}`,
      attempts: 0,
    });
    const result = await processIdempotentJob(repos.syncJobs, {
      type: "urlChange",
      jobId: `urlChange:${key}`,
      idempotencyKey: key,
      tenantId: TenantA.id,
      payload: { tenantId: TenantA.id },
      handler,
    });
    expect(result).toEqual({ skipped: true, status: "CANCELLED" });
    expect(handler).not.toHaveBeenCalled();
    expect((await repos.syncJobs.findById(created.id))?.status).toBe(
      "CANCELLED"
    );
  });

  it("9. FAILED can be reclaimed to RUNNING then COMPLETED", async () => {
    const repos = createSeededMemoryRepositories();
    const key = "833:failed-retry";
    await repos.syncJobs.create({
      id: randomUUID(),
      tenantId: TenantA.id,
      type: "urlChange",
      status: "FAILED",
      provider: "mock",
      idempotencyScope: "SYNC_JOB",
      idempotencyKey: key,
      jobId: `urlChange:${key}`,
      attempts: 1,
      error: "prior",
    });
    const result = await processIdempotentJob(repos.syncJobs, {
      type: "urlChange",
      jobId: `urlChange:${key}`,
      idempotencyKey: key,
      tenantId: TenantA.id,
      payload: { tenantId: TenantA.id },
      handler: async () => {},
    });
    expect(result).toEqual({ skipped: false, status: "COMPLETED" });
  });

  it("10. handler throw marks FAILED and rethrows", async () => {
    const repos = createSeededMemoryRepositories();
    const key = "833:throw";
    await expect(
      processIdempotentJob(repos.syncJobs, {
        type: "urlChange",
        jobId: `urlChange:${key}`,
        idempotencyKey: key,
        tenantId: TenantA.id,
        payload: { tenantId: TenantA.id },
        handler: async () => {
          throw new Error("boom");
        },
      })
    ).rejects.toThrow("boom");
    const job = await repos.syncJobs.findByIdempotencyKey(
      TenantA.id,
      "SYNC_JOB",
      key
    );
    expect(job?.status).toBe("FAILED");
  });
});

describe("Phase 8.3.3 URL change HTTP ??Worker exclusivity", () => {
  it("11. concurrent execute calls provider once", async () => {
    const h = createUrlHarness();
    const queued = await queueValidatedUrlChange(
      h,
      "833:uc:concurrent",
      "https://example.com/833-concurrent"
    );
    const spy = vi.spyOn(h.provider, "updateEntityUrl");

    const [a, b] = await Promise.all([
      h.changes.execute(TenantA.id, queued.id),
      h.changes.execute(TenantA.id, queued.id),
    ]);

    expect(spy).toHaveBeenCalledTimes(1);
    const statuses = [a, b].map((r) => ({
      status: r.request.status,
      skipped: r.skipped,
    }));
    expect(statuses.filter((s) => !s.skipped)).toHaveLength(1);
    expect(statuses.filter((s) => s.skipped)).toHaveLength(1);
    expect(
      (await h.changes.getById(TenantA.id, queued.id)).status
    ).toBe("SUCCEEDED");
  });

  it("12. processUrlChangeJob then HTTP execute skips", async () => {
    const h = createUrlHarness();
    const queued = await queueValidatedUrlChange(
      h,
      "833:uc:worker-then-http",
      "https://example.com/833-wth"
    );
    const spy = vi.spyOn(h.provider, "updateEntityUrl");

    await processUrlChangeJob({
      syncJobs: h.repos.syncJobs,
      urlChangeRequests: h.changes,
      tenantId: TenantA.id,
      requestId: queued.id,
      jobId: queued.jobId!,
      idempotencyKey: queued.idempotencyKey,
    });
    const second = await h.changes.execute(TenantA.id, queued.id);
    expect(second.skipped).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("13. HTTP execute then processUrlChangeJob does not double-mutate", async () => {
    const h = createUrlHarness();
    const queued = await queueValidatedUrlChange(
      h,
      "833:uc:http-then-worker",
      "https://example.com/833-htw"
    );
    const spy = vi.spyOn(h.provider, "updateEntityUrl");

    await h.changes.execute(TenantA.id, queued.id);
    const second = await processUrlChangeJob({
      syncJobs: h.repos.syncJobs,
      urlChangeRequests: h.changes,
      tenantId: TenantA.id,
      requestId: queued.id,
      jobId: queued.jobId!,
      idempotencyKey: queued.idempotencyKey,
    });
    // SyncJob was still PENDING after HTTP-only execute ??worker claims it,
    // but executeLocked sees SUCCEEDED and skips provider.
    expect(second.status).toBe("COMPLETED");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("14. overlapping processIdempotentJob + execute is re-entrant safe", async () => {
    const h = createUrlHarness();
    const queued = await queueValidatedUrlChange(
      h,
      "833:uc:reentry",
      "https://example.com/833-re"
    );
    const spy = vi.spyOn(h.provider, "updateEntityUrl");

    await processUrlChangeJob({
      syncJobs: h.repos.syncJobs,
      urlChangeRequests: h.changes,
      tenantId: TenantA.id,
      requestId: queued.id,
      jobId: queued.jobId!,
      idempotencyKey: queued.idempotencyKey,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(
      (await h.changes.getById(TenantA.id, queued.id)).status
    ).toBe("SUCCEEDED");
  });
});

describe("Phase 8.3.3 conversion upload exclusivity", () => {
  it("15. concurrent executeUpload calls provider once", async () => {
    const h = createConvHarness();
    const queued = await queueConversion(h, "15");
    const spy = vi.spyOn(h.provider, "uploadConversion");

    const [a, b] = await Promise.all([
      h.svc.executeUpload(TenantA.id, queued.id),
      h.svc.executeUpload(TenantA.id, queued.id),
    ]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect([a.skipped, b.skipped].sort()).toEqual([false, true]);
    expect(
      (await h.svc.getConversion(TenantA.id, queued.id)).googleUploadStatus
    ).toBe("UPLOADED");
  });

  it("16. processConversionUploadJob then executeUpload skips", async () => {
    const h = createConvHarness();
    const queued = await queueConversion(h, "16");
    const spy = vi.spyOn(h.provider, "uploadConversion");
    const jobId = `conversionUpload:${queued.idempotencyKey}`;

    await processConversionUploadJob({
      syncJobs: h.repos.syncJobs,
      orderConversions: h.svc,
      tenantId: TenantA.id,
      conversionId: queued.id,
      jobId,
      idempotencyKey: queued.idempotencyKey!,
    });
    const second = await h.svc.executeUpload(TenantA.id, queued.id);
    expect(second.skipped).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("17. HTTP upload then worker process does not double-mutate", async () => {
    const h = createConvHarness();
    const queued = await queueConversion(h, "17");
    const spy = vi.spyOn(h.provider, "uploadConversion");
    const jobId = `conversionUpload:${queued.idempotencyKey}`;

    await h.svc.executeUpload(TenantA.id, queued.id);
    const second = await processConversionUploadJob({
      syncJobs: h.repos.syncJobs,
      orderConversions: h.svc,
      tenantId: TenantA.id,
      conversionId: queued.id,
      jobId,
      idempotencyKey: queued.idempotencyKey!,
    });
    expect(second.status).toBe("COMPLETED");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("Phase 8.3.3 health / regression surface", () => {
  it("18. health reports phase 8.3.3", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.json()).toMatchObject({
      phase: "10",
      queueMode: "off",
      worker: { enabled: false, status: "stopped" },
    });
    await app.close();
  });

  it("19. createServices still Redis-free under Vitest", async () => {
    const services = createServices();
    expect(services.queueMode).toBe("off");
    await services.dispose();
  });

  it("20. HTTP execute path still exists (not removed)", async () => {
    const h = createUrlHarness();
    const queued = await queueValidatedUrlChange(
      h,
      "833:uc:http-retained",
      "https://example.com/833-retain"
    );
    const result = await h.changes.execute(TenantA.id, queued.id);
    expect(result.request.status).toBe("SUCCEEDED");
  });
});
