import { createHash, randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import type { PrismaClient } from "@adlinklab/database";

/**
 * P0-5 — Token / session blacklist.
 *
 * Writes go to the TokenRevocation table AND a Redis blacklist mirror
 * (key `revoked:jti:<jti>` / `revoked:hash:<tokenHash>` → "1", TTL = time
 * until expiresAt). Redis is best-effort: when unavailable, only the DB
 * write happens and nothing throws. Reads check Redis first, then DB.
 *
 * Only hashes / jtis are ever stored — never a plaintext token.
 */

export type RevocationType = "session" | "jwt";

export interface RevokeTokenInput {
  jti?: string;
  tokenHash?: string;
  type: RevocationType;
  reason?: string;
  expiresAt: Date;
}

export interface RevocationCheckInput {
  jti?: string;
  tokenHash?: string;
}

export interface RevocationDeps {
  /** Override the shared Redis client (tests inject an in-memory fake). */
  redis?: RevocationRedisLike | null;
  /** Override "now" (tests). */
  now?: Date;
}

/** Minimal Redis surface used here (ioredis satisfies it). */
export interface RevocationRedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: string, ttlSeconds: number): Promise<unknown>;
}

/** SHA-256 hex of an opaque token — the only form ever persisted. */
export function hashTokenForRevocation(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

let sharedRedis: Redis | null | undefined;

function getSharedRedis(): Redis | null {
  if (sharedRedis !== undefined) return sharedRedis;
  const url = (process.env.REDIS_URL ?? "").trim();
  if (!url) {
    sharedRedis = null;
    return null;
  }
  try {
    const client = new Redis(url, {
      lazyConnect: true,
      enableReadyCheck: false,
      maxRetriesPerRequest: 1,
      // Stop reconnecting after the first failure — revocation must never
      // hang a request on a dead Redis.
      retryStrategy: () => null,
    });
    // ioredis emits unhandled 'error' events by default; swallow them.
    client.on("error", () => undefined);
    sharedRedis = client;
  } catch {
    sharedRedis = null;
  }
  return sharedRedis;
}

function redisKeys(input: RevokeTokenInput | RevocationCheckInput): string[] {
  const keys: string[] = [];
  if (input.jti) keys.push(`revoked:jti:${input.jti}`);
  if (input.tokenHash) keys.push(`revoked:hash:${input.tokenHash}`);
  return keys;
}

/**
 * Record a revocation. Never throws: Redis failures are swallowed and a
 * DB failure is swallowed too (callers such as logout already removed the
 * session row, so the revocation is belt-and-braces).
 */
export async function revokeToken(
  prisma: PrismaClient,
  input: RevokeTokenInput,
  deps: RevocationDeps = {}
): Promise<void> {
  const jti = input.jti?.trim() || undefined;
  const tokenHash = input.tokenHash?.trim() || undefined;
  if (!jti && !tokenHash) return;
  const now = deps.now ?? new Date();
  try {
    // Idempotent: refresh expiry/reason when the identifier is already listed.
    let existing: { id: string } | null = null;
    try {
      if (jti) {
        existing = await prisma.tokenRevocation.findUnique({
          where: { jti },
          select: { id: true },
        });
      }
      if (!existing && tokenHash) {
        existing = await prisma.tokenRevocation.findUnique({
          where: { tokenHash },
          select: { id: true },
        });
      }
    } catch {
      existing = null;
    }
    if (existing) {
      await prisma.tokenRevocation.update({
        where: { id: existing.id },
        data: {
          type: input.type,
          reason: input.reason ?? null,
          expiresAt: input.expiresAt,
        },
      });
    } else {
      await prisma.tokenRevocation.create({
        data: {
          id: randomUUID(),
          jti: jti ?? null,
          tokenHash: tokenHash ?? null,
          type: input.type,
          reason: input.reason ?? null,
          expiresAt: input.expiresAt,
        },
      });
    }
  } catch {
    // DB write failed — still attempt the Redis mirror below.
  }

  const redis: RevocationRedisLike | null | undefined =
    deps.redis !== undefined ? deps.redis : getSharedRedis();
  if (!redis) return;
  const ttlSeconds = Math.max(
    1,
    Math.ceil((input.expiresAt.getTime() - now.getTime()) / 1000)
  );
  for (const key of redisKeys({ jti, tokenHash })) {
    try {
      await redis.set(key, "1", "EX", ttlSeconds);
    } catch {
      // Redis unavailable — DB row is the source of truth.
    }
  }
}

/**
 * True when the identifier is revoked. Never throws: lookup failures
 * resolve to false (the session row itself remains the primary validity
 * signal; the blacklist is a secondary kill-switch).
 */
export async function isRevoked(
  prisma: PrismaClient,
  input: RevocationCheckInput,
  deps: RevocationDeps = {}
): Promise<boolean> {
  const jti = input.jti?.trim() || undefined;
  const tokenHash = input.tokenHash?.trim() || undefined;
  if (!jti && !tokenHash) return false;

  const redis: RevocationRedisLike | null | undefined =
    deps.redis !== undefined ? deps.redis : getSharedRedis();
  if (redis) {
    for (const key of redisKeys({ jti, tokenHash })) {
      try {
        if ((await redis.get(key)) === "1") return true;
      } catch {
        // fall through to the DB check
      }
    }
  }

  try {
    if (jti) {
      const row = await prisma.tokenRevocation.findUnique({
        where: { jti },
        select: { id: true },
      });
      if (row) return true;
    }
    if (tokenHash) {
      const row = await prisma.tokenRevocation.findUnique({
        where: { tokenHash },
        select: { id: true },
      });
      if (row) return true;
    }
  } catch {
    return false;
  }
  return false;
}
