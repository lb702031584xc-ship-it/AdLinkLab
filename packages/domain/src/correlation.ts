import { randomUUID } from "node:crypto";

/**
 * Correlation / request id propagation (API → Service → Transaction → Audit → Job).
 * Not full distributed tracing — a clean request-scoped correlation handle.
 */
export interface CorrelationContext {
  requestId: string;
  tenantId?: string;
  actorId?: string;
}

export function createCorrelation(input?: {
  requestId?: string;
  tenantId?: string;
  actorId?: string;
}): CorrelationContext {
  return {
    requestId: input?.requestId ?? randomUUID(),
    tenantId: input?.tenantId,
    actorId: input?.actorId,
  };
}
