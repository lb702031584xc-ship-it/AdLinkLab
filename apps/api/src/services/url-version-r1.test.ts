import { describe, expect, it } from "vitest";
import { createSeededMemoryRepositories } from "@adlinklab/database";
import { UrlVersionService } from "./index.js";

describe("Phase 1.2-R1 UrlVersionService concurrency", () => {
  it("concurrent createVersion does not duplicate version numbers", async () => {
    const repos = createSeededMemoryRepositories();
    const service = new UrlVersionService(
      repos.urlVersions,
      repos.ads,
      repos.unitOfWork
    );
    const campaignId = (await repos.campaigns.list()).items[0]!.id;
    const tenantId = (await repos.tenants.list()).items[0]!.id;

    const created = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        service.createVersion({
          tenantId,
          entityType: "CAMPAIGN",
          entityId: campaignId,
          finalUrl: `https://example.com/race-${i}`,
          status: "DRAFT",
        })
      )
    );

    const nums = created.map((v) => v.version).sort((a, b) => a - b);
    expect(new Set(nums).size).toBe(5);
  });

  it("concurrent activateVersion leaves a single ACTIVE", async () => {
    const repos = createSeededMemoryRepositories();
    const service = new UrlVersionService(
      repos.urlVersions,
      repos.ads,
      repos.unitOfWork
    );
    const campaignId = (await repos.campaigns.list()).items[0]!.id;
    const tenantId = (await repos.tenants.list()).items[0]!.id;

    const v2 = await service.createVersion({
      tenantId,
      entityType: "CAMPAIGN",
      entityId: campaignId,
      finalUrl: "https://example.com/act-v2",
      status: "DRAFT",
    });
    const v3 = await service.createVersion({
      tenantId,
      entityType: "CAMPAIGN",
      entityId: campaignId,
      finalUrl: "https://example.com/act-v3",
      status: "DRAFT",
    });

    await Promise.allSettled([
      service.activateVersion({ tenantId, versionId: v2.id }),
      service.activateVersion({ tenantId, versionId: v3.id }),
    ]);

    const versions = await repos.urlVersions.listByEntity(
      "CAMPAIGN",
      campaignId
    );
    expect(versions.filter((v) => v.status === "ACTIVE")).toHaveLength(1);
  });
});
