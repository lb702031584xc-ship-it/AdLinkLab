import { describe, expect, it } from "vitest";
import {
  buildFixtureDataset,
  countActiveUrlVersionsByEntity,
  TenantA,
  TenantB,
} from "./index.js";
import { createSeededMemoryRepositories } from "../memory/repositories.js";

describe("Phase 1.3 fixture dataset", () => {
  it("creates expected tenant count", () => {
    const ds = buildFixtureDataset();
    expect(ds.tenants).toHaveLength(2);
    expect(ds.tenants.map((t) => t.id).sort()).toEqual(
      [TenantA.id, TenantB.id].sort()
    );
  });

  it("creates expected Tenant A campaigns", () => {
    const ds = buildFixtureDataset();
    const campaigns = ds.campaigns.filter((c) => c.tenantId === TenantA.id);
    expect(campaigns).toHaveLength(2);
    expect(campaigns.map((c) => c.googleCampaignId).sort()).toEqual([
      "camp-1001",
      "mock-campaign-002",
    ]);
  });

  it("creates expected Tenant A offers and landing pages", () => {
    const ds = buildFixtureDataset();
    expect(ds.offers.filter((o) => o.tenantId === TenantA.id)).toHaveLength(2);
    expect(
      ds.landingPages.filter((l) => l.tenantId === TenantA.id)
    ).toHaveLength(2);
    expect(
      ds.landingPages.every((l) => l.url.startsWith("https://example.com/"))
    ).toBe(true);
  });

  it("creates Google Ads hierarchy for Tenant A", () => {
    const ds = buildFixtureDataset();
    expect(ds.ads.filter((a) => a.tenantId === TenantA.id)).toHaveLength(4);
    expect(
      ds.adGroupCriteria.filter((c) => c.tenantId === TenantA.id)
    ).toHaveLength(4);
    expect(ds.adGroups.filter((g) => g.tenantId === TenantA.id)).toHaveLength(
      3
    );
  });

  it("creates tracking links with public ids", () => {
    const ds = buildFixtureDataset();
    const links = ds.trackingLinks.filter((t) => t.tenantId === TenantA.id);
    expect(links).toHaveLength(3);
    expect(links.map((l) => l.publicId).sort()).toEqual([
      "trk_demo_001",
      "trk_demo_002",
      "trk_demo_003",
    ]);
  });

  it("creates attribution chain TrackingLink → Click → Conversion → Order", () => {
    const ds = buildFixtureDataset();
    const order = ds.orders.find((o) => o.orderId === "ORDER-001")!;
    const conversion = ds.conversions.find((c) => c.id === order.conversionId)!;
    const click = ds.clicks.find((c) => c.id === conversion.clickId)!;
    const link = ds.trackingLinks.find((t) => t.id === click.trackingLinkId)!;
    expect(link.tenantId).toBe(TenantA.id);
    expect(click.tenantId).toBe(TenantA.id);
    expect(conversion.tenantId).toBe(TenantA.id);
    expect(order.tenantId).toBe(TenantA.id);
    expect(ds.orders.filter((o) => o.tenantId === TenantA.id)).toHaveLength(2);
  });

  it("creates URL versions with exactly one ACTIVE per entity", () => {
    const ds = buildFixtureDataset();
    const actives = countActiveUrlVersionsByEntity(ds.urlVersions);
    for (const count of actives.values()) {
      expect(count).toBe(1);
    }
    const campaignVersions = ds.urlVersions.filter(
      (v) =>
        v.tenantId === TenantA.id &&
        v.entityType === "CAMPAIGN" &&
        v.entityId === TenantA.campaignA
    );
    expect(campaignVersions.map((v) => v.status).sort()).toEqual([
      "ACTIVE",
      "SUPERSEDED",
    ]);
    expect(
      campaignVersions.find((v) => v.status === "SUPERSEDED")?.finalUrl
    ).not.toBe(campaignVersions.find((v) => v.status === "ACTIVE")?.finalUrl);
  });

  it("creates UrlChangeRequest SUCCEEDED / FAILED / QUEUED fixtures", () => {
    const ds = buildFixtureDataset();
    const statuses = ds.urlChangeRequests.map((r) => r.status).sort();
    expect(statuses).toEqual(["FAILED", "QUEUED", "SUCCEEDED"]);
    expect(
      ds.urlChangeRequests.every(
        (r) =>
          r.idempotencyScope === "URL_CHANGE" &&
          r.idempotencyKey &&
          r.tenantId === TenantA.id
      )
    ).toBe(true);
  });

  it("creates SyncJob COMPLETED / FAILED / PENDING fixtures", () => {
    const ds = buildFixtureDataset();
    const aJobs = ds.syncJobs.filter((j) => j.tenantId === TenantA.id);
    expect(aJobs.map((j) => j.status).sort()).toEqual([
      "COMPLETED",
      "FAILED",
      "PENDING",
    ]);
    expect(
      aJobs.every((j) => j.idempotencyScope === "SYNC_JOB" && j.idempotencyKey)
    ).toBe(true);
  });

  it("creates AuditLog fixture actions", () => {
    const ds = buildFixtureDataset();
    const actions = new Set(
      ds.auditLogs.filter((a) => a.tenantId === TenantA.id).map((a) => a.action)
    );
    expect(actions.has("tenant.created")).toBe(true);
    expect(actions.has("campaign.created")).toBe(true);
    expect(actions.has("URL_VERSION_ACTIVATED")).toBe(true);
    expect(actions.has("URL_VERSION_SUPERSEDED")).toBe(true);
    expect(actions.has("ORDER_CREATED")).toBe(true);
    expect(actions.has("SYNC_JOB_CREATED")).toBe(true);
  });

  it("preserves tenant isolation between A and B", () => {
    const ds = buildFixtureDataset();
    const aIds = new Set(
      [
        ...ds.campaigns,
        ...ds.offers,
        ...ds.trackingLinks,
        ...ds.clicks,
        ...ds.orders,
        ...ds.urlVersions,
      ]
        .filter((x) => x.tenantId === TenantA.id)
        .map((x) => x.id)
    );
    const bOwned = [
      ...ds.campaigns,
      ...ds.offers,
      ...ds.trackingLinks,
      ...ds.clicks,
      ...ds.orders,
      ...ds.urlVersions,
    ].filter((x) => x.tenantId === TenantB.id);

    expect(bOwned.length).toBeGreaterThan(0);
    expect(bOwned.every((x) => !aIds.has(x.id))).toBe(true);
    expect(ds.users.some((u) => u.tenantId === TenantB.id)).toBe(true);
    expect(ds.googleAccounts.some((g) => g.tenantId === TenantB.id)).toBe(true);
  });

  it("is deterministic across builds", () => {
    const a = buildFixtureDataset();
    const b = buildFixtureDataset();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("InMemory seed aligns with fixture identities", async () => {
    const repos = createSeededMemoryRepositories();
    const tenants = await repos.tenants.list({ pageSize: 100 });
    expect(tenants.total).toBe(2);

    const aCampaigns = await repos.campaigns.list({
      tenantId: TenantA.id,
      pageSize: 100,
    });
    expect(aCampaigns.total).toBe(2);

    const bCampaigns = await repos.campaigns.findByIdForTenant(
      TenantA.id,
      TenantB.campaign
    );
    expect(bCampaigns).toBeNull();

    const bOwn = await repos.campaigns.findByIdForTenant(
      TenantB.id,
      TenantB.campaign
    );
    expect(bOwn?.id).toBe(TenantB.campaign);

    const aOrders = await repos.orders.list({
      tenantId: TenantA.id,
      pageSize: 100,
    });
    expect(aOrders.items.map((o) => o.orderId).sort()).toEqual([
      "ORDER-001",
      "ORDER-002",
    ]);
  });

  it("Tenant A cannot read Tenant B order by id-for-tenant", async () => {
    const repos = createSeededMemoryRepositories();
    const cross = await repos.orders.findByIdForTenant(
      TenantA.id,
      TenantB.order
    );
    expect(cross).toBeNull();
    const own = await repos.orders.findByIdForTenant(TenantB.id, TenantB.order);
    expect(own?.orderId).toBe("ORDER-B-001");
  });
});

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabaseUrl)("Phase 1.3 PostgreSQL seed", () => {
  it("placeholder — run seed against DATABASE_URL manually", () => {
    expect(process.env.DATABASE_URL).toBeTruthy();
  });
});

describe.skipIf(hasDatabaseUrl)("Phase 1.3 PostgreSQL availability", () => {
  it("reports DATABASE_URL unavailable", () => {
    expect(process.env.DATABASE_URL).toBeFalsy();
  });
});
