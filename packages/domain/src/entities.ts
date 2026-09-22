import type {
  AccountStatus,
  AdGroupStatus,
  AdStatus,
  CampaignStatus,
  ConversionStatus,
  CriterionStatus,
  GoogleUploadStatus,
  LandingPageStatus,
  MoneyDecimal,
  OfferStatus,
  OrderStatus,
  SoftDeleteFields,
  ScriptConnectionHealth,
  ScriptExecutionResult,
  ScriptIntegrationStatus,
  ScriptSyncState,
  TrackingLinkStatus,
  UserStatus,
} from "./statuses.js";

export * from "./statuses.js";

export interface Timestamps {
  createdAt: Date;
  updatedAt: Date;
}

export interface Tenant extends Timestamps, SoftDeleteFields {
  id: string;
  name: string;
  slug: string;
  status: UserStatus;
}

export interface User extends Timestamps, SoftDeleteFields {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  status: UserStatus;
}

export interface GoogleAccount extends Timestamps, SoftDeleteFields {
  id: string;
  tenantId: string;
  userId: string;
  /** Google Ads customer id (unique) */
  customerId: string;
  /**
   * Phase 0 API alias — same value as customerId.
   * @deprecated Prefer customerId
   */
  googleCustomerId: string;
  managerCustomerId?: string;
  name: string;
  /** @deprecated Prefer name */
  descriptiveName: string;
  currency: string;
  /** @deprecated Prefer currency */
  currencyCode: string;
  timezone: string;
  /** @deprecated Prefer timezone */
  timeZone: string;
  /** Opaque vault/KMS reference — never plaintext OAuth secret */
  oauthCredentialRef?: string;
  status: AccountStatus;
}

export interface Campaign extends Timestamps, SoftDeleteFields {
  id: string;
  tenantId: string;
  googleAccountId: string;
  googleCampaignId: string;
  name: string;
  status: CampaignStatus;
  biddingStrategy?: string;
}

export interface AdGroup extends Timestamps, SoftDeleteFields {
  id: string;
  tenantId: string;
  campaignId: string;
  googleAdGroupId: string;
  name: string;
  status: AdGroupStatus;
}

export interface Ad extends Timestamps, SoftDeleteFields {
  id: string;
  tenantId: string;
  adGroupId: string;
  googleAdId: string;
  name: string;
  status: AdStatus;
  /** Optional display mirrors — canonical URL lives in UrlVersion */
  finalUrl?: string;
  trackingTemplate?: string;
}

export interface AdGroupCriterion extends Timestamps, SoftDeleteFields {
  id: string;
  tenantId: string;
  adGroupId: string;
  googleCriterionId: string;
  keyword?: string;
  /** @deprecated Prefer keyword */
  keywordText?: string;
  matchType?: string;
  status: CriterionStatus;
}

export interface Offer extends Timestamps, SoftDeleteFields {
  id: string;
  tenantId: string;
  name: string;
  network: string;
  destinationUrl: string;
  status: OfferStatus;
  /** Lower number = higher priority (default 100) */
  priority: number;
  startsAt?: Date;
  endsAt?: Date;
  /** Idempotency for create — scope e.g. OFFER_CREATE */
  idempotencyScope?: string;
  idempotencyKey?: string;
}

/** Many-to-many binding: TrackingLink ↔ Offer with priority / fallback */
export interface TrackingLinkOffer extends Timestamps {
  id: string;
  tenantId: string;
  trackingLinkId: string;
  offerId: string;
  /** Lower = higher priority */
  priority: number;
  isFallback: boolean;
}

export interface LandingPage extends Timestamps, SoftDeleteFields {
  id: string;
  tenantId: string;
  offerId: string;
  name: string;
  url: string;
  domain: string;
  status: LandingPageStatus;
}

export interface TrackingLink extends Timestamps, SoftDeleteFields {
  id: string;
  tenantId: string;
  /** Public slug / routing key (unique) */
  publicId: string;
  offerId: string;
  campaignId?: string;
  adGroupId?: string;
  adId?: string;
  criterionId?: string;
  landingPageId?: string;
  status: TrackingLinkStatus;
}

export interface Click {
  id: string;
  /**
   * Public attribution click ID (crypto UUID).
   * Equals `id` for new records; Conversion/Order reference this via clickId → Click.id.
   */
  clickId: string;
  tenantId: string;
  trackingLinkId: string;
  offerId?: string;
  landingPageId?: string;
  campaignId?: string;
  adGroupId?: string;
  adId?: string;
  criterionId?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  userAgent?: string;
  ipAddress?: string;
  referer?: string;
  country?: string;
  region?: string;
  city?: string;
  deviceType?: string;
  /** Normalized query/metadata map (size-capped at ingestion) */
  queryParameters?: Record<string, string>;
  /** Optional ingestion idempotency key (tenant-scoped) */
  ingestionId?: string;
  occurredAt: Date;
  createdAt: Date;
}

export interface Conversion extends Timestamps, SoftDeleteFields {
  id: string;
  tenantId: string;
  /** Required — conversion must reference a click */
  clickId: string;
  conversionAction: string;
  conversionTime: Date;
  /** Decimal string — never float */
  value?: MoneyDecimal;
  currency?: string;
  /**
   * @deprecated Prefer value (decimal string)
   */
  conversionValue?: number;
  /** @deprecated Prefer currency */
  currencyCode?: string;
  status: ConversionStatus;
  googleUploadStatus: GoogleUploadStatus;
  googleConversionResourceName?: string;
  gclid?: string;
  orderId?: string;
  /** Idempotency scope, e.g. CONVERSION */
  idempotencyScope?: string;
  idempotencyKey?: string;
}

export interface Order extends Timestamps, SoftDeleteFields {
  id: string;
  tenantId: string;
  orderId: string;
  clickId?: string;
  conversionId?: string;
  /** Decimal string — never float */
  value: MoneyDecimal;
  currency: string;
  /**
   * @deprecated Prefer value
   */
  amount?: number;
  /** @deprecated Prefer currency */
  currencyCode?: string;
  status: OrderStatus;
  /** Idempotency scope, e.g. ORDER */
  idempotencyScope?: string;
  idempotencyKey?: string;
}

export type UrlEntityType =
  | "CUSTOMER"
  | "CAMPAIGN"
  | "AD_GROUP"
  | "AD"
  | "AD_GROUP_CRITERION";

/** Typed custom parameters — never arbitrary unknown JSON in business layer */
export type CustomParameters = Record<string, string>;

export interface UrlConfiguration {
  finalUrl?: string;
  finalMobileUrl?: string;
  finalAppUrl?: string;
  trackingTemplate?: string;
  customParameters: CustomParameters;
}

export type UrlVersionStatus = "DRAFT" | "ACTIVE" | "SUPERSEDED" | "ROLLED_BACK";

export interface UrlVersion {
  id: string;
  tenantId: string;
  entityType: UrlEntityType;
  entityId: string;
  adId?: string;
  offerId?: string;
  finalUrl: string;
  finalMobileUrl?: string;
  finalAppUrl?: string;
  trackingTemplate?: string;
  customParameters: CustomParameters;
  version: number;
  status: UrlVersionStatus;
  effectiveAt?: Date;
  createdAt: Date;
  createdBy?: string;
  updatedAt: Date;
}

export type UrlChangeRequestStatus =
  | "DRAFT"
  | "VALIDATED"
  | "QUEUED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

export interface UrlChangeRequest extends Timestamps {
  id: string;
  tenantId: string;
  entityType: UrlEntityType;
  entityId: string;
  fromVersionId?: string;
  toVersionId: string;
  reason: string;
  requestedBy: string;
  status: UrlChangeRequestStatus;
  /** Idempotency scope, e.g. URL_CHANGE */
  idempotencyScope: string;
  idempotencyKey: string;
  scheduledAt?: Date;
  executedAt?: Date;
  error?: string;
  jobId?: string;
}

export type SyncJobStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  /** @deprecated Phase 0 lowercase */
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface SyncJob extends Timestamps {
  id: string;
  tenantId?: string;
  type: string;
  status: SyncJobStatus;
  provider: string;
  externalAccountId?: string;
  /** Idempotency scope, e.g. SYNC_JOB */
  idempotencyScope: string;
  idempotencyKey: string;
  jobId?: string;
  attempts: number;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  /** @deprecated Prefer error */
  errorMessage?: string;
  payload?: Record<string, unknown>;
}

/** Typed JSON snapshots for audit */
export type AuditSnapshot = Record<string, unknown>;

export interface AuditLog {
  id: string;
  tenantId?: string;
  actorId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: AuditSnapshot;
  after?: AuditSnapshot;
  requestId?: string;
  jobId?: string;
  createdAt: Date;
  /**
   * Phase 0.1 aliases
   * @deprecated Prefer entityType / entityId / after
   */
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Phase 8.4.1 — Google Ads Script Integration.
 * Token plaintext is NEVER stored — only keyId / prefix / hash for future auth.
 */
export interface GoogleAdsScriptIntegration extends Timestamps, SoftDeleteFields {
  id: string;
  tenantId: string;
  googleAccountId: string;
  name: string;
  status: ScriptIntegrationStatus;
  /** Opaque id for logs — never the raw token */
  tokenKeyId: string;
  /** Short display prefix e.g. alk_s_ab12 */
  tokenPrefix: string;
  /** Server-side hash (HMAC-SHA256 with pepper in 8.4.2+) — never plaintext */
  tokenHash: string;
  /** Bumped when desired config payload for this integration changes */
  configGeneration: number;
  lastSeenAt?: Date;
}

/**
 * Phase 8.4.1 — Sync target under an Integration.
 * entityId is polymorphic; Phase 8.4.1 allows entityType=AD only.
 * Ad (internal UUID) is the authority for Google external IDs.
 */
export interface ScriptSyncTarget extends Timestamps, SoftDeleteFields {
  id: string;
  tenantId: string;
  integrationId: string;
  entityType: UrlEntityType;
  /** AdLinkLab entity UUID (Ad.id when entityType=AD) */
  entityId: string;
  /** Denormalized from Ad — Google external ad id (not authority) */
  googleAdId?: string;
  /** Denormalized AdLinkLab Campaign.id */
  campaignId?: string;
  /** Denormalized AdLinkLab AdGroup.id */
  adGroupId?: string;
  /**
   * Phase 9.5 — NOT Desired Authority.
   * Sole Desired Authority is ACTIVE UrlVersion.version for this Ad.
   * This column is optional projection/cache only; readers must never treat it as source of truth.
   */
  desiredVersion?: number;
  /** Last accepted Script sync applied version (integration-specific). */
  appliedVersion?: number;
  lastSyncAt?: Date;
  lastSuccessAt?: Date;
  syncState: ScriptSyncState;
  connectionHealth: ScriptConnectionHealth;
  lastExecution?: ScriptExecutionResult;
}

/**
 * Phase 8.4.1 — Append-only Script sync history.
 * No update/delete repository methods.
 */
export interface ScriptSyncLog {
  id: string;
  tenantId: string;
  integrationId: string;
  targetId: string;
  desiredVersion: number;
  reportedAppliedVersion?: number;
  result: ScriptExecutionResult;
  errorCode?: string;
  /** Must never contain tokens / API keys / secrets */
  errorMessage?: string;
  requestId?: string;
  idempotencyScope: string;
  idempotencyKey: string;
  createdAt: Date;
}
