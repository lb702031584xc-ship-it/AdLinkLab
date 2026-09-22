import { ValidationError } from "@adlinklab/shared";
import type { UrlEntityType } from "./entities.js";

/** Phase 8.4.1 — ScriptSyncTarget is AD-only. */
export function assertScriptSyncTargetAdOnly(entityType: UrlEntityType): void {
  if (entityType !== "AD") {
    throw new ValidationError(
      "ScriptSyncTarget entityType must be AD in Phase 8.4.1",
      { entityType }
    );
  }
}

export interface TenantScopedAccountRef {
  id: string;
  tenantId: string;
}

/**
 * Domain/repository constraint: Integration.tenantId must equal GoogleAccount.tenantId.
 * Prisma cannot express composite tenant FK — enforced here.
 */
export function assertGoogleAccountBelongsToTenant(
  account: TenantScopedAccountRef | null | undefined,
  tenantId: string,
  googleAccountId: string
): asserts account is TenantScopedAccountRef {
  if (!account || account.id !== googleAccountId) {
    throw new ValidationError("GoogleAccount not found for Script Integration", {
      googleAccountId,
      tenantId,
    });
  }
  if (account.tenantId !== tenantId) {
    throw new ValidationError(
      "GoogleAccount tenantId must match Script Integration tenantId",
      {
        googleAccountId,
        integrationTenantId: tenantId,
        googleAccountTenantId: account.tenantId,
      }
    );
  }
}
