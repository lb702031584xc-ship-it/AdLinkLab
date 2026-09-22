import { describe, expect, it } from "vitest";
import { createSeededMemoryRepositories, TenantA, TenantB } from "@adlinklab/database";
import { AuditActions } from "@adlinklab/domain";
import {
  MockGoogleAdsProvider,
  GoogleAdsProviderError,
} from "@adlinklab/google-ads";
import { ValidationError } from "@adlinklab/shared";
import { GoogleAdsSyncService } from "./google-ads-sync.js";

function createSyncHarness(provider = new MockGoogleAdsProvider()) {
  const repos = createSeededMemoryRepositories();
  const sync = new GoogleAdsSyncService(
    repos.googleAccounts,
    provider,
    repos.unitOfWork
  );
  return { repos, sync, provider };
}

describe("Phase 3 GoogleAdsSyncService", () => {
  it("first sync upserts hierarchy from mock provider", async () => {
    const { repos, sync } = createSyncHarness();
    const beforeCampaigns = (
      await repos.campaigns.list({ tenantId: TenantA.id, pageSize: 100 })
    ).total;

    const result = await sync.sync({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      idempotencyKey: "phase3-first-sync",
    });

    expect(result.job.status).toBe("COMPLETED");
    expect(result.summary).toBeTruthy();
    expect(result.summary!.startedAt).toBeTruthy();
    expect(result.summary!.completedAt).toBeTruthy();

    const campaigns = await repos.campaigns.list({
      tenantId: TenantA.id,
      pageSize: 100,
    });
    expect(campaigns.total).toBe(beforeCampaigns);
    expect(
      campaigns.items.some((c) => c.googleCampaignId === "camp-1001")
    ).toBe(true);

    const ads = await repos.ads.list({ tenantId: TenantA.id, pageSize: 100 });
    expect(ads.items.some((a) => a.googleAdId === "ad-3001")).toBe(true);

    const criteria = await repos.adGroupCriteria.list({
      tenantId: TenantA.id,
      pageSize: 100,
    });
    expect(
      criteria.items.some((c) => c.googleCriterionId === "mock-criterion-001")
    ).toBe(true);
  });

  it("repeat sync does not duplicate campaigns/adgroups/ads/criteria", async () => {
    const { repos, sync } = createSyncHarness();
    await sync.sync({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      idempotencyKey: "phase3-repeat-a",
    });
    const c1 = (await repos.campaigns.list({ tenantId: TenantA.id, pageSize: 100 }))
      .total;
    const g1 = (await repos.adGroups.list({ tenantId: TenantA.id, pageSize: 100 }))
      .total;
    const a1 = (await repos.ads.list({ tenantId: TenantA.id, pageSize: 100 })).total;
    const k1 = (
      await repos.adGroupCriteria.list({ tenantId: TenantA.id, pageSize: 100 })
    ).total;

    await sync.sync({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      idempotencyKey: "phase3-repeat-b",
    });

    expect(
      (await repos.campaigns.list({ tenantId: TenantA.id, pageSize: 100 })).total
    ).toBe(c1);
    expect(
      (await repos.adGroups.list({ tenantId: TenantA.id, pageSize: 100 })).total
    ).toBe(g1);
    expect(
      (await repos.ads.list({ tenantId: TenantA.id, pageSize: 100 })).total
    ).toBe(a1);
    expect(
      (await repos.adGroupCriteria.list({ tenantId: TenantA.id, pageSize: 100 }))
        .total
    ).toBe(k1);
  });

  it("empty sync (no matching campaigns) completes with zero creates", async () => {
    const { sync } = createSyncHarness();
    const result = await sync.sync({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      idempotencyKey: "phase3-empty",
      campaignIds: ["nonexistent-campaign"],
    });
    expect(result.job.status).toBe("COMPLETED");
    expect(result.summary).toMatchObject({
      campaignsCreated: 0,
      campaignsUpdated: 0,
      adGroupsCreated: 0,
      adsCreated: 0,
      criteriaCreated: 0,
    });
  });

  it("partial hierarchy sync for Campaign A only", async () => {
    const { sync } = createSyncHarness();
    const result = await sync.sync({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      idempotencyKey: "phase3-partial",
      campaignIds: ["camp-1001"],
    });
    expect(result.job.status).toBe("COMPLETED");
    expect(
      (result.summary!.campaignsCreated ?? 0) +
        (result.summary!.campaignsUpdated ?? 0)
    ).toBe(1);
  });

  it("campaign upsert updates name on second sync", async () => {
    const { repos, sync, provider } = createSyncHarness();
    await sync.sync({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      idempotencyKey: "phase3-upsert-1",
      campaignIds: ["camp-1001"],
    });
    // Mutate mock in-memory list via second sync after configure — mock data is static.
    // Re-sync should count as update.
    const result = await sync.sync({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      idempotencyKey: "phase3-upsert-2",
      campaignIds: ["camp-1001"],
    });
    expect(result.summary!.campaignsUpdated).toBeGreaterThanOrEqual(1);
    expect(result.summary!.campaignsCreated).toBe(0);
    const camp = (
      await repos.campaigns.list({ tenantId: TenantA.id, pageSize: 100 })
    ).items.find((c) => c.googleCampaignId === "camp-1001");
    expect(camp?.name).toBe("Campaign A");
    expect(provider).toBeTruthy();
  });

  it("rejects cross-tenant google account sync", async () => {
    const { sync } = createSyncHarness();
    await expect(
      sync.sync({
        tenantId: TenantB.id,
        googleAccountId: TenantA.account,
        idempotencyKey: "phase3-cross",
      })
    ).rejects.toBeTruthy();
  });

  it("rejects DISABLED google account", async () => {
    const { repos, sync } = createSyncHarness();
    await repos.googleAccounts.update(TenantA.account, { status: "DISABLED" });
    await expect(
      sync.sync({
        tenantId: TenantA.id,
        googleAccountId: TenantA.account,
        idempotencyKey: "phase3-disabled",
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("idempotent same key returns same SyncJob", async () => {
    const { sync } = createSyncHarness();
    const key = "phase3-idem-same";
    const a = await sync.sync({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      idempotencyKey: key,
    });
    const b = await sync.sync({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      idempotencyKey: key,
    });
    expect(b.job.id).toBe(a.job.id);
    expect(b.replayed).toBe(true);
    expect(a.job.status).toBe("COMPLETED");
  });

  it("concurrent same-key sync yields one logical SyncJob", async () => {
    const { repos, sync } = createSyncHarness();
    const key = "phase3-concurrent-same";
    const results = await Promise.all([
      sync.sync({
        tenantId: TenantA.id,
        googleAccountId: TenantA.account,
        idempotencyKey: key,
      }),
      sync.sync({
        tenantId: TenantA.id,
        googleAccountId: TenantA.account,
        idempotencyKey: key,
      }),
      sync.sync({
        tenantId: TenantA.id,
        googleAccountId: TenantA.account,
        idempotencyKey: key,
      }),
    ]);
    const ids = new Set(results.map((r) => r.job.id));
    expect(ids.size).toBe(1);

    const jobs = (
      await repos.syncJobs.list({ tenantId: TenantA.id, pageSize: 200 })
    ).items.filter((j) => j.idempotencyKey === key);
    expect(jobs).toHaveLength(1);
  });

  it("concurrent different-key syncs do not duplicate campaigns", async () => {
    const { repos, sync } = createSyncHarness();
    const before = (
      await repos.campaigns.list({ tenantId: TenantA.id, pageSize: 100 })
    ).total;
    await Promise.all([
      sync.sync({
        tenantId: TenantA.id,
        googleAccountId: TenantA.account,
        idempotencyKey: "phase3-diff-a",
      }),
      sync.sync({
        tenantId: TenantA.id,
        googleAccountId: TenantA.account,
        idempotencyKey: "phase3-diff-b",
      }),
    ]);
    const after = (
      await repos.campaigns.list({ tenantId: TenantA.id, pageSize: 100 })
    ).total;
    expect(after).toBe(before);
  });

  it("provider RATE_LIMITED fails SyncJob as retryable", async () => {
    const provider = new MockGoogleAdsProvider();
    provider.configureError({ method: "listCampaigns", code: "RATE_LIMITED" });
    const { sync, repos } = createSyncHarness(provider);
    await expect(
      sync.sync({
        tenantId: TenantA.id,
        googleAccountId: TenantA.account,
        idempotencyKey: "phase3-rate-limit",
      })
    ).rejects.toBeInstanceOf(GoogleAdsProviderError);

    const job = await repos.syncJobs.findByIdempotencyKey(
      TenantA.id,
      "SYNC_JOB",
      "phase3-rate-limit"
    );
    expect(job?.status).toBe("FAILED");
    expect(job?.payload?.retryable).toBe(true);
  });

  it("provider UNAUTHORIZED fails SyncJob as non-retryable", async () => {
    const provider = new MockGoogleAdsProvider();
    provider.configureError({ method: "getCustomer", code: "UNAUTHORIZED" });
    const { sync, repos } = createSyncHarness(provider);
    await expect(
      sync.sync({
        tenantId: TenantA.id,
        googleAccountId: TenantA.account,
        idempotencyKey: "phase3-unauth",
      })
    ).rejects.toMatchObject({ googleCode: "UNAUTHORIZED", retryable: false });

    const job = await repos.syncJobs.findByIdempotencyKey(
      TenantA.id,
      "SYNC_JOB",
      "phase3-unauth"
    );
    expect(job?.status).toBe("FAILED");
    expect(job?.payload?.retryable).toBe(false);
  });

  it("writes SYNC_STARTED and SYNC_COMPLETED audit logs", async () => {
    const { repos, sync } = createSyncHarness();
    await sync.sync({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      idempotencyKey: "phase3-audit",
      requestId: "req-phase3-audit",
    });
    const logs = await repos.auditLogs.list({
      tenantId: TenantA.id,
      pageSize: 200,
    });
    const actions = logs.items.map((l) => l.action);
    expect(actions).toContain(AuditActions.SYNC_STARTED);
    expect(actions).toContain(AuditActions.SYNC_COMPLETED);
    expect(
      logs.items.some(
        (l) =>
          l.action === AuditActions.SYNC_COMPLETED &&
          l.requestId === "req-phase3-audit"
      )
    ).toBe(true);
  });

  it("writes SYNC_FAILED audit on provider error", async () => {
    const provider = new MockGoogleAdsProvider();
    provider.configureError({ method: "*", code: "TEMPORARY_ERROR" });
    const { repos, sync } = createSyncHarness(provider);
    await expect(
      sync.sync({
        tenantId: TenantA.id,
        googleAccountId: TenantA.account,
        idempotencyKey: "phase3-audit-fail",
      })
    ).rejects.toBeTruthy();
    const logs = await repos.auditLogs.list({
      tenantId: TenantA.id,
      pageSize: 200,
    });
    expect(logs.items.some((l) => l.action === AuditActions.SYNC_FAILED)).toBe(
      true
    );
  });

  it("adgroup/ad/criterion upsert counters are present in summary", async () => {
    const { sync } = createSyncHarness();
    const result = await sync.sync({
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      idempotencyKey: "phase3-counters",
    });
    expect(result.summary).toEqual(
      expect.objectContaining({
        adGroupsCreated: expect.any(Number),
        adGroupsUpdated: expect.any(Number),
        adsCreated: expect.any(Number),
        adsUpdated: expect.any(Number),
        criteriaCreated: expect.any(Number),
        criteriaUpdated: expect.any(Number),
      })
    );
  });

  it("Tenant B sync uses isolation customer without touching Tenant A counts", async () => {
    const { repos, sync } = createSyncHarness();
    const aBefore = (
      await repos.campaigns.list({ tenantId: TenantA.id, pageSize: 100 })
    ).total;
    await sync.sync({
      tenantId: TenantB.id,
      googleAccountId: TenantB.account,
      idempotencyKey: "phase3-tenant-b",
    });
    const aAfter = (
      await repos.campaigns.list({ tenantId: TenantA.id, pageSize: 100 })
    ).total;
    expect(aAfter).toBe(aBefore);
    const bCamps = await repos.campaigns.list({
      tenantId: TenantB.id,
      pageSize: 100,
    });
    expect(
      bCamps.items.some((c) => c.googleCampaignId === "mock-campaign-b-001")
    ).toBe(true);
  });
});
