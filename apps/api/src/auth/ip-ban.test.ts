/**
 * P0-4 — IP ban: whitelist parsing, watcher threshold/window, ban lookup,
 * enforcement hook (403), whitelist exemption, auto-ban via onResponse.
 * In-memory fake Prisma (no live DB) + Fastify inject.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import {
  findActiveIpBan,
  isIpBanned,
  isValidIp,
  parseIpBanWhitelist,
  registerIpBanHooks,
} from "./ip-ban.js";
import { IpBanWatcher } from "./ip-ban-watcher.js";
import { createObservabilityErrorHandler } from "../observability/index.js";

type Row = Record<string, any>;

function makeIpBanDelegate(store: Row[]) {
  return {
    findMany: async ({ where, orderBy }: any) => {
      let rows = store.filter((r) => (where?.ip ? r.ip === where.ip : true));
      if (orderBy?.createdAt === "desc") {
        rows = [...rows].sort((a, b) => b.createdAt - a.createdAt);
      }
      return rows.map((r) => ({ ...r }));
    },
    create: async ({ data }: any) => {
      const row = { createdAt: new Date(), updatedAt: new Date(), ...data };
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

describe("isValidIp / parseIpBanWhitelist", () => {
  it("validates v4/v6 and rejects garbage", () => {
    expect(isValidIp("203.0.113.9")).toBe(true);
    expect(isValidIp("::1")).toBe(true);
    expect(isValidIp("2001:db8::1")).toBe(true);
    expect(isValidIp("999.1.1.1")).toBe(false);
    expect(isValidIp("not-an-ip")).toBe(false);
    expect(isValidIp("")).toBe(false);
  });

  it("unset → loopback defaults; set → used as-is", () => {
    expect(parseIpBanWhitelist({})).toEqual(["127.0.0.1", "::1"]);
    expect(
      parseIpBanWhitelist({ IP_BAN_WHITELIST: "10.0.0.1, 10.0.0.2" })
    ).toEqual(["10.0.0.1", "10.0.0.2"]);
  });
});

describe("IpBanWatcher", () => {
  it("trips exactly once at the threshold, then suppresses until ban elapses", () => {
    const w = new IpBanWatcher({
      windowMs: 5 * 60_000,
      threshold: 3,
      banDurationMs: 60 * 60_000,
      now: () => 0,
    });
    expect(w.record("203.0.113.9", 500, 0).shouldBan).toBe(false);
    expect(w.record("203.0.113.9", 500, 1000).shouldBan).toBe(false);
    const trip = w.record("203.0.113.9", 500, 2000);
    expect(trip).toEqual({ shouldBan: true, count: 3 });
    // Still erroring inside the ban duration → no second trip.
    expect(w.record("203.0.113.9", 500, 3000).shouldBan).toBe(false);
    // After the ban duration elapses, counting restarts.
    expect(w.record("203.0.113.9", 500, 60 * 60_000 + 5000).shouldBan).toBe(false);
  });

  it("ignores 2xx/3xx, resets across windows, skips whitelisted IPs", () => {
    const w = new IpBanWatcher({
      windowMs: 1000,
      threshold: 2,
      whitelist: ["10.0.0.1"],
    });
    expect(w.record("203.0.113.9", 200, 0).shouldBan).toBe(false);
    expect(w.record("203.0.113.9", 500, 0).shouldBan).toBe(false);
    // Window elapsed → counter restarts.
    expect(w.record("203.0.113.9", 500, 5000).shouldBan).toBe(false);
    expect(w.record("203.0.113.9", 500, 5100).shouldBan).toBe(true);
    expect(w.record("10.0.0.1", 500, 0)).toEqual({ shouldBan: false, count: 0 });
  });
});

describe("findActiveIpBan / isIpBanned", () => {
  it("active / revoked / expired / whitelisted cases", async () => {
    const store: Row[] = [];
    const fake = { ipBan: makeIpBanDelegate(store) } as any;
    const now = new Date("2026-10-17T12:00:00Z");
    store.push(
      { id: "b1", ip: "203.0.113.9", revokedAt: null, expiresAt: null, createdAt: now },
      { id: "b2", ip: "198.51.100.7", revokedAt: now, expiresAt: null, createdAt: now },
      { id: "b3", ip: "192.0.2.5", revokedAt: null, expiresAt: new Date("2026-10-01T00:00:00Z"), createdAt: now },
    );
    expect((await findActiveIpBan(fake, "203.0.113.9", now))?.id).toBe("b1");
    expect(await findActiveIpBan(fake, "198.51.100.7", now)).toBeNull();
    expect(await findActiveIpBan(fake, "192.0.2.5", now)).toBeNull();
    expect(await isIpBanned(fake, "203.0.113.9", { now })).toBe(true);
    expect(await isIpBanned(fake, "127.0.0.1", { now })).toBe(false);
  });

  it("fail-open on DB error", async () => {
    const broken = {
      ipBan: { findMany: async () => { throw new Error("db down"); } },
    } as any;
    expect(await isIpBanned(broken, "203.0.113.9")).toBe(false);
  });
});

describe("registerIpBanHooks", () => {
  it("banned IP → 403 generic; whitelisted IP with a ban row still passes", async () => {
    const store: Row[] = [];
    const fake = { ipBan: makeIpBanDelegate(store) } as any;
    store.push(
      { id: "b1", ip: "203.0.113.9", revokedAt: null, expiresAt: null, createdAt: new Date() },
      { id: "b2", ip: "127.0.0.1", revokedAt: null, expiresAt: null, createdAt: new Date() },
    );
    const app = Fastify({ logger: false });
    app.setErrorHandler(createObservabilityErrorHandler());
    registerIpBanHooks(app, fake, { autoEnabled: false });
    app.get("/ping", async () => ({ ok: true }));

    const blocked = await app.inject({ method: "GET", url: "/ping", remoteAddress: "203.0.113.9" });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().message).toBe("Forbidden");

    const allowed = await app.inject({ method: "GET", url: "/ping", remoteAddress: "127.0.0.1" });
    expect(allowed.statusCode).toBe(200);
  });

  it("auto-ban: threshold errors → next request 403, ban row level=auto", async () => {
    const store: Row[] = [];
    const fake = { ipBan: makeIpBanDelegate(store) } as any;
    const app = Fastify({ logger: false });
    app.setErrorHandler(createObservabilityErrorHandler());
    registerIpBanHooks(app, fake, {
      autoEnabled: true,
      watcher: new IpBanWatcher({ windowMs: 60_000, threshold: 3, banDurationMs: 60_000 }),
    });
    app.get("/boom", async (_req, reply) => reply.status(500).send({ error: "boom" }));
    app.get("/ping", async () => ({ ok: true }));

    const ip = "203.0.113.9";
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: "GET", url: "/boom", remoteAddress: ip });
      expect(res.statusCode).toBe(500);
    }
    expect(store).toHaveLength(1);
    expect(store[0].level).toBe("auto");
    expect(store[0].requestCount).toBe(3);
    expect(store[0].ip).toBe(ip);

    const blocked = await app.inject({ method: "GET", url: "/ping", remoteAddress: ip });
    expect(blocked.statusCode).toBe(403);
  });
});
