import { ConflictError } from "@adlinklab/shared";
import type { UrlChangeRequestStatus, UrlVersionStatus } from "./entities.js";
import type {
  ConversionStatus,
  GoogleUploadStatus,
  OfferStatus,
  OrderStatus,
} from "./statuses.js";

const URL_VERSION_TRANSITIONS: Record<UrlVersionStatus, UrlVersionStatus[]> = {
  DRAFT: ["ACTIVE", "SUPERSEDED"],
  ACTIVE: ["SUPERSEDED", "ROLLED_BACK"],
  SUPERSEDED: [],
  ROLLED_BACK: [],
};

/**
 * UrlVersion status transitions.
 * Rollback = create a NEW version copying old content — never rewrite history.
 */
export function assertUrlVersionTransition(
  from: UrlVersionStatus,
  to: UrlVersionStatus
): void {
  const allowed = URL_VERSION_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new ConflictError(`Invalid UrlVersion transition ${from} → ${to}`, {
      from,
      to,
    });
  }
}

const CHANGE_REQUEST_TRANSITIONS: Record<
  UrlChangeRequestStatus,
  UrlChangeRequestStatus[]
> = {
  DRAFT: ["VALIDATED", "CANCELLED"],
  VALIDATED: ["QUEUED", "CANCELLED"],
  QUEUED: ["RUNNING", "CANCELLED"],
  RUNNING: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: [],
  FAILED: ["VALIDATED"],
  CANCELLED: [],
};

export function assertUrlChangeRequestTransition(
  from: UrlChangeRequestStatus,
  to: UrlChangeRequestStatus
): void {
  const allowed = CHANGE_REQUEST_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new ConflictError(
      `Invalid UrlChangeRequest transition ${from} → ${to}`,
      { from, to }
    );
  }
}

const OFFER_TRANSITIONS: Record<OfferStatus, OfferStatus[]> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["PAUSED", "ARCHIVED"],
  PAUSED: ["ACTIVE", "ARCHIVED"],
  ARCHIVED: [],
};

/** Phase 5 — Offer lifecycle. ARCHIVED is terminal. */
export function assertOfferTransition(from: OfferStatus, to: OfferStatus): void {
  const allowed = OFFER_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new ConflictError(`Invalid Offer transition ${from} → ${to}`, {
      from,
      to,
    });
  }
}

const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED", "ARCHIVED"],
  CONFIRMED: ["REFUNDED", "CANCELLED", "ARCHIVED"],
  CANCELLED: ["ARCHIVED"],
  REFUNDED: ["ARCHIVED"],
  ARCHIVED: [],
};

/** Phase 7 — Order lifecycle. ARCHIVED is terminal. */
export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  const allowed = ORDER_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new ConflictError(`Invalid Order transition ${from} → ${to}`, {
      from,
      to,
    });
  }
}

const CONVERSION_TRANSITIONS: Record<ConversionStatus, ConversionStatus[]> = {
  PENDING: ["ATTRIBUTED", "FAILED", "ARCHIVED"],
  ATTRIBUTED: ["UPLOADED", "FAILED", "ARCHIVED"],
  UPLOADED: ["ARCHIVED"],
  FAILED: ["ATTRIBUTED", "ARCHIVED"],
  ARCHIVED: [],
};

/** Phase 7 — Conversion business lifecycle (separate from GoogleUploadStatus). */
export function assertConversionTransition(
  from: ConversionStatus,
  to: ConversionStatus
): void {
  const allowed = CONVERSION_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new ConflictError(`Invalid Conversion transition ${from} → ${to}`, {
      from,
      to,
    });
  }
}

const GOOGLE_UPLOAD_TRANSITIONS: Record<
  GoogleUploadStatus,
  GoogleUploadStatus[]
> = {
  NOT_UPLOADED: ["QUEUED", "SKIPPED", "FAILED"],
  QUEUED: ["UPLOADED", "FAILED", "SKIPPED", "NOT_UPLOADED"],
  UPLOADED: [],
  FAILED: ["QUEUED", "SKIPPED"],
  SKIPPED: [],
};

/** Phase 7 — Google Ads upload pipeline. */
export function assertGoogleUploadTransition(
  from: GoogleUploadStatus,
  to: GoogleUploadStatus
): void {
  const allowed = GOOGLE_UPLOAD_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new ConflictError(
      `Invalid GoogleUploadStatus transition ${from} → ${to}`,
      { from, to }
    );
  }
}

export const AuditActions = {
  URL_CHANGE_REQUEST_CREATED: "URL_CHANGE_REQUEST_CREATED",
  URL_CHANGE_REQUEST_VALIDATED: "URL_CHANGE_REQUEST_VALIDATED",
  URL_CHANGE_REQUEST_QUEUED: "URL_CHANGE_REQUEST_QUEUED",
  URL_CHANGE_REQUEST_RUNNING: "URL_CHANGE_REQUEST_RUNNING",
  URL_CHANGE_REQUEST_SUCCEEDED: "URL_CHANGE_REQUEST_SUCCEEDED",
  URL_CHANGE_REQUEST_FAILED: "URL_CHANGE_REQUEST_FAILED",
  URL_CHANGE_REQUEST_CANCELLED: "URL_CHANGE_REQUEST_CANCELLED",
  URL_CHANGE_REQUEST_ROLLED_BACK: "URL_CHANGE_REQUEST_ROLLED_BACK",
  URL_VERSION_ACTIVATED: "URL_VERSION_ACTIVATED",
  URL_VERSION_SUPERSEDED: "URL_VERSION_SUPERSEDED",
  URL_VERSION_ROLLED_BACK: "URL_VERSION_ROLLED_BACK",
  ORDER_CREATED: "ORDER_CREATED",
  ORDER_STATUS_CHANGED: "ORDER_STATUS_CHANGED",
  CONVERSION_CREATED: "CONVERSION_CREATED",
  CONVERSION_QUEUED: "CONVERSION_QUEUED",
  CONVERSION_UPLOAD_STARTED: "CONVERSION_UPLOAD_STARTED",
  CONVERSION_UPLOADED: "CONVERSION_UPLOADED",
  CONVERSION_UPLOAD_FAILED: "CONVERSION_UPLOAD_FAILED",
  CONVERSION_RETRY: "CONVERSION_RETRY",
  CONVERSION_CANCELLED: "CONVERSION_CANCELLED",
  SYNC_JOB_CREATED: "SYNC_JOB_CREATED",
  SYNC_STARTED: "SYNC_STARTED",
  SYNC_COMPLETED: "SYNC_COMPLETED",
  SYNC_FAILED: "SYNC_FAILED",
  TRACKING_LINK_CREATED: "TRACKING_LINK_CREATED",
  TRACKING_LINK_UPDATED: "TRACKING_LINK_UPDATED",
  TRACKING_LINK_STATUS_CHANGED: "TRACKING_LINK_STATUS_CHANGED",
  OFFER_CREATED: "OFFER_CREATED",
  OFFER_UPDATED: "OFFER_UPDATED",
  OFFER_STATUS_CHANGED: "OFFER_STATUS_CHANGED",
  TRACKING_LINK_OFFER_ADDED: "TRACKING_LINK_OFFER_ADDED",
  TRACKING_LINK_OFFER_UPDATED: "TRACKING_LINK_OFFER_UPDATED",
  TRACKING_LINK_OFFER_REMOVED: "TRACKING_LINK_OFFER_REMOVED",
  /** Phase 8.4.2 — Script Integration auth lifecycle (never log tokens) */
  SCRIPT_INTEGRATION_CREATED: "SCRIPT_INTEGRATION_CREATED",
  SCRIPT_INTEGRATION_TOKEN_ROTATED: "SCRIPT_INTEGRATION_TOKEN_ROTATED",
  SCRIPT_INTEGRATION_REVOKED: "SCRIPT_INTEGRATION_REVOKED",
  SCRIPT_INTEGRATION_DISABLED: "SCRIPT_INTEGRATION_DISABLED",
  SCRIPT_INTEGRATION_ENABLED: "SCRIPT_INTEGRATION_ENABLED",
  SCRIPT_INTEGRATION_AUTH_SUCCESS: "SCRIPT_INTEGRATION_AUTH_SUCCESS",
  SCRIPT_INTEGRATION_AUTH_FAILURE: "SCRIPT_INTEGRATION_AUTH_FAILURE",
  /** Phase 8.4.9 — Target attach/detach (never log tokens / secrets) */
  SCRIPT_SYNC_TARGET_ATTACHED: "SCRIPT_SYNC_TARGET_ATTACHED",
  SCRIPT_SYNC_TARGET_DETACHED: "SCRIPT_SYNC_TARGET_DETACHED",
  /** Phase 8.4.5 — Script sync-result outcomes (never log tokens / secrets) */
  SCRIPT_SYNC_RESULT_APPLIED: "SCRIPT_SYNC_RESULT_APPLIED",
  SCRIPT_SYNC_RESULT_RECORDED: "SCRIPT_SYNC_RESULT_RECORDED",
  SCRIPT_SYNC_RESULT_REJECTED: "SCRIPT_SYNC_RESULT_REJECTED",
  SCRIPT_SYNC_RESULT_IDEMPOTENT_REPLAY: "SCRIPT_SYNC_RESULT_IDEMPOTENT_REPLAY",
} as const;

export type AuditAction = (typeof AuditActions)[keyof typeof AuditActions];
