import { describe, expect, it } from "vitest";
import type {
  Campaign,
  Click,
  GoogleAdsScriptIntegration,
  UrlVersion,
} from "./entities.js";

describe("domain entities", () => {
  it("accepts campaign with internal uuid and external google id", () => {
    const campaign: Campaign = {
      id: "11111111-1111-1111-1111-111111111111",
      tenantId: "00000000-0000-4000-8000-000000000001",
      googleAccountId: "22222222-2222-2222-2222-222222222222",
      googleCampaignId: "g-camp-1",
      name: "Test Campaign",
      status: "ACTIVE",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    expect(campaign.googleCampaignId).toBe("g-camp-1");
  });

  it("models click metadata without mutation semantics", () => {
    const click: Click = {
      id: "33333333-3333-3333-3333-333333333333",
      clickId: "33333333-3333-3333-3333-333333333333",
      tenantId: "00000000-0000-4000-8000-000000000001",
      trackingLinkId: "44444444-4444-4444-4444-444444444444",
      gclid: "gclid-abc",
      utmSource: "google",
      userAgent: "Mozilla/5.0",
      ipAddress: "203.0.113.10",
      referer: "https://www.google.com/",
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    expect(click.gclid).toBe("gclid-abc");
    expect(click.clickId).toBe(click.id);
  });

  it("keeps finalUrl / trackingTemplate / customParameters separate", () => {
    const version: UrlVersion = {
      id: "55555555-5555-5555-5555-555555555555",
      tenantId: "00000000-0000-4000-8000-000000000001",
      entityType: "AD",
      entityId: "66666666-6666-6666-6666-666666666666",
      adId: "66666666-6666-6666-6666-666666666666",
      finalUrl: "https://example.com/landing",
      trackingTemplate:
        "https://tracker.example.com/click?cid={_clickid}&url={lpurl}",
      customParameters: { _clickid: "abc123" },
      version: 1,
      status: "ACTIVE",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    expect(version.customParameters._clickid).toBe("abc123");
    expect(version.finalUrl).not.toContain("tracker.example.com");
    expect(version.entityType).toBe("AD");
  });

  it("models Script Integration without plaintext token fields", () => {
    const integration: GoogleAdsScriptIntegration = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      tenantId: "00000000-0000-4000-8000-000000000001",
      googleAccountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
      name: "Primary Script",
      status: "ACTIVE",
      tokenKeyId: "tok_1",
      tokenPrefix: "alk_s_abcd",
      tokenHash: "a".repeat(64),
      configGeneration: 0,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    expect(integration.tokenHash).toHaveLength(64);
    expect(integration).not.toHaveProperty("token");
  });
});
