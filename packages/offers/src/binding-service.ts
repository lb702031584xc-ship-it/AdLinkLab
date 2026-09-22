import { randomUUID } from "node:crypto";
import type {
  TrackingLinkOffer,
  TrackingLinkOfferRepository,
  TrackingLinkRepository,
  OfferRepository,
  UnitOfWork,
} from "@adlinklab/domain";
import { AuditActions } from "@adlinklab/domain";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@adlinklab/shared";

/**
 * Manage TrackingLink ↔ Offer bindings (tenant scoped).
 */
export class TrackingLinkOfferService {
  constructor(
    private readonly trackingLinks: TrackingLinkRepository,
    private readonly offers: OfferRepository,
    private readonly bindings: TrackingLinkOfferRepository,
    private readonly unitOfWork: UnitOfWork
  ) {}

  listBindings(tenantId: string, trackingLinkId: string) {
    return this.bindings.findByTrackingLinkForTenant(tenantId, trackingLinkId);
  }

  async addBinding(input: {
    tenantId: string;
    trackingLinkId: string;
    offerId: string;
    priority?: number;
    isFallback?: boolean;
    requestId?: string;
  }): Promise<TrackingLinkOffer> {
    const link = await this.trackingLinks.findByIdForTenant(
      input.tenantId,
      input.trackingLinkId
    );
    if (!link) throw new NotFoundError("TrackingLink", input.trackingLinkId);

    const offer = await this.offers.findByIdForTenant(
      input.tenantId,
      input.offerId
    );
    if (!offer) throw new NotFoundError("Offer", input.offerId);

    return this.unitOfWork.transaction(async (ctx) => {
      const existing = await ctx.trackingLinkOffers.findBindingForTenant(
        input.tenantId,
        input.trackingLinkId,
        input.offerId
      );
      if (existing) {
        throw new ConflictError("TrackingLinkOffer binding already exists", {
          trackingLinkId: input.trackingLinkId,
          offerId: input.offerId,
        });
      }

      if (input.isFallback) {
        const fallback = await ctx.trackingLinkOffers.findFallbackForTrackingLink(
          input.tenantId,
          input.trackingLinkId
        );
        if (fallback) {
          throw new ConflictError(
            "TrackingLink already has a fallback Offer binding",
            { trackingLinkId: input.trackingLinkId, existingId: fallback.id }
          );
        }
      }

      const created = await ctx.trackingLinkOffers.create({
        id: randomUUID(),
        tenantId: input.tenantId,
        trackingLinkId: input.trackingLinkId,
        offerId: input.offerId,
        priority: input.priority ?? 100,
        isFallback: input.isFallback ?? false,
      });

      await ctx.auditLogs.create({
        id: randomUUID(),
        tenantId: input.tenantId,
        action: AuditActions.TRACKING_LINK_OFFER_ADDED,
        entityType: "TrackingLinkOffer",
        entityId: created.id,
        requestId: input.requestId,
        after: {
          trackingLinkId: created.trackingLinkId,
          offerId: created.offerId,
          priority: created.priority,
          isFallback: created.isFallback,
        },
      });

      return created;
    });
  }

  async updateBinding(input: {
    tenantId: string;
    bindingId: string;
    priority?: number;
    isFallback?: boolean;
    requestId?: string;
  }): Promise<TrackingLinkOffer> {
    const existing = await this.bindings.findByIdForTenant(
      input.tenantId,
      input.bindingId
    );
    if (!existing) throw new NotFoundError("TrackingLinkOffer", input.bindingId);

    return this.unitOfWork.transaction(async (ctx) => {
      if (input.isFallback === true && !existing.isFallback) {
        const fallback = await ctx.trackingLinkOffers.findFallbackForTrackingLink(
          input.tenantId,
          existing.trackingLinkId
        );
        if (fallback && fallback.id !== existing.id) {
          throw new ConflictError(
            "TrackingLink already has a fallback Offer binding",
            { trackingLinkId: existing.trackingLinkId }
          );
        }
      }

      const updated = await ctx.trackingLinkOffers.update(existing.id, {
        priority: input.priority ?? existing.priority,
        isFallback:
          input.isFallback !== undefined ? input.isFallback : existing.isFallback,
      });

      await ctx.auditLogs.create({
        id: randomUUID(),
        tenantId: input.tenantId,
        action: AuditActions.TRACKING_LINK_OFFER_UPDATED,
        entityType: "TrackingLinkOffer",
        entityId: updated.id,
        requestId: input.requestId,
        before: {
          priority: existing.priority,
          isFallback: existing.isFallback,
        },
        after: {
          priority: updated.priority,
          isFallback: updated.isFallback,
        },
      });

      return updated;
    });
  }

  async removeBinding(input: {
    tenantId: string;
    bindingId: string;
    requestId?: string;
  }): Promise<void> {
    const existing = await this.bindings.findByIdForTenant(
      input.tenantId,
      input.bindingId
    );
    if (!existing) throw new NotFoundError("TrackingLinkOffer", input.bindingId);

    await this.unitOfWork.transaction(async (ctx) => {
      await ctx.trackingLinkOffers.delete(existing.id);
      await ctx.auditLogs.create({
        id: randomUUID(),
        tenantId: input.tenantId,
        action: AuditActions.TRACKING_LINK_OFFER_REMOVED,
        entityType: "TrackingLinkOffer",
        entityId: existing.id,
        requestId: input.requestId,
        before: {
          trackingLinkId: existing.trackingLinkId,
          offerId: existing.offerId,
        },
      });
    });
  }

  /**
   * Replace all bindings for a tracking link (PUT semantics).
   */
  async replaceBindings(input: {
    tenantId: string;
    trackingLinkId: string;
    bindings: Array<{
      offerId: string;
      priority?: number;
      isFallback?: boolean;
    }>;
    requestId?: string;
  }): Promise<TrackingLinkOffer[]> {
    const link = await this.trackingLinks.findByIdForTenant(
      input.tenantId,
      input.trackingLinkId
    );
    if (!link) throw new NotFoundError("TrackingLink", input.trackingLinkId);

    const fallbacks = input.bindings.filter((b) => b.isFallback);
    if (fallbacks.length > 1) {
      throw new ValidationError("At most one fallback binding is allowed");
    }

    for (const b of input.bindings) {
      const offer = await this.offers.findByIdForTenant(
        input.tenantId,
        b.offerId
      );
      if (!offer) throw new NotFoundError("Offer", b.offerId);
    }

    return this.unitOfWork.transaction(async (ctx) => {
      const current = await ctx.trackingLinkOffers.findByTrackingLinkForTenant(
        input.tenantId,
        input.trackingLinkId
      );
      for (const c of current) {
        await ctx.trackingLinkOffers.delete(c.id);
      }

      const created: TrackingLinkOffer[] = [];
      for (const b of input.bindings) {
        const row = await ctx.trackingLinkOffers.create({
          id: randomUUID(),
          tenantId: input.tenantId,
          trackingLinkId: input.trackingLinkId,
          offerId: b.offerId,
          priority: b.priority ?? 100,
          isFallback: b.isFallback ?? false,
        });
        created.push(row);
        await ctx.auditLogs.create({
          id: randomUUID(),
          tenantId: input.tenantId,
          action: AuditActions.TRACKING_LINK_OFFER_ADDED,
          entityType: "TrackingLinkOffer",
          entityId: row.id,
          requestId: input.requestId,
          after: {
            trackingLinkId: row.trackingLinkId,
            offerId: row.offerId,
            priority: row.priority,
            isFallback: row.isFallback,
          },
        });
      }
      return created;
    });
  }
}
