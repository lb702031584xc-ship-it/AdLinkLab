import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@adlinklab/shared";
import { TrackingLinkOfferService } from "./binding-service.js";
import {
  createAuditLogRepo,
  createBindingRepo,
  createMemoryUnitOfWork,
  createOfferRepo,
  createTrackingLinkRepo,
  makeBinding,
  makeOffer,
  makeTrackingLink,
} from "./test-fakes.js";

const TENANT = "tenant-a";

function buildService(opts?: {
  offers?: ReturnType<typeof makeOffer>[];
  links?: ReturnType<typeof makeTrackingLink>[];
  bindings?: ReturnType<typeof makeBinding>[];
}) {
  const bindings = createBindingRepo(opts?.bindings ?? []);
  const auditLogs = createAuditLogRepo();
  const svc = new TrackingLinkOfferService(
    createTrackingLinkRepo(
      opts?.links ?? [
        makeTrackingLink({
          id: "tl-1",
          tenantId: TENANT,
          publicId: "pub-1",
          offerId: "o1",
        }),
      ]
    ),
    createOfferRepo(
      opts?.offers ?? [makeOffer({ id: "o1", tenantId: TENANT }), makeOffer({ id: "o2", tenantId: TENANT })]
    ),
    bindings,
    createMemoryUnitOfWork({ trackingLinkOffers: bindings, auditLogs })
  );
  return { svc, bindings, auditLogs };
}

describe("TrackingLinkOfferService", () => {
  it("addBinding creates binding with default priority 100", async () => {
    const { svc, bindings, auditLogs } = buildService();
    const created = await svc.addBinding({
      tenantId: TENANT,
      trackingLinkId: "tl-1",
      offerId: "o1",
    });
    expect(created.offerId).toBe("o1");
    expect(created.priority).toBe(100);
    expect(created.isFallback).toBe(false);
    expect(bindings._store).toHaveLength(1);
    expect(auditLogs._store[0]?.action).toBe("TRACKING_LINK_OFFER_ADDED");
  });

  it("addBinding rejects missing TrackingLink", async () => {
    const { svc } = buildService({ links: [] });
    await expect(
      svc.addBinding({
        tenantId: TENANT,
        trackingLinkId: "missing",
        offerId: "o1",
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("addBinding rejects missing Offer", async () => {
    const { svc } = buildService({ offers: [] });
    await expect(
      svc.addBinding({
        tenantId: TENANT,
        trackingLinkId: "tl-1",
        offerId: "missing",
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("addBinding rejects duplicate binding", async () => {
    const { svc } = buildService({
      bindings: [
        makeBinding({
          id: "b1",
          tenantId: TENANT,
          trackingLinkId: "tl-1",
          offerId: "o1",
        }),
      ],
    });
    await expect(
      svc.addBinding({
        tenantId: TENANT,
        trackingLinkId: "tl-1",
        offerId: "o1",
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("addBinding rejects second fallback", async () => {
    const { svc } = buildService({
      bindings: [
        makeBinding({
          id: "b1",
          tenantId: TENANT,
          trackingLinkId: "tl-1",
          offerId: "o1",
          isFallback: true,
        }),
      ],
    });
    await expect(
      svc.addBinding({
        tenantId: TENANT,
        trackingLinkId: "tl-1",
        offerId: "o2",
        isFallback: true,
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("updateBinding changes priority", async () => {
    const { svc } = buildService({
      bindings: [
        makeBinding({
          id: "b1",
          tenantId: TENANT,
          trackingLinkId: "tl-1",
          offerId: "o1",
          priority: 100,
        }),
      ],
    });
    const updated = await svc.updateBinding({
      tenantId: TENANT,
      bindingId: "b1",
      priority: 5,
    });
    expect(updated.priority).toBe(5);
  });

  it("updateBinding rejects unknown binding", async () => {
    const { svc } = buildService();
    await expect(
      svc.updateBinding({ tenantId: TENANT, bindingId: "missing", priority: 1 })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("removeBinding deletes and audits", async () => {
    const { svc, bindings, auditLogs } = buildService({
      bindings: [
        makeBinding({
          id: "b1",
          tenantId: TENANT,
          trackingLinkId: "tl-1",
          offerId: "o1",
        }),
      ],
    });
    await svc.removeBinding({ tenantId: TENANT, bindingId: "b1" });
    expect(bindings._store).toHaveLength(0);
    expect(auditLogs._store.some((a) => a.action === "TRACKING_LINK_OFFER_REMOVED")).toBe(
      true
    );
  });

  it("replaceBindings rejects more than one fallback", async () => {
    const { svc } = buildService();
    await expect(
      svc.replaceBindings({
        tenantId: TENANT,
        trackingLinkId: "tl-1",
        bindings: [
          { offerId: "o1", isFallback: true },
          { offerId: "o2", isFallback: true },
        ],
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("replaceBindings replaces all bindings", async () => {
    const { svc, bindings } = buildService({
      bindings: [
        makeBinding({
          id: "old",
          tenantId: TENANT,
          trackingLinkId: "tl-1",
          offerId: "o1",
          priority: 1,
        }),
      ],
    });
    const created = await svc.replaceBindings({
      tenantId: TENANT,
      trackingLinkId: "tl-1",
      bindings: [
        { offerId: "o2", priority: 20 },
        { offerId: "o1", priority: 30, isFallback: true },
      ],
    });
    expect(created).toHaveLength(2);
    expect(bindings._store.map((b) => b.offerId).sort()).toEqual(["o1", "o2"]);
    expect(bindings._store.find((b) => b.offerId === "o1")?.isFallback).toBe(true);
  });

  it("listBindings returns tenant-scoped bindings", async () => {
    const { svc } = buildService({
      bindings: [
        makeBinding({
          id: "b1",
          tenantId: TENANT,
          trackingLinkId: "tl-1",
          offerId: "o1",
        }),
      ],
    });
    const listed = await svc.listBindings(TENANT, "tl-1");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.offerId).toBe("o1");
  });
});
