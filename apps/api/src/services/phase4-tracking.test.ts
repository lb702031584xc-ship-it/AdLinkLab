import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSeededMemoryRepositories, TenantA, TenantB } from "@adlinklab/database";
import { AuditActions, REQUEST_METADATA_LIMITS } from "@adlinklab/domain";
import { NotFoundError, ValidationError } from "@adlinklab/shared";
import {
  assertSafeRedirectUrl,
  MockClickGenerator,
  normalizeRequestMetadata,
  TrackingLinkResolver,
} from "@adlinklab/tracking";
import {
  ClickIngestionService,
  TrackingLinkManagementService,
} from "./click-ingestion.js";

function createHarness() {
  const repos = createSeededMemoryRepositories();
  const resolver = new TrackingLinkResolver(
    repos.trackingLinks,
    repos.offers,
    repos.landingPages
  );
  const clicks = new ClickIngestionService(
    resolver,
    repos.clicks,
    repos.unitOfWork
  );
  const trackingLinks = new TrackingLinkManagementService(repos.trackingLinks, {
    record: async (input) => {
      await repos.auditLogs.create({
        id: randomUUID(),
        tenantId: input.tenantId,
        action: input.action,
        entityType: input.entityType ?? "TrackingLink",
        entityId: input.entityId,
        requestId: input.requestId,
        after: input.after ?? {},
        before: input.before,
      });
    },
  });
  return { repos, resolver, clicks, trackingLinks };
}

describe("Phase 4 Tracking & Click Attribution", () => {
  it("1. resolves TrackingLink with offer + landing + attribution", async () => {
    const { resolver } = createHarness();
    const resolved = await resolver.resolve(TenantA.id, "trk_demo_001");
    expect(resolved.trackingLink.publicId).toBe("trk_demo_001");
    expect(resolved.offer.id).toBe(TenantA.offerA);
    expect(resolved.landingPage.id).toBe(TenantA.landingA);
    expect(resolved.redirectUrl).toBe("https://example.com/offer-a");
    expect(resolved.attribution.tenantId).toBe(TenantA.id);
  });

  it("2. missing TrackingLink throws NotFound", async () => {
    const { resolver } = createHarness();
    await expect(
      resolver.resolve(TenantA.id, "trk_missing")
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("3. inactive TrackingLink is rejected", async () => {
    const { repos, resolver } = createHarness();
    await repos.trackingLinks.update(TenantA.trackingA, { status: "PAUSED" });
    await expect(
      resolver.resolve(TenantA.id, "trk_demo_001")
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("4. Offer missing/inactive is rejected", async () => {
    const { repos, resolver } = createHarness();
    await repos.offers.update(TenantA.offerA, { status: "ARCHIVED" });
    await expect(
      resolver.resolve(TenantA.id, "trk_demo_001")
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("5. LandingPage missing is rejected", async () => {
    const { repos, resolver } = createHarness();
    await repos.trackingLinks.update(TenantA.trackingA, {
      landingPageId: undefined,
    });
    await expect(
      resolver.resolve(TenantA.id, "trk_demo_001")
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("6. successful click persists and returns redirect", async () => {
    const { clicks } = createHarness();
    const result = await clicks.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
      requestMetadata: {
        ipAddress: "203.0.113.50",
        userAgent: "AdLinkLabTest/1.0",
        referer: "https://example.test/",
      },
    });
    expect(result.redirectUrl).toBe("https://example.com/offer-a");
    expect(result.offerId).toBe(TenantA.offerA);
    expect(result.landingPageId).toBe(TenantA.landingA);
    expect(result.replayed).toBe(false);
  });

  it("7. clickId is a UUID (not Math.random / Date.now)", async () => {
    const { clicks } = createHarness();
    const result = await clicks.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
    });
    expect(result.clickId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(result.click.clickId).toBe(result.clickId);
    expect(result.click.id).toBe(result.clickId);
  });

  it("8. attribution context is immutable and complete", async () => {
    const { clicks } = createHarness();
    const result = await clicks.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
    });
    expect(Object.isFrozen(result.attribution)).toBe(true);
    expect(result.attribution).toMatchObject({
      tenantId: TenantA.id,
      trackingLinkId: TenantA.trackingA,
      offerId: TenantA.offerA,
      landingPageId: TenantA.landingA,
    });
  });

  it("9. campaign attribution is captured", async () => {
    const { clicks } = createHarness();
    const result = await clicks.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
    });
    expect(result.attribution.campaignId).toBe(TenantA.campaignA);
    expect(result.click.campaignId).toBe(TenantA.campaignA);
  });

  it("10. adGroup attribution is captured", async () => {
    const { clicks } = createHarness();
    const result = await clicks.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
    });
    expect(result.attribution.adGroupId).toBe(TenantA.adGroupA1);
    expect(result.click.adGroupId).toBe(TenantA.adGroupA1);
  });

  it("11. ad attribution is captured", async () => {
    const { clicks } = createHarness();
    const result = await clicks.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
    });
    expect(result.attribution.adId).toBe(TenantA.adA1);
    expect(result.click.adId).toBe(TenantA.adA1);
  });

  it("12. criterion attribution is captured", async () => {
    const { clicks } = createHarness();
    const result = await clicks.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
    });
    expect(result.attribution.criterionId).toBe(TenantA.critA1);
    expect(result.click.criterionId).toBe(TenantA.critA1);
  });

  it("13. query parameters are captured", async () => {
    const { clicks } = createHarness();
    const result = await clicks.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
      queryParameters: { custom_flag: "alpha", other: "beta" },
    });
    expect(result.click.queryParameters?.custom_flag).toBe("alpha");
    expect(result.click.queryParameters?.other).toBe("beta");
  });

  it("14. gclid / gbraid / wbraid are captured", async () => {
    const { clicks } = createHarness();
    const result = await clicks.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
      queryParameters: {
        gclid: "gclid-live-001",
        gbraid: "gbraid-001",
        wbraid: "wbraid-001",
      },
    });
    expect(result.click.gclid).toBe("gclid-live-001");
    expect(result.click.gbraid).toBe("gbraid-001");
    expect(result.click.wbraid).toBe("wbraid-001");
  });

  it("15. UTM parameters are captured", async () => {
    const { clicks } = createHarness();
    const result = await clicks.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
      queryParameters: {
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: "phase4",
        utm_term: "keyword",
        utm_content: "ad-a",
      },
    });
    expect(result.click.utmSource).toBe("google");
    expect(result.click.utmMedium).toBe("cpc");
    expect(result.click.utmCampaign).toBe("phase4");
    expect(result.click.utmTerm).toBe("keyword");
    expect(result.click.utmContent).toBe("ad-a");
  });

  it("16. metadata is normalized (trim)", () => {
    const meta = normalizeRequestMetadata({
      userAgent: "  Mozilla/5.0  ",
      referer: "  https://example.com/r  ",
      ipAddress: " 203.0.113.9 ",
      queryParameters: { " gclid ": "  abc  " },
    });
    expect(meta.userAgent).toBe("Mozilla/5.0");
    expect(meta.referer).toBe("https://example.com/r");
    expect(meta.ipAddress).toBe("203.0.113.9");
    expect(meta.queryParameters.gclid).toBe("abc");
  });

  it("17. metadata length limits are enforced", () => {
    const longUa = "u".repeat(REQUEST_METADATA_LIMITS.userAgentMax + 50);
    const longRef = "r".repeat(REQUEST_METADATA_LIMITS.refererMax + 50);
    const keys = Object.fromEntries(
      Array.from({ length: REQUEST_METADATA_LIMITS.maxQueryKeys + 10 }, (_, i) => [
        `k${i}`,
        "v",
      ])
    );
    const meta = normalizeRequestMetadata({
      userAgent: longUa,
      referer: longRef,
      queryParameters: {
        ...keys,
        password: "secret",
        authorization: "Bearer x",
        cookie: "a=b",
      },
    });
    expect(meta.userAgent!.length).toBe(REQUEST_METADATA_LIMITS.userAgentMax);
    expect(meta.referer!.length).toBe(REQUEST_METADATA_LIMITS.refererMax);
    expect(Object.keys(meta.queryParameters).length).toBeLessThanOrEqual(
      REQUEST_METADATA_LIMITS.maxQueryKeys
    );
    expect(meta.queryParameters.password).toBeUndefined();
    expect(meta.queryParameters.authorization).toBeUndefined();
    expect(meta.queryParameters.cookie).toBeUndefined();
  });

  it("18. ingestion idempotency returns first click", async () => {
    const { clicks, repos } = createHarness();
    const a = await clicks.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
      ingestionId: "ingest-phase4-1",
    });
    const b = await clicks.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
      ingestionId: "ingest-phase4-1",
    });
    expect(b.clickId).toBe(a.clickId);
    expect(b.replayed).toBe(true);
    const listed = await repos.clicks.list({
      tenantId: TenantA.id,
      trackingLinkId: TenantA.trackingA,
      pageSize: 500,
    });
    const withKey = listed.items.filter((c) => c.ingestionId === "ingest-phase4-1");
    expect(withKey).toHaveLength(1);
  });

  it("19. same tracking URL without ingestionId creates separate clicks", async () => {
    const { clicks } = createHarness();
    const a = await clicks.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
    });
    const b = await clicks.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
    });
    expect(a.clickId).not.toBe(b.clickId);
  });

  it("20. cross-tenant resolve is rejected", async () => {
    const { resolver } = createHarness();
    await expect(
      resolver.resolve(TenantB.id, "trk_demo_001")
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("21. open redirect via query url is ignored (DB destination only)", async () => {
    const { clicks } = createHarness();
    const result = await clicks.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
      queryParameters: { url: "https://evil.example/phish" },
    });
    expect(result.redirectUrl).toBe("https://example.com/offer-a");
    expect(result.redirectUrl).not.toContain("evil.example");
  });

  it("22. invalid URL schemes are rejected", () => {
    expect(() => assertSafeRedirectUrl("javascript:alert(1)")).toThrow(
      ValidationError
    );
    expect(() => assertSafeRedirectUrl("data:text/html,hi")).toThrow(
      ValidationError
    );
    expect(() => assertSafeRedirectUrl("file:///etc/passwd")).toThrow(
      ValidationError
    );
    expect(assertSafeRedirectUrl("https://example.com/ok")).toContain("https://");
  });

  it("23. MockClickGenerator produces synthetic TEST-NET traffic", async () => {
    const { clicks } = createHarness();
    const gen = new MockClickGenerator({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
    });
    const synthetic = gen.generate();
    expect(synthetic.requestMetadata.ipAddress).toMatch(/^203\.0\.113\./);
    expect(synthetic.requestMetadata.userAgent).toContain("MockClickGenerator");
    const result = await clicks.recordClick({
      tenantId: synthetic.tenantId,
      trackingLinkPublicId: synthetic.trackingLinkPublicId,
      requestMetadata: synthetic.requestMetadata,
    });
    expect(result.click.ipAddress).toMatch(/^203\.0\.113\./);
    expect(result.click.gclid).toBe("synthetic-gclid-test-only");
  });

  it("24. click statistics by tracking link / offer / campaign", async () => {
    const { clicks } = createHarness();
    const before = await clicks.countByTrackingLink(
      TenantA.id,
      TenantA.trackingA
    );
    await clicks.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
    });
    const after = await clicks.countByTrackingLink(
      TenantA.id,
      TenantA.trackingA
    );
    expect(after).toBe(before + 1);
    expect(await clicks.countByOffer(TenantA.id, TenantA.offerA)).toBeGreaterThan(
      0
    );
    expect(
      await clicks.countByCampaign(TenantA.id, TenantA.campaignA)
    ).toBeGreaterThan(0);
  });

  it("25. Tenant B isolation — A clicks do not appear under B", async () => {
    const { clicks } = createHarness();
    await clicks.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
      ingestionId: "tenant-a-only",
    });
    const bList = await clicks.list(TenantB.id, 1, 200);
    expect(bList.items.every((c) => c.tenantId === TenantB.id)).toBe(true);
    expect(bList.items.some((c) => c.ingestionId === "tenant-a-only")).toBe(
      false
    );

    const bClick = await clicks.recordClick({
      tenantId: TenantB.id,
      trackingLinkPublicId: "trk_isolation_001",
    });
    expect(bClick.attribution.tenantId).toBe(TenantB.id);
    expect(bClick.redirectUrl).toContain("tenant-b");
  });

  it("26. TrackingLink create/update writes AuditLog", async () => {
    const { trackingLinks, repos } = createHarness();
    const created = await trackingLinks.create(
      {
        id: "22222222-2222-4222-8222-222222229999",
        tenantId: TenantA.id,
        publicId: "trk_audit_new",
        offerId: TenantA.offerA,
        landingPageId: TenantA.landingA,
        status: "ACTIVE",
      },
      "req-tl-create"
    );
    await trackingLinks.update(
      TenantA.id,
      created.id,
      { status: "PAUSED" },
      "req-tl-status"
    );
    const logs = await repos.auditLogs.list({
      tenantId: TenantA.id,
      pageSize: 200,
    });
    expect(
      logs.items.some((l) => l.action === AuditActions.TRACKING_LINK_CREATED)
    ).toBe(true);
    expect(
      logs.items.some(
        (l) => l.action === AuditActions.TRACKING_LINK_STATUS_CHANGED
      )
    ).toBe(true);
  });

  it("27. LandingPage inactive is rejected", async () => {
    const { repos, resolver } = createHarness();
    await repos.landingPages.update(TenantA.landingA, { status: "ARCHIVED" });
    await expect(
      resolver.resolve(TenantA.id, "trk_demo_001")
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
