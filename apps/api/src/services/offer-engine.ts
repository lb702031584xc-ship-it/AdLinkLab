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

/** Offer 申请状态（offer 入库 ≠ 能推；与 status 生命周期独立的维度）。 */
export const APPLICATION_STATUSES = [
  "not_applied",
  "applied",
  "approved",
  "rejected",
] as const;

/** Offer + 申请状态三字段（domain Offer 未包含，API 层本地扩展类型）。 */
export type OfferWithApplication = Offer & {
  applicationStatus?: string;
  appliedAt?: Date | null;
  applicationNote?: string | null;
};

function validateApplicationFields(input: {
  applicationStatus?: string;
  appliedAt?: Date | null;
  applicationNote?: string | null;
}): void {
  if (
    input.applicationStatus !== undefined &&
    !(APPLICATION_STATUSES as readonly string[]).includes(input.applicationStatus)
  ) {
    throw new ValidationError(
      "applicationStatus must be not_applied, applied, approved or rejected"
    );
  }
  if (
    input.appliedAt !== undefined &&
    input.appliedAt !== null &&
    (!(input.appliedAt instanceof Date) ||
      Number.isNaN(input.appliedAt.getTime()))
  ) {
    throw new ValidationError("appliedAt must be a valid date");
  }
  if (
    input.applicationNote !== undefined &&
    input.applicationNote !== null &&
    (typeof input.applicationNote !== "string" ||
      input.applicationNote.length > 500)
  ) {
    throw new ValidationError("applicationNote must be at most 500 characters");
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

  async getById(tenantId: string, id: string): Promise<OfferWithApplication> {
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
    /** 联盟链接：联盟后台给的带参跟踪链接（可空；空字符串按 null 处理） */
    affiliateUrl?: string | null;
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
    /** 申请状态（独立维度）：not_applied | applied | approved | rejected；缺省 not_applied */
    applicationStatus?: string;
    /** 申请日期 */
    appliedAt?: Date | null;
    /** 申请备注（≤500 字；空串按 null 处理） */
    applicationNote?: string | null;
  }): Promise<{ offer: OfferWithApplication; created: boolean; replayed: boolean }> {
    if (!input.tenantId) throw new ValidationError("tenantId is required");
    if (!input.name?.trim()) throw new ValidationError("name is required");
    if (!input.network?.trim()) throw new ValidationError("network is required");
    validateBrandFields(input);
    validateApplicationFields(input);
    if (
      input.source !== undefined &&
      !["affiliate", "amazon", "cashback"].includes(input.source)
    ) {
      throw new ValidationError("source must be affiliate, amazon or cashback");
    }
    assertSafeRedirectUrl(input.destinationUrl);
    const affiliateUrl = input.affiliateUrl?.trim() || null;
    if (affiliateUrl) {
      assertSafeRedirectUrl(affiliateUrl);
    }

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

        // 扩展类型变量承载申请状态三字段（domain Offer 未包含），再传 repository 避 excess property 检查。
        const createData: Omit<
          OfferWithApplication,
          "createdAt" | "updatedAt"
        > = {
          id: randomUUID(),
          tenantId: input.tenantId,
          name: input.name.trim(),
          network: input.network.trim(),
          source: input.source ?? "affiliate",
          destinationUrl: input.destinationUrl.trim(),
          affiliateUrl,
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
          applicationStatus: input.applicationStatus ?? "not_applied",
          appliedAt: input.appliedAt ?? null,
          applicationNote: input.applicationNote?.trim() || null,
          idempotencyScope: input.idempotencyKey
            ? OFFER_CREATE_SCOPE
            : undefined,
          idempotencyKey: input.idempotencyKey,
        };
        const created = await ctx.offers.create(createData);

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
      /** 联盟链接（可空；空字符串按 null 处理） */
      affiliateUrl?: string | null;
      priority?: number;
      startsAt?: Date | null;
      endsAt?: Date | null;
      brandName?: string;
      brandNameSource?: string;
      brandNameConfidence?: number;
      festivalTheme?: string;
      /** 申请状态（独立维度）：not_applied | applied | approved | rejected */
      applicationStatus?: string;
      /** 申请日期；为 null 时不动（仿 startsAt 语义） */
      appliedAt?: Date | null;
      /** 申请备注（≤500 字）；空串/null = 清空 */
      applicationNote?: string | null;
    },
    requestId?: string
  ): Promise<OfferWithApplication> {
    const existing = await this.getById(tenantId, id);
    if (data.destinationUrl) {
      assertSafeRedirectUrl(data.destinationUrl);
    }
    const affiliateUrl =
      data.affiliateUrl === undefined
        ? undefined
        : data.affiliateUrl?.trim() || null;
    if (affiliateUrl) {
      assertSafeRedirectUrl(affiliateUrl);
    }
    validateBrandFields(data);
    validateApplicationFields(data);

    return this.unitOfWork.transaction(async (ctx) => {
      // 扩展类型变量承载申请状态三字段（domain Offer 未包含），再传 repository 避 excess property 检查。
      const updateData: Partial<Omit<OfferWithApplication, "id" | "createdAt">> = {
        name: data.name ?? existing.name,
        network: data.network ?? existing.network,
        destinationUrl: data.destinationUrl ?? existing.destinationUrl,
        affiliateUrl: affiliateUrl === undefined ? existing.affiliateUrl : affiliateUrl,
        priority: data.priority ?? existing.priority,
        brandName: data.brandName?.trim() || existing.brandName,
        brandNameSource: data.brandNameSource ?? existing.brandNameSource,
        brandNameConfidence:
          data.brandNameConfidence ?? existing.brandNameConfidence,
        festivalTheme:
          data.festivalTheme === undefined
            ? existing.festivalTheme
            : normalizeFestivalTheme(data.festivalTheme),
        applicationStatus:
          data.applicationStatus ?? existing.applicationStatus ?? "not_applied",
        appliedAt:
          data.appliedAt === null
            ? undefined
            : (data.appliedAt ?? existing.appliedAt),
        applicationNote:
          data.applicationNote === undefined
            ? existing.applicationNote
            : data.applicationNote?.trim() || null,
        startsAt:
          data.startsAt === null
            ? undefined
            : (data.startsAt ?? existing.startsAt),
        endsAt:
          data.endsAt === null ? undefined : (data.endsAt ?? existing.endsAt),
      };
      const updated = await ctx.offers.update(id, updateData);

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
