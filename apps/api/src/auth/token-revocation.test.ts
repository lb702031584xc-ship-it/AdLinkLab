/**
 * P0-5 — Token revocation: DB + Redis mirror, Redis-down fallback,
 * idempotent re-revoke, never-throw lookups.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it } from "vitest";
import {
  hashTokenForRevocation,
  isRevoked,
  revokeToken,
} from "./token-revocation.js";

type Row = Record<string, any>;

function makeRevocationDelegate(store: Row[]) {
  return {
    findUnique: async ({ where }: any) => {
      const row =
        store.find((r) => where.jti !== undefined && r.jti === where.jti) ??
        store.find((r) => where.tokenHash !== undefined && r.tokenHash === where.tokenHash) ??
        null;
      return row ? { ...row } : null;
    },
    create: async ({ data }: any) => {
      const row = { createdAt: new Date(), ...data };
      store.push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const row = store.find((r) => r.id === where.id);
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return { ...row };
    },
  };
}

function makeFakeRedis() {
  const map = new Map<string, string>();
  return {
    map,
    get: async (key: string) => map.get(key) ?? null,
    set: async (key: string, value: string) => {
      map.set(key, value);
      return "OK";
    },
  };
}

const EXPIRY = new Date("2026-11-16T12:00:00Z");
const NOW = new Date("2026-10-17T12:00:00Z");

describe("hashTokenForRevocation", () => {
  it("is SHA-256 hex and never reveals the token", async () => {
    const hash = hashTokenForRevocation("secret-token");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("secret-token");
  });
});

describe("revokeToken / isRevoked", () => {
  it("revoked jti is found via Redis and via DB", async () => {
    const store: Row[] = [];
    const fake = { tokenRevocation: makeRevocationDelegate(store) } as any;
    const redis = makeFakeRedis();

    expect(await isRevoked(fake, { jti: "jti-1" }, { redis })).toBe(false);
    await revokeToken(
      fake,
      { jti: "jti-1", type: "jwt", reason: "logout", expiresAt: EXPIRY },
      { redis, now: NOW }
    );
    expect(store).toHaveLength(1);
    expect(store[0].jti).toBe("jti-1");
    expect(store[0].tokenHash).toBeNull();
    expect(await isRevoked(fake, { jti: "jti-1" }, { redis })).toBe(true);

    // Redis empty → DB still answers.
    const emptyRedis = makeFakeRedis();
    expect(await isRevoked(fake, { jti: "jti-1" }, { redis: emptyRedis })).toBe(true);
  });

  it("tokenHash revocation works; re-revoke is idempotent (one row)", async () => {
    const store: Row[] = [];
    const fake = { tokenRevocation: makeRevocationDelegate(store) } as any;
    const redis = makeFakeRedis();
    const hash = hashTokenForRevocation("session-token-abc");

    await revokeToken(fake, { tokenHash: hash, type: "session", reason: "logout", expiresAt: EXPIRY }, { redis, now: NOW });
    await revokeToken(fake, { tokenHash: hash, type: "session", reason: "logout", expiresAt: EXPIRY }, { redis, now: NOW });
    expect(store).toHaveLength(1);
    expect(await isRevoked(fake, { tokenHash: hash }, { redis })).toBe(true);
    expect(await isRevoked(fake, { tokenHash: hashTokenForRevocation("other") }, { redis })).toBe(false);
  });

  it("Redis down → DB-only write still works, no throw", async () => {
    const store: Row[] = [];
    const fake = { tokenRevocation: makeRevocationDelegate(store) } as any;
    const throwingRedis = {
      get: async () => { throw new Error("redis down"); },
      set: async () => { throw new Error("redis down"); },
    };
    await expect(
      revokeToken(
        fake,
        { jti: "jti-down", type: "jwt", expiresAt: EXPIRY },
        { redis: throwingRedis, now: NOW }
      )
    ).resolves.toBeUndefined();
    expect(store).toHaveLength(1);
    expect(await isRevoked(fake, { jti: "jti-down" }, { redis: throwingRedis })).toBe(true);
  });

  it("no identifier → no-op; DB down → isRevoked resolves false", async () => {
    const store: Row[] = [];
    const fake = { tokenRevocation: makeRevocationDelegate(store) } as any;
    const redis = makeFakeRedis();
    await revokeToken(fake, { type: "session", expiresAt: EXPIRY }, { redis, now: NOW });
    expect(store).toHaveLength(0);

    const broken = {
      tokenRevocation: {
        findUnique: async () => { throw new Error("db down"); },
      },
    } as any;
    await expect(isRevoked(broken, { jti: "x" }, { redis })).resolves.toBe(false);
  });
});
