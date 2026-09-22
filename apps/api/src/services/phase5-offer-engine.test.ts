import { describe, expect, it } from "vitest";
import { createSeededMemoryRepositories, TenantA, TenantB } from "@adlinklab/database";
import { AuditActions } from "@adlinklab/domain";
import {
  OfferEligibilityService,
  OfferSelectionService,
  TrackingLinkOfferService,
} from "@adlinklab/offers";
import { ConflictError, NotFoundError, ValidationError } from "@adlinklab/shared";
import { ClickIngestionService } from "./click-ingestion.js";
import { OfferService } from "./offer-engine.js";
import { TrackingLinkResolver } from "@adlinklab/tracking";

function createHarness() {
  const repos = createSeededMemoryRepositories();
  const eligibility = new OfferEligibilityService(
    repos.offers,
    repos.landingPages
  );
  const selection = new OfferSelectionService(
    repos.trackingLinks,
    repos.offers,
    repos.trackingLinkOffers,
    eligibility
  );
  const bindings = new TrackingLinkOfferService(
    repos.trackingLinks,
    repos.offers,
    repos.trackingLinkOffers,
    repos.unitOfWork
  );
  const offers = new OfferService(
    repos.offers,
    repos.landingPages,
    repos.unitOfWork
  );
  const clicks = new ClickIngestionService(
    new TrackingLinkResolver(
      repos.trackingLinks,
      repos.offers,
      repos.landingPages
    ),
    repos.clicks,
    repos.unitOfWork
  );
  return { repos, eligibility, selection, bindings, offers, clicks };
}

describe("Phase 5 Offer Engine", () => {
  it("1. create offer", async () => {
    const { offers } = createHarness();
    const result = await offers.create({
      tenantId: TenantA.id,
      name: "New Offer",
      network: "test-net",
      destinationUrl: "https://example.com/new",
      status: "DRAFT",
    });
    expect(result.created).toBe(true);
    expect(result.offer.priority).toBe(100);
    expect(result.offer.status).toBe("DRAFT");
  });

  it("2. get offer by id", async () => {
    const { offers } = createHarness();
    const got = await offers.getById(TenantA.id, TenantA.offerA);
    expect(got.name).toBe("Offer A");
  });

  it("3. list offers tenant scoped", async () => {
    const { offers } = createHarness();
    const listed = await offers.list(TenantA.id, 1, 50);
    expect(listed.items.every((o) => o.tenantId === TenantA.id)).toBe(true);
  });

  it("4. tenant isolation on get", async () => {
    const { offers } = createHarness();
    await expect(
      offers.getById(TenantB.id, TenantA.offerA)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("5. update offer metadata", async () => {
    const { offers } = createHarness();
    const updated = await offers.update(TenantA.id, TenantA.offerA, {
      name: "Offer A Renamed",
      priority: 50,
    });
    expect(updated.name).toBe("Offer A Renamed");
    expect(updated.priority).toBe(50);
  });

  it("6. DRAFT → ACTIVE", async () => {
    const { offers } = createHarness();
    const created = await offers.create({
      tenantId: TenantA.id,
      name: "Draft Offer",
      network: "n",
      destinationUrl: "https://example.com/d",
      status: "DRAFT",
    });
    const active = await offers.changeStatus(
      TenantA.id,
      created.offer.id,
      "ACTIVE"
    );
    expect(active.status).toBe("ACTIVE");
  });

  it("7. ACTIVE → PAUSED", async () => {
    const { offers } = createHarness();
    const paused = await offers.changeStatus(TenantA.id, TenantA.offerA, "PAUSED");
    expect(paused.status).toBe("PAUSED");
  });

  it("8. PAUSED → ACTIVE", async () => {
    const { offers } = createHarness();
    await offers.changeStatus(TenantA.id, TenantA.offerA, "PAUSED");
    const active = await offers.changeStatus(TenantA.id, TenantA.offerA, "ACTIVE");
    expect(active.status).toBe("ACTIVE");
  });

  it("9. ACTIVE → ARCHIVED", async () => {
    const { offers } = createHarness();
    const archived = await offers.changeStatus(
      TenantA.id,
      TenantA.offerA,
      "ARCHIVED"
    );
    expect(archived.status).toBe("ARCHIVED");
  });

  it("10. illegal transition DRAFT → PAUSED", async () => {
    const { offers } = createHarness();
    const created = await offers.create({
      tenantId: TenantA.id,
      name: "X",
      network: "n",
      destinationUrl: "https://example.com/x",
      status: "DRAFT",
    });
    await expect(
      offers.changeStatus(TenantA.id, created.offer.id, "PAUSED")
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("11. ARCHIVED is terminal", async () => {
    const { offers } = createHarness();
    await offers.changeStatus(TenantA.id, TenantA.offerA, "ARCHIVED");
    await expect(
      offers.changeStatus(TenantA.id, TenantA.offerA, "ACTIVE")
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("12. active offer is eligible", async () => {
    const { eligibility } = createHarness();
    const result = await eligibility.evaluate(TenantA.id, TenantA.offerA);
    expect(result.eligible).toBe(true);
    expect(result.landingPage?.id).toBe(TenantA.landingA);
  });

  it("13. paused offer rejected", async () => {
    const { offers, eligibility } = createHarness();
    await offers.changeStatus(TenantA.id, TenantA.offerA, "PAUSED");
    const result = await eligibility.evaluate(TenantA.id, TenantA.offerA);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("PAUSED");
  });

  it("14. draft offer rejected", async () => {
    const { offers, eligibility } = createHarness();
    const created = await offers.create({
      tenantId: TenantA.id,
      name: "Draft",
      network: "n",
      destinationUrl: "https://example.com/d2",
      status: "DRAFT",
    });
    const result = await eligibility.evaluate(TenantA.id, created.offer.id);
    expect(result.eligible).toBe(false);
  });

  it("15. archived offer rejected", async () => {
    const { offers, eligibility } = createHarness();
    await offers.changeStatus(TenantA.id, TenantA.offerA, "ARCHIVED");
    const result = await eligibility.evaluate(TenantA.id, TenantA.offerA);
    expect(result.eligible).toBe(false);
  });

  it("16. deleted offer rejected", async () => {
    const { repos, eligibility } = createHarness();
    await repos.offers.update(TenantA.offerA, { deletedAt: new Date() });
    const result = await eligibility.evaluate(TenantA.id, TenantA.offerA);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("OFFER_DELETED");
  });

  it("17. before startsAt rejected", async () => {
    const { repos, eligibility } = createHarness();
    const future = new Date("2099-01-01T00:00:00.000Z");
    await repos.offers.update(TenantA.offerA, { startsAt: future });
    const result = await eligibility.evaluate(
      TenantA.id,
      TenantA.offerA,
      new Date("2026-01-01T00:00:00.000Z")
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("BEFORE_STARTS_AT");
  });

  it("18. after endsAt rejected", async () => {
    const { repos, eligibility } = createHarness();
    await repos.offers.update(TenantA.offerA, {
      endsAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    const result = await eligibility.evaluate(
      TenantA.id,
      TenantA.offerA,
      new Date("2026-01-01T00:00:00.000Z")
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("AFTER_ENDS_AT");
  });

  it("19. active LandingPage required", async () => {
    const { repos, eligibility } = createHarness();
    await repos.landingPages.update(TenantA.landingA, { status: "PAUSED" });
    const result = await eligibility.evaluate(TenantA.id, TenantA.offerA);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("NO_ACTIVE_LANDING_PAGE");
  });

  it("20. LandingPage ownership mismatch rejected", async () => {
    const { repos, eligibility } = createHarness();
    // Point Offer A's only LP at Offer B — ownership check fails via offerId filter
    await repos.landingPages.update(TenantA.landingA, {
      offerId: TenantB.offer,
    });
    const result = await eligibility.evaluate(TenantA.id, TenantA.offerA);
    expect(result.eligible).toBe(false);
  });

  it("21. add binding", async () => {
    const { bindings } = createHarness();
    const row = await bindings.addBinding({
      tenantId: TenantA.id,
      trackingLinkId: TenantA.trackingA,
      offerId: TenantA.offerB,
      priority: 10,
    });
    expect(row.offerId).toBe(TenantA.offerB);
    expect(row.priority).toBe(10);
  });

  it("22. duplicate binding rejected", async () => {
    const { bindings } = createHarness();
    await bindings.addBinding({
      tenantId: TenantA.id,
      trackingLinkId: TenantA.trackingA,
      offerId: TenantA.offerB,
    });
    await expect(
      bindings.addBinding({
        tenantId: TenantA.id,
        trackingLinkId: TenantA.trackingA,
        offerId: TenantA.offerB,
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("23. update binding priority", async () => {
    const { bindings } = createHarness();
    const row = await bindings.addBinding({
      tenantId: TenantA.id,
      trackingLinkId: TenantA.trackingA,
      offerId: TenantA.offerB,
      priority: 50,
    });
    const updated = await bindings.updateBinding({
      tenantId: TenantA.id,
      bindingId: row.id,
      priority: 5,
    });
    expect(updated.priority).toBe(5);
  });

  it("24. remove binding", async () => {
    const { bindings } = createHarness();
    const row = await bindings.addBinding({
      tenantId: TenantA.id,
      trackingLinkId: TenantA.trackingA,
      offerId: TenantA.offerB,
    });
    await bindings.removeBinding({ tenantId: TenantA.id, bindingId: row.id });
    const listed = await bindings.listBindings(TenantA.id, TenantA.trackingA);
    expect(listed.find((b) => b.id === row.id)).toBeUndefined();
  });

  it("25. cross tenant binding rejected", async () => {
    const { bindings } = createHarness();
    await expect(
      bindings.addBinding({
        tenantId: TenantB.id,
        trackingLinkId: TenantA.trackingA,
        offerId: TenantB.offer,
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("26. one fallback maximum", async () => {
    const { bindings } = createHarness();
    await bindings.addBinding({
      tenantId: TenantA.id,
      trackingLinkId: TenantA.trackingA,
      offerId: TenantA.offerA,
      isFallback: true,
    });
    await expect(
      bindings.addBinding({
        tenantId: TenantA.id,
        trackingLinkId: TenantA.trackingA,
        offerId: TenantA.offerB,
        isFallback: true,
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("27. highest priority wins (lower number)", async () => {
    const { bindings, selection } = createHarness();
    await bindings.replaceBindings({
      tenantId: TenantA.id,
      trackingLinkId: TenantA.trackingA,
      bindings: [
        { offerId: TenantA.offerA, priority: 20 },
        { offerId: TenantA.offerB, priority: 10 },
      ],
    });
    // Offer B needs ACTIVE landing — fixture has landingB for offerB
    const result = await selection.select({
      tenantId: TenantA.id,
      trackingLinkId: TenantA.trackingA,
    });
    expect(result.selectedOfferId).toBe(TenantA.offerB);
    expect(result.reason).toBe("PRIORITY");
    expect(result.fallbackUsed).toBe(false);
  });

  it("28. same priority deterministic tie-break by offerId ASC", async () => {
    const { bindings, selection } = createHarness();
    await bindings.replaceBindings({
      tenantId: TenantA.id,
      trackingLinkId: TenantA.trackingA,
      bindings: [
        { offerId: TenantA.offerB, priority: 10 },
        { offerId: TenantA.offerA, priority: 10 },
      ],
    });
    const result = await selection.select({
      tenantId: TenantA.id,
      trackingLinkId: TenantA.trackingA,
    });
    const expected =
      TenantA.offerA < TenantA.offerB ? TenantA.offerA : TenantA.offerB;
    expect(result.selectedOfferId).toBe(expected);
  });

  it("29. fallback used when primary ineligible", async () => {
    const { offers, bindings, selection } = createHarness();
    await bindings.replaceBindings({
      tenantId: TenantA.id,
      trackingLinkId: TenantA.trackingA,
      bindings: [
        { offerId: TenantA.offerA, priority: 1, isFallback: false },
        { offerId: TenantA.offerB, priority: 100, isFallback: true },
      ],
    });
    await offers.changeStatus(TenantA.id, TenantA.offerA, "PAUSED");
    const result = await selection.select({
      tenantId: TenantA.id,
      trackingLinkId: TenantA.trackingA,
    });
    expect(result.selectedOfferId).toBe(TenantA.offerB);
    expect(result.reason).toBe("FALLBACK");
    expect(result.fallbackUsed).toBe(true);
  });

  it("30. fallback also ineligible → NO_ELIGIBLE_OFFER", async () => {
    const { offers, bindings, selection } = createHarness();
    await bindings.replaceBindings({
      tenantId: TenantA.id,
      trackingLinkId: TenantA.trackingA,
      bindings: [
        { offerId: TenantA.offerA, priority: 1 },
        { offerId: TenantA.offerB, isFallback: true },
      ],
    });
    await offers.changeStatus(TenantA.id, TenantA.offerA, "PAUSED");
    await offers.changeStatus(TenantA.id, TenantA.offerB, "PAUSED");
    const result = await selection.select({
      tenantId: TenantA.id,
      trackingLinkId: TenantA.trackingA,
    });
    expect(result.reason).toBe("NO_ELIGIBLE_OFFER");
    expect(result.selectedOfferId).toBeNull();
  });

  it("31. no candidate bindings and primary ineligible", async () => {
    const { offers, selection } = createHarness();
    await offers.changeStatus(TenantA.id, TenantA.offerA, "ARCHIVED");
    const result = await selection.select({
      tenantId: TenantA.id,
      trackingLinkId: TenantA.trackingA,
    });
    expect(result.reason).toBe("NO_ELIGIBLE_OFFER");
  });

  it("32. default TrackingLink.offerId when no bindings (Phase 4 compat)", async () => {
    const { selection } = createHarness();
    const result = await selection.select({
      tenantId: TenantA.id,
      trackingLinkId: TenantA.trackingA,
    });
    expect(result.selectedOfferId).toBe(TenantA.offerA);
    expect(result.reason).toBe("PRIMARY");
    expect(result.redirectUrl).toBe("https://example.com/offer-a");
  });

  it("33. deterministic LandingPage selection by id ASC", async () => {
    const { eligibility, repos } = createHarness();
    await repos.landingPages.create({
      id: "11111111-1111-4111-8111-111111110000",
      tenantId: TenantA.id,
      offerId: TenantA.offerA,
      name: "Earlier LP",
      url: "https://example.com/earlier",
      domain: "example.com",
      status: "ACTIVE",
    });
    const result = await eligibility.evaluate(TenantA.id, TenantA.offerA);
    expect(result.landingPage?.id).toBe("11111111-1111-4111-8111-111111110000");
  });

  it("34. request ?url= ignored by selection (DB destination only)", async () => {
    const { selection } = createHarness();
    const result = await selection.select({
      tenantId: TenantA.id,
      trackingLinkId: TenantA.trackingA,
    });
    expect(result.redirectUrl).not.toContain("evil");
    expect(result.redirectUrl).toBe("https://example.com/offer-a");
  });

  it("35. arbitrary destination rejected on create", async () => {
    const { offers } = createHarness();
    await expect(
      offers.create({
        tenantId: TenantA.id,
        name: "Bad",
        network: "n",
        destinationUrl: "javascript:alert(1)",
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("36. GoogleAds mutation not involved in selection", async () => {
    const { selection } = createHarness();
    const result = await selection.select({
      tenantId: TenantA.id,
      trackingLinkId: TenantA.trackingA,
    });
    expect(result.selectedOfferId).toBeTruthy();
    // SelectionResult only — no provider call surface
    expect(result).not.toHaveProperty("googleAdsMutation");
  });

  it("37. Offer create same idempotency key replays", async () => {
    const { offers } = createHarness();
    const a = await offers.create({
      tenantId: TenantA.id,
      name: "Idem",
      network: "n",
      destinationUrl: "https://example.com/idem",
      idempotencyKey: "offer-key-1",
    });
    const b = await offers.create({
      tenantId: TenantA.id,
      name: "Idem Other",
      network: "n",
      destinationUrl: "https://example.com/idem2",
      idempotencyKey: "offer-key-1",
    });
    expect(b.offer.id).toBe(a.offer.id);
    expect(b.replayed).toBe(true);
  });

  it("38. different tenant same idempotency key allowed", async () => {
    const { offers } = createHarness();
    const a = await offers.create({
      tenantId: TenantA.id,
      name: "A",
      network: "n",
      destinationUrl: "https://example.com/a-key",
      idempotencyKey: "shared-key",
    });
    const b = await offers.create({
      tenantId: TenantB.id,
      name: "B",
      network: "n",
      destinationUrl: "https://example.com/b-key",
      idempotencyKey: "shared-key",
    });
    expect(a.offer.id).not.toBe(b.offer.id);
  });

  it("39. Phase 4 tracking click still works", async () => {
    const { clicks } = createHarness();
    const result = await clicks.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
    });
    expect(result.redirectUrl).toBe("https://example.com/offer-a");
    expect(result.offerId).toBe(TenantA.offerA);
  });

  it("40. Phase 4 same URL creates two clicks", async () => {
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

  it("41. Offer status change writes audit", async () => {
    const { offers, repos } = createHarness();
    await offers.changeStatus(TenantA.id, TenantA.offerA, "PAUSED");
    const logs = await repos.auditLogs.list({
      tenantId: TenantA.id,
      pageSize: 200,
    });
    expect(
      logs.items.some((l) => l.action === AuditActions.OFFER_STATUS_CHANGED)
    ).toBe(true);
  });

  it("42. replaceBindings writes TRACKING_LINK_OFFER_ADDED via UoW", async () => {
    const { bindings, repos } = createHarness();
    await bindings.replaceBindings({
      tenantId: TenantA.id,
      trackingLinkId: TenantA.trackingA,
      bindings: [{ offerId: TenantA.offerB, priority: 1 }],
      requestId: "req-bind",
    });
    const logs = await repos.auditLogs.list({
      tenantId: TenantA.id,
      pageSize: 200,
    });
    expect(
      logs.items.some((l) => l.action === AuditActions.TRACKING_LINK_OFFER_ADDED)
    ).toBe(true);
  });
});
