/**
 * Phase 8.3.5 ??Runtime Verification (Queue / Worker hardening acceptance).
 *
 * Always-on: in-memory orchestration (no Redis / PG required).
 * Opt-in Redis: PHASE835_RUNTIME=1 or PHASE83_REDIS=1
 * Opt-in PG:    PHASE835_PG=1 or PHASE835_FULL=1
 * Full stack:   PHASE835_FULL=1 (requires both PG + Redis)
 *
 * TEST-ONLY ??does not modify business semantics.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";
import {
  createPrismaRepositories,
  createSeededMemoryRepositories,
  PrismaUnitOfWork,
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
import { createServices, buildApp } from "../app.js";
import { BullMqJobProducer } from "./producer.js";
import { createRedisConnection, QUEUE_NAMES } from "./jobs.js";
import { createWorkerRuntime } from "./runtime.js";
import { resetMutationLocksForTests } from "./execution-guard.js";
import {
  phase61DatabaseUrl,
  startPhase61Postgres,
  stopPhase61Postgres,
} from "../../../../packages/database/scripts/phase61-pg-harness.mts";

const USER = TenantA.user;
const DB_ROOT = join(
  fileURLToPath(new URL("../../../../packages/database", import.meta.url))
);

const RUN_REDIS =
  process.env.PHASE835_RUNTIME === "1" ||
  process.env.PHASE83_REDIS === "1" ||
  process.env.PHASE835_FULL === "1";
const RUN_PG =
  process.env.PHASE835_PG === "1" || process.env.PHASE835_FULL === "1";

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
    return (await client.ping()) === "PONG";
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

async function waitForSyncJob(
  syncJobs: { findById: (id: string) => Promise<{ status: string } | null> },
  syncJobId: string,
  target: string,
  ms = 20_000
) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const job = await syncJobs.findById(syncJobId);
    if (job?.status === target) return job;
    await new Promise((r) => setTimeout(r, 200));
  }
  return syncJobs.findById(syncJobId);
}

function createMemoryStack(provider = new MockGoogleAdsProvider()) {
  resetMutationLocksForTests();
  const repos = createSeededMemoryRepositories();
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

function createPrismaStack(prisma: PrismaClient, provider = new MockGoogleAdsProvider()) {
  resetMutationLocksForTests();
  const repos = createPrismaRepositories(prisma);
  const uow = new PrismaUnitOfWork(prisma);
  const audit = new AuditService(repos.auditLogs);
  const urlChangeRequests = new UrlChangeRequestService(
    repos.urlChangeRequests,
    repos.urlVersions,
    repos.ads,
    provider,
    audit,
    uow,
    repos.syncJobs
  );
  const orderConversions = new OrderConversionService(
    repos.orders,
    repos.conversions,
    repos.clicks,
    repos.googleAccounts,
    provider,
    uow,
    audit,
    repos.syncJobs
  );
  const runtime = createWorkerRuntime({
    syncJobs: repos.syncJobs,
    urlChangeRequests,
    orderConversions,
    log: { info: () => {}, error: () => {} },
  });
  return { repos, provider, urlChangeRequests, orderConversions, runtime, uow };
}

async function seedPgConversionGraph(prisma: PrismaClient, label: string) {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const offerId = randomUUID();
  const landingId = randomUUID();
  const trackingId = randomUUID();
  const clickId = randomUUID();
  const accountId = randomUUID();
  const customerId = `mock-cust-${label}-${accountId.slice(0, 8)}`;
  await prisma.tenant.create({
    data: {
      id: tenantId,
      name: label,
      slug: `${label}-${tenantId.slice(0, 8)}`,
      status: "ACTIVE",
    },
  });
  await prisma.user.create({
    data: {
      id: userId,
      tenantId,
      email: `${label}@example.com`,
      name: label,
      status: "ACTIVE",
    },
  });
  await prisma.googleAccount.create({
    data: {
      id: accountId,
      tenantId,
      userId,
      name: `${label}-ga`,
      customerId,
      currency: "USD",
      timezone: "UTC",
      status: "ACTIVE",
    },
  });
  await prisma.offer.create({
    data: {
      id: offerId,
      tenantId,
      name: `${label}-offer`,
      network: "test",
      destinationUrl: "https://example.com",
      status: "ACTIVE",
    },
  });
  await prisma.landingPage.create({
    data: {
      id: landingId,
      tenantId,
      offerId,
      name: "lp",
      url: "https://example.com/lp",
      domain: "example.com",
      status: "ACTIVE",
    },
  });
  await prisma.trackingLink.create({
    data: {
      id: trackingId,
      tenantId,
      publicId: `trk-${label}-${trackingId.slice(0, 8)}`,
      offerId,
      landingPageId: landingId,
      status: "ACTIVE",
    },
  });
  await prisma.click.create({
    data: {
      id: clickId,
      clickId,
      tenantId,
      trackingLinkId: trackingId,
      gclid: `GCLID_${label}`,
      occurredAt: new Date(),
    },
  });
  return { tenantId, clickId, customerId };
}

async function seedPgUrlChangeGraph(prisma: PrismaClient, label: string) {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const accountId = randomUUID();
  const campaignId = randomUUID();
  const adGroupId = randomUUID();
  const adId = randomUUID();
  const googleAdId = "ad-3001";
  await prisma.tenant.create({
    data: {
      id: tenantId,
      name: label,
      slug: `${label}-${tenantId.slice(0, 8)}`,
      status: "ACTIVE",
    },
  });
  await prisma.user.create({
    data: {
      id: userId,
      tenantId,
      email: `${label}@example.com`,
      name: label,
      status: "ACTIVE",
    },
  });
  await prisma.googleAccount.create({
    data: {
      id: accountId,
      tenantId,
      userId,
      name: `${label}-ga`,
      customerId: `mock-cust-${label}`,
      currency: "USD",
      timezone: "UTC",
      status: "ACTIVE",
    },
  });
  await prisma.campaign.create({
    data: {
      id: campaignId,
      tenantId,
      googleAccountId: accountId,
      googleCampaignId: `camp-${label}`,
      name: `${label}-camp`,
      status: "ACTIVE",
    },
  });
  await prisma.adGroup.create({
    data: {
      id: adGroupId,
      tenantId,
      campaignId,
      googleAdGroupId: "ag-2001",
      name: `${label}-ag`,
      status: "ACTIVE",
    },
  });
  await prisma.ad.create({
    data: {
      id: adId,
      tenantId,
      adGroupId,
      googleAdId,
      name: `${label}-ad`,
      status: "ACTIVE",
    },
  });
  return { tenantId, adId, googleAdId };
}

async function bootstrapPg(): Promise<{
  prisma: PrismaClient;
  startedByUs: boolean;
}> {
  process.env.DATABASE_URL = phase61DatabaseUrl();
  const boot = await startPhase61Postgres();
  const startedByUs = !boot.reused;

  let prisma = new PrismaClient({
    datasources: { db: { url: phase61DatabaseUrl() } },
  });
  let needsSchema = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename = 'sync_jobs'
    `;
    needsSchema = tables.length === 0;
  } catch {
    needsSchema = true;
    await prisma.$disconnect().catch(() => undefined);
  }
  if (needsSchema) {
    const reset = spawnSync(
      "pnpm",
      ["exec", "tsx", "scripts/phase61-reset-db.mts"],
      {
        cwd: DB_ROOT,
        env: { ...process.env, DATABASE_URL: phase61DatabaseUrl() },
        encoding: "utf8",
        shell: true,
      }
    );
    if (reset.status !== 0) {
      throw new Error(`reset failed: ${reset.stdout}\n${reset.stderr}`);
    }
    const migrate = spawnSync(
      "pnpm",
      ["exec", "tsx", "scripts/phase61-migrate-deploy.mts"],
      {
        cwd: DB_ROOT,
        env: { ...process.env, DATABASE_URL: phase61DatabaseUrl() },
        encoding: "utf8",
        shell: true,
      }
    );
    if (migrate.status !== 0) {
      throw new Error(`migrate failed: ${migrate.stdout}\n${migrate.stderr}`);
    }
    prisma = new PrismaClient({
      datasources: { db: { url: phase61DatabaseUrl() } },
    });
    await prisma.$queryRaw`SELECT 1`;
  }
  return { prisma, startedByUs };
}

describe("Phase 8.3.5 memory runtime verification", () => {
  beforeAll(() => resetMutationLocksForTests());

  it("1. urlChange: queue ??Worker only ??SUCCEEDED + SyncJob COMPLETED", async () => {
    const h = createMemoryStack();
    const key = `p835:uc:${randomUUID().slice(0, 8)}`;
    const draft = await h.versions.createVersion({
      tenantId: TenantA.id,
      adId: TenantA.adA1,
      finalUrl: `https://example.com/${key}`,
      trackingTemplate:
        "https://tracker.example.com/click?cid={_clickid}&url={lpurl}",
      customParameters: { _clickid: "x" },
      createdBy: USER,
    });
    const { request } = await h.urlChangeRequests.create({
      tenantId: TenantA.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      toVersionId: draft.id,
      reason: "835",
      requestedBy: USER,
      idempotencyKey: key,
    });
    await h.urlChangeRequests.validate(TenantA.id, request.id);
    const queued = await h.urlChangeRequests.queue(TenantA.id, request.id);
    const sync = (await h.repos.syncJobs.findByIdempotencyKey(
      TenantA.id,
      "SYNC_JOB",
      key
    ))!;
    expect(sync.status).toBe("PENDING");

    const providerSpy = vi.spyOn(h.provider, "updateEntityUrl");
    await h.runtime.dispatch(QUEUE_NAMES.urlChange, {
      type: "urlChange",
      tenantId: TenantA.id,
      requestId: queued.id,
      idempotencyKey: key,
      jobId: queued.jobId!,
      syncJobId: sync.id,
    });

    expect(providerSpy).toHaveBeenCalledTimes(1);
    expect((await h.repos.syncJobs.findById(sync.id))?.status).toBe(
      "COMPLETED"
    );
    expect((await h.urlChangeRequests.getById(TenantA.id, queued.id)).status).toBe(
      "SUCCEEDED"
    );
  });

  it("2. conversionUpload: queue ??Worker only ??UPLOADED", async () => {
    const h = createMemoryStack();
    const { order } = await h.orderConversions.createOrder({
      tenantId: TenantA.id,
      orderId: `835-O-${randomUUID().slice(0, 8)}`,
      clickId: TenantA.click3,
      value: "2.0000",
      currency: "USD",
      idempotencyKey: `835:o:${randomUUID().slice(0, 8)}`,
    });
    const { conversion } = await h.orderConversions.createConversionFromOrder({
      tenantId: TenantA.id,
      orderId: order.id,
      conversionAction: "purchase",
      idempotencyKey: `835:c:${randomUUID().slice(0, 8)}`,
    });
    await h.orderConversions.queueUpload(TenantA.id, conversion.id);
    const sync = (await h.repos.syncJobs.findByIdempotencyKey(
      TenantA.id,
      "SYNC_JOB",
      conversion.idempotencyKey!
    ))!;
    const uploadSpy = vi.spyOn(h.provider, "uploadConversion");

    await h.runtime.dispatch(QUEUE_NAMES.conversionUpload, {
      type: "conversionUpload",
      tenantId: TenantA.id,
      conversionId: conversion.id,
      idempotencyKey: conversion.idempotencyKey!,
      jobId: `conversionUpload:${conversion.idempotencyKey}`,
      syncJobId: sync.id,
    });

    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect((await h.repos.syncJobs.findById(sync.id))?.status).toBe(
      "COMPLETED"
    );
    expect(
      (await h.orderConversions.getConversion(TenantA.id, conversion.id))
        .googleUploadStatus
    ).toBe("UPLOADED");
  });

  it("3. crash recovery: soft-fail then redelivery succeeds once", async () => {
    const provider = new MockGoogleAdsProvider();
    provider.configureError({
      method: "updateEntityUrl",
      code: "TEMPORARY_ERROR",
    });
    const h = createMemoryStack(provider);
    const key = `p835:recover:${randomUUID().slice(0, 8)}`;
    const draft = await h.versions.createVersion({
      tenantId: TenantA.id,
      adId: TenantA.adA1,
      finalUrl: "https://example.com/recover",
      trackingTemplate:
        "https://tracker.example.com/click?cid={_clickid}&url={lpurl}",
      customParameters: { _clickid: "r" },
      createdBy: USER,
    });
    const { request } = await h.urlChangeRequests.create({
      tenantId: TenantA.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      toVersionId: draft.id,
      reason: "recover",
      requestedBy: USER,
      idempotencyKey: key,
    });
    await h.urlChangeRequests.validate(TenantA.id, request.id);
    const queued = await h.urlChangeRequests.queue(TenantA.id, request.id);
    const sync = (await h.repos.syncJobs.findByIdempotencyKey(
      TenantA.id,
      "SYNC_JOB",
      key
    ))!;
    const payload = {
      type: "urlChange" as const,
      tenantId: TenantA.id,
      requestId: queued.id,
      idempotencyKey: key,
      jobId: queued.jobId!,
      syncJobId: sync.id,
    };
    const providerSpy = vi.spyOn(provider, "updateEntityUrl");

    await expect(
      h.runtime.dispatch(QUEUE_NAMES.urlChange, payload, {
        softRetryEnabled: true,
        attemptsMade: 0,
        maxAttempts: 3,
      })
    ).rejects.toBeInstanceOf(GoogleAdsProviderError);
    expect((await h.repos.syncJobs.findById(sync.id))?.status).toBe("PENDING");

    provider.configureError(null);
    await h.runtime.dispatch(QUEUE_NAMES.urlChange, payload, {
      softRetryEnabled: true,
      attemptsMade: 1,
      maxAttempts: 3,
    });
    expect(providerSpy).toHaveBeenCalledTimes(2);
    expect((await h.repos.syncJobs.findById(sync.id))?.status).toBe(
      "COMPLETED"
    );

    const redelivery = await h.runtime.dispatch(QUEUE_NAMES.urlChange, payload, {
      softRetryEnabled: true,
      attemptsMade: 2,
      maxAttempts: 3,
    });
    expect(redelivery).toMatchObject({ skipped: true, status: "COMPLETED" });
    expect(providerSpy).toHaveBeenCalledTimes(2);
  });

  it("4. manual retryUpload after terminal Worker failure", async () => {
    const provider = new MockGoogleAdsProvider();
    provider.configureError({
      method: "uploadConversion",
      code: "INVALID_ARGUMENT",
    });
    const h = createMemoryStack(provider);
    const { order } = await h.orderConversions.createOrder({
      tenantId: TenantA.id,
      orderId: `835-F-${randomUUID().slice(0, 8)}`,
      clickId: TenantA.click3,
      value: "1.0000",
      currency: "USD",
      idempotencyKey: `835:fo:${randomUUID().slice(0, 8)}`,
    });
    const { conversion } = await h.orderConversions.createConversionFromOrder({
      tenantId: TenantA.id,
      orderId: order.id,
      conversionAction: "purchase",
      idempotencyKey: `835:fc:${randomUUID().slice(0, 8)}`,
    });
    await h.orderConversions.queueUpload(TenantA.id, conversion.id);
    const sync = (await h.repos.syncJobs.findByIdempotencyKey(
      TenantA.id,
      "SYNC_JOB",
      conversion.idempotencyKey!
    ))!;

    await expect(
      h.runtime.dispatch(QUEUE_NAMES.conversionUpload, {
        type: "conversionUpload",
        tenantId: TenantA.id,
        conversionId: conversion.id,
        idempotencyKey: conversion.idempotencyKey!,
        jobId: `conversionUpload:${conversion.idempotencyKey}`,
        syncJobId: sync.id,
      })
    ).rejects.toBeTruthy();
    expect(
      (await h.orderConversions.getConversion(TenantA.id, conversion.id))
        .googleUploadStatus
    ).toBe("FAILED");

    provider.configureError(null);
    await h.orderConversions.retryUpload(TenantA.id, conversion.id);
    await h.runtime.dispatch(QUEUE_NAMES.conversionUpload, {
      type: "conversionUpload",
      tenantId: TenantA.id,
      conversionId: conversion.id,
      idempotencyKey: conversion.idempotencyKey!,
      jobId: `conversionUpload:${conversion.idempotencyKey}`,
      syncJobId: sync.id,
    });
    expect(
      (await h.orderConversions.getConversion(TenantA.id, conversion.id))
        .googleUploadStatus
    ).toBe("UPLOADED");
  });

  it("5. WorkerRuntime start ??close lifecycle", async () => {
    const h = createMemoryStack();
    const close = vi.fn(async () => {});
    const runtime = createWorkerRuntime(
      {
        syncJobs: h.repos.syncJobs,
        urlChangeRequests: h.urlChangeRequests,
        orderConversions: h.orderConversions,
        log: { info: () => {}, error: () => {} },
      },
      { createWorkers: () => [{ close }] }
    );
    await runtime.start();
    expect(runtime.getStatus()).toBe("running");
    await runtime.close();
    expect(close).toHaveBeenCalledOnce();
    expect(runtime.getStatus()).toBe("stopped");
  });

  it("6. default Vitest remains Redis-free", async () => {
    const s = createServices();
    expect(s.queueMode).toBe("off");
    await s.dispose();
  });

  it("7. health reports phase 10", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.json()).toMatchObject({
      phase: "10",
      status: "ok",
      queueMode: "off",
    });
    await app.close();
  });
});

describe.skipIf(!RUN_REDIS)("Phase 8.3.5 Redis runtime (PHASE835_RUNTIME=1)", () => {
  let redisOk = false;

  beforeAll(async () => {
    redisOk = await probeRedis();
    if (!redisOk) console.warn("SKIPPED ??Redis unavailable");
  }, 10_000);

  it("8. Producer ??Redis ??Worker ??COMPLETED (urlChange)", async (ctx) => {
    if (!redisOk) {
      ctx.skip();
      return;
    }
    const h = createMemoryStack();
    const connection = createRedisConnection();
    const producer = new BullMqJobProducer(connection);
    const runtime = createWorkerRuntime(
      {
        syncJobs: h.repos.syncJobs,
        urlChangeRequests: h.urlChangeRequests,
        orderConversions: h.orderConversions,
        log: { info: () => {}, error: () => {} },
      },
      { connection }
    );
    await runtime.start();
    try {
      const key = `p835:redis:uc:${Date.now()}`;
      const draft = await h.versions.createVersion({
        tenantId: TenantA.id,
        adId: TenantA.adA1,
        finalUrl: "https://example.com/redis-835",
        trackingTemplate:
          "https://tracker.example.com/click?cid={_clickid}&url={lpurl}",
        customParameters: { _clickid: "r" },
        createdBy: USER,
      });
      const { request } = await h.urlChangeRequests.create({
        tenantId: TenantA.id,
        entityType: "AD",
        entityId: TenantA.adA1,
        toVersionId: draft.id,
        reason: "835-redis",
        requestedBy: USER,
        idempotencyKey: key,
      });
      await h.urlChangeRequests.validate(TenantA.id, request.id);
      const queued = await h.urlChangeRequests.queue(TenantA.id, request.id);
      const sync = (await h.repos.syncJobs.findByIdempotencyKey(
        TenantA.id,
        "SYNC_JOB",
        key
      ))!;
      await producer.enqueueUrlChange({
        type: "urlChange",
        tenantId: TenantA.id,
        requestId: queued.id,
        idempotencyKey: key,
        jobId: queued.jobId!,
        syncJobId: sync.id,
      });
      const finalJob = await waitForSyncJob(h.repos.syncJobs, sync.id, "COMPLETED");
      expect(finalJob?.status).toBe("COMPLETED");
      expect(
        (await h.urlChangeRequests.getById(TenantA.id, queued.id)).status
      ).toBe("SUCCEEDED");
    } finally {
      await runtime.close();
      await producer.close();
    }
  }, 35_000);

  it("9. Producer ??Redis ??Worker ??COMPLETED (conversionUpload)", async (ctx) => {
    if (!redisOk) {
      ctx.skip();
      return;
    }
    const h = createMemoryStack();
    const connection = createRedisConnection();
    const producer = new BullMqJobProducer(connection);
    const runtime = createWorkerRuntime(
      {
        syncJobs: h.repos.syncJobs,
        urlChangeRequests: h.urlChangeRequests,
        orderConversions: h.orderConversions,
        log: { info: () => {}, error: () => {} },
      },
      { connection }
    );
    await runtime.start();
    try {
      const { order } = await h.orderConversions.createOrder({
        tenantId: TenantA.id,
        orderId: `REDIS835-O-${Date.now()}`,
        clickId: TenantA.click3,
        value: "3.5000",
        currency: "USD",
        idempotencyKey: `p835:redis:o:${Date.now()}`,
      });
      const { conversion } = await h.orderConversions.createConversionFromOrder({
        tenantId: TenantA.id,
        orderId: order.id,
        conversionAction: "purchase",
        idempotencyKey: `p835:redis:c:${Date.now()}`,
      });
      await h.orderConversions.queueUpload(TenantA.id, conversion.id);
      const sync = (await h.repos.syncJobs.findByIdempotencyKey(
        TenantA.id,
        "SYNC_JOB",
        conversion.idempotencyKey!
      ))!;
      await producer.enqueueConversionUpload({
        type: "conversionUpload",
        tenantId: TenantA.id,
        conversionId: conversion.id,
        idempotencyKey: conversion.idempotencyKey!,
        jobId: `conversionUpload:${conversion.idempotencyKey}`,
        syncJobId: sync.id,
      });
      const finalJob = await waitForSyncJob(h.repos.syncJobs, sync.id, "COMPLETED");
      expect(finalJob?.status).toBe("COMPLETED");
      expect(
        (await h.orderConversions.getConversion(TenantA.id, conversion.id))
          .googleUploadStatus
      ).toBe("UPLOADED");
    } finally {
      await runtime.close();
      await producer.close();
    }
  }, 35_000);
});

describe.skipIf(!RUN_PG)("Phase 8.3.5 PostgreSQL runtime (PHASE835_PG=1)", () => {
  let prisma: PrismaClient;
  let startedByUs = false;

  beforeAll(async () => {
    const boot = await bootstrapPg();
    prisma = boot.prisma;
    startedByUs = boot.startedByUs;
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => undefined);
    if (startedByUs) await stopPhase61Postgres();
  }, 60_000);

  it("10. PG: queue ??Worker dispatch ??SyncJob COMPLETED (conversionUpload)", async () => {
    const g = await seedPgConversionGraph(prisma, `p835-conv-${Date.now()}`);
    const h = createPrismaStack(prisma);
    const { order } = await h.orderConversions.createOrder({
      tenantId: g.tenantId,
      orderId: `P835-CO-${Date.now()}`,
      clickId: g.clickId,
      value: "7.0000",
      currency: "USD",
      idempotencyKey: `p835:pg:o:${Date.now()}`,
    });
    const { conversion } = await h.orderConversions.createConversionFromOrder({
      tenantId: g.tenantId,
      orderId: order.id,
      conversionAction: "purchase",
      idempotencyKey: `p835:pg:c:${Date.now()}`,
    });
    await h.orderConversions.queueUpload(g.tenantId, conversion.id);
    const sync = (await h.repos.syncJobs.findByIdempotencyKey(
      g.tenantId,
      "SYNC_JOB",
      conversion.idempotencyKey!
    ))!;
    expect(sync.status).toBe("PENDING");

    await h.runtime.dispatch(QUEUE_NAMES.conversionUpload, {
      type: "conversionUpload",
      tenantId: g.tenantId,
      conversionId: conversion.id,
      idempotencyKey: conversion.idempotencyKey!,
      jobId: `conversionUpload:${conversion.idempotencyKey}`,
      syncJobId: sync.id,
    });

    const fromDb = await prisma.syncJob.findUnique({ where: { id: sync.id } });
    expect(fromDb?.status).toBe("COMPLETED");
    const convDb = await prisma.conversion.findUnique({
      where: { id: conversion.id },
    });
    expect(convDb?.googleUploadStatus).toBe("UPLOADED");

    const prisma2 = new PrismaClient({
      datasources: { db: { url: phase61DatabaseUrl() } },
    });
    const reloaded = await prisma2.syncJob.findUnique({ where: { id: sync.id } });
    expect(reloaded?.status).toBe("COMPLETED");
    await prisma2.$disconnect();
  }, 60_000);

  it("11. PG: queue ??Worker dispatch ??SyncJob COMPLETED (urlChange)", async () => {
    const g = await seedPgUrlChangeGraph(prisma, `p835-uc-${Date.now()}`);
    const h = createPrismaStack(prisma);
    const versions = new UrlVersionService(
      h.repos.urlVersions,
      h.repos.ads,
      h.uow
    );
    const draft = await versions.createVersion({
      tenantId: g.tenantId,
      adId: g.adId,
      finalUrl: "https://example.com/pg-835-uc",
      trackingTemplate:
        "https://tracker.example.com/click?cid={_clickid}&url={lpurl}",
      customParameters: { _clickid: "pg" },
      createdBy: USER,
    });
    const { request } = await h.urlChangeRequests.create({
      tenantId: g.tenantId,
      entityType: "AD",
      entityId: g.adId,
      toVersionId: draft.id,
      reason: "pg-835",
      requestedBy: USER,
      idempotencyKey: `p835:pg:uc:${Date.now()}`,
    });
    await h.urlChangeRequests.validate(g.tenantId, request.id);
    const queued = await h.urlChangeRequests.queue(g.tenantId, request.id);
    const sync = (await h.repos.syncJobs.findByIdempotencyKey(
      g.tenantId,
      "SYNC_JOB",
      request.idempotencyKey
    ))!;

    await h.runtime.dispatch(QUEUE_NAMES.urlChange, {
      type: "urlChange",
      tenantId: g.tenantId,
      requestId: queued.id,
      idempotencyKey: request.idempotencyKey,
      jobId: queued.jobId!,
      syncJobId: sync.id,
    });

    const ucrDb = await prisma.urlChangeRequest.findUnique({
      where: { id: queued.id },
    });
    expect(ucrDb?.status).toBe("SUCCEEDED");
    const syncDb = await prisma.syncJob.findUnique({ where: { id: sync.id } });
    expect(syncDb?.status).toBe("COMPLETED");
  }, 60_000);

  it("12. PG: createServices(prisma) wires queue hardening stack", async () => {
    const services = createServices({ persistence: "prisma", prisma });
    expect(services.persistence).toBe("prisma");
    expect(services.syncJobs).toBeTruthy();
    await services.dispose();
  }, 30_000);
});

describe.skipIf(
  process.env.PHASE835_FULL !== "1"
)("Phase 8.3.5 PG + Redis full stack (PHASE835_FULL=1)", () => {
    let prisma: PrismaClient;
    let startedByUs = false;
    let redisOk = false;

    beforeAll(async () => {
      redisOk = await probeRedis();
      if (!redisOk) console.warn("SKIPPED ??Redis unavailable");
      const boot = await bootstrapPg();
      prisma = boot.prisma;
      startedByUs = boot.startedByUs;
    }, 180_000);

    afterAll(async () => {
      await prisma?.$disconnect().catch(() => undefined);
      if (startedByUs) await stopPhase61Postgres();
    }, 60_000);

    it("13. PG SyncJob + Redis Producer + Worker ??COMPLETED", async (ctx) => {
      if (!redisOk) {
        ctx.skip();
        return;
      }
      const g = await seedPgConversionGraph(prisma, `p835-full-${Date.now()}`);
      const h = createPrismaStack(prisma);
      const connection = createRedisConnection();
      const producer = new BullMqJobProducer(connection);
      await runtimeStart(h, connection);
      try {
        const { order } = await h.orderConversions.createOrder({
          tenantId: g.tenantId,
          orderId: `P835-FULL-${Date.now()}`,
          clickId: g.clickId,
          value: "4.0000",
          currency: "USD",
          idempotencyKey: `p835:full:o:${Date.now()}`,
        });
        const { conversion } = await h.orderConversions.createConversionFromOrder({
          tenantId: g.tenantId,
          orderId: order.id,
          conversionAction: "purchase",
          idempotencyKey: `p835:full:c:${Date.now()}`,
        });
        await h.orderConversions.queueUpload(g.tenantId, conversion.id);
        const sync = (await h.repos.syncJobs.findByIdempotencyKey(
          g.tenantId,
          "SYNC_JOB",
          conversion.idempotencyKey!
        ))!;
        await producer.enqueueConversionUpload({
          type: "conversionUpload",
          tenantId: g.tenantId,
          conversionId: conversion.id,
          idempotencyKey: conversion.idempotencyKey!,
          jobId: `conversionUpload:${conversion.idempotencyKey}`,
          syncJobId: sync.id,
        });
        const finalJob = await waitForSyncJob(h.repos.syncJobs, sync.id, "COMPLETED");
        expect(finalJob?.status).toBe("COMPLETED");
        const fromPg = await prisma.syncJob.findUnique({ where: { id: sync.id } });
        expect(fromPg?.status).toBe("COMPLETED");
      } finally {
        await runtimeRef?.close();
        await producer.close();
      }
    }, 45_000);
  }
);

let runtimeRef: ReturnType<typeof createWorkerRuntime> | undefined;

async function runtimeStart(
  h: ReturnType<typeof createPrismaStack>,
  connection: ReturnType<typeof createRedisConnection>
) {
  runtimeRef = createWorkerRuntime(
    {
      syncJobs: h.repos.syncJobs,
      urlChangeRequests: h.urlChangeRequests,
      orderConversions: h.orderConversions,
      log: { info: () => {}, error: () => {} },
    },
    { connection }
  );
  await runtimeRef.start();
}
