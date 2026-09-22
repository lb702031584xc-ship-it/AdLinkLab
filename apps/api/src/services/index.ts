import { randomUUID } from "node:crypto";
import type {
  AdRepository,
  AdGroupRepository,
  AuditLogRepository,
  CampaignRepository,
  ClickRepository,
  GoogleAccountRepository,
  SyncJobRepository,
  TrackingLinkRepository,
  UnitOfWork,
  UrlEntityType,
  UrlVersion,
  UrlVersionRepository,
} from "@adlinklab/domain";
import { assertUrlVersionTransition } from "@adlinklab/domain";
import type { GoogleAdsProvider } from "@adlinklab/google-ads";
import {
  assertValidUrlVersionFields,
  ServingUrlResolver,
  UrlResolver,
} from "@adlinklab/tracking";
import type { TrafficProvider } from "@adlinklab/traffic";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  createIdempotencyKey,
} from "@adlinklab/shared";

const VERSION_CREATE_RETRIES = 8;
const SYNC_JOB_SCOPE = "SYNC_JOB";

export class GoogleAccountService {
  constructor(
    private readonly googleAccounts: GoogleAccountRepository,
    private readonly providerKind: "mock" | "api" = "mock"
  ) {}
  list(tenantId: string, page?: number, pageSize?: number) {
    return this.googleAccounts.list({ tenantId, page, pageSize });
  }
  getById(id: string) {
    return this.googleAccounts.findById(id);
  }

  /**
   * Read-only provider/account status — no secrets, no mutations.
   * Always tenant-scoped (Phase 8.2).
   */
  async getStatus(input: { id: string; tenantId: string }) {
    const account = await this.googleAccounts.findByIdForTenant(
      input.tenantId,
      input.id
    );
    if (!account) throw new NotFoundError("GoogleAccount", input.id);
    return {
      id: account.id,
      tenantId: account.tenantId,
      customerId: account.customerId ?? account.googleCustomerId,
      status: account.status,
      oauthCredentialRefPresent: Boolean(account.oauthCredentialRef),
      providerKind: this.providerKind,
      liveApiEnabled: false,
      mutationsEnabled: false,
      phase: "2",
    };
  }
}

export class CampaignService {
  constructor(
    private readonly campaigns: CampaignRepository,
    private readonly provider: GoogleAdsProvider
  ) {}
  list(tenantId: string, page?: number, pageSize?: number) {
    return this.campaigns.list({ tenantId, page, pageSize });
  }
  async syncFromProvider(customerId: string) {
    return this.provider.listCampaigns(customerId);
  }
}

export class AdService {
  constructor(
    private readonly ads: AdRepository,
    private readonly adGroups: AdGroupRepository
  ) {}
  list(tenantId: string, page?: number, pageSize?: number) {
    return this.ads.list({ tenantId, page, pageSize });
  }
  listAdGroups(tenantId: string, page?: number, pageSize?: number) {
    return this.adGroups.list({ tenantId, page, pageSize });
  }
}

export class TrackingService {
  constructor(
    private readonly trackingLinks: TrackingLinkRepository,
    private readonly urlResolver = new UrlResolver(),
    private readonly servingResolver = new ServingUrlResolver()
  ) {}
  list(page?: number, pageSize?: number, tenantId?: string) {
    return this.trackingLinks.list({ page, pageSize, tenantId });
  }
  getById(tenantId: string, id: string) {
    return this.trackingLinks.findByIdForTenant(tenantId, id);
  }
  getByPublicId(tenantId: string, publicId: string) {
    return this.trackingLinks.findByPublicIdForTenant(tenantId, publicId);
  }
  resolveUrl(input: {
    finalUrl: string;
    trackingTemplate?: string;
    customParameters?: Record<string, string>;
    clickId?: string;
  }) {
    return this.urlResolver.resolve(input);
  }
  resolveServingUrl(
    input: Parameters<ServingUrlResolver["resolveServingUrl"]>[0]
  ) {
    return this.servingResolver.resolveServingUrl(input);
  }
}

export class ClickService {
  constructor(
    private readonly clicks: ClickRepository,
    private readonly traffic: TrafficProvider,
    private readonly ingestion?: {
      recordClick: (
        input: import("./click-ingestion.js").RecordClickInput
      ) => Promise<import("./click-ingestion.js").ClickResult>;
      getClick: (tenantId: string, id: string) => Promise<import("@adlinklab/domain").Click>;
      list: (
        tenantId: string,
        page?: number,
        pageSize?: number
      ) => ReturnType<ClickRepository["list"]>;
      listByTrackingLink: (
        tenantId: string,
        trackingLinkId: string,
        page?: number,
        pageSize?: number
      ) => ReturnType<ClickRepository["list"]>;
      countByTrackingLink: (
        tenantId: string,
        trackingLinkId: string
      ) => Promise<number>;
      countByOffer: (tenantId: string, offerId: string) => Promise<number>;
      countByCampaign: (tenantId: string, campaignId: string) => Promise<number>;
    }
  ) {}
  list(page?: number, pageSize?: number, tenantId?: string) {
    if (tenantId && this.ingestion) {
      return this.ingestion.list(tenantId, page, pageSize);
    }
    return this.clicks.list({ page, pageSize, tenantId });
  }
  record(input: Parameters<TrafficProvider["recordClick"]>[0]) {
    return this.traffic.recordClick(input);
  }
  recordClick(input: import("./click-ingestion.js").RecordClickInput) {
    if (!this.ingestion) {
      throw new ValidationError("Click ingestion service is not configured");
    }
    return this.ingestion.recordClick(input);
  }
  getClick(tenantId: string, id: string) {
    if (!this.ingestion) {
      throw new ValidationError("Click ingestion service is not configured");
    }
    return this.ingestion.getClick(tenantId, id);
  }
  listByTrackingLink(
    tenantId: string,
    trackingLinkId: string,
    page?: number,
    pageSize?: number
  ) {
    if (!this.ingestion) {
      return this.clicks.list({ tenantId, trackingLinkId, page, pageSize });
    }
    return this.ingestion.listByTrackingLink(
      tenantId,
      trackingLinkId,
      page,
      pageSize
    );
  }
  countByTrackingLink(tenantId: string, trackingLinkId: string) {
    return (
      this.ingestion?.countByTrackingLink(tenantId, trackingLinkId) ??
      this.clicks.countByTrackingLink(tenantId, trackingLinkId)
    );
  }
  countByOffer(tenantId: string, offerId: string) {
    return (
      this.ingestion?.countByOffer(tenantId, offerId) ??
      this.clicks.countByOffer(tenantId, offerId)
    );
  }
  countByCampaign(tenantId: string, campaignId: string) {
    return (
      this.ingestion?.countByCampaign(tenantId, campaignId) ??
      this.clicks.countByCampaign(tenantId, campaignId)
    );
  }
}

export { OrderConversionService } from "./conversion-order.js";

export class UrlVersionService {
  constructor(
    private readonly urlVersions: UrlVersionRepository,
    private readonly ads: AdRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  list(tenantId: string, page?: number, pageSize?: number) {
    return this.urlVersions.list({ tenantId, page, pageSize });
  }

  /**
   * Creates a new URL version without overwriting history.
   * Allocates version inside a transaction and retries on unique conflicts
   * (version race / ACTIVE partial unique index).
   */
  async createVersion(input: {
    entityType?: UrlEntityType;
    entityId?: string;
    adId?: string;
    offerId?: string;
    tenantId?: string;
    finalUrl: string;
    finalMobileUrl?: string;
    finalAppUrl?: string;
    trackingTemplate?: string;
    customParameters?: Record<string, string>;
    createdBy?: string;
    effectiveAt?: Date;
    status?: "DRAFT" | "ACTIVE";
  }) {
    const entityType = input.entityType ?? "AD";
    const entityId = input.entityId ?? input.adId;
    if (!entityId) {
      throw new ValidationError("entityId or adId is required");
    }

    let tenantId = input.tenantId;
    if (entityType === "AD") {
      const ad = await this.ads.findById(entityId);
      if (!ad) throw new NotFoundError("Ad", entityId);
      tenantId = tenantId ?? ad.tenantId;
    }
    if (!tenantId) {
      throw new ValidationError("tenantId is required");
    }

    assertValidUrlVersionFields({
      finalUrl: input.finalUrl,
      finalMobileUrl: input.finalMobileUrl,
      finalAppUrl: input.finalAppUrl,
      trackingTemplate: input.trackingTemplate,
      customParameters: input.customParameters,
    });

    const activate = (input.status ?? "ACTIVE") === "ACTIVE";
    const attemptCreate = async (urlVersions: UrlVersionRepository) => {
      let lastError: unknown;
      for (let attempt = 0; attempt < VERSION_CREATE_RETRIES; attempt++) {
        try {
          if (activate) {
            const active = await urlVersions.findActiveByEntity(
              entityType,
              entityId
            );
            if (active) {
              assertUrlVersionTransition(active.status, "SUPERSEDED");
              await urlVersions.updateStatus(active.id, {
                status: "SUPERSEDED",
              });
            }
          }

          const version = await urlVersions.getNextVersion(entityType, entityId);
          return await urlVersions.create({
            id: randomUUID(),
            tenantId,
            entityType,
            entityId,
            adId: entityType === "AD" ? entityId : input.adId,
            offerId: input.offerId,
            finalUrl: input.finalUrl,
            finalMobileUrl: input.finalMobileUrl,
            finalAppUrl: input.finalAppUrl,
            trackingTemplate: input.trackingTemplate,
            customParameters: input.customParameters ?? {},
            version,
            status: input.status ?? "ACTIVE",
            effectiveAt: input.effectiveAt ?? new Date(),
            createdBy: input.createdBy,
          });
        } catch (error) {
          lastError = error;
          if (!(error instanceof ConflictError)) throw error;
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new ConflictError("Failed to allocate UrlVersion under concurrency");
    };

    if (this.unitOfWork) {
      return this.unitOfWork.transaction((ctx) => attemptCreate(ctx.urlVersions));
    }
    return attemptCreate(this.urlVersions);
  }

  /**
   * Activate an existing DRAFT version for an entity.
   * DB transaction only — does not call external Google Ads provider.
   */
  async activateVersion(input: {
    tenantId: string;
    versionId: string;
  }): Promise<UrlVersion> {
    const run = async (urlVersions: UrlVersionRepository) => {
      let lastError: unknown;
      for (let attempt = 0; attempt < VERSION_CREATE_RETRIES; attempt++) {
        try {
          const target = await urlVersions.findByIdForTenant(
            input.tenantId,
            input.versionId
          );
          if (!target) throw new NotFoundError("UrlVersion", input.versionId);

          const active = await urlVersions.findActiveByEntity(
            target.entityType,
            target.entityId
          );
          if (active && active.id === target.id) {
            return active;
          }
          if (active) {
            assertUrlVersionTransition(active.status, "SUPERSEDED");
            await urlVersions.updateStatus(active.id, { status: "SUPERSEDED" });
          }
          if (target.status !== "ACTIVE") {
            assertUrlVersionTransition(target.status, "ACTIVE");
            return await urlVersions.updateStatus(target.id, {
              status: "ACTIVE",
              effectiveAt: new Date(),
            });
          }
          return target;
        } catch (error) {
          lastError = error;
          if (!(error instanceof ConflictError)) throw error;
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new ConflictError("Failed to activate UrlVersion under concurrency");
    };

    if (this.unitOfWork) {
      return this.unitOfWork.transaction((ctx) => run(ctx.urlVersions));
    }
    return run(this.urlVersions);
  }
}

/**
 * URL Change workflow:
 * Create → Validate → Preview → Queue → Provider → Result → Audit
 * Direct ad URL mutation is forbidden; all changes go through UrlChangeRequest.
 * @see ./url-change-engine.ts
 */
export { UrlChangeRequestService } from "./url-change-engine.js";
export {
  buildRollbackReason,
  isRollbackReason,
} from "./url-change-engine.js";

export class SyncService {
  constructor(private readonly syncJobs: SyncJobRepository) {}

  list(tenantId: string, page?: number, pageSize?: number) {
    return this.syncJobs.list({ tenantId, page, pageSize });
  }

  async enqueueIdempotent(input: {
    type: string;
    jobId: string;
    payload: Record<string, unknown>;
    tenantId?: string;
    idempotencyKey?: string;
  }) {
    const tenantId =
      input.tenantId ??
      (typeof input.payload.tenantId === "string"
        ? input.payload.tenantId
        : "00000000-0000-4000-8000-000000000001");
    const idempotencyKey =
      input.idempotencyKey ??
      createIdempotencyKey(input.type, input.jobId, JSON.stringify(input.payload));

    const existing = await this.syncJobs.findByIdempotencyKey(
      tenantId,
      SYNC_JOB_SCOPE,
      idempotencyKey
    );
    if (existing) {
      const status = existing.status.toUpperCase();
      if (status === "COMPLETED" || status === "RUNNING") {
        return existing;
      }
      if (status === "FAILED") {
        return this.syncJobs.update(existing.id, {
          status: "PENDING",
          attempts: existing.attempts + 1,
          error: undefined,
          errorMessage: undefined,
        });
      }
      throw new ConflictError("Job already pending", { idempotencyKey });
    }

    return this.syncJobs.create({
      id: randomUUID(),
      tenantId,
      jobId: input.jobId,
      type: input.type,
      status: "PENDING",
      provider: "mock",
      idempotencyScope: SYNC_JOB_SCOPE,
      idempotencyKey,
      payload: input.payload,
      attempts: 0,
    });
  }
}

export class AuditService {
  constructor(private readonly auditLogs: AuditLogRepository) {}
  list(tenantId: string, page?: number, pageSize?: number) {
    return this.auditLogs.list({ tenantId, page, pageSize });
  }
  record(input: {
    actorId?: string;
    action: string;
    resourceType?: string;
    resourceId?: string;
    entityType?: string;
    entityId?: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    requestId?: string;
    jobId?: string;
    tenantId?: string;
  }) {
    const entityType = input.entityType ?? input.resourceType ?? "Unknown";
    const entityId = input.entityId ?? input.resourceId;
    const after = input.after ?? input.metadata ?? {};
    return this.auditLogs.create({
      id: randomUUID(),
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: input.action,
      entityType,
      entityId,
      before: input.before,
      after,
      requestId: input.requestId,
      jobId: input.jobId,
      resourceType: entityType,
      resourceId: entityId,
      metadata: after,
    });
  }

  recordUrlChange(input: {
    action?: string;
    tenantId?: string;
    entityType: UrlEntityType;
    entityId: string;
    fromVersion?: number;
    toVersion?: number;
    requestedBy: string;
    jobId?: string;
    status: string;
    error?: string;
    changeRequestId?: string;
    afterExtra?: Record<string, unknown>;
  }) {
    const after = {
      entityType: input.entityType,
      entityId: input.entityId,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      requestedBy: input.requestedBy,
      jobId: input.jobId,
      status: input.status,
      timestamp: new Date().toISOString(),
      error: input.error,
      ...input.afterExtra,
    };
    return this.record({
      actorId: input.requestedBy,
      action: input.action ?? "url.change",
      tenantId: input.tenantId,
      entityType: "UrlChangeRequest",
      entityId: input.changeRequestId ?? input.entityId,
      resourceType: "UrlChangeRequest",
      resourceId: input.changeRequestId ?? input.entityId,
      requestId: input.changeRequestId,
      jobId: input.jobId,
      after,
      metadata: after,
    });
  }
}
