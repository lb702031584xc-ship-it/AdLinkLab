import { describe, expect, it } from "vitest";
import { createSeededMemoryRepositories, TenantA } from "@adlinklab/database";
import { AuditActions } from "@adlinklab/domain";
import { MockGoogleAdsProvider } from "@adlinklab/google-ads";
import {
  AuditService,
  UrlChangeRequestService,
  UrlVersionService,
} from "./index.js";

function createChanges() {
  const repos = createSeededMemoryRepositories();
  const versions = new UrlVersionService(
    repos.urlVersions,
    repos.ads,
    repos.unitOfWork
  );
  const audit = new AuditService(repos.auditLogs);
  const provider = new MockGoogleAdsProvider();
  const changes = new UrlChangeRequestService(
    repos.urlChangeRequests,
    repos.urlVersions,
    repos.ads,
    provider,
    audit,
    repos.unitOfWork,
    repos.syncJobs
  );
  return { repos, versions, audit, provider, changes };
}

describe("URL change request lifecycle", () => {
  it("runs Create → Validate → Preview → Queue → Provider → Audit", async () => {
    const { versions, changes, provider, audit } = createChanges();

    const draft = await versions.createVersion({
      tenantId: TenantA.id,
      adId: TenantA.adA1,
      finalUrl: "https://example.com/landing-v2",
      trackingTemplate:
        "https://tracker.example.com/click?cid={_clickid}&url={lpurl}",
      customParameters: { _clickid: "v2" },
      status: "DRAFT",
      createdBy: TenantA.user,
    });

    const { request, created } = await changes.create({
      tenantId: TenantA.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      toVersionId: draft.id,
      reason: "Phase 6 lifecycle test",
      requestedBy: TenantA.user,
      idempotencyKey: "urlChange:test:lifecycle:1",
    });
    expect(created).toBe(true);
    expect(request.status).toBe("DRAFT");

    const validated = await changes.validate(TenantA.id, request.id);
    expect(validated.status).toBe("VALIDATED");

    const preview = await changes.preview(TenantA.id, request.id);
    expect(preview.servingPreview.finalUrl).toBe(
      "https://example.com/landing-v2"
    );

    const queued = await changes.queue(TenantA.id, request.id);
    expect(queued.status).toBe("QUEUED");
    expect(queued.jobId).toBeTruthy();

    const executed = await changes.execute(TenantA.id, request.id);
    expect(executed.skipped).toBe(false);
    expect(executed.request.status).toBe("SUCCEEDED");

    const ads = await provider.listAds("ag-2001");
    expect(ads[0]?.finalUrl).toBe("https://example.com/landing-v2");

    const logs = await audit.list(TenantA.id);
    expect(
      logs.items.some(
        (l) => l.action === AuditActions.URL_CHANGE_REQUEST_SUCCEEDED
      )
    ).toBe(true);
  });
});

describe("UrlChangeRequest idempotency", () => {
  it("does not create duplicate requests or re-mutate on retry", async () => {
    const { versions, changes } = createChanges();

    const draft = await versions.createVersion({
      tenantId: TenantA.id,
      adId: TenantA.adA1,
      finalUrl: "https://example.com/idempotent",
      status: "DRAFT",
    });

    const key = "urlChange:test:idempotency:unique";
    const first = await changes.create({
      tenantId: TenantA.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      toVersionId: draft.id,
      reason: "idempotency",
      requestedBy: "user-1",
      idempotencyKey: key,
    });
    const second = await changes.create({
      tenantId: TenantA.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      toVersionId: draft.id,
      reason: "idempotency",
      requestedBy: "user-1",
      idempotencyKey: key,
    });

    expect(second.created).toBe(false);
    expect(second.request.id).toBe(first.request.id);

    await changes.validate(TenantA.id, first.request.id);
    await changes.queue(TenantA.id, first.request.id);
    const exec1 = await changes.execute(TenantA.id, first.request.id);
    const exec2 = await changes.execute(TenantA.id, first.request.id);

    expect(exec1.skipped).toBe(false);
    expect(exec2.skipped).toBe(true);
    expect(exec2.request.status).toBe("SUCCEEDED");

    const all = await changes.list(TenantA.id);
    expect(all.items.filter((r) => r.idempotencyKey === key)).toHaveLength(1);
  });
});

describe("URL version append-only", () => {
  it("rejects content mutation via updateStatus path", async () => {
    const repos = createSeededMemoryRepositories();
    const versions = await repos.urlVersions.list();
    const v1 = versions.items[0]!;
    const originalUrl = v1.finalUrl;

    await repos.urlVersions.updateStatus(v1.id, { status: "SUPERSEDED" });
    const after = await repos.urlVersions.findById(v1.id);
    expect(after?.finalUrl).toBe(originalUrl);
    expect(after?.status).toBe("SUPERSEDED");
  });
});

describe("Audit logging for URL change", () => {
  it("records entityType, versions, requestedBy, jobId, status, timestamp", async () => {
    const repos = createSeededMemoryRepositories();
    const audit = new AuditService(repos.auditLogs);
    await audit.recordUrlChange({
      action: AuditActions.URL_CHANGE_REQUEST_SUCCEEDED,
      tenantId: TenantA.id,
      entityType: "AD",
      entityId: TenantA.adA1,
      fromVersion: 1,
      toVersion: 2,
      requestedBy: TenantA.user,
      jobId: "job-1",
      status: "SUCCEEDED",
      changeRequestId: "req-1",
    });

    const logs = await audit.list(TenantA.id);
    const entry = logs.items.find((l) => l.resourceId === "req-1");
    expect(entry?.action).toBe(AuditActions.URL_CHANGE_REQUEST_SUCCEEDED);
    expect(entry?.metadata.entityType).toBe("AD");
    expect(entry?.metadata.fromVersion).toBe(1);
    expect(entry?.metadata.toVersion).toBe(2);
    expect(entry?.metadata.requestedBy).toBeTruthy();
    expect(entry?.metadata.jobId).toBe("job-1");
    expect(entry?.metadata.status).toBe("SUCCEEDED");
    expect(entry?.metadata.timestamp).toBeTruthy();
  });
});
