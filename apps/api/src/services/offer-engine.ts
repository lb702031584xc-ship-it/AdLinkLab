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

/** P1-2：品牌名来源（自动提取仅建议，人工填写优先）。 */
export const BRAND_NAME_SOURCES = ["manual", "auto_extracted", "domain_fallback"] as const;

/** P1-15：节日主题（只影响 RSA 文案）。"none" = 无节日主题。 */
export const FESTIVAL_THEMES = [
  "none",
  "valentines",
  "easter",
  "mothers-day",
  "fathers-day",
  "independence-day",
  "back-to-school",
  "labor-day",
  "halloween",
  "thanksgiving",
  "black-friday",
  "cyber-monday",
  "prime-day",
  "prime-big-deal-days",
  "christmas",
  "new-year",
] as const;

export function normalizeFestivalTheme(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const v = input.trim().toLowerCase();
  if (!v || v === "none") return undefined;
  return (FESTIVAL_THEMES as readonly string[]).includes(v) ? v : undefined;
}

function validateBrandFields(input: {
  brandName?: string;
  brandNameSource?: string;
  brandNameConfidence?: number;
}): void {
  if (input.brandName !== undefined && input.brandName.trim() === "") {
    throw new ValidationError("brandName must be non-empty when provided");
  }
  if (
    input.brandNameSource !== undefined &&
    !(BRAND_NAME_SOURCES as readonly string[]).includes(input.brandNameSource)
  ) {
    throw new ValidationError(
      "brandNameSource must be manual, auto_extracted or domain_fallback"
    );
  }
  if (
    input.brandNameConfidence !== undefined &&
    (!Number.isFinite(input.brandNameConfidence) ||
      input.brandNameConfidence < 0 ||
      input.brandNameConfidence > 1)
  ) {
    throw new ValidationError("brandNameConfidence must be between 0 and 1");
  }
}

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

  list(tenantId: string, page?: number, pageSize?: number, source?: string) {
    return this.offers.list({ tenantId, page, pageSize, source });
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
    /** Offer 来源：affiliate | amazon | cashback（默认 affiliate） */
    source?: string;
    destinationUrl: string;
    status?: OfferStatus;
    priority?: number;
    startsAt?: Date;
    endsAt?: Date;
    idempotencyKey?: string;
    requestId?: string;
    commissionValue?: number;
    commissionType?: string;
    avgPrice?: number;
    pickedAt?: Date;
    /** P1-2：品牌名（自动提取仅建议；人工填写优先） */
    brandName?: string;
    brandNameSource?: string;
    brandNameConfidence?: number;
    /** P1-15：节日主题（只影响 RSA 文案） */
    festivalTheme?: string;
  }): Promise<{ offer: Offer; created: boolean; replayed: boolean }> {
    if (!input.tenantId) throw new ValidationError("tenantId is required");
    if (!input.name?.trim()) throw new ValidationError("name is required");
    if (!input.network?.trim()) throw new ValidationError("network is required");
    validateBrandFields(input);
    if (
      input.source !== undefined &&
      !["affiliate", "amazon", "cashback"].includes(input.source)
    ) {
      throw new ValidationError("source must be affiliate, amazon or cashback");
    }
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
          source: input.source ?? "affiliate",
          destinationUrl: input.destinationUrl.trim(),
          status: input.status ?? "DRAFT",
          priority: input.priority ?? 100,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          commissionValue: input.commissionValue,
          commissionType: input.commissionType,
          avgPrice: input.avgPrice,
          pickedAt: input.pickedAt,
          brandName: input.brandName?.trim() || undefined,
          brandNameSource: input.brandNameSource,
          brandNameConfidence: input.brandNameConfidence,
          festivalTheme: normalizeFestivalTheme(input.festivalTheme),
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
      brandName?: string;
      brandNameSource?: string;
      brandNameConfidence?: number;
      festivalTheme?: string;
    },
    requestId?: string
  ): Promise<Offer> {
    const existing = await this.getById(tenantId, id);
    if (data.destinationUrl) {
      assertSafeRedirectUrl(data.destinationUrl);
    }
    validateBrandFields(data);

    return this.unitOfWork.transaction(async (ctx) => {
      const updated = await ctx.offers.update(id, {
        name: data.name ?? existing.name,
        network: data.network ?? existing.network,
        destinationUrl: data.destinationUrl ?? existing.destinationUrl,
        priority: data.priority ?? existing.priority,
        brandName: data.brandName?.trim() || existing.brandName,
        brandNameSource: data.brandNameSource ?? existing.brandNameSource,
        brandNameConfidence:
          data.brandNameConfidence ?? existing.brandNameConfidence,
        festivalTheme:
          data.festivalTheme === undefined
            ? existing.festivalTheme
            : normalizeFestivalTheme(data.festivalTheme),
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
