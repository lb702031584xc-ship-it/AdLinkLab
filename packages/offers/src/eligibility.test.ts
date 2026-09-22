import { describe, expect, it } from "vitest";
import { OfferEligibilityService } from "./eligibility.js";
import {
  createLandingPageRepo,
  createOfferRepo,
  makeLandingPage,
  makeOffer,
} from "./test-fakes.js";

const TENANT = "tenant-a";
const OTHER = "tenant-b";
const NOW = new Date("2026-06-15T12:00:00.000Z");

describe("OfferEligibilityService", () => {
  it("ACTIVE offer with ACTIVE landing page is eligible", async () => {
    const offer = makeOffer({ id: "o-active", tenantId: TENANT, status: "ACTIVE" });
    const lp = makeLandingPage({
      id: "lp-1",
      tenantId: TENANT,
      offerId: offer.id,
      status: "ACTIVE",
      url: "https://landing.example/ok",
    });
    const svc = new OfferEligibilityService(
      createOfferRepo([offer]),
      createLandingPageRepo([lp])
    );
    const result = await svc.evaluate(TENANT, offer.id, NOW);
    expect(result).toEqual({
      eligible: true,
      landingPage: lp,
    });
  });

  it("missing offer → OFFER_NOT_FOUND", async () => {
    const svc = new OfferEligibilityService(
      createOfferRepo([]),
      createLandingPageRepo([])
    );
    await expect(svc.evaluate(TENANT, "missing", NOW)).resolves.toEqual({
      eligible: false,
      reason: "OFFER_NOT_FOUND",
    });
  });

  it("tenant mismatch → TENANT_MISMATCH", async () => {
    const offer = makeOffer({ id: "o1", tenantId: OTHER, status: "ACTIVE" });
    const svc = new OfferEligibilityService(
      createOfferRepo([offer]),
      createLandingPageRepo([])
    );
    await expect(svc.evaluateOffer(TENANT, offer, NOW)).resolves.toEqual({
      eligible: false,
      reason: "TENANT_MISMATCH",
    });
  });

  it("deleted offer → OFFER_DELETED", async () => {
    const offer = makeOffer({
      id: "o1",
      tenantId: TENANT,
      status: "ACTIVE",
      deletedAt: NOW,
    });
    const svc = new OfferEligibilityService(
      createOfferRepo([offer]),
      createLandingPageRepo([])
    );
    await expect(svc.evaluateOffer(TENANT, offer, NOW)).resolves.toEqual({
      eligible: false,
      reason: "OFFER_DELETED",
    });
  });

  it.each([
    ["DRAFT", "OFFER_STATUS_DRAFT"],
    ["PAUSED", "OFFER_STATUS_PAUSED"],
    ["ARCHIVED", "OFFER_STATUS_ARCHIVED"],
  ] as const)("%s offer → %s", async (status, reason) => {
    const offer = makeOffer({ id: "o1", tenantId: TENANT, status });
    const svc = new OfferEligibilityService(
      createOfferRepo([offer]),
      createLandingPageRepo([
        makeLandingPage({ id: "lp", tenantId: TENANT, offerId: "o1" }),
      ])
    );
    await expect(svc.evaluate(TENANT, "o1", NOW)).resolves.toEqual({
      eligible: false,
      reason,
    });
  });

  it("before startsAt → BEFORE_STARTS_AT", async () => {
    const offer = makeOffer({
      id: "o1",
      tenantId: TENANT,
      status: "ACTIVE",
      startsAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    const svc = new OfferEligibilityService(
      createOfferRepo([offer]),
      createLandingPageRepo([
        makeLandingPage({ id: "lp", tenantId: TENANT, offerId: "o1" }),
      ])
    );
    await expect(svc.evaluate(TENANT, "o1", NOW)).resolves.toEqual({
      eligible: false,
      reason: "BEFORE_STARTS_AT",
    });
  });

  it("at or after endsAt → AFTER_ENDS_AT", async () => {
    const offer = makeOffer({
      id: "o1",
      tenantId: TENANT,
      status: "ACTIVE",
      endsAt: NOW,
    });
    const svc = new OfferEligibilityService(
      createOfferRepo([offer]),
      createLandingPageRepo([
        makeLandingPage({ id: "lp", tenantId: TENANT, offerId: "o1" }),
      ])
    );
    await expect(svc.evaluate(TENANT, "o1", NOW)).resolves.toEqual({
      eligible: false,
      reason: "AFTER_ENDS_AT",
    });
  });

  it("no ACTIVE landing page → NO_ACTIVE_LANDING_PAGE", async () => {
    const offer = makeOffer({ id: "o1", tenantId: TENANT, status: "ACTIVE" });
    const svc = new OfferEligibilityService(
      createOfferRepo([offer]),
      createLandingPageRepo([
        makeLandingPage({
          id: "lp",
          tenantId: TENANT,
          offerId: "o1",
          status: "PAUSED",
        }),
      ])
    );
    await expect(svc.evaluate(TENANT, "o1", NOW)).resolves.toEqual({
      eligible: false,
      reason: "NO_ACTIVE_LANDING_PAGE",
    });
  });

  it("resolveActiveLandingPage picks ACTIVE by id ASC", async () => {
    const offer = makeOffer({ id: "o1", tenantId: TENANT, status: "ACTIVE" });
    const lpB = makeLandingPage({
      id: "lp-b",
      tenantId: TENANT,
      offerId: "o1",
      status: "ACTIVE",
    });
    const lpA = makeLandingPage({
      id: "lp-a",
      tenantId: TENANT,
      offerId: "o1",
      status: "ACTIVE",
    });
    const svc = new OfferEligibilityService(
      createOfferRepo([offer]),
      createLandingPageRepo([lpB, lpA])
    );
    const picked = await svc.resolveActiveLandingPage(TENANT, "o1");
    expect(picked?.id).toBe("lp-a");
  });

  it("skips deleted landing pages when resolving", async () => {
    const offer = makeOffer({ id: "o1", tenantId: TENANT, status: "ACTIVE" });
    const svc = new OfferEligibilityService(
      createOfferRepo([offer]),
      createLandingPageRepo([
        makeLandingPage({
          id: "lp-deleted",
          tenantId: TENANT,
          offerId: "o1",
          status: "ACTIVE",
          deletedAt: NOW,
        }),
        makeLandingPage({
          id: "lp-ok",
          tenantId: TENANT,
          offerId: "o1",
          status: "ACTIVE",
        }),
      ])
    );
    const picked = await svc.resolveActiveLandingPage(TENANT, "o1");
    expect(picked?.id).toBe("lp-ok");
  });
});
