import type {
  Ad,
  AdGroup,
  AdGroupCriterion,
  AuditLog,
  Campaign,
  Click,
  Conversion,
  GoogleAccount,
  GoogleAdsScriptIntegration,
  LandingPage,
  Offer,
  Order,
  ScriptSyncLog,
  ScriptSyncTarget,
  SyncJob,
  Tenant,
  TrackingLink,
  TrackingLinkOffer,
  UrlChangeRequest,
  UrlEntityType,
  UrlVersion,
  UrlVersionStatus,
  User,
} from "./entities.js";
import type { PaginationInput, PaginatedResult } from "@adlinklab/shared";

export type UrlVersionStatusPatch = {
  status?: UrlVersionStatus;
  effectiveAt?: Date;
};

export interface TenantRepository {
  findById(id: string): Promise<Tenant | null>;
  findBySlug(slug: string): Promise<Tenant | null>;
  list(input?: PaginationInput): Promise<PaginatedResult<Tenant>>;
  create(data: Omit<Tenant, "createdAt" | "updatedAt">): Promise<Tenant>;
  update(id: string, data: Partial<Omit<Tenant, "id" | "createdAt">>): Promise<Tenant>;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByIdForTenant(tenantId: string, id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  list(input?: PaginationInput & { tenantId?: string }): Promise<PaginatedResult<User>>;
  create(data: Omit<User, "createdAt" | "updatedAt">): Promise<User>;
  update(id: string, data: Partial<Omit<User, "id" | "createdAt">>): Promise<User>;
}

export interface GoogleAccountRepository {
  findById(id: string): Promise<GoogleAccount | null>;
  findByIdForTenant(tenantId: string, id: string): Promise<GoogleAccount | null>;
  findByGoogleCustomerId(googleCustomerId: string): Promise<GoogleAccount | null>;
  findByCustomerId(customerId: string): Promise<GoogleAccount | null>;
  list(input?: PaginationInput & { tenantId?: string }): Promise<PaginatedResult<GoogleAccount>>;
  create(data: Omit<GoogleAccount, "createdAt" | "updatedAt">): Promise<GoogleAccount>;
  update(
    id: string,
    data: Partial<Omit<GoogleAccount, "id" | "createdAt">>
  ): Promise<GoogleAccount>;
}

export interface CampaignRepository {
  findById(id: string): Promise<Campaign | null>;
  findByIdForTenant(tenantId: string, id: string): Promise<Campaign | null>;
  findByGoogleCampaignId(googleCampaignId: string): Promise<Campaign | null>;
  list(
    input?: PaginationInput & { googleAccountId?: string; tenantId?: string }
  ): Promise<PaginatedResult<Campaign>>;
  create(data: Omit<Campaign, "createdAt" | "updatedAt">): Promise<Campaign>;
  update(id: string, data: Partial<Omit<Campaign, "id" | "createdAt">>): Promise<Campaign>;
  /** Soft-archive — must NOT cascade-delete attribution */
  softDelete(id: string): Promise<Campaign>;
}

export interface AdGroupRepository {
  findById(id: string): Promise<AdGroup | null>;
  findByIdForTenant(tenantId: string, id: string): Promise<AdGroup | null>;
  findByGoogleAdGroupId(googleAdGroupId: string): Promise<AdGroup | null>;
  list(
    input?: PaginationInput & { campaignId?: string; tenantId?: string }
  ): Promise<PaginatedResult<AdGroup>>;
  create(data: Omit<AdGroup, "createdAt" | "updatedAt">): Promise<AdGroup>;
  update(id: string, data: Partial<Omit<AdGroup, "id" | "createdAt">>): Promise<AdGroup>;
}

export interface AdRepository {
  findById(id: string): Promise<Ad | null>;
  findByIdForTenant(tenantId: string, id: string): Promise<Ad | null>;
  findByGoogleAdId(googleAdId: string): Promise<Ad | null>;
  list(
    input?: PaginationInput & { adGroupId?: string; tenantId?: string }
  ): Promise<PaginatedResult<Ad>>;
  create(data: Omit<Ad, "createdAt" | "updatedAt">): Promise<Ad>;
  update(id: string, data: Partial<Omit<Ad, "id" | "createdAt">>): Promise<Ad>;
}

export interface AdGroupCriterionRepository {
  findById(id: string): Promise<AdGroupCriterion | null>;
  findByIdForTenant(tenantId: string, id: string): Promise<AdGroupCriterion | null>;
  findByGoogleCriterionId(googleCriterionId: string): Promise<AdGroupCriterion | null>;
  list(
    input?: PaginationInput & { adGroupId?: string; tenantId?: string }
  ): Promise<PaginatedResult<AdGroupCriterion>>;
  create(data: Omit<AdGroupCriterion, "createdAt" | "updatedAt">): Promise<AdGroupCriterion>;
  update(
    id: string,
    data: Partial<Omit<AdGroupCriterion, "id" | "createdAt">>
  ): Promise<AdGroupCriterion>;
}

export interface OfferRepository {
  findById(id: string): Promise<Offer | null>;
  findByIdForTenant(tenantId: string, id: string): Promise<Offer | null>;
  findByIdempotencyKey(
    tenantId: string,
    scope: string,
    idempotencyKey: string
  ): Promise<Offer | null>;
  list(input?: PaginationInput & { tenantId?: string }): Promise<PaginatedResult<Offer>>;
  create(data: Omit<Offer, "createdAt" | "updatedAt">): Promise<Offer>;
  update(id: string, data: Partial<Omit<Offer, "id" | "createdAt">>): Promise<Offer>;
}

export interface LandingPageRepository {
  findById(id: string): Promise<LandingPage | null>;
  findByIdForTenant(tenantId: string, id: string): Promise<LandingPage | null>;
  list(
    input?: PaginationInput & { tenantId?: string; offerId?: string }
  ): Promise<PaginatedResult<LandingPage>>;
  create(data: Omit<LandingPage, "createdAt" | "updatedAt">): Promise<LandingPage>;
  update(
    id: string,
    data: Partial<Omit<LandingPage, "id" | "createdAt">>
  ): Promise<LandingPage>;
}

export interface TrackingLinkOfferRepository {
  findById(id: string): Promise<TrackingLinkOffer | null>;
  findByIdForTenant(tenantId: string, id: string): Promise<TrackingLinkOffer | null>;
  findByTrackingLinkForTenant(
    tenantId: string,
    trackingLinkId: string
  ): Promise<TrackingLinkOffer[]>;
  findBindingForTenant(
    tenantId: string,
    trackingLinkId: string,
    offerId: string
  ): Promise<TrackingLinkOffer | null>;
  findFallbackForTrackingLink(
    tenantId: string,
    trackingLinkId: string
  ): Promise<TrackingLinkOffer | null>;
  create(
    data: Omit<TrackingLinkOffer, "createdAt" | "updatedAt">
  ): Promise<TrackingLinkOffer>;
  update(
    id: string,
    data: Partial<Omit<TrackingLinkOffer, "id" | "createdAt" | "tenantId">>
  ): Promise<TrackingLinkOffer>;
  delete(id: string): Promise<void>;
}

export interface TrackingLinkRepository {
  findById(id: string): Promise<TrackingLink | null>;
  findByIdForTenant(tenantId: string, id: string): Promise<TrackingLink | null>;
  /** @deprecated Prefer findByPublicIdForTenant — never use without tenant check */
  findByPublicId(publicId: string): Promise<TrackingLink | null>;
  findByPublicIdForTenant(
    tenantId: string,
    publicId: string
  ): Promise<TrackingLink | null>;
  list(input?: PaginationInput & { tenantId?: string }): Promise<PaginatedResult<TrackingLink>>;
  create(data: Omit<TrackingLink, "createdAt" | "updatedAt">): Promise<TrackingLink>;
  update(
    id: string,
    data: Partial<Omit<TrackingLink, "id" | "createdAt">>
  ): Promise<TrackingLink>;
}

export interface ClickRepository {
  findById(id: string): Promise<Click | null>;
  findByIdForTenant(tenantId: string, id: string): Promise<Click | null>;
  findByClickIdForTenant(tenantId: string, clickId: string): Promise<Click | null>;
  findByIngestionIdForTenant(
    tenantId: string,
    ingestionId: string
  ): Promise<Click | null>;
  list(
    input?: PaginationInput & {
      trackingLinkId?: string;
      tenantId?: string;
      offerId?: string;
      campaignId?: string;
    }
  ): Promise<PaginatedResult<Click>>;
  create(data: Omit<Click, "createdAt"> & { createdAt?: Date }): Promise<Click>;
  countByTrackingLink(tenantId: string, trackingLinkId: string): Promise<number>;
  countByOffer(tenantId: string, offerId: string): Promise<number>;
  countByCampaign(tenantId: string, campaignId: string): Promise<number>;
}

export interface ConversionRepository {
  findById(id: string): Promise<Conversion | null>;
  findByIdForTenant(tenantId: string, id: string): Promise<Conversion | null>;
  findByIdempotencyKey(
    tenantId: string,
    scope: string,
    idempotencyKey: string
  ): Promise<Conversion | null>;
  /** @deprecated Prefer findById — conversionId column removed in Phase 1.1 */
  findByConversionId(conversionId: string): Promise<Conversion | null>;
  list(input?: PaginationInput & { tenantId?: string }): Promise<PaginatedResult<Conversion>>;
  create(data: Omit<Conversion, "createdAt" | "updatedAt">): Promise<Conversion>;
  update(
    id: string,
    data: Partial<Omit<Conversion, "id" | "createdAt">>
  ): Promise<Conversion>;
}

export interface OrderRepository {
  findById(id: string): Promise<Order | null>;
  findByIdForTenant(tenantId: string, id: string): Promise<Order | null>;
  findByIdempotencyKey(
    tenantId: string,
    scope: string,
    idempotencyKey: string
  ): Promise<Order | null>;
  findByOrderId(orderId: string, tenantId?: string): Promise<Order | null>;
  list(input?: PaginationInput & { tenantId?: string }): Promise<PaginatedResult<Order>>;
  create(data: Omit<Order, "createdAt" | "updatedAt">): Promise<Order>;
  update(id: string, data: Partial<Omit<Order, "id" | "createdAt">>): Promise<Order>;
}

export interface UrlVersionRepository {
  findById(id: string): Promise<UrlVersion | null>;
  findByIdForTenant(tenantId: string, id: string): Promise<UrlVersion | null>;
  listByEntity(entityType: UrlEntityType, entityId: string): Promise<UrlVersion[]>;
  findActiveByEntity(entityType: UrlEntityType, entityId: string): Promise<UrlVersion | null>;
  getNextVersion(entityType: UrlEntityType, entityId: string): Promise<number>;
  listByAdId(adId: string): Promise<UrlVersion[]>;
  findActiveByAdId(adId: string): Promise<UrlVersion | null>;
  getNextVersionForAd(adId: string): Promise<number>;
  create(data: Omit<UrlVersion, "createdAt" | "updatedAt">): Promise<UrlVersion>;
  updateStatus(id: string, data: UrlVersionStatusPatch): Promise<UrlVersion>;
  update(id: string, data: UrlVersionStatusPatch): Promise<UrlVersion>;
  list(
    input?: PaginationInput & {
      adId?: string;
      entityType?: UrlEntityType;
      entityId?: string;
      tenantId?: string;
    }
  ): Promise<PaginatedResult<UrlVersion>>;
}

export interface UrlChangeRequestRepository {
  findById(id: string): Promise<UrlChangeRequest | null>;
  findByIdForTenant(tenantId: string, id: string): Promise<UrlChangeRequest | null>;
  findByIdempotencyKey(
    tenantId: string,
    scope: string,
    idempotencyKey: string
  ): Promise<UrlChangeRequest | null>;
  list(
    input?: PaginationInput & { tenantId?: string }
  ): Promise<PaginatedResult<UrlChangeRequest>>;
  create(data: Omit<UrlChangeRequest, "createdAt" | "updatedAt">): Promise<UrlChangeRequest>;
  update(
    id: string,
    data: Partial<
      Omit<
        UrlChangeRequest,
        "id" | "createdAt" | "idempotencyKey" | "idempotencyScope" | "tenantId"
      >
    >
  ): Promise<UrlChangeRequest>;
}

export interface SyncJobRepository {
  findById(id: string): Promise<SyncJob | null>;
  findByIdForTenant(tenantId: string, id: string): Promise<SyncJob | null>;
  findByJobId(jobId: string): Promise<SyncJob | null>;
  findByIdempotencyKey(
    tenantId: string,
    scope: string,
    idempotencyKey: string
  ): Promise<SyncJob | null>;
  list(input?: PaginationInput & { tenantId?: string }): Promise<PaginatedResult<SyncJob>>;
  create(data: Omit<SyncJob, "createdAt" | "updatedAt">): Promise<SyncJob>;
  update(id: string, data: Partial<Omit<SyncJob, "id" | "createdAt">>): Promise<SyncJob>;
}

export interface AuditLogRepository {
  findById(id: string): Promise<AuditLog | null>;
  list(input?: PaginationInput & { tenantId?: string }): Promise<PaginatedResult<AuditLog>>;
  create(data: Omit<AuditLog, "createdAt"> & { createdAt?: Date }): Promise<AuditLog>;
}

/** Phase 8.4.1 — Script Integration persistence */
export interface GoogleAdsScriptIntegrationRepository {
  create(
    data: Omit<GoogleAdsScriptIntegration, "createdAt" | "updatedAt">
  ): Promise<GoogleAdsScriptIntegration>;
  findById(id: string): Promise<GoogleAdsScriptIntegration | null>;
  findByIdForTenant(
    tenantId: string,
    id: string
  ): Promise<GoogleAdsScriptIntegration | null>;
  findByTenant(
    tenantId: string,
    input?: PaginationInput
  ): Promise<PaginatedResult<GoogleAdsScriptIntegration>>;
  /** Future auth lookup — hash only, never plaintext token */
  findByTokenHash(tokenHash: string): Promise<GoogleAdsScriptIntegration | null>;
  update(
    id: string,
    data: Partial<
      Omit<
        GoogleAdsScriptIntegration,
        "id" | "createdAt" | "tenantId" | "tokenHash" | "tokenKeyId" | "tokenPrefix"
      >
    >
  ): Promise<GoogleAdsScriptIntegration>;
  /**
   * Phase 8.4.2 — atomic credential rotation.
   * Replaces hash/prefix/keyId; plaintext is never stored.
   */
  replaceTokenCredentials(
    id: string,
    data: {
      tokenKeyId: string;
      tokenPrefix: string;
      tokenHash: string;
    }
  ): Promise<GoogleAdsScriptIntegration>;
  /**
   * Soft-delete: sets deletedAt (and DISABLED when previously ACTIVE).
   * Does not cascade SyncLog history.
   */
  softDelete(id: string): Promise<GoogleAdsScriptIntegration>;
}

export interface ScriptSyncTargetRepository {
  create(
    data: Omit<ScriptSyncTarget, "createdAt" | "updatedAt">
  ): Promise<ScriptSyncTarget>;
  findById(id: string): Promise<ScriptSyncTarget | null>;
  findByIdForTenant(
    tenantId: string,
    id: string
  ): Promise<ScriptSyncTarget | null>;
  findByIntegration(
    tenantId: string,
    integrationId: string,
    input?: PaginationInput
  ): Promise<PaginatedResult<ScriptSyncTarget>>;
  findByIntegrationAndEntity(
    tenantId: string,
    integrationId: string,
    entityType: UrlEntityType,
    entityId: string
  ): Promise<ScriptSyncTarget | null>;
  update(
    id: string,
    data: Partial<Omit<ScriptSyncTarget, "id" | "createdAt" | "tenantId" | "integrationId">>
  ): Promise<ScriptSyncTarget>;
  /** Phase 8.4.4 — Integration-scoped target lookup (404-safe). */
  findByIdForIntegration(
    tenantId: string,
    integrationId: string,
    targetId: string
  ): Promise<ScriptSyncTarget | null>;
  /**
   * Phase 8.4.4 — Atomic compare-and-set for appliedVersion (never regress).
   * Updates only when appliedVersion is null or strictly less than desiredVersion.
   * Parameter `desiredVersion` is the accepted applied candidate (must already match ACTIVE);
   * it does NOT write ScriptSyncTarget.desiredVersion column (that field is non-authority).
   */
  compareAndSetAppliedVersion(input: {
    tenantId: string;
    integrationId: string;
    targetId: string;
    desiredVersion: number;
    lastExecution: ScriptSyncTarget["lastExecution"];
    syncState: ScriptSyncTarget["syncState"];
    lastSyncAt: Date;
    lastSuccessAt?: Date;
  }): Promise<{ target: ScriptSyncTarget; updated: boolean }>;
}

/**
 * Append-only Script sync history — create + read only (no update/delete).
 */
export interface ScriptSyncLogRepository {
  create(data: Omit<ScriptSyncLog, "createdAt"> & { createdAt?: Date }): Promise<ScriptSyncLog>;
  findById(id: string): Promise<ScriptSyncLog | null>;
  findByIdForTenant(tenantId: string, id: string): Promise<ScriptSyncLog | null>;
  findByIntegration(
    tenantId: string,
    integrationId: string,
    input?: PaginationInput
  ): Promise<PaginatedResult<ScriptSyncLog>>;
  findByTarget(
    tenantId: string,
    targetId: string,
    input?: PaginationInput
  ): Promise<PaginatedResult<ScriptSyncLog>>;
  findByIdempotencyKey(
    tenantId: string,
    scope: string,
    idempotencyKey: string
  ): Promise<ScriptSyncLog | null>;
}
