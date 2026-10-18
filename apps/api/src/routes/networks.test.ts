/**
 * Network API framework — route tests (in-memory fake Prisma + Fastify inject).
 * Auth: requireTenant in "disabled" mode reads x-tenant-id (existing test path).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { registerNetworkRoutes } from "./networks.js";
import { encryptApiKey } from "../networks/network-crypto.js";
import type { NetworkAdapter, NetworkOffer } from "../networks/types.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const NETWORK = "22222222-2222-4222-8222-222222222222";
const PEPPER = "test-pepper-for-network-routes";

interface Ctx {
  networks: any[];
  offers: any[];
  pulls: any[];
}

function stubAdapter(offers: NetworkOffer[]): NetworkAdapter {
  return {
    kind: "impact",
    displayName: "Impact",
    pullOffers: async () => offers,
  };
}

function buildApp(ctx: Ctx) {
  const fake = {
    affiliateNetwork: {
      findFirst: async (args: any) =>
        ctx.networks.find(
          (n) =>
            (!args.where.id || n.id === args.where.id) &&
            (!args.where.tenantId || n.tenantId === args.where.tenantId) &&
            n.deletedAt == null
        ) ?? null,
      findMany: async (args: any) =>
        ctx.networks.filter(
          (n) =>
            n.deletedAt == null &&
            (!args.where.tenantId || n.tenantId === args.where.tenantId)
        ),
      create: async (args: any) => {
        const row = {
          ...args.data,
          website: args.data.website ?? null,
          apiBaseUrl: args.data.apiBaseUrl ?? null,
          lastPullAt: null,
          pullStatus: "NEVER",
          pullError: null,
          status: "ACTIVE",
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        ctx.networks.push(row);
        return row;
      },
      update: async (args: any) => {
        const row = ctx.networks.find((n) => n.id === args.where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, args.data);
        return row;
      },
    },
    networkOffer: {
      findUnique: async (args: any) => {
        const k = args.where.tenantId_networkId_externalId;
        return (
          ctx.offers.find(
            (o) =>
              o.tenantId === k.tenantId &&
              o.networkId === k.networkId &&
              o.externalId === k.externalId
          ) ?? null
        );
      },
      create: async (args: any) => {
        ctx.offers.push(args.data);
        return args.data;
      },
      update: async (args: any) => {
        const row = ctx.offers.find((o) => o.id === args.where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, args.data);
        return row;
      },
      count: async (args: any) =>
        ctx.offers.filter(
          (o) =>
            o.tenantId === args.where.tenantId &&
            o.networkId === args.where.networkId
        ).length,
      findMany: async (args: any) =>
        ctx.offers
          .filter(
            (o) =>
              o.tenantId === args.where.tenantId &&
              o.networkId === args.where.networkId
          )
          .slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? 20)),
    },
    networkOfferPull: {
      create: async (args: any) => {
        const row = { ...args.data, pulledAt: new Date() };
        ctx.pulls.push(row);
        return row;
      },
      count: async (args: any) =>
        ctx.pulls.filter(
          (p) =>
            p.tenantId === args.where.tenantId &&
            p.networkId === args.where.networkId
        ).length,
      findMany: async (args: any) =>
        ctx.pulls
          .filter(
            (p) =>
              p.tenantId === args.where.tenantId &&
              p.networkId === args.where.networkId
          )
          .slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? 20)),
    },
  };

  const app = Fastify({ logger: false });
  const auth = { mode: "disabled" as const, registry: [] };
  const pullDeps = {
    getAdapterImpl: () =>
      stubAdapter([
        {
          externalId: "ext-1",
          name: "Pulled Offer",
          payout: 9.99,
          currency: "USD",
          termsText: "terms",
          rawData: {},
        },
      ]),
    pepper: PEPPER,
  };
  return registerNetworkRoutes(
    app,
    { prisma: fake as unknown as PrismaClient },
    auth,
    pullDeps
  ).then(() => app);
}

function headers(tenant = TENANT) {
  return { "content-type": "application/json", "x-tenant-id": tenant };
}

describe("networks routes", () => {
  it("POST creates a network; credentials are masked in every response", async () => {
    const ctx: Ctx = { networks: [], offers: [], pulls: [] };
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/networks",
      headers: headers(),
      payload: {
        name: "Impact",
        kind: "impact",
        apiKey: "SID:TOKEN",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json().network;
    expect(body.apiConfigured).toBe(true);
    expect(body.apiKey).toBeUndefined();
    expect(body.apiKeyRef).toBeUndefined();
    // DB stores ciphertext, never plaintext.
    expect(ctx.networks[0].apiKeyRef).toMatch(/^enc:v1:/);
    expect(ctx.networks[0].apiKeyRef).not.toContain("SID:TOKEN");

    const list = await app.inject({ method: "GET", url: "/api/v1/networks", headers: headers() });
    expect(list.json().networks[0].apiConfigured).toBe(true);
    expect(list.json().networks[0].apiKeyRef).toBeUndefined();
  });

  it("POST rejects an unsupported kind", async () => {
    const ctx: Ctx = { networks: [], offers: [], pulls: [] };
    const app = await buildApp(ctx);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/networks",
      headers: headers(),
      payload: { name: "Mystery", kind: "acme" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("tenant isolation: networks are scoped to the requesting tenant", async () => {
    const ctx: Ctx = { networks: [], offers: [], pulls: [] };
    const app = await buildApp(ctx);
    await app.inject({
      method: "POST",
      url: "/api/v1/networks",
      headers: headers(),
      payload: { name: "Mine", kind: "impact" },
    });
    const other = await app.inject({
      method: "GET",
      url: "/api/v1/networks",
      headers: headers(OTHER_TENANT),
    });
    expect(other.json().networks).toHaveLength(0);
    const mine = await app.inject({
      method: "GET",
      url: "/api/v1/networks",
      headers: headers(),
    });
    expect(mine.json().networks).toHaveLength(1);
  });

  it("PATCH rotates the apiKey; the ciphertext is never exposed", async () => {
    const ctx: Ctx = {
      networks: [
        {
          id: NETWORK,
          tenantId: TENANT,
          name: "Impact",
          kind: "impact",
          website: null,
          apiConfigured: true,
          apiKeyRef: encryptApiKey("OLD:TOKEN", PEPPER),
          apiBaseUrl: null,
          lastPullAt: null,
          pullStatus: "NEVER",
          pullError: null,
          status: "ACTIVE",
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      offers: [],
      pulls: [],
    };
    const app = await buildApp(ctx);
    const oldRef = ctx.networks[0].apiKeyRef;
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/networks/${NETWORK}`,
      headers: headers(),
      payload: { apiKey: "NEW:TOKEN" },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.networks[0].apiKeyRef).not.toBe(oldRef);
    expect(ctx.networks[0].apiKeyRef).not.toContain("NEW:TOKEN");
    expect(res.json().network.apiKeyRef).toBeUndefined();
  });

  it("POST /:id/pull-now without credentials returns a friendly 400", async () => {
    const ctx: Ctx = {
      networks: [
        {
          id: NETWORK,
          tenantId: TENANT,
          name: "No creds",
          kind: "impact",
          website: null,
          apiConfigured: false,
          apiKeyRef: null,
          apiBaseUrl: null,
          lastPullAt: null,
          pullStatus: "NEVER",
          pullError: null,
          status: "ACTIVE",
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      offers: [],
      pulls: [],
    };
    const app = await buildApp(ctx);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/networks/${NETWORK}/pull-now`,
      headers: headers(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message ?? res.body).toBeTruthy();
  });

  it("POST /:id/pull-now pulls offers with a stub adapter (202)", async () => {
    const ctx: Ctx = {
      networks: [
        {
          id: NETWORK,
          tenantId: TENANT,
          name: "Impact",
          kind: "impact",
          website: null,
          apiConfigured: true,
          apiKeyRef: encryptApiKey("SID:TOKEN", PEPPER),
          apiBaseUrl: null,
          lastPullAt: null,
          pullStatus: "NEVER",
          pullError: null,
          status: "ACTIVE",
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      offers: [],
      pulls: [],
    };
    const app = await buildApp(ctx);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/networks/${NETWORK}/pull-now`,
      headers: { "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(202);
    const pull = res.json().pull;
    expect(pull.status).toBe("SUCCESS");
    expect(pull.newCount).toBe(1);
    expect(ctx.offers).toHaveLength(1);
    expect(ctx.networks[0].pullStatus).toBe("SUCCESS");
  });

  it("GET /:id/offers and /:id/pulls return pulled data (tenant-scoped)", async () => {
    const ctx: Ctx = {
      networks: [
        {
          id: NETWORK,
          tenantId: TENANT,
          name: "Impact",
          kind: "impact",
          website: null,
          apiConfigured: true,
          apiKeyRef: encryptApiKey("SID:TOKEN", PEPPER),
          apiBaseUrl: null,
          lastPullAt: null,
          pullStatus: "NEVER",
          pullError: null,
          status: "ACTIVE",
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      offers: [],
      pulls: [],
    };
    const app = await buildApp(ctx);
    await app.inject({
      method: "POST",
      url: `/api/v1/networks/${NETWORK}/pull-now`,
      headers: { "x-tenant-id": TENANT },
    });

    const offers = await app.inject({
      method: "GET",
      url: `/api/v1/networks/${NETWORK}/offers?page=1&pageSize=20`,
      headers: headers(),
    });
    expect(offers.json().total).toBe(1);
    expect(offers.json().offers[0].name).toBe("Pulled Offer");

    const pulls = await app.inject({
      method: "GET",
      url: `/api/v1/networks/${NETWORK}/pulls`,
      headers: headers(),
    });
    expect(pulls.json().total).toBe(1);
    expect(pulls.json().pulls[0].status).toBe("SUCCESS");

    const other = await app.inject({
      method: "GET",
      url: `/api/v1/networks/${NETWORK}/offers`,
      headers: headers(OTHER_TENANT),
    });
    expect(other.statusCode).toBe(404);
  });
});

describe("GET /api/v1/networks 登录账号字段（密码只写不读）", () => {
  it("返回用户名明文 + 密码已设置布尔值 + 到期时间，永不回显密码", async () => {
    const ctx: Ctx = { networks: [], offers: [], pulls: [] };
    const secret = encryptApiKey("topsecret", PEPPER);
    ctx.networks.push({
      id: NETWORK,
      tenantId: TENANT,
      name: "YP",
      kind: "yeahpromos",
      website: null,
      apiConfigured: false,
      apiKeyRef: null,
      apiBaseUrl: null,
      lastPullAt: null,
      pullStatus: "NEVER",
      pullError: null,
      status: "ACTIVE",
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      syncMode: "session",
      sessionRef: null,
      sessionStatus: "OK",
      sessionUsername: "myuser",
      sessionPasswordRef: secret,
      sessionValidDays: 30,
      lastLoginAt: new Date("2026-10-01T00:00:00.000Z"),
    });
    const app = await buildApp(ctx);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/networks",
      headers: headers(),
    });
    expect(res.statusCode).toBe(200);
    const n = res.json().networks[0];
    // 用户名明文可显示
    expect(n.sessionUsername).toBe("myuser");
    // 密码永不回显：只有"是否已设置"布尔值
    expect(n.sessionPasswordSet).toBe(true);
    expect(n.sessionPasswordRef).toBeUndefined();
    expect(n.sessionPassword).toBeUndefined();
    expect(JSON.stringify(n)).not.toContain("topsecret");
    // 有效期/到期时间展示
    expect(n.sessionValidDays).toBe(30);
    expect(n.lastLoginAt).toBe("2026-10-01T00:00:00.000Z");
    expect(n.sessionExpiresAt).toBe("2026-10-31T00:00:00.000Z");
  });

  it("未设置密码 → sessionPasswordSet 为 false", async () => {
    const ctx: Ctx = { networks: [], offers: [], pulls: [] };
    ctx.networks.push({
      id: NETWORK,
      tenantId: TENANT,
      name: "YP",
      kind: "yeahpromos",
      website: null,
      apiConfigured: false,
      apiKeyRef: null,
      apiBaseUrl: null,
      lastPullAt: null,
      pullStatus: "NEVER",
      pullError: null,
      status: "ACTIVE",
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      syncMode: "session",
      sessionRef: null,
      sessionStatus: "NEVER",
      sessionUsername: null,
      sessionPasswordRef: null,
      sessionValidDays: null,
      lastLoginAt: null,
    });
    const app = await buildApp(ctx);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/networks",
      headers: headers(),
    });
    const n = res.json().networks[0];
    expect(n.sessionPasswordSet).toBe(false);
    expect(n.sessionUsername).toBeNull();
    expect(n.sessionExpiresAt).toBeNull();
  });
});
