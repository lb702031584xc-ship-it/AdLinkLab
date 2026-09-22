import { randomUUID } from "node:crypto";
import type {
  LandingPageRepository,
  Offer,
  OfferRepository,
  OfferStatus,
  UnitOfWork,
} from "@adlinklab/domain";
import { assertOfferTransition, AuditActions } from "@adlinklab/domain";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@adlinklab/shared";
import { assertSafeRedirectUrl } from "@adlinklab/tracking";

const OFFER_CREATE_SCOPE = "OFFER_CREATE";

/**
 * Phase 5 — Offer CRUD + status lifecycle (tenant scoped).
 * Does not mutate Google Ads URLs.
 */
export class OfferService {
  constructor(
    private readonly offers: OfferRepository,
    private readonly landingPages: LandingPageRepository,
    private readonly unitOfWork: UnitOfWork
  ) {}

  list(tenantId: string, page?: number, pageSize?: number) {
    return this.offers.list({ tenantId, page, pageSize });
  }

  async getById(tenantId: string, id: string): Promise<Offer> {
    const offer = await this.offers.findByIdForTenant(tenantId, id);
    if (!offer) throw new NotFoundError("Offer", id);
    return offer;
  }

  async create(input: {
    tenantId: string;
    name: string;
    network: string;
    destinationUrl: string;
    status?: OfferStatus;
    priority?: number;
    startsAt?: Date;
    endsAt?: Date;
    idempotencyKey?: string;
    requestId?: string;
  }): Promise<{ offer: Offer; created: boolean; replayed: boolean }> {
    if (!input.tenantId) throw new ValidationError("tenantId is required");
    if (!input.name?.trim()) throw new ValidationError("name is required");
    if (!input.network?.trim()) throw new ValidationError("network is required");
    assertSafeRedirectUrl(input.destinationUrl);

    if (input.idempotencyKey) {
      const existing = await this.offers.findByIdempotencyKey(
        input.tenantId,
        OFFER_CREATE_SCOPE,
        input.idempotencyKey
      );
      if (existing) {
        return { offer: existing, created: false, replayed: true };
      }
    }

    try {
      let wasCreate = true;
      const offer = await this.unitOfWork.transaction(async (ctx) => {
        if (input.idempotencyKey) {
          const raced = await ctx.offers.findByIdempotencyKey(
            input.tenantId,
            OFFER_CREATE_SCOPE,
            input.idempotencyKey
          );
          if (raced) {
            wasCreate = false;
            return raced;
          }
        }

        const created = await ctx.offers.create({
          id: randomUUID(),
          tenantId: input.tenantId,
          name: input.name.trim(),
          network: input.network.trim(),
          destinationUrl: input.destinationUrl.trim(),
          status: input.status ?? "DRAFT",
          priority: input.priority ?? 100,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          idempotencyScope: input.idempotencyKey
            ? OFFER_CREATE_SCOPE
            : undefined,
          idempotencyKey: input.idempotencyKey,
        });

        await ctx.auditLogs.create({
          id: randomUUID(),
          tenantId: input.tenantId,
          action: AuditActions.OFFER_CREATED,
          entityType: "Offer",
          entityId: created.id,
          requestId: input.requestId,
          after: {
            name: created.name,
            status: created.status,
            priority: created.priority,
          },
        });

        return created;
      });

      return {
        offer,
        created: wasCreate,
        replayed: !wasCreate,
      };
    } catch (error) {
      if (error instanceof ConflictError && input.idempotencyKey) {
        const existing = await this.offers.findByIdempotencyKey(
          input.tenantId,
          OFFER_CREATE_SCOPE,
          input.idempotencyKey
        );
        if (existing) {
          return { offer: existing, created: false, replayed: true };
        }
      }
      throw error;
    }
  }

  async update(
    tenantId: string,
    id: string,
    data: {
      name?: string;
      network?: string;
      destinationUrl?: string;
      priority?: number;
      startsAt?: Date | null;
      endsAt?: Date | null;
    },
    requestId?: string
  ): Promise<Offer> {
    const existing = await this.getById(tenantId, id);
    if (data.destinationUrl) {
      assertSafeRedirectUrl(data.destinationUrl);
    }

    return this.unitOfWork.transaction(async (ctx) => {
      const updated = await ctx.offers.update(id, {
        name: data.name ?? existing.name,
        network: data.network ?? existing.network,
        destinationUrl: data.destinationUrl ?? existing.destinationUrl,
        priority: data.priority ?? existing.priority,
        startsAt:
          data.startsAt === null
            ? undefined
            : (data.startsAt ?? existing.startsAt),
        endsAt:
          data.endsAt === null ? undefined : (data.endsAt ?? existing.endsAt),
      });

      await ctx.auditLogs.create({
        id: randomUUID(),
        tenantId,
        action: AuditActions.OFFER_UPDATED,
        entityType: "Offer",
        entityId: id,
        requestId,
        before: {
          name: existing.name,
          priority: existing.priority,
        },
        after: {
          name: updated.name,
          priority: updated.priority,
        },
      });

      return updated;
    });
  }

  async changeStatus(
    tenantId: string,
    id: string,
    status: OfferStatus,
    requestId?: string
  ): Promise<Offer> {
    const existing = await this.getById(tenantId, id);
    assertOfferTransition(existing.status, status);

    return this.unitOfWork.transaction(async (ctx) => {
      const updated = await ctx.offers.update(id, {
        status,
        archivedAt: status === "ARCHIVED" ? new Date() : existing.archivedAt,
      });

      await ctx.auditLogs.create({
        id: randomUUID(),
        tenantId,
        action: AuditActions.OFFER_STATUS_CHANGED,
        entityType: "Offer",
        entityId: id,
        requestId,
        before: { status: existing.status },
        after: { status: updated.status },
      });

      return updated;
    });
  }

  listLandingPages(tenantId: string, offerId: string, page?: number, pageSize?: number) {
    return this.landingPages.list({ tenantId, offerId, page, pageSize });
  }
}
