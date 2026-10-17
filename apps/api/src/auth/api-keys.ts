import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { UnauthorizedError } from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";

/** Fixture Tenant A / B — deterministic research keys (never for real production). */
export const FIXTURE_API_KEYS = {
  tenantA: {
    key: "alk_dev_tenant_a",
    tenantId: "00000000-0000-4000-8000-000000000001",
  },
  tenantB: {
    key: "alk_dev_tenant_b",
    tenantId: "00000000-0000-4000-8000-000000000002",
  },
} as const;

export type AuthMode = "disabled" | "api_key";

export interface AuthPrincipal {
  tenantId: string;
  keyId: string;
  authMode: AuthMode;
}

export interface ApiKeyRecord {
  /** Opaque id for logs — never the raw secret. */
  keyId: string;
  tenantId: string;
  keyHash: string;
}

function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/** Thrown when production AUTH_MODE is not explicitly api_key (Phase 9.2). */
export class ProductionAuthModeError extends Error {
  readonly code = "PRODUCTION_AUTH_MODE";

  constructor(message = "Production requires AUTH_MODE=api_key") {
    super(message);
    this.name = "ProductionAuthModeError";
  }
}

/**
 * Resolve AUTH_MODE (single source of truth).
 *
 * Production (Phase 9.2): AUTH_MODE must be explicitly `api_key`.
 * Missing / empty / whitespace / disabled / invalid → throw (fail closed).
 *
 * Non-production:
 * - explicit AUTH_MODE=disabled|api_key respected
 * - Vitest / NODE_ENV=test → disabled when omitted (Phase 4–7 compatibility)
 * - otherwise → api_key when omitted
 */
export function resolveAuthMode(env: NodeJS.ProcessEnv = process.env): AuthMode {
  const isProduction = (env.NODE_ENV ?? "").trim() === "production";
  const explicit = (env.AUTH_MODE ?? "").trim().toLowerCase();

  if (isProduction) {
    if (explicit === "api_key") return "api_key";
    throw new ProductionAuthModeError();
  }

  if (explicit === "disabled" || explicit === "api_key") return explicit;
  if (env.VITEST || env.NODE_ENV === "test") return "disabled";
  return "api_key";
}

function shouldLoadFixtureApiKeys(env: NodeJS.ProcessEnv): boolean {
  // Production never loads research fixture keys (equiv. NO_FIXTURES=1).
  if (env.NODE_ENV === "production") return false;
  if (env.ADLINKLAB_API_KEYS_NO_FIXTURES === "1") return false;
  return true;
}

/**
 * Parse ADLINKLAB_API_KEYS=key:tenantId,key2:tenantId2
 * Fixture keys load in development/test unless ADLINKLAB_API_KEYS_NO_FIXTURES=1.
 * Production never loads FIXTURE_API_KEYS.
 */
export function loadApiKeyRegistry(
  env: NodeJS.ProcessEnv = process.env
): ApiKeyRecord[] {
  const records: ApiKeyRecord[] = [];
  const raw = (env.ADLINKLAB_API_KEYS ?? "").trim();
  if (raw) {
    for (const part of raw.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const idx = trimmed.lastIndexOf(":");
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      const tenantId = trimmed.slice(idx + 1).trim();
      if (!key || !tenantId) continue;
      records.push({
        keyId: `env:${key.slice(0, 8)}`,
        tenantId,
        keyHash: hashApiKey(key),
      });
    }
  }

  if (shouldLoadFixtureApiKeys(env)) {
    for (const fixture of Object.values(FIXTURE_API_KEYS)) {
      const already = records.some((r) => r.tenantId === fixture.tenantId);
      if (already) continue;
      records.push({
        keyId: `fixture:${fixture.key}`,
        tenantId: fixture.tenantId,
        keyHash: hashApiKey(fixture.key),
      });
    }
  }

  return records;
}

export function authenticateApiKey(
  rawKey: string | undefined,
  registry: ApiKeyRecord[]
): AuthPrincipal {
  if (!rawKey?.trim()) {
    throw new UnauthorizedError("API key required");
  }
  const keyHash = hashApiKey(rawKey.trim());
  const match = registry.find((r) => safeEqualHex(r.keyHash, keyHash));
  if (!match) {
    throw new UnauthorizedError("Invalid API key");
  }
  return {
    tenantId: match.tenantId,
    keyId: match.keyId,
    authMode: "api_key",
  };
}

export function extractApiKeyFromHeaders(headers: {
  authorization?: string;
  "x-api-key"?: string;
}): string | undefined {
  const headerKey = headers["x-api-key"]?.trim();
  if (headerKey) return headerKey;
  const auth = headers.authorization?.trim();
  if (!auth) return undefined;
  const bearer = /^Bearer\s+(.+)$/i.exec(auth);
  return bearer?.[1]?.trim();
}

// ---------------------------------------------------------------------------
// P0-3 — DB-backed API keys (ApiKey table). Env keys keep working as before;
// DB keys are checked after the env registry misses (see tenant.ts hook).
// Only the SHA-256 hash + 8-char prefix are stored; the plaintext key is
// returned exactly once at create/rotate time.
// ---------------------------------------------------------------------------

/** Rotation grace window: a revoked key still authenticates for 24h. */
export const DB_API_KEY_GRACE_MS = 24 * 60 * 60 * 1000;

/** Prefix length stored alongside the hash (first 8 chars of the raw key). */
export const DB_API_KEY_PREFIX_LEN = 8;

export function generateDbApiKey(): {
  key: string;
  keyHash: string;
  keyPrefix: string;
} {
  const key = `alk_${randomBytes(32).toString("hex")}`;
  return {
    key,
    keyHash: hashApiKey(key),
    keyPrefix: key.slice(0, DB_API_KEY_PREFIX_LEN),
  };
}

export type DbApiKeyStatus = "active" | "grace" | "revoked" | "expired";

/** Pure status resolution (used by routes + tests). */
export function resolveDbApiKeyStatus(
  row: {
    expiresAt?: Date | null;
    revokedAt?: Date | null;
    graceExpiresAt?: Date | null;
  },
  now: Date = new Date()
): DbApiKeyStatus {
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
    return "expired";
  }
  if (row.revokedAt) {
    if (
      row.graceExpiresAt &&
      row.graceExpiresAt.getTime() > now.getTime()
    ) {
      return "grace";
    }
    return "revoked";
  }
  return "active";
}

export type DbApiKeyCheck =
  | {
      status: "ok";
      tenantId: string;
      keyId: string;
      scopes: string[];
      inGrace: boolean;
    }
  | { status: "not_found" }
  | {
      status: "rejected";
      reason: "expired" | "revoked" | "ip_not_allowed";
    };

/**
 * Validate a raw key against the DB ApiKey table.
 * - `not_found` → caller falls through to the env registry / 401.
 * - `rejected` → the key is known but must not authenticate (expired,
 *   revoked past grace, or caller IP outside ipWhitelist).
 * - `ok` → best-effort lastUsedAt update; a failed update never blocks.
 * Never throws: DB failures resolve to `not_found` (fail-open to the env
 * registry path, which still enforces its own checks).
 */
export async function authenticateDbApiKey(
  prisma: PrismaClient,
  rawKey: string | undefined,
  requestIp: string | undefined,
  now: Date = new Date()
): Promise<DbApiKeyCheck> {
  const trimmed = rawKey?.trim();
  if (!trimmed) return { status: "not_found" };
  try {
    const row = await prisma.apiKey.findUnique({
      where: { keyHash: hashApiKey(trimmed) },
    });
    if (!row) return { status: "not_found" };

    const status = resolveDbApiKeyStatus(row, now);
    if (status === "expired") return { status: "rejected", reason: "expired" };
    if (status === "revoked") return { status: "rejected", reason: "revoked" };

    const whitelist = (row.ipWhitelist ?? []).map((ip) => ip.trim());
    if (whitelist.length > 0) {
      const ip = (requestIp ?? "").trim();
      if (!ip || !whitelist.includes(ip)) {
        return { status: "rejected", reason: "ip_not_allowed" };
      }
    }

    // Best-effort: a failed lastUsedAt write must never block the request.
    try {
      await prisma.apiKey.update({
        where: { id: row.id },
        data: { lastUsedAt: now },
      });
    } catch {
      // ignore — usage bookkeeping only
    }

    return {
      status: "ok",
      tenantId: row.tenantId,
      keyId: `db:${row.id}`,
      scopes: [...(row.scopes ?? [])],
      inGrace: status === "grace",
    };
  } catch {
    return { status: "not_found" };
  }
}
