/**
 * Phase 9.3 — HTTP correlation / request ID.
 * Prefer client X-Request-ID when safe; otherwise crypto.randomUUID().
 */
import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "x-request-id";
/** Max accepted client-provided request ID length (bytes/chars). */
export const MAX_REQUEST_ID_LENGTH = 128;

/**
 * Safe printable ASCII without control chars / whitespace (log-injection resistant).
 */
const SAFE_REQUEST_ID = /^[\x21-\x7E]+$/;

export function sanitizeRequestId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_REQUEST_ID_LENGTH) return null;
  if (!SAFE_REQUEST_ID.test(trimmed)) return null;
  return trimmed;
}

export function resolveRequestId(
  headerValue: string | string[] | undefined
): string {
  const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return sanitizeRequestId(candidate) ?? randomUUID();
}
