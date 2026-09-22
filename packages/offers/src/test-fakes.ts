/**
 * Minimal in-memory fakes for @adlinklab/offers unit tests.
 * Not for production use.
 */
import type {
  AuditLog,
  LandingPage,
  Offer,
  TrackingLink,
  TrackingLinkOffer,
} from "@adlinklab/domain";
import type {
  AuditLogRepository,
  LandingPageRepository,
  OfferRepository,
  TrackingLinkOfferRepository,
  TrackingLinkRepository,
} from "@adlinklab/domain";
import type { TransactionContext, UnitOfWork } from "@adlinklab/domain";

const now = () => new Date("2026-06-15T12:00:00.000Z");

export function makeOffer(partial: Partial<Offer> & Pick<Offer, "id" | "tenantId">): Offer {
  return {
    name: partial.name ?? `Offer ${partial.id}`,
    network: partial.network ?? "test-network",
    destinationUrl: partial.destinationUrl ?? "https://offer.example/dest",
    status: partial.status ?? "ACTIVE",
    priority: partial.priority ?? 100,
    createdAt: partial.createdAt ?? now(),
    updatedAt: partial.updatedAt ?? now(),
    startsAt: partial.startsAt,
    endsAt: partial.endsAt,
    deletedAt: partial.deletedAt,
    idempotencyScope: partial.idempotencyScope,
    idempotencyKey: partial.idempotencyKey,
    id: partial.id,
    tenantId: partial.tenantId,
  };
}

export function makeLandingPage(
  partial: Partial<LandingPage> & Pick<LandingPage, "id" | "tenantId" | "offerId">
): LandingPage {
  return {
    name: partial.name ?? `LP ${partial.id}`,
    url: partial.url ?? "https://landing.example/page",
    domain: partial.domain ?? "landing.example",
    status: partial.status ?? "ACTIVE",
    createdAt: partial.createdAt ?? now(),
    updatedAt: partial.updatedAt ?? now(),
    deletedAt: partial.deletedAt,
    id: partial.id,
    tenantId: partial.tenantId,
    offerId: partial.offerId,
  };
}

export function makeTrackingLink(
  partial: Partial<TrackingLink> &
    Pick<TrackingLink, "id" | "tenantId" | "offerId" | "publicId">
): TrackingLink {
  return {
    status: partial.status ?? "ACTIVE",
    createdAt: partial.createdAt ?? now(),
    updatedAt: partial.updatedAt ?? now(),
    deletedAt: partial.deletedAt,
    landingPageId: partial.landingPageId,
    campaignId: partial.campaignId,
    adGroupId: partial.adGroupId,
    adId: partial.adId,
    criterionId: partial.criterionId,
    id: partial.id,
    tenantId: partial.tenantId,
    offerId: partial.offerId,
    publicId: partial.publicId,
  };
}

export function makeBinding(
  partial: Partial<TrackingLinkOffer> &
    Pick<TrackingLinkOffer, "id" | "tenantId" | "trackingLinkId" | "offerId">
): TrackingLinkOffer {
  return {
    priority: partial.priority ?? 100,
    isFallback: partial.isFallback ?? false,
    createdAt: partial.createdAt ?? now(),
    updatedAt: partial.updatedAt ?? now(),
    id: partial.id,
    tenantId: partial.tenantId,
    trackingLinkId: partial.trackingLinkId,
    offerId: partial.offerId,
  };
}

export function createOfferRepo(offers: Offer[]): OfferRepository {
  const byId = new Map(offers.map((o) => [o.id, o]));
  return {
    findById: async (id) => byId.get(id) ?? null,
    findByIdForTenant: async (tenantId, id) => {
      const o = byId.get(id);
      return o && o.tenantId === tenantId ? o : null;
    },
    findByIdempotencyKey: async () => null,
    list: async () => ({ items: [...byId.values()], total: byId.size, page: 1, pageSize: 50 }),
    create: async (data) => {
      const row = { ...data, createdAt: now(), updatedAt: now() };
      byId.set(row.id, row);
      return row;
    },
    update: async (id, data) => {
      const prev = byId.get(id);
      if (!prev) throw new Error(`Offer ${id} missing`);
      const next = { ...prev, ...data, updatedAt: now() };
      byId.set(id, next);
      return next;
    },
  };
}

export function createLandingPageRepo(pages: LandingPage[]): LandingPageRepository {
  const store = [...pages];
  return {
    findById: async (id) => store.find((p) => p.id === id) ?? null,
    findByIdForTenant: async (tenantId, id) =>
      store.find((p) => p.id === id && p.tenantId === tenantId) ?? null,
    list: async (input) => {
      let items = store;
      if (input?.tenantId) items = items.filter((p) => p.tenantId === input.tenantId);
      if (input?.offerId) items = items.filter((p) => p.offerId === input.offerId);
      return { items, total: items.length, page: 1, pageSize: input?.pageSize ?? 50 };
    },
    create: async (data) => {
      const row = { ...data, createdAt: now(), updatedAt: now() };
      store.push(row);
      return row;
    },
    update: async (id, data) => {
      const i = store.findIndex((p) => p.id === id);
      if (i < 0) throw new Error(`LandingPage ${id} missing`);
      store[i] = { ...store[i]!, ...data, updatedAt: now() };
      return store[i]!;
    },
  };
}

export function createTrackingLinkRepo(links: TrackingLink[]): TrackingLinkRepository {
  const byId = new Map(links.map((l) => [l.id, l]));
  return {
    findById: async (id) => byId.get(id) ?? null,
    findByIdForTenant: async (tenantId, id) => {
      const l = byId.get(id);
      return l && l.tenantId === tenantId ? l : null;
    },
    findByPublicId: async () => null,
    findByPublicIdForTenant: async () => null,
    list: async () => ({ items: [...byId.values()], total: byId.size, page: 1, pageSize: 50 }),
    create: async (data) => {
      const row = { ...data, createdAt: now(), updatedAt: now() };
      byId.set(row.id, row);
      return row;
    },
    update: async (id, data) => {
      const prev = byId.get(id);
      if (!prev) throw new Error(`TrackingLink ${id} missing`);
      const next = { ...prev, ...data, updatedAt: now() };
      byId.set(id, next);
      return next;
    },
  };
}

export function createBindingRepo(
  initial: TrackingLinkOffer[] = []
): TrackingLinkOfferRepository & { _store: TrackingLinkOffer[] } {
  const store = [...initial];
  const repo: TrackingLinkOfferRepository & { _store: TrackingLinkOffer[] } = {
    _store: store,
    findById: async (id) => store.find((b) => b.id === id) ?? null,
    findByIdForTenant: async (tenantId, id) =>
      store.find((b) => b.id === id && b.tenantId === tenantId) ?? null,
    findByTrackingLinkForTenant: async (tenantId, trackingLinkId) =>
      store.filter(
        (b) => b.tenantId === tenantId && b.trackingLinkId === trackingLinkId
      ),
    findBindingForTenant: async (tenantId, trackingLinkId, offerId) =>
      store.find(
        (b) =>
          b.tenantId === tenantId &&
          b.trackingLinkId === trackingLinkId &&
          b.offerId === offerId
      ) ?? null,
    findFallbackForTrackingLink: async (tenantId, trackingLinkId) =>
      store.find(
        (b) =>
          b.tenantId === tenantId &&
          b.trackingLinkId === trackingLinkId &&
          b.isFallback
      ) ?? null,
    create: async (data) => {
      const row = { ...data, createdAt: now(), updatedAt: now() };
      store.push(row);
      return row;
    },
    update: async (id, data) => {
      const i = store.findIndex((b) => b.id === id);
      if (i < 0) throw new Error(`Binding ${id} missing`);
      store[i] = { ...store[i]!, ...data, updatedAt: now() };
      return store[i]!;
    },
    delete: async (id) => {
      const i = store.findIndex((b) => b.id === id);
      if (i >= 0) store.splice(i, 1);
    },
  };
  return repo;
}

export function createAuditLogRepo(): AuditLogRepository & { _store: AuditLog[] } {
  const store: AuditLog[] = [];
  return {
    _store: store,
    findById: async (id) => store.find((a) => a.id === id) ?? null,
    list: async () => ({ items: store, total: store.length, page: 1, pageSize: 50 }),
    create: async (data) => {
      const row = {
        ...data,
        createdAt: now(),
      } as AuditLog;
      store.push(row);
      return row;
    },
  };
}

/** UnitOfWork that shares the same binding + audit repos inside the transaction. */
export function createMemoryUnitOfWork(deps: {
  trackingLinkOffers: TrackingLinkOfferRepository;
  auditLogs: AuditLogRepository;
}): UnitOfWork {
  return {
    transaction: async (work) => {
      const ctx = {
        trackingLinkOffers: deps.trackingLinkOffers,
        auditLogs: deps.auditLogs,
      } as unknown as TransactionContext;
      return work(ctx);
    },
  };
}
