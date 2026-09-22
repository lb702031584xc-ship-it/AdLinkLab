/**
 * Phase 7.1 — PostgreSQL runtime for OrderConversionService + API (TEST-ONLY).
 * Reuses Phase 6.1 harness. Opt-in: PHASE61_PG=1 or PHASE71_PG=1
 * Does not modify business code.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createPrismaRepositories,
  PrismaUnitOfWork,
} from "@adlinklab/database";
import { AuditActions } from "@adlinklab/domain";
import {
  isRetryableGoogleAdsCode,
  MockGoogleAdsProvider,
} from "@adlinklab/google-ads";
import { resolveGoogleClickIdentity } from "@adlinklab/conversions";
import {
  phase61DatabaseUrl,
  startPhase61Postgres,
  stopPhase61Postgres,
} from "../../../../packages/database/scripts/phase61-pg-harness.mts";
import { AuditService, OrderConversionService } from "./index.js";
import { processConversionUploadJob } from "../queue/conversion-upload-worker.js";
import { buildApp, createServices } from "../app.js";

const DB_ROOT = join(
  fileURLToPath(new URL("../../../../packages/database", import.meta.url))
);
const RUN_PG =
  process.env.PHASE61_PG === "1" || process.env.PHASE71_PG === "1";

async function seedTenantGraph(
  prisma: PrismaClient,
  label: string,
  clickIds?: {
    gclid?: string | null;
    gbraid?: string | null;
    wbraid?: string | null;
  }
) {
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
      email: `${label}-${userId.slice(0, 8)}@example.com`,
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
      gclid: clickIds?.gclid === null ? null : (clickIds?.gclid ?? "TEST_GCLID_DEFAULT"),
      gbraid: clickIds?.gbraid ?? null,
      wbraid: clickIds?.wbraid ?? null,
      occurredAt: new Date(),
    },
  });
  return { tenantId, clickId, trackingId, accountId, offerId, customerId };
}

function createSvc(prisma: PrismaClient, provider = new MockGoogleAdsProvider()) {
  const repos = createPrismaRepositories(prisma);
  const uow = new PrismaUnitOfWork(prisma);
  const audit = new AuditService(repos.auditLogs);
  const svc = new OrderConversionService(
    repos.orders,
    repos.conversions,
    repos.clicks,
    repos.googleAccounts,
    provider,
    uow,
    audit,
    repos.syncJobs
  );
  return { repos, uow, audit, svc, provider };
}

describe.skipIf(!RUN_PG)("Phase 7.1 PostgreSQL OrderConversion runtime", () => {
  let prisma: PrismaClient;
  let startedByUs = false;

  beforeAll(async () => {
    process.env.DATABASE_URL = phase61DatabaseUrl();
    prisma = new PrismaClient({
      datasources: { db: { url: phase61DatabaseUrl() } },
    });

    let healthy = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'conversions'
      `;
      healthy = tables.length > 0;
    } catch {
      healthy = false;
      await prisma.$disconnect().catch(() => undefined);
    }

    if (!healthy) {
      await startPhase61Postgres();
      startedByUs = true;
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
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (startedByUs) {
      await stopPhase61Postgres();
    }
  });

  it("Order → Conversion authority via Order.conversionId", async () => {
    const { svc } = createSvc(prisma);
    const graph = await seedTenantGraph(prisma, "auth");
    const { order } = await svc.createOrder({
      tenantId: graph.tenantId,
      orderId: "P71-AUTH-1",
      clickId: graph.clickId,
      value: "12.3400",
      currency: "USD",
      idempotencyKey: "p71:auth:o",
    });
    const { conversion, order: linked } = await svc.createConversionFromOrder({
      tenantId: graph.tenantId,
      orderId: order.id,
      conversionAction: "purchase",
      idempotencyKey: "p71:auth:c",
    });
    expect(linked.conversionId).toBe(conversion.id);
    const fromDb = await prisma.order.findUnique({ where: { id: order.id } });
    expect(fromDb?.conversionId).toBe(conversion.id);
  });

  it("tenant isolation: B cannot get/queue/execute A conversion", async () => {
    const { svc } = createSvc(prisma);
    const a = await seedTenantGraph(prisma, "iso-a");
    const b = await seedTenantGraph(prisma, "iso-b");
    const { order } = await svc.createOrder({
      tenantId: a.tenantId,
      orderId: "P71-ISO",
      clickId: a.clickId,
      value: "1.00",
      currency: "USD",
      idempotencyKey: "p71:iso:o",
    });
    const { conversion } = await svc.createConversionFromOrder({
      tenantId: a.tenantId,
      orderId: order.id,
      conversionAction: "purchase",
      idempotencyKey: "p71:iso:c",
    });
    await expect(svc.getConversion(b.tenantId, conversion.id)).rejects.toBeTruthy();
    await expect(svc.queueUpload(b.tenantId, conversion.id)).rejects.toBeTruthy();
    await expect(svc.executeUpload(b.tenantId, conversion.id)).rejects.toBeTruthy();
    await expect(svc.cancelUpload(b.tenantId, conversion.id)).rejects.toBeTruthy();
    await expect(svc.retryUpload(b.tenantId, conversion.id)).rejects.toBeTruthy();
    const listB = await svc.listConversions(b.tenantId);
    expect(listB.items.some((c) => c.id === conversion.id)).toBe(false);
  });

  it("attribution Case A/B/C/D", async () => {
    const { svc } = createSvc(prisma);
    const a = await seedTenantGraph(prisma, "attr-a", {
      gclid: "TEST_GCLID_A",
      gbraid: null,
      wbraid: null,
    });
    expect(
      resolveGoogleClickIdentity(
        (await prisma.click.findUnique({ where: { id: a.clickId } }))!
      )
    ).toEqual({ kind: "gclid", value: "TEST_GCLID_A" });

    const b = await seedTenantGraph(prisma, "attr-b", {
      gclid: null,
      gbraid: "TEST_GBRAID_B",
      wbraid: null,
    });
    expect(
      resolveGoogleClickIdentity(
        (await prisma.click.findUnique({ where: { id: b.clickId } }))!
      )
    ).toEqual({ kind: "gbraid", value: "TEST_GBRAID_B" });

    const c = await seedTenantGraph(prisma, "attr-c", {
      gclid: null,
      gbraid: null,
      wbraid: "TEST_WBRAID_C",
    });
    expect(
      resolveGoogleClickIdentity(
        (await prisma.click.findUnique({ where: { id: c.clickId } }))!
      )
    ).toEqual({ kind: "wbraid", value: "TEST_WBRAID_C" });

    const d = await seedTenantGraph(prisma, "attr-d", {
      gclid: null,
      gbraid: null,
      wbraid: null,
    });
    const { order } = await svc.createOrder({
      tenantId: d.tenantId,
      orderId: "P71-SKIP",
      clickId: d.clickId,
      value: "1.00",
      currency: "USD",
      idempotencyKey: "p71:skip:o",
    });
    const { conversion } = await svc.createConversionFromOrder({
      tenantId: d.tenantId,
      orderId: order.id,
      conversionAction: "purchase",
      idempotencyKey: "p71:skip:c",
    });
    expect(conversion.googleUploadStatus).toBe("SKIPPED");
  });

  it("conversion + order idempotency (service + DB)", async () => {
    const { svc } = createSvc(prisma);
    const g = await seedTenantGraph(prisma, "idem");
    const o1 = await svc.createOrder({
      tenantId: g.tenantId,
      orderId: "P71-IDEM-O",
      clickId: g.clickId,
      value: "9.9900",
      currency: "USD",
      idempotencyKey: "p71:idem:o",
    });
    const o2 = await svc.createOrder({
      tenantId: g.tenantId,
      orderId: "P71-IDEM-O",
      clickId: g.clickId,
      value: "9.9900",
      currency: "USD",
      idempotencyKey: "p71:idem:o",
    });
    expect(o2.created).toBe(false);
    expect(o2.order.id).toBe(o1.order.id);

    const c1 = await svc.createConversionFromOrder({
      tenantId: g.tenantId,
      orderId: o1.order.id,
      conversionAction: "purchase",
      idempotencyKey: "p71:idem:c",
    });
    const c2 = await svc.createConversionFromOrder({
      tenantId: g.tenantId,
      orderId: o1.order.id,
      conversionAction: "purchase",
      idempotencyKey: "p71:idem:c",
    });
    expect(c2.created).toBe(false);
    expect(c2.conversion.id).toBe(c1.conversion.id);
    const count = await prisma.conversion.count({
      where: { tenantId: g.tenantId, idempotencyKey: "p71:idem:c" },
    });
    expect(count).toBe(1);
  });

  it("queue idempotency: triple queue → one SyncJob", async () => {
    const { svc } = createSvc(prisma);
    const g = await seedTenantGraph(prisma, "qidem");
    const { order } = await svc.createOrder({
      tenantId: g.tenantId,
      orderId: "P71-Q",
      clickId: g.clickId,
      value: "2.00",
      currency: "USD",
      idempotencyKey: "p71:q:o",
    });
    const { conversion } = await svc.createConversionFromOrder({
      tenantId: g.tenantId,
      orderId: order.id,
      conversionAction: "purchase",
      idempotencyKey: "p71:q:c",
    });
    await svc.queueUpload(g.tenantId, conversion.id);
    await svc.queueUpload(g.tenantId, conversion.id);
    await svc.queueUpload(g.tenantId, conversion.id);
    const jobs = await prisma.syncJob.findMany({
      where: {
        tenantId: g.tenantId,
        type: "conversionUpload",
        idempotencyKey: conversion.idempotencyKey!,
      },
    });
    expect(jobs).toHaveLength(1);
    const fresh = await svc.getConversion(g.tenantId, conversion.id);
    expect(fresh.googleUploadStatus).toBe("QUEUED");
  });

  it("execute idempotency via processQueued", async () => {
    const { svc } = createSvc(prisma);
    const g = await seedTenantGraph(prisma, "exidem");
    const { order } = await svc.createOrder({
      tenantId: g.tenantId,
      orderId: "P71-EX",
      clickId: g.clickId,
      value: "3.00",
      currency: "USD",
      idempotencyKey: "p71:ex:o",
    });
    const { conversion } = await svc.createConversionFromOrder({
      tenantId: g.tenantId,
      orderId: order.id,
      conversionAction: "purchase",
      idempotencyKey: "p71:ex:c",
    });
    await svc.queueUpload(g.tenantId, conversion.id);
    const first = await svc.processQueued(g.tenantId, conversion.id);
    expect(first.conversion.googleUploadStatus).toBe("UPLOADED");
    const second = await svc.processQueued(g.tenantId, conversion.id);
    expect(second.sync.skipped).toBe(true);
    expect(second.conversion.googleUploadStatus).toBe("UPLOADED");
    const jobs = await prisma.syncJob.findMany({
      where: { tenantId: g.tenantId, idempotencyKey: "p71:ex:c" },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("COMPLETED");
  });

  it("concurrent processQueued → one logical upload", async () => {
    const { svc } = createSvc(prisma);
    const g = await seedTenantGraph(prisma, "conc");
    const { order } = await svc.createOrder({
      tenantId: g.tenantId,
      orderId: "P71-CONC",
      clickId: g.clickId,
      value: "4.00",
      currency: "USD",
      idempotencyKey: "p71:conc:o",
    });
    const { conversion } = await svc.createConversionFromOrder({
      tenantId: g.tenantId,
      orderId: order.id,
      conversionAction: "purchase",
      idempotencyKey: "p71:conc:c",
    });
    await svc.queueUpload(g.tenantId, conversion.id);
    const results = await Promise.allSettled([
      svc.processQueued(g.tenantId, conversion.id),
      svc.processQueued(g.tenantId, conversion.id),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const latest = await svc.getConversion(g.tenantId, conversion.id);
    expect(latest.googleUploadStatus).toBe("UPLOADED");
    const jobs = await prisma.syncJob.findMany({
      where: { tenantId: g.tenantId, idempotencyKey: "p71:conc:c" },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("COMPLETED");
  });

  it("provider error classification + retry path", async () => {
    expect(isRetryableGoogleAdsCode("RATE_LIMITED")).toBe(true);
    expect(isRetryableGoogleAdsCode("TEMPORARY_ERROR")).toBe(true);
    expect(isRetryableGoogleAdsCode("INVALID_ARGUMENT")).toBe(false);
    expect(isRetryableGoogleAdsCode("PROVIDER_ERROR")).toBe(false);

    const provider = new MockGoogleAdsProvider();
    provider.configureError({
      method: "uploadConversion",
      code: "TEMPORARY_ERROR",
    });
    const { svc } = createSvc(prisma, provider);
    const g = await seedTenantGraph(prisma, "retry");
    const { order } = await svc.createOrder({
      tenantId: g.tenantId,
      orderId: "P71-RETRY",
      clickId: g.clickId,
      value: "5.00",
      currency: "USD",
      idempotencyKey: "p71:retry:o",
    });
    const { conversion } = await svc.createConversionFromOrder({
      tenantId: g.tenantId,
      orderId: order.id,
      conversionAction: "purchase",
      idempotencyKey: "p71:retry:c",
    });
    await svc.queueUpload(g.tenantId, conversion.id);
    await expect(
      svc.executeUpload(g.tenantId, conversion.id)
    ).rejects.toBeTruthy();
    expect(
      (await svc.getConversion(g.tenantId, conversion.id)).googleUploadStatus
    ).toBe("FAILED");

    provider.configureError(null);
    const retried = await svc.retryUpload(g.tenantId, conversion.id);
    expect(retried.googleUploadStatus).toBe("QUEUED");
    const { conversion: uploaded } = await svc.executeUpload(
      g.tenantId,
      conversion.id
    );
    expect(uploaded.googleUploadStatus).toBe("UPLOADED");
  });

  it("non-retryable INVALID_ARGUMENT → FAILED (no auto success)", async () => {
    const provider = new MockGoogleAdsProvider();
    provider.configureError({
      method: "uploadConversion",
      code: "INVALID_ARGUMENT",
    });
    const { svc } = createSvc(prisma, provider);
    const g = await seedTenantGraph(prisma, "nret");
    const { order } = await svc.createOrder({
      tenantId: g.tenantId,
      orderId: "P71-NRET",
      clickId: g.clickId,
      value: "5.00",
      currency: "USD",
      idempotencyKey: "p71:nret:o",
    });
    const { conversion } = await svc.createConversionFromOrder({
      tenantId: g.tenantId,
      orderId: order.id,
      conversionAction: "purchase",
      idempotencyKey: "p71:nret:c",
    });
    await svc.queueUpload(g.tenantId, conversion.id);
    await expect(
      svc.executeUpload(g.tenantId, conversion.id)
    ).rejects.toBeTruthy();
    expect(
      (await svc.getConversion(g.tenantId, conversion.id)).googleUploadStatus
    ).toBe("FAILED");
  });

  it("cancel QUEUED → SKIPPED; execute is no-op skip", async () => {
    const { svc } = createSvc(prisma);
    const g = await seedTenantGraph(prisma, "cancel");
    const { order } = await svc.createOrder({
      tenantId: g.tenantId,
      orderId: "P71-CANCEL",
      clickId: g.clickId,
      value: "6.00",
      currency: "USD",
      idempotencyKey: "p71:cancel:o",
    });
    const { conversion } = await svc.createConversionFromOrder({
      tenantId: g.tenantId,
      orderId: order.id,
      conversionAction: "purchase",
      idempotencyKey: "p71:cancel:c",
    });
    await svc.queueUpload(g.tenantId, conversion.id);
    const cancelled = await svc.cancelUpload(g.tenantId, conversion.id);
    expect(cancelled.googleUploadStatus).toBe("SKIPPED");
    const result = await svc.executeUpload(g.tenantId, conversion.id);
    expect(result.skipped).toBe(true);
    expect(result.conversion.googleUploadStatus).toBe("SKIPPED");
  });

  it("audit actions tenant-scoped", async () => {
    const { svc, audit } = createSvc(prisma);
    const g = await seedTenantGraph(prisma, "aud");
    const { order } = await svc.createOrder({
      tenantId: g.tenantId,
      orderId: "P71-AUD",
      clickId: g.clickId,
      value: "7.00",
      currency: "USD",
      idempotencyKey: "p71:aud:o",
    });
    const { conversion } = await svc.createConversionFromOrder({
      tenantId: g.tenantId,
      orderId: order.id,
      conversionAction: "purchase",
      idempotencyKey: "p71:aud:c",
    });
    await svc.queueUpload(g.tenantId, conversion.id);
    await svc.executeUpload(g.tenantId, conversion.id);

    const logs = await prisma.auditLog.findMany({
      where: { tenantId: g.tenantId },
    });
    const actions = new Set(logs.map((l) => l.action));
    expect(actions.has(AuditActions.ORDER_CREATED)).toBe(true);
    expect(actions.has(AuditActions.CONVERSION_CREATED)).toBe(true);
    expect(actions.has(AuditActions.CONVERSION_QUEUED)).toBe(true);
    expect(actions.has(AuditActions.CONVERSION_UPLOADED)).toBe(true);
    expect(logs.every((l) => l.tenantId === g.tenantId)).toBe(true);
    expect(audit).toBeTruthy();
  });

  it("worker helper uploads against PG SyncJob", async () => {
    const { svc, repos } = createSvc(prisma);
    const g = await seedTenantGraph(prisma, "worker");
    const { order } = await svc.createOrder({
      tenantId: g.tenantId,
      orderId: "P71-WORKER",
      clickId: g.clickId,
      value: "8.00",
      currency: "USD",
      idempotencyKey: "p71:worker:o",
    });
    const { conversion } = await svc.createConversionFromOrder({
      tenantId: g.tenantId,
      orderId: order.id,
      conversionAction: "purchase",
      idempotencyKey: "p71:worker:c",
    });
    await svc.queueUpload(g.tenantId, conversion.id);
    const result = await processConversionUploadJob({
      syncJobs: repos.syncJobs,
      orderConversions: svc,
      tenantId: g.tenantId,
      conversionId: conversion.id,
      jobId: `conversionUpload:${conversion.idempotencyKey}`,
      idempotencyKey: conversion.idempotencyKey!,
    });
    expect(result.status).toBe("COMPLETED");
    expect(
      (await svc.getConversion(g.tenantId, conversion.id)).googleUploadStatus
    ).toBe("UPLOADED");
  });

  it("API runtime against PG-backed services", async () => {
    const { svc } = createSvc(prisma);
    const g = await seedTenantGraph(prisma, "api");
    const base = createServices();
    const app = await buildApp({
      ...base,
      orders: svc,
      conversions: svc,
    });

    const createOrder = await app.inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: { "x-tenant-id": g.tenantId },
      payload: {
        orderId: "P71-API-O",
        clickId: g.clickId,
        value: "11.0000",
        currency: "USD",
        idempotencyKey: "p71:api:o",
      },
    });
    expect(createOrder.statusCode).toBe(200);
    const orderBody = createOrder.json() as {
      order: { id: string };
      created: boolean;
    };
    expect(orderBody.created).toBe(true);

    const fromOrder = await app.inject({
      method: "POST",
      url: "/api/v1/conversions/from-order",
      headers: { "x-tenant-id": g.tenantId },
      payload: {
        orderId: orderBody.order.id,
        conversionAction: "purchase",
        idempotencyKey: "p71:api:c",
      },
    });
    expect(fromOrder.statusCode).toBe(200);
    const convId = (fromOrder.json() as { conversion: { id: string } })
      .conversion.id;

    const queue = await app.inject({
      method: "POST",
      url: `/api/v1/conversions/${convId}/queue`,
      headers: { "x-tenant-id": g.tenantId },
    });
    expect(queue.statusCode).toBe(200);

    const execute = await app.inject({
      method: "POST",
      url: `/api/v1/conversions/${convId}/execute`,
      headers: { "x-tenant-id": g.tenantId },
    });
    expect(execute.statusCode).toBe(200);
    expect(
      (execute.json() as { conversion: { googleUploadStatus: string } })
        .conversion.googleUploadStatus
    ).toBe("UPLOADED");

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/orders",
      headers: { "x-tenant-id": g.tenantId },
    });
    expect(list.statusCode).toBe(200);

    const get = await app.inject({
      method: "GET",
      url: `/api/v1/conversions/${convId}`,
      headers: { "x-tenant-id": g.tenantId },
    });
    expect(get.statusCode).toBe(200);

    const other = await seedTenantGraph(prisma, "api-b");
    const cross = await app.inject({
      method: "GET",
      url: `/api/v1/conversions/${convId}`,
      headers: { "x-tenant-id": other.tenantId },
    });
    expect(cross.statusCode).toBeGreaterThanOrEqual(400);

    await app.close();
  });

  it("archivedAt/deletedAt present; uploadAttempts/uploadedAt absent (current design)", async () => {
    const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'conversions'
    `;
    const names = new Set(cols.map((c) => c.column_name));
    expect(names.has("archived_at")).toBe(true);
    expect(names.has("deleted_at")).toBe(true);
    expect(names.has("upload_attempts")).toBe(false);
    expect(names.has("uploaded_at")).toBe(false);
  });

  it("gbraid upload uses mock external id containing gbraid", async () => {
    const { svc } = createSvc(prisma);
    const g = await seedTenantGraph(prisma, "gbraid", {
      gclid: null,
      gbraid: "TEST_GBRAID_UPLOAD",
      wbraid: null,
    });
    const { order } = await svc.createOrder({
      tenantId: g.tenantId,
      orderId: "P71-GB",
      clickId: g.clickId,
      value: "1.50",
      currency: "USD",
      idempotencyKey: "p71:gb:o",
    });
    const { conversion } = await svc.createConversionFromOrder({
      tenantId: g.tenantId,
      orderId: order.id,
      conversionAction: "purchase",
      idempotencyKey: "p71:gb:c",
    });
    await svc.queueUpload(g.tenantId, conversion.id);
    const { conversion: uploaded } = await svc.executeUpload(
      g.tenantId,
      conversion.id
    );
    expect(uploaded.googleConversionResourceName).toContain("TEST_GBRAID_UPLOAD");
  });
});
