/**
 * P0-3 — DB API keys: generation, status resolution, DB validation.
 * In-memory fake Prisma (no live DB).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  DB_API_KEY_GRACE_MS,
  authenticateDbApiKey,
  generateDbApiKey,
  resolveDbApiKeyStatus,
} from "./api-keys.js";

type Row = Record<string, any>;

function makeApiKeyDelegate(store: Row[]) {
  return {
    findUnique: async ({ where }: any) => {
      const row = store.find((r) => r.keyHash === where.keyHash) ?? null;
      return row ? { ...row } : null;
    },
    update: async ({ where, data }: any) => {
      const row = store.find((r) => r.id === where.id);
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return { ...row };
    },
  };
}

function seedRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "key-1",
    tenantId: "tenant-1",
    name: "CI key",
    keyPrefix: "alk_0000",
    keyHash: "",
    scopes: [],
    ipWhitelist: [],
    expiresAt: null,
    revokedAt: null,
    graceExpiresAt: null,
    lastUsedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

const NOW = new Date("2026-10-17T12:00:00Z");

describe("generateDbApiKey", () => {
  it("returns alk_ + 64 hex chars; hash is SHA-256 of the key; prefix is first 8 chars", () => {
    const g = generateDbApiKey();
    expect(g.key).toMatch(/^alk_[0-9a-f]{64}$/);
    expect(g.keyHash).toBe(createHash("sha256").update(g.key, "utf8").digest("hex"));
    expect(g.keyPrefix).toBe(g.key.slice(0, 8));
    expect(g.keyPrefix).toHaveLength(8);
  });

  it("generates distinct keys", () => {
    expect(generateDbApiKey().key).not.toBe(generateDbApiKey().key);
  });
});

describe("resolveDbApiKeyStatus", () => {
  it("active by default; expired wins over revoked", () => {
    expect(resolveDbApiKeyStatus({}, NOW)).toBe("active");
    expect(
      resolveDbApiKeyStatus(
        {
          expiresAt: new Date("2026-10-01T00:00:00Z"),
          revokedAt: NOW,
          graceExpiresAt: new Date("2026-10-18T00:00:00Z"),
        },
        NOW
      )
    ).toBe("expired");
  });

  it("grace within 24h of revocation, revoked after grace", () => {
    expect(
      resolveDbApiKeyStatus(
        {
          revokedAt: NOW,
          graceExpiresAt: new Date(NOW.getTime() + DB_API_KEY_GRACE_MS),
        },
        NOW
      )
    ).toBe("grace");
    expect(
      resolveDbApiKeyStatus(
        {
          revokedAt: new Date(NOW.getTime() - DB_API_KEY_GRACE_MS - 1000),
          graceExpiresAt: new Date(NOW.getTime() - 1000),
        },
        NOW
      )
    ).toBe("revoked");
    expect(
      resolveDbApiKeyStatus({ revokedAt: NOW, graceExpiresAt: null }, NOW)
    ).toBe("revoked");
  });
});

describe("authenticateDbApiKey", () => {
  it("ok + updates lastUsedAt; unknown key → not_found", async () => {
    const store: Row[] = [];
    const fake = { apiKey: makeApiKeyDelegate(store) } as any;
    const g = generateDbApiKey();
    store.push(seedRow({ keyHash: g.keyHash }));

    expect(await authenticateDbApiKey(fake, "nope", "1.2.3.4", NOW)).toEqual({
      status: "not_found",
    });
    const ok = await authenticateDbApiKey(fake, g.key, "1.2.3.4", NOW);
    expect(ok.status).toBe("ok");
    if (ok.status === "ok") {
      expect(ok.tenantId).toBe("tenant-1");
      expect(ok.inGrace).toBe(false);
    }
    expect(store[0].lastUsedAt).toEqual(NOW);
  });

  it("expired → rejected; revoked past grace → rejected; within grace → ok + inGrace", async () => {
    const store: Row[] = [];
    const fake = { apiKey: makeApiKeyDelegate(store) } as any;

    const expired = generateDbApiKey();
    store.push(seedRow({ id: "k-exp", keyHash: expired.keyHash, expiresAt: new Date("2026-10-01T00:00:00Z") }));
    expect(await authenticateDbApiKey(fake, expired.key, undefined, NOW)).toEqual({
      status: "rejected",
      reason: "expired",
    });

    const revoked = generateDbApiKey();
    store.push(
      seedRow({
        id: "k-rev",
        keyHash: revoked.keyHash,
        revokedAt: new Date("2026-10-10T00:00:00Z"),
        graceExpiresAt: new Date("2026-10-11T00:00:00Z"),
      })
    );
    expect(await authenticateDbApiKey(fake, revoked.key, undefined, NOW)).toEqual({
      status: "rejected",
      reason: "revoked",
    });

    const grace = generateDbApiKey();
    store.push(
      seedRow({
        id: "k-grace",
        keyHash: grace.keyHash,
        revokedAt: NOW,
        graceExpiresAt: new Date(NOW.getTime() + 60_000),
      })
    );
    const res = await authenticateDbApiKey(fake, grace.key, undefined, NOW);
    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.inGrace).toBe(true);
  });

  it("ipWhitelist: matching IP ok, other IP rejected, missing IP rejected", async () => {
    const store: Row[] = [];
    const fake = { apiKey: makeApiKeyDelegate(store) } as any;
    const g = generateDbApiKey();
    store.push(seedRow({ keyHash: g.keyHash, ipWhitelist: ["203.0.113.9"] }));

    expect(
      (await authenticateDbApiKey(fake, g.key, "203.0.113.9", NOW)).status
    ).toBe("ok");
    expect(await authenticateDbApiKey(fake, g.key, "198.51.100.7", NOW)).toEqual({
      status: "rejected",
      reason: "ip_not_allowed",
    });
    expect(await authenticateDbApiKey(fake, g.key, undefined, NOW)).toEqual({
      status: "rejected",
      reason: "ip_not_allowed",
    });
  });
});
