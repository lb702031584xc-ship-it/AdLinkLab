import { describe, expect, it } from "vitest";
import { NotFoundError } from "@adlinklab/shared";
import { OfferEligibilityService } from "./eligibility.js";
import { OfferSelectionService } from "./selection.js";
import {
  createBindingRepo,
  createLandingPageRepo,
  createOfferRepo,
  createTrackingLinkRepo,
  makeBinding,
  makeLandingPage,
  makeOffer,
  makeTrackingLink,
} from "./test-fakes.js";

const TENANT = "tenant-a";
const NOW = new Date("2026-06-15T12:00:00.000Z");

function buildSelection(opts: {
  offers: ReturnType<typeof makeOffer>[];
  landings: ReturnType<typeof makeLandingPage>[];
  links: ReturnType<typeof makeTrackingLink>[];
  bindings?: ReturnType<typeof makeBinding>[];
}) {
  const offers = createOfferRepo(opts.offers);
  const landings = createLandingPageRepo(opts.landings);
  const eligibility = new OfferEligibilityService(offers, landings);
  return new OfferSelectionService(
    createTrackingLinkRepo(opts.links),
    offers,
    createBindingRepo(opts.bindings ?? []),
    eligibility
  );
}

describe("OfferSelectionService", () => {
  it("throws NotFoundError when TrackingLink missing", async () => {
    const svc = buildSelection({
      offers: [],
      landings: [],
      links: [],
    });
    await expect(
      svc.select({ tenantId: TENANT, trackingLinkId: "missing", now: NOW })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("no bindings → PRIMARY from TrackingLink.offerId when eligible", async () => {
    const offer = makeOffer({ id: "o-primary", tenantId: TENANT, status: "ACTIVE" });
    const lp = makeLandingPage({
      id: "lp-1",
      tenantId: TENANT,
      offerId: offer.id,
      url: "https://landing.example/primary",
    });
    const link = makeTrackingLink({
      id: "tl-1",
      tenantId: TENANT,
      publicId: "pub-1",
      offerId: offer.id,
    });
    const svc = buildSelection({
      offers: [offer],
      landings: [lp],
      links: [link],
    });
    const result = await svc.select({
      tenantId: TENANT,
      trackingLinkId: link.id,
      now: NOW,
    });
    expect(result.reason).toBe("PRIMARY");
    expect(result.selectedOfferId).toBe(offer.id);
    expect(result.selectedLandingPageId).toBe(lp.id);
    expect(result.redirectUrl).toBe("https://landing.example/primary");
    expect(result.fallbackUsed).toBe(false);
  });

  it("no bindings + DRAFT primary → NO_ELIGIBLE_OFFER", async () => {
    const offer = makeOffer({ id: "o-draft", tenantId: TENANT, status: "DRAFT" });
    const link = makeTrackingLink({
      id: "tl-1",
      tenantId: TENANT,
      publicId: "pub-1",
      offerId: offer.id,
    });
    const svc = buildSelection({
      offers: [offer],
      landings: [
        makeLandingPage({ id: "lp", tenantId: TENANT, offerId: offer.id }),
      ],
      links: [link],
    });
    const result = await svc.select({
      tenantId: TENANT,
      trackingLinkId: link.id,
      now: NOW,
    });
    expect(result.reason).toBe("NO_ELIGIBLE_OFFER");
    expect(result.selectedOfferId).toBeNull();
    expect(result.redirectUrl).toBeNull();
    expect(result.candidates[0]?.ineligibleReason).toBe("OFFER_STATUS_DRAFT");
  });

  it("bindings: lower priority number wins (PRIORITY)", async () => {
    const oHigh = makeOffer({ id: "o-high", tenantId: TENANT, status: "ACTIVE" });
    const oLow = makeOffer({ id: "o-low", tenantId: TENANT, status: "ACTIVE" });
    const link = makeTrackingLink({
      id: "tl-1",
      tenantId: TENANT,
      publicId: "pub-1",
      offerId: oHigh.id,
    });
    const svc = buildSelection({
      offers: [oHigh, oLow],
      landings: [
        makeLandingPage({
          id: "lp-high",
          tenantId: TENANT,
          offerId: oHigh.id,
          url: "https://landing.example/high",
        }),
        makeLandingPage({
          id: "lp-low",
          tenantId: TENANT,
          offerId: oLow.id,
          url: "https://landing.example/low",
        }),
      ],
      links: [link],
      bindings: [
        makeBinding({
          id: "b1",
          tenantId: TENANT,
          trackingLinkId: link.id,
          offerId: oHigh.id,
          priority: 50,
        }),
        makeBinding({
          id: "b2",
          tenantId: TENANT,
          trackingLinkId: link.id,
          offerId: oLow.id,
          priority: 10,
        }),
      ],
    });
    const result = await svc.select({
      tenantId: TENANT,
      trackingLinkId: link.id,
      now: NOW,
    });
    expect(result.reason).toBe("PRIORITY");
    expect(result.selectedOfferId).toBe(oLow.id);
    expect(result.redirectUrl).toBe("https://landing.example/low");
  });

  it("same priority → offerId ASC tie-break", async () => {
    const oB = makeOffer({ id: "o-b", tenantId: TENANT, status: "ACTIVE" });
    const oA = makeOffer({ id: "o-a", tenantId: TENANT, status: "ACTIVE" });
    const link = makeTrackingLink({
      id: "tl-1",
      tenantId: TENANT,
      publicId: "pub-1",
      offerId: oB.id,
    });
    const svc = buildSelection({
      offers: [oB, oA],
      landings: [
        makeLandingPage({
          id: "lp-b",
          tenantId: TENANT,
          offerId: oB.id,
          url: "https://landing.example/b",
        }),
        makeLandingPage({
          id: "lp-a",
          tenantId: TENANT,
          offerId: oA.id,
          url: "https://landing.example/a",
        }),
      ],
      links: [link],
      bindings: [
        makeBinding({
          id: "b1",
          tenantId: TENANT,
          trackingLinkId: link.id,
          offerId: oB.id,
          priority: 100,
        }),
        makeBinding({
          id: "b2",
          tenantId: TENANT,
          trackingLinkId: link.id,
          offerId: oA.id,
          priority: 100,
        }),
      ],
    });
    const result = await svc.select({
      tenantId: TENANT,
      trackingLinkId: link.id,
      now: NOW,
    });
    expect(result.selectedOfferId).toBe("o-a");
  });

  it("PAUSED primary + ACTIVE fallback → FALLBACK", async () => {
    const primary = makeOffer({
      id: "o-paused",
      tenantId: TENANT,
      status: "PAUSED",
    });
    const fallback = makeOffer({
      id: "o-fb",
      tenantId: TENANT,
      status: "ACTIVE",
    });
    const link = makeTrackingLink({
      id: "tl-1",
      tenantId: TENANT,
      publicId: "pub-1",
      offerId: primary.id,
    });
    const svc = buildSelection({
      offers: [primary, fallback],
      landings: [
        makeLandingPage({
          id: "lp-p",
          tenantId: TENANT,
          offerId: primary.id,
        }),
        makeLandingPage({
          id: "lp-f",
          tenantId: TENANT,
          offerId: fallback.id,
          url: "https://landing.example/fallback",
        }),
      ],
      links: [link],
      bindings: [
        makeBinding({
          id: "b1",
          tenantId: TENANT,
          trackingLinkId: link.id,
          offerId: primary.id,
          priority: 10,
          isFallback: false,
        }),
        makeBinding({
          id: "b2",
          tenantId: TENANT,
          trackingLinkId: link.id,
          offerId: fallback.id,
          priority: 100,
          isFallback: true,
        }),
      ],
    });
    const result = await svc.select({
      tenantId: TENANT,
      trackingLinkId: link.id,
      now: NOW,
    });
    expect(result.reason).toBe("FALLBACK");
    expect(result.fallbackUsed).toBe(true);
    expect(result.selectedOfferId).toBe(fallback.id);
    expect(result.redirectUrl).toBe("https://landing.example/fallback");
  });

  it("ARCHIVED offers are not selected", async () => {
    const offer = makeOffer({
      id: "o-arch",
      tenantId: TENANT,
      status: "ARCHIVED",
    });
    const link = makeTrackingLink({
      id: "tl-1",
      tenantId: TENANT,
      publicId: "pub-1",
      offerId: offer.id,
    });
    const svc = buildSelection({
      offers: [offer],
      landings: [
        makeLandingPage({ id: "lp", tenantId: TENANT, offerId: offer.id }),
      ],
      links: [link],
    });
    const result = await svc.select({
      tenantId: TENANT,
      trackingLinkId: link.id,
      now: NOW,
    });
    expect(result.reason).toBe("NO_ELIGIBLE_OFFER");
    expect(result.candidates[0]?.ineligibleReason).toBe("OFFER_STATUS_ARCHIVED");
  });

  it("unsafe landing URL → UNSAFE_LANDING_URL then NO_ELIGIBLE_OFFER", async () => {
    const offer = makeOffer({ id: "o1", tenantId: TENANT, status: "ACTIVE" });
    const link = makeTrackingLink({
      id: "tl-1",
      tenantId: TENANT,
      publicId: "pub-1",
      offerId: offer.id,
    });
    const svc = buildSelection({
      offers: [offer],
      landings: [
        makeLandingPage({
          id: "lp",
          tenantId: TENANT,
          offerId: offer.id,
          url: "javascript:alert(1)",
        }),
      ],
      links: [link],
    });
    const result = await svc.select({
      tenantId: TENANT,
      trackingLinkId: link.id,
      now: NOW,
    });
    expect(result.reason).toBe("NO_ELIGIBLE_OFFER");
    expect(result.candidates[0]?.eligible).toBe(false);
    expect(result.candidates[0]?.ineligibleReason).toBe("UNSAFE_LANDING_URL");
  });
});
