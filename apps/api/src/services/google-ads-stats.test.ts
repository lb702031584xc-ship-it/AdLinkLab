import { describe, expect, it } from "vitest";
import type { GoogleAccountRepository } from "@adlinklab/domain";
import { MockGoogleAdsProvider } from "@adlinklab/google-ads";
import {
  GoogleAdsStatsService,
} from "./google-ads-stats.js";

function makeService(accounts: Record<string, unknown>[]) {
  const repo = {
    findByIdForTenant: async (tenantId: string, id: string) => {
      const row = accounts.find(
        (a) =>
          (a as { id: string }).id === id &&
          (a as { tenantId: string }).tenantId === tenantId
      );
      return (row ?? null) as never;
    },
  } as unknown as GoogleAccountRepository;
  return new GoogleAdsStatsService(repo, new MockGoogleAdsProvider(), "mock");
}

const ACCOUNT = {
  id: "11111111-1111-4111-8111-111111111111",
  tenantId: "tenant-1",
  customerId: "mock-customer-001",
  googleCustomerId: "mock-customer-001",
  currency: "CNY",
};

describe("GoogleAdsStatsService", () => {
  it("returns mock provider stats for the tenant account", async () => {
    const service = makeService([ACCOUNT]);
    const result = await service.getCampaignStats({
      tenantId: "tenant-1",
      googleAccountId: ACCOUNT.id,
      startDate: "2026-10-20",
      endDate: "2026-10-27",
    });
    expect(result.provider).toBe("mock");
    expect(result.customerId).toBe("mock-customer-001");
    expect(result.currency).toBe("CNY");
    expect(result.stats.map((s) => s.campaignId)).toEqual([
      "camp-1001",
      "mock-campaign-002",
    ]);
    expect(result.stats[0]?.impressions).toBe(1000);
  });

  it("filters by campaignIds", async () => {
    const service = makeService([ACCOUNT]);
    const result = await service.getCampaignStats({
      tenantId: "tenant-1",
      googleAccountId: ACCOUNT.id,
      startDate: "2026-10-20",
      endDate: "2026-10-27",
      campaignIds: ["mock-campaign-002"],
    });
    expect(result.stats.map((s) => s.campaignId)).toEqual([
      "mock-campaign-002",
    ]);
  });

  it("throws when the account is missing or belongs to another tenant", async () => {
    const service = makeService([ACCOUNT]);
    await expect(
      service.getCampaignStats({
        tenantId: "tenant-1",
        googleAccountId: "22222222-2222-4222-8222-222222222222",
        startDate: "2026-10-20",
        endDate: "2026-10-27",
      })
    ).rejects.toThrow();
    await expect(
      service.getCampaignStats({
        tenantId: "tenant-2",
        googleAccountId: ACCOUNT.id,
        startDate: "2026-10-20",
        endDate: "2026-10-27",
      })
    ).rejects.toThrow();
  });

  it("throws when the account has no customerId", async () => {
    const service = makeService([
      { ...ACCOUNT, customerId: "", googleCustomerId: "" },
    ]);
    await expect(
      service.getCampaignStats({
        tenantId: "tenant-1",
        googleAccountId: ACCOUNT.id,
        startDate: "2026-10-20",
        endDate: "2026-10-27",
      })
    ).rejects.toThrow("missing customerId");
  });
});
