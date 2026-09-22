/**
 * Domain status enums — aligned with Prisma enums (Phase 1.1).
 * Prefer these over free-form strings.
 */

export type AccountStatus = "ACTIVE" | "PAUSED" | "ARCHIVED" | "DISABLED";
export type CampaignStatus = "ACTIVE" | "PAUSED" | "ARCHIVED" | "REMOVED";
export type AdGroupStatus = "ACTIVE" | "PAUSED" | "ARCHIVED" | "REMOVED";
export type AdStatus = "ACTIVE" | "PAUSED" | "ARCHIVED" | "REMOVED";
export type CriterionStatus = "ACTIVE" | "PAUSED" | "ARCHIVED" | "REMOVED";
export type OfferStatus = "ACTIVE" | "PAUSED" | "ARCHIVED" | "DRAFT";
export type LandingPageStatus = "ACTIVE" | "PAUSED" | "ARCHIVED" | "DRAFT";
export type TrackingLinkStatus = "ACTIVE" | "PAUSED" | "ARCHIVED" | "DRAFT";
export type ConversionStatus =
  | "PENDING"
  | "ATTRIBUTED"
  | "UPLOADED"
  | "FAILED"
  | "ARCHIVED";
export type GoogleUploadStatus =
  | "NOT_UPLOADED"
  | "QUEUED"
  | "UPLOADED"
  | "FAILED"
  | "SKIPPED";
export type OrderStatus =
  | "PENDING"
  | "CONFIRMED"
  | "CANCELLED"
  | "REFUNDED"
  | "ARCHIVED";
export type UserStatus = "ACTIVE" | "PAUSED" | "ARCHIVED" | "DISABLED";

/** Phase 8.4.1 — Google Ads Script Integration lifecycle */
export type ScriptIntegrationStatus = "ACTIVE" | "DISABLED" | "REVOKED";

/** Desired vs applied alignment for a ScriptSyncTarget */
export type ScriptSyncState = "SYNCED" | "OUT_OF_SYNC" | "NEVER_APPLIED";

/** Script connectivity / liveness (independent of syncState) */
export type ScriptConnectionHealth = "CONNECTED" | "STALE" | "DISABLED";

/** Last / logged Script execution outcome (independent of syncState) */
export type ScriptExecutionResult =
  | "SUCCESS"
  | "FAILED"
  | "PARTIAL"
  | "NO_CHANGE";

/**
 * @deprecated Prefer specific *Status enums. Kept for Phase 0 callers.
 */
export type EntityStatus =
  | "active"
  | "paused"
  | "archived"
  | "draft"
  | AccountStatus
  | CampaignStatus
  | OfferStatus;

/**
 * Money strategy: decimal string (never IEEE float).
 * Matches PostgreSQL Decimal(19,4).
 */
export type MoneyDecimal = string;

export interface SoftDeleteFields {
  archivedAt?: Date;
  deletedAt?: Date;
}
