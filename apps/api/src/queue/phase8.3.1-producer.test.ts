import { describe, expect, it } from "vitest";
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
import { NoopJobProducer } from "./producer.js";
import { createServices } from "../app.js";

const USER = TenantA.user;

describe("Phase 8.3.1 — producer wiring after SyncJob queue", () => {
  it("urlChange queue() enqueues after SyncJob PENDING + business QUEUED", async () => {
    const repos = createSeededMemoryRepositories();
    const producer = new NoopJobProducer();
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
      new MockGoogleAdsProvider(),
      audit,
      repos.unitOfWork,
      repos.syncJobs,
      producer
    );

    const draft = await versions.createVersion({
      tenantId: TenantA.id,
      adId: TenantA.adA1,
      finalUrl: "https://example.com/p831-v2",
      trackingTemplate:
        "https://tracker.example.com/click?cid={_clickid}&url={lpurl}",
      customParameters: { _clickid: "abc123" },
      createdBy: USER,
    });

    const { request } = await changes.create({
      tenantId: TenantA.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      toVersionId: draft.id,
      reason: "phase8.3.1 producer",
      requestedBy: USER,
      idempotencyKey: "p831:uc:1",
    });
    await changes.validate(TenantA.id, request.id);

    const queued = await changes.queue(TenantA.id, request.id);
    expect(queued.status).toBe("QUEUED");
    expect(queued.jobId).toBe(`urlChange:${request.idempotencyKey}`);

    const sync = await repos.syncJobs.findByIdempotencyKey(
      TenantA.id,
      "SYNC_JOB",
      request.idempotencyKey
    );
    expect(sync?.status).toBe("PENDING");
    expect(producer.calls).toHaveLength(1);
    expect(producer.calls[0]).toMatchObject({
      type: "urlChange",
      tenantId: TenantA.id,
      requestId: request.id,
      jobId: queued.jobId,
      syncJobId: sync!.id,
    });
  });

  it("conversion queueUpload() enqueues after SyncJob PENDING", async () => {
    const repos = createSeededMemoryRepositories();
    const producer = new NoopJobProducer();
    const audit = new AuditService(repos.auditLogs);
    const svc = new OrderConversionService(
      repos.orders,
      repos.conversions,
      repos.clicks,
      repos.googleAccounts,
      new MockGoogleAdsProvider(),
      repos.unitOfWork,
      audit,
      repos.syncJobs,
      producer
    );

    const { order } = await svc.createOrder({
      tenantId: TenantA.id,
      orderId: "P831-O1",
      clickId: TenantA.click3,
      value: "9.9900",
      currency: "USD",
      idempotencyKey: "p831:order:1",
    });
    const { conversion } = await svc.createConversionFromOrder({
      tenantId: TenantA.id,
      orderId: order.id,
      conversionAction: "purchase",
      idempotencyKey: "p831:conv:1",
    });

    const queued = await svc.queueUpload(TenantA.id, conversion.id);
    expect(queued.googleUploadStatus).toBe("QUEUED");

    const jobId = `conversionUpload:${conversion.idempotencyKey}`;
    const sync = await repos.syncJobs.findByIdempotencyKey(
      TenantA.id,
      "SYNC_JOB",
      conversion.idempotencyKey!
    );
    expect(sync?.status).toBe("PENDING");
    expect(producer.calls).toHaveLength(1);
    expect(producer.calls[0]).toMatchObject({
      type: "conversionUpload",
      tenantId: TenantA.id,
      conversionId: conversion.id,
      jobId,
      syncJobId: sync!.id,
    });
  });

  it("createServices exposes queueMode=off and closes producer on dispose", async () => {
    const services = createServices();
    expect(services.queueMode).toBe("off");
    await services.dispose();
  });

  it("already-QUEUED url change does not enqueue again", async () => {
    const repos = createSeededMemoryRepositories();
    const producer = new NoopJobProducer();
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
      new MockGoogleAdsProvider(),
      audit,
      repos.unitOfWork,
      repos.syncJobs,
      producer
    );

    const draft = await versions.createVersion({
      tenantId: TenantA.id,
      adId: TenantA.adA1,
      finalUrl: "https://example.com/p831-dup",
      trackingTemplate:
        "https://tracker.example.com/click?cid={_clickid}&url={lpurl}",
      customParameters: { _clickid: "abc123" },
      createdBy: USER,
    });
    const { request } = await changes.create({
      tenantId: TenantA.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      toVersionId: draft.id,
      reason: "dup enqueue",
      requestedBy: USER,
      idempotencyKey: "p831:uc:dup",
    });
    await changes.validate(TenantA.id, request.id);
    await changes.queue(TenantA.id, request.id);
    await changes.queue(TenantA.id, request.id);
    expect(producer.calls).toHaveLength(1);
  });
});
