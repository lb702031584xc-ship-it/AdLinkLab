/**
 * Phase 8.3.2 — opt-in Redis E2E:
 *   Producer → Redis → Worker → process*Job
 *
 * Run: PHASE83_REDIS=1 pnpm --filter @adlinklab/api test
 * If Redis unavailable: tests are SKIPPED (not reported as pass).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import IORedis from "ioredis";
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
import { BullMqJobProducer } from "./producer.js";
import { createRedisConnection, QUEUE_NAMES } from "./jobs.js";
import { createWorkerRuntime } from "./runtime.js";

const RUN = process.env.PHASE83_REDIS === "1";
const USER = TenantA.user;

async function probeRedis(): Promise<boolean> {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  const client = new IORedis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1500,
    lazyConnect: true,
    enableOfflineQueue: false,
  });
  try {
    await client.connect();
    const pong = await client.ping();
    return pong === "PONG";
  } catch {
    return false;
  } finally {
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
  }
}

describe.skipIf(!RUN)("Phase 8.3.2 Redis runtime (PHASE83_REDIS=1)", () => {
  let redisOk = false;

  beforeAll(async () => {
    redisOk = await probeRedis();
    if (!redisOk) {
      console.warn("SKIPPED — Redis unavailable");
    }
  }, 10_000);

  afterAll(async () => {
    // no global resources
  });

  it("enqueue urlChange → Worker → SyncJob COMPLETED", async (ctx) => {
    if (!redisOk) {
      ctx.skip();
      return;
    }

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

    const connection = createRedisConnection();
    const producer = new BullMqJobProducer(connection);
    const runtime = createWorkerRuntime(
      {
        syncJobs: repos.syncJobs,
        urlChangeRequests,
        orderConversions,
        log: { info: () => {}, error: () => {} },
      },
      { connection }
    );
    await runtime.start();

    try {
      const draft = await versions.createVersion({
        tenantId: TenantA.id,
        adId: TenantA.adA1,
        finalUrl: "https://example.com/redis-uc",
        trackingTemplate:
          "https://tracker.example.com/click?cid={_clickid}&url={lpurl}",
        customParameters: { _clickid: "r" },
        createdBy: USER,
      });
      const { request } = await urlChangeRequests.create({
        tenantId: TenantA.id,
        entityType: "AD",
        entityId: TenantA.adA1,
        toVersionId: draft.id,
        reason: "redis-e2e",
        requestedBy: USER,
        idempotencyKey: `p832:redis:uc:${Date.now()}`,
      });
      await urlChangeRequests.validate(TenantA.id, request.id);
      const queued = await urlChangeRequests.queue(TenantA.id, request.id);
      const sync = await repos.syncJobs.findByIdempotencyKey(
        TenantA.id,
        "SYNC_JOB",
        request.idempotencyKey
      );
      expect(sync).toBeTruthy();

      const enq = await producer.enqueueUrlChange({
        type: "urlChange",
        tenantId: TenantA.id,
        requestId: queued.id,
        idempotencyKey: request.idempotencyKey,
        jobId: queued.jobId!,
        syncJobId: sync!.id,
      });
      expect(enq.enqueued).toBe(true);

      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const job = await repos.syncJobs.findById(sync!.id);
        if (job?.status === "COMPLETED") break;
        await new Promise((r) => setTimeout(r, 200));
      }
      expect((await repos.syncJobs.findById(sync!.id))?.status).toBe(
        "COMPLETED"
      );
      expect(
        (await urlChangeRequests.getById(TenantA.id, queued.id)).status
      ).toBe("SUCCEEDED");
    } finally {
      await runtime.close();
      await producer.close();
    }
  }, 30_000);

  it("enqueue conversionUpload → Worker → SyncJob COMPLETED", async (ctx) => {
    if (!redisOk) {
      ctx.skip();
      return;
    }

    const repos = createSeededMemoryRepositories();
    const provider = new MockGoogleAdsProvider();
    const audit = new AuditService(repos.auditLogs);
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

    const connection = createRedisConnection();
    const producer = new BullMqJobProducer(connection);
    const runtime = createWorkerRuntime(
      {
        syncJobs: repos.syncJobs,
        urlChangeRequests,
        orderConversions,
        log: { info: () => {}, error: () => {} },
      },
      { connection }
    );
    await runtime.start();

    try {
      const { order } = await orderConversions.createOrder({
        tenantId: TenantA.id,
        orderId: `REDIS-O-${Date.now()}`,
        clickId: TenantA.click3,
        value: "3.5000",
        currency: "USD",
        idempotencyKey: `p832:redis:o:${Date.now()}`,
      });
      const { conversion } = await orderConversions.createConversionFromOrder({
        tenantId: TenantA.id,
        orderId: order.id,
        conversionAction: "purchase",
        idempotencyKey: `p832:redis:c:${Date.now()}`,
      });
      const queued = await orderConversions.queueUpload(
        TenantA.id,
        conversion.id
      );
      const sync = await repos.syncJobs.findByIdempotencyKey(
        TenantA.id,
        "SYNC_JOB",
        conversion.idempotencyKey!
      );
      expect(sync).toBeTruthy();

      const jobId = `conversionUpload:${conversion.idempotencyKey}`;
      const enq = await producer.enqueueConversionUpload({
        type: "conversionUpload",
        tenantId: TenantA.id,
        conversionId: queued.id,
        idempotencyKey: conversion.idempotencyKey!,
        jobId,
        syncJobId: sync!.id,
      });
      expect(enq.enqueued).toBe(true);
      expect(QUEUE_NAMES.conversionUpload).toBe("conversionUpload");

      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const job = await repos.syncJobs.findById(sync!.id);
        if (job?.status === "COMPLETED") break;
        await new Promise((r) => setTimeout(r, 200));
      }
      expect((await repos.syncJobs.findById(sync!.id))?.status).toBe(
        "COMPLETED"
      );
      expect(
        (
          await orderConversions.getConversion(TenantA.id, conversion.id)
        ).googleUploadStatus
      ).toBe("UPLOADED");
    } finally {
      await runtime.close();
      await producer.close();
    }
  }, 30_000);
});
