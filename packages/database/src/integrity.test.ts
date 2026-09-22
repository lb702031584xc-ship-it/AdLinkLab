import { describe, expect, it } from "vitest";
import { ConflictError } from "@adlinklab/shared";
import { createSeededMemoryRepositories } from "./memory/repositories.js";
import { InMemoryUrlVersionRepository } from "./memory/repositories.js";
import type { UrlVersion } from "@adlinklab/domain";

/**
 * Phase 1.1 database integrity tests (in-memory constraint enforcement).
 * PostgreSQL integration tests are skipped when DATABASE ENVIRONMENT UNAVAILABLE.
 */
describe("Phase 1.1 database integrity", () => {
  it("1. unique Google Customer", async () => {
    const repos = createSeededMemoryRepositories();
    const existing = (await repos.googleAccounts.list()).items[0]!;
    await expect(
      repos.googleAccounts.create({
        ...existing,
        id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("2. unique Campaign external ID per account", async () => {
    const repos = createSeededMemoryRepositories();
    const camp = (await repos.campaigns.list()).items[0]!;
    await expect(
      repos.campaigns.create({
        ...camp,
        id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee01",
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("3. unique Ad external ID per AdGroup", async () => {
    const repos = createSeededMemoryRepositories();
    const ad = (await repos.ads.list()).items[0]!;
    await expect(
      repos.ads.create({
        ...ad,
        id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee02",
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("4. unique Criterion external ID per AdGroup", async () => {
    const repos = createSeededMemoryRepositories();
    const crit = (await repos.adGroupCriteria.list()).items[0]!;
    await expect(
      repos.adGroupCriteria.create({
        ...crit,
        id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee03",
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("5. unique TrackingLink publicId", async () => {
    const repos = createSeededMemoryRepositories();
    const link = (await repos.trackingLinks.list()).items[0]!;
    await expect(
      repos.trackingLinks.create({
        ...link,
        id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee04",
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("6. unique UrlVersion entity/version", async () => {
    const repos = createSeededMemoryRepositories();
    const v1 = (await repos.urlVersions.listByAdId(
      "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
    ))[0]!;
    await expect(
      repos.urlVersions.create({
        ...v1,
        id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee05",
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("7. unique UrlChangeRequest tenant+scope+idempotencyKey", async () => {
    const repos = createSeededMemoryRepositories();
    const base = {
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee06",
      tenantId: "00000000-0000-4000-8000-000000000001",
      entityType: "AD" as const,
      entityId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      toVersionId: "66666666-6666-4666-8666-666666666667",
      reason: "test",
      requestedBy: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      status: "DRAFT" as const,
      idempotencyScope: "URL_CHANGE",
      idempotencyKey: "idem-unique-1",
    };
    await repos.urlChangeRequests.create(base);
    await expect(
      repos.urlChangeRequests.create({
        ...base,
        id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee07",
      })
    ).rejects.toBeInstanceOf(ConflictError);

    // Same key allowed under a different tenant
    await expect(
      repos.urlChangeRequests.create({
        ...base,
        id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee0d",
        tenantId: "00000000-0000-4000-8000-000000000099",
      })
    ).resolves.toBeTruthy();
  });

  it("8. unique SyncJob tenant+scope+idempotencyKey", async () => {
    const repos = createSeededMemoryRepositories();
    const job = (await repos.syncJobs.list()).items[0]!;
    await expect(
      repos.syncJobs.create({
        ...job,
        id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee08",
        jobId: "job-other",
      })
    ).rejects.toBeInstanceOf(ConflictError);

    // Same key allowed under a different tenant
    await expect(
      repos.syncJobs.create({
        ...job,
        id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee0e",
        tenantId: "00000000-0000-4000-8000-000000000099",
        jobId: "job-other-tenant",
      })
    ).resolves.toBeTruthy();
  });

  it("9. Order tenant uniqueness", async () => {
    const repos = createSeededMemoryRepositories();
    const order = (await repos.orders.list()).items[0]!;
    await expect(
      repos.orders.create({
        ...order,
        id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee09",
      })
    ).rejects.toBeInstanceOf(ConflictError);

    // Same orderId allowed under a different tenant
    await expect(
      repos.orders.create({
        ...order,
        id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee0a",
        tenantId: "00000000-0000-4000-8000-000000000099",
      })
    ).resolves.toBeTruthy();
  });

  it("10. historical UrlVersion cannot be overwritten", async () => {
    const repos = createSeededMemoryRepositories();
    const v1 = (await repos.urlVersions.listByAdId(
      "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
    )).find((v) => v.version === 1)!;
    const original = v1.finalUrl;
    await repos.urlVersions.updateStatus(v1.id, { status: "ROLLED_BACK" });
    const after = await repos.urlVersions.findById(v1.id);
    expect(after?.finalUrl).toBe(original);
    expect(after?.status).toBe("ROLLED_BACK");
  });

  it("11. Click can exist without Conversion", async () => {
    const repos = createSeededMemoryRepositories();
    const click = await repos.clicks.create({
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee0b",
      tenantId: "00000000-0000-4000-8000-000000000001",
      trackingLinkId: "22222222-2222-4222-8222-222222222222",
      gclid: "orphan-gclid",
    });
    const conversions = await repos.conversions.list();
    expect(conversions.items.every((c) => c.clickId !== click.id)).toBe(true);
  });

  it("12. Conversion must reference Click", async () => {
    const repos = createSeededMemoryRepositories();
    const conversion = (await repos.conversions.list()).items[0]!;
    expect(conversion.clickId).toBeTruthy();
    const click = await repos.clicks.findById(conversion.clickId);
    expect(click).not.toBeNull();
  });

  it("13. Order attribution chain", async () => {
    const repos = createSeededMemoryRepositories();
    const order = (await repos.orders.list()).items[0]!;
    expect(order.clickId).toBeTruthy();
    expect(order.conversionId).toBeTruthy();
    const click = await repos.clicks.findById(order.clickId!);
    const conversion = await repos.conversions.findById(order.conversionId!);
    expect(click).not.toBeNull();
    expect(conversion?.clickId).toBe(order.clickId);
  });

  it("14. Campaign deletion does not delete attribution history", async () => {
    const repos = createSeededMemoryRepositories();
    const campaign = (await repos.campaigns.list()).items[0]!;
    const clicksBefore = (await repos.clicks.list()).total;
    const conversionsBefore = (await repos.conversions.list()).total;
    const ordersBefore = (await repos.orders.list()).total;

    await repos.campaigns.softDelete(campaign.id);
    const archived = await repos.campaigns.findById(campaign.id);
    expect(archived?.status).toBe("ARCHIVED");
    expect(archived?.deletedAt).toBeTruthy();

    expect((await repos.clicks.list()).total).toBe(clicksBefore);
    expect((await repos.conversions.list()).total).toBe(conversionsBefore);
    expect((await repos.orders.list()).total).toBe(ordersBefore);
  });

  it("15. URL Version V1 → V2 → V3 history remains intact", async () => {
    const repos = createSeededMemoryRepositories();
    const adId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
    const historyBefore = await repos.urlVersions.listByAdId(adId);
    expect(historyBefore.map((v) => v.version)).toEqual([1, 2]);

    const active = await repos.urlVersions.findActiveByAdId(adId);
    if (active) {
      await repos.urlVersions.updateStatus(active.id, { status: "SUPERSEDED" });
    }

    const v3: Omit<UrlVersion, "createdAt" | "updatedAt"> = {
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee0c",
      tenantId: "00000000-0000-4000-8000-000000000001",
      entityType: "AD",
      entityId: adId,
      adId,
      finalUrl: "https://example.com/landing-v3",
      customParameters: { _clickid: "v3" },
      version: 3,
      status: "ACTIVE",
      createdBy: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    };
    await repos.urlVersions.create(v3);

    const history = await repos.urlVersions.listByAdId(adId);
    expect(history.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(history.find((v) => v.version === 1)?.finalUrl).toBe(
      "https://example.com/landing"
    );
    expect(history.find((v) => v.version === 2)?.finalUrl).toBe(
      "https://example.com/landing-v2"
    );
    expect(history.find((v) => v.version === 3)?.status).toBe("ACTIVE");
  });
});

describe("UrlVersion append-only store", () => {
  it("InMemoryUrlVersionRepository rejects content mutation via updateStatus", async () => {
    const store = new Map<string, UrlVersion>();
    const now = new Date();
    store.set("v1", {
      id: "v1",
      tenantId: "t",
      entityType: "AD",
      entityId: "a",
      finalUrl: "https://example.com/a",
      customParameters: {},
      version: 1,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    });
    const repo = new InMemoryUrlVersionRepository(store);
    await repo.updateStatus("v1", { status: "SUPERSEDED" });
    expect(store.get("v1")?.finalUrl).toBe("https://example.com/a");
  });
});
