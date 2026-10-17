import { randomUUID } from "node:crypto";
import type {
  AdGroupCriterionRepository,
  AttributionContext,
  Click,
  ClickRepository,
  RequestMetadataInput,
  TrackingLinkRepository,
  UnitOfWork,
} from "@adlinklab/domain";
import { AuditActions } from "@adlinklab/domain";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@adlinklab/shared";
import {
  extractTrackingParams,
  normalizeRequestMetadata,
  TrackingLinkResolver,
} from "@adlinklab/tracking";
import { TrafficEventService } from "./traffic-events.js";
import { businessMetrics } from "../observability/index.js";

export interface ClickAuditWriter {
  record(input: {
    tenantId?: string;
    action: string;
    entityType?: string;
    entityId?: string;
    requestId?: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  }): Promise<unknown> | unknown;
}

export interface ClickResult {
  clickId: string;
  trackingLinkId: string;
  offerId: string;
  landingPageId: string;
  redirectUrl: string;
  attribution: AttributionContext;
  replayed: boolean;
  click: Click;
}

export interface RecordClickInput {
  /** Optional for public redirect — derived from TrackingLink.publicId when omitted. */
  tenantId?: string;
  trackingLinkPublicId: string;
  requestMetadata?: RequestMetadataInput;
  queryParameters?: Record<string, string | string[] | undefined>;
  occurredAt?: Date;
  /** Explicit ingestion idempotency key — same key returns first Click */
  ingestionId?: string;
  requestId?: string;
  /**
   * Real inbound request URL (e.g. the /t/:publicId URL). Optional —
   * recorded as the AD_CLICK destination when present, left empty otherwise.
   */
  requestUrl?: string;
}

/**
 * Phase 4 — Click ingestion with tenant-scoped attribution.
 * Network / external work stays outside DB transactions.
 */
export class ClickIngestionService {
  constructor(
    private readonly resolver: TrackingLinkResolver,
    private readonly clicks: ClickRepository,
    private readonly unitOfWork: UnitOfWork,
    /**
     * Phase 2 — traffic event journal (optional). Best-effort only:
     * event writes never change the Click result or throw into it.
     */
    private readonly trafficEvents?: TrafficEventService,
    /** Optional — enables real criterion matchType lookup for Click.matchType. */
    private readonly adGroupCriteria?: AdGroupCriterionRepository
  ) {}

  async recordClick(input: RecordClickInput): Promise<ClickResult> {
    if (!input.trackingLinkPublicId?.trim()) {
      throw new ValidationError("trackingLinkPublicId is required");
    }

    const publicId = input.trackingLinkPublicId.trim();
    const resolved = input.tenantId
      ? await this.resolver.resolve(input.tenantId, publicId)
      : await this.resolver.resolveByPublicId(publicId);
    const tenantId = resolved.trackingLink.tenantId;

    if (input.tenantId && input.tenantId !== tenantId) {
      throw new ValidationError("tenantId does not match TrackingLink", {
        tenantId: input.tenantId,
        linkTenantId: tenantId,
      });
    }

    const metadata = normalizeRequestMetadata({
      ...input.requestMetadata,
      queryParameters: {
        ...(input.requestMetadata?.queryParameters ?? {}),
        ...(input.queryParameters ?? {}),
      },
    });
    const trackingParams = extractTrackingParams(metadata.queryParameters);

    if (input.ingestionId) {
      const existing = await this.clicks.findByIngestionIdForTenant(
        tenantId,
        input.ingestionId
      );
      if (existing) {
        return {
          clickId: existing.clickId,
          trackingLinkId: existing.trackingLinkId,
          offerId: existing.offerId ?? resolved.offer.id,
          landingPageId: existing.landingPageId ?? resolved.landingPage.id,
          redirectUrl: resolved.redirectUrl,
          attribution: resolved.attribution,
          replayed: true,
          click: existing,
        };
      }
    }

    const clickUuid = randomUUID();
    const occurredAt = input.occurredAt ?? new Date();
    // Phase 2 — real criterion matchType only; null when unknown, never invented.
    const matchType = await this.resolveMatchType(
      tenantId,
      resolved.attribution.criterionId
    );

    try {
      const click = await this.unitOfWork.transaction(async (ctx) => {
        if (input.ingestionId) {
          const raced = await ctx.clicks.findByIngestionIdForTenant(
            tenantId,
            input.ingestionId
          );
          if (raced) return raced;
        }

        return ctx.clicks.create({
          id: clickUuid,
          clickId: clickUuid,
          tenantId,
          trackingLinkId: resolved.trackingLink.id,
          offerId: resolved.attribution.offerId,
          landingPageId: resolved.attribution.landingPageId,
          campaignId: resolved.attribution.campaignId ?? undefined,
          adGroupId: resolved.attribution.adGroupId ?? undefined,
          adId: resolved.attribution.adId ?? undefined,
          criterionId: resolved.attribution.criterionId ?? undefined,
          gclid: trackingParams.gclid,
          gbraid: trackingParams.gbraid,
          wbraid: trackingParams.wbraid,
          utmSource: trackingParams.utmSource,
          utmMedium: trackingParams.utmMedium,
          utmCampaign: trackingParams.utmCampaign,
          utmTerm: trackingParams.utmTerm,
          utmContent: trackingParams.utmContent,
          trafficSource: trackingParams.utmSource ?? undefined,
          trafficMedium: trackingParams.utmMedium ?? undefined,
          matchType,
          userAgent: metadata.userAgent,
          ipAddress: metadata.ipAddress,
          referer: metadata.referer,
          queryParameters: { ...metadata.queryParameters },
          ingestionId: input.ingestionId,
          occurredAt,
        });
      });

      const replayed = click.id !== clickUuid;
      if (!replayed) businessMetrics.clickRecorded(); // P2-3
      const result: ClickResult = {
        clickId: click.clickId,
        trackingLinkId: click.trackingLinkId,
        offerId: click.offerId ?? resolved.offer.id,
        landingPageId: click.landingPageId ?? resolved.landingPage.id,
        redirectUrl: resolved.redirectUrl,
        attribution: resolved.attribution,
        replayed,
        click,
      };

      if (!replayed && this.trafficEvents) {
        // Phase 2 — traffic event journal. Best-effort: failures are logged
        // inside the service and never affect the click result above.
        await this.trafficEvents.emitClickChain({
          tenantId,
          clickId: click.id,
          trackingLinkId: click.trackingLinkId,
          timestamp: occurredAt,
          referer: metadata.referer ?? null,
          requestUrl: input.requestUrl ?? null,
          landingPageId: click.landingPageId ?? null,
          landingPageUrl: resolved.landingPage.url,
          redirectUrl: result.redirectUrl,
        });
      }

      return result;
    } catch (error) {
      if (error instanceof ConflictError && input.ingestionId) {
        const existing = await this.clicks.findByIngestionIdForTenant(
          tenantId,
          input.ingestionId
        );
        if (existing) {
          return {
            clickId: existing.clickId,
            trackingLinkId: existing.trackingLinkId,
            offerId: existing.offerId ?? resolved.offer.id,
            landingPageId: existing.landingPageId ?? resolved.landingPage.id,
            redirectUrl: resolved.redirectUrl,
            attribution: resolved.attribution,
            replayed: true,
            click: existing,
          };
        }
      }
      throw error;
    }
  }

  async getClick(tenantId: string, id: string): Promise<Click> {
    const click = await this.clicks.findByIdForTenant(tenantId, id);
    if (!click) throw new NotFoundError("Click", id);
    return click;
  }

  /**
   * Phase 2 — best-effort real criterion matchType lookup.
   * Returns undefined when unknown; never throws, never invents a value.
   */
  private async resolveMatchType(
    tenantId: string,
    criterionId: string | null
  ): Promise<string | undefined> {
    if (!criterionId || !this.adGroupCriteria) return undefined;
    try {
      const criterion = await this.adGroupCriteria.findByIdForTenant(
        tenantId,
        criterionId
      );
      return criterion?.matchType ?? undefined;
    } catch {
      return undefined;
    }
  }

  list(tenantId: string, page?: number, pageSize?: number) {
    return this.clicks.list({ tenantId, page, pageSize });
  }

  listByTrackingLink(
    tenantId: string,
    trackingLinkId: string,
    page?: number,
    pageSize?: number
  ) {
    return this.clicks.list({ tenantId, trackingLinkId, page, pageSize });
  }

  countByTrackingLink(tenantId: string, trackingLinkId: string) {
    return this.clicks.countByTrackingLink(tenantId, trackingLinkId);
  }

  countByOffer(tenantId: string, offerId: string) {
    return this.clicks.countByOffer(tenantId, offerId);
  }

  countByCampaign(tenantId: string, campaignId: string) {
    return this.clicks.countByCampaign(tenantId, campaignId);
  }
}

/** Tracking link CRUD with audit on create/update/status change */
export class TrackingLinkManagementService {
  constructor(
    private readonly trackingLinks: TrackingLinkRepository,
    private readonly audit?: ClickAuditWriter
  ) {}

  list(tenantId: string, page?: number, pageSize?: number) {
    return this.trackingLinks.list({ tenantId, page, pageSize });
  }

  async getById(tenantId: string, id: string) {
    const link = await this.trackingLinks.findByIdForTenant(tenantId, id);
    if (!link) throw new NotFoundError("TrackingLink", id);
    return link;
  }

  async getByPublicId(tenantId: string, publicId: string) {
    const link = await this.trackingLinks.findByPublicIdForTenant(
      tenantId,
      publicId
    );
    if (!link) throw new NotFoundError("TrackingLink", publicId);
    return link;
  }

  async create(
    data: Parameters<TrackingLinkRepository["create"]>[0],
    requestId?: string
  ) {
    const created = await this.trackingLinks.create(data);
    await this.audit?.record({
      tenantId: created.tenantId,
      action: AuditActions.TRACKING_LINK_CREATED,
      entityType: "TrackingLink",
      entityId: created.id,
      requestId,
      after: { publicId: created.publicId, status: created.status },
    });
    return created;
  }

  async update(
    tenantId: string,
    id: string,
    data: Parameters<TrackingLinkRepository["update"]>[1],
    requestId?: string
  ) {
    const existing = await this.getById(tenantId, id);
    const updated = await this.trackingLinks.update(id, data);
    const statusChanged =
      data.status != null && data.status !== existing.status;
    await this.audit?.record({
      tenantId,
      action: statusChanged
        ? AuditActions.TRACKING_LINK_STATUS_CHANGED
        : AuditActions.TRACKING_LINK_UPDATED,
      entityType: "TrackingLink",
      entityId: id,
      requestId,
      before: { status: existing.status },
      after: { status: updated.status, publicId: updated.publicId },
    });
    return updated;
  }
}
