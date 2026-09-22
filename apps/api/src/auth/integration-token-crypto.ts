/**
 * Phase 8.4.2 — Integration token crypto (HMAC-SHA256 + pepper).
 * Never log tokens, pepper, or Authorization headers.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { UnauthorizedError } from "@adlinklab/shared";

/** Minimum random entropy for Script Integration tokens (bytes). */
export const INTEGRATION_TOKEN_ENTROPY_BYTES = 32;

/** Display prefix length (characters of encoded token). */
export const INTEGRATION_TOKEN_PREFIX_LENGTH = 12;

/**
 * Test-only pepper — never for production.
 * Used when VITEST/NODE_ENV=test and INTEGRATION_TOKEN_PEPPER is unset.
 */
export const TEST_INTEGRATION_TOKEN_PEPPER =
  "adlinklab-test-integration-token-pepper-not-for-production";

export interface GeneratedIntegrationToken {
  /** Full plaintext token — return once; never persist. */
  token: string;
  tokenKeyId: string;
  tokenPrefix: string;
  tokenHash: string;
}

/**
 * Resolve server-side pepper.
 * - Prefer INTEGRATION_TOKEN_PEPPER
 * - Test/Vitest: fall back to TEST pepper (never commit real secrets)
 * - Otherwise: throw (fail closed for generate/auth paths that call this)
 */
export function resolveIntegrationTokenPepper(
  env: NodeJS.ProcessEnv = process.env
): string {
  const configured = (env.INTEGRATION_TOKEN_PEPPER ?? "").trim();
  if (configured) return configured;
  if (env.VITEST || env.NODE_ENV === "test") {
    return TEST_INTEGRATION_TOKEN_PEPPER;
  }
  throw new UnauthorizedError("Unauthorized");
}

/** Explicit config check for create/rotate (clearer than auth 401). */
export function assertIntegrationTokenPepperConfigured(
  env: NodeJS.ProcessEnv = process.env
): string {
  const configured = (env.INTEGRATION_TOKEN_PEPPER ?? "").trim();
  if (configured) return configured;
  if (env.VITEST || env.NODE_ENV === "test") {
    return TEST_INTEGRATION_TOKEN_PEPPER;
  }
  throw new Error(
    "INTEGRATION_TOKEN_PEPPER is required for Script Integration token operations"
  );
}

function toBase64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * HMAC-SHA256(pepper, token) → hex digest.
 * Pepper must never be logged or returned.
 */
export function hashIntegrationToken(token: string, pepper: string): string {
  return createHmac("sha256", pepper).update(token, "utf8").digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * Generate a high-entropy Script Integration token.
 * Format: alk_s_<base64url(32 bytes)>
 */
export function generateIntegrationTokenMaterial(
  pepper: string
): GeneratedIntegrationToken {
  const entropy = randomBytes(INTEGRATION_TOKEN_ENTROPY_BYTES);
  const token = `alk_s_${toBase64Url(entropy)}`;
  const tokenKeyId = `itk_${toBase64Url(randomBytes(12))}`;
  const tokenPrefix = token.slice(0, INTEGRATION_TOKEN_PREFIX_LENGTH);
  const tokenHash = hashIntegrationToken(token, pepper);
  return { token, tokenKeyId, tokenPrefix, tokenHash };
}

/**
 * Extract Bearer token from Authorization header only.
 * Does NOT read x-api-key (reserved for Phase 8.2 tenant API keys).
 */
export function extractBearerToken(
  authorization: string | undefined
): string | undefined {
  if (authorization === undefined || authorization === null) return undefined;
  const raw = authorization.trim();
  if (!raw) return undefined;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(raw);
  if (!match) return undefined;
  const token = match[1]?.trim();
  return token || undefined;
}
