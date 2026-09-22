import { createIdempotencyKey } from "@adlinklab/shared";

/** Logical scopes for tenant-scoped idempotency */
export type IdempotencyScope =
  | "URL_CHANGE"
  | "SYNC_JOB"
  | "CONVERSION"
  | "ORDER"
  | "OFFER_CREATE"
  | "SCRIPT_SYNC_RESULT";

export interface IdempotencyIdentity {
  tenantId: string;
  scope: IdempotencyScope;
  idempotencyKey: string;
}

export function buildScopedIdempotencyKey(identity: IdempotencyIdentity): string {
  return createIdempotencyKey(
    identity.tenantId,
    identity.scope,
    identity.idempotencyKey
  );
}

/**
 * Result of an idempotent write: either newly created or replay of first result.
 */
export interface IdempotentResult<T> {
  created: boolean;
  value: T;
}
