import { ConflictError, ValidationError } from "@adlinklab/shared";

/** Explicit tenant ownership check — do not rely on UUID randomness. */
export function assertSameTenant(
  expectedTenantId: string,
  actualTenantId: string | undefined | null,
  resource: string
): void {
  if (!actualTenantId || actualTenantId !== expectedTenantId) {
    throw new ValidationError(`Cross-tenant reference rejected for ${resource}`, {
      expectedTenantId,
      actualTenantId: actualTenantId ?? null,
      resource,
    });
  }
}

export function assertTenantId(tenantId: string | undefined | null): string {
  if (!tenantId) {
    throw new ValidationError("tenantId is required");
  }
  return tenantId;
}

export class TenantConflictError extends ConflictError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = "TenantConflictError";
  }
}
