/**
 * 清单 #3 — 品牌词分级管理路由测试。
 * In-memory fake Prisma + Fastify inject. Auth: requireTenant in "disabled"
 * mode reads the tenant from the x-tenant-id header (existing test-compat
 * path, same as budget-rules.test.ts); tenant isolation is asserted with a
 * second tenant header.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import { registerBrandKeywordRoutes } from "./brand-keywords.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";

interface Ctx {
  keywords: any[];
}

function buildApp(ctx: Ctx) {
  let seq = 0;
  const fake = {
    brandKeyword: {
      create: async (args: any) => {
        const row = {
          ...args.data,
          warningCount: args.data.warningCount ?? 0,
          lastWarningKind: null,
          lastWarningAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          _seq: ++seq,
        };
        ctx.keywords.push(row);
        return row;
      },
      findFirst: async (args: any) =>
        ctx.keywords.find(
          (r) =>
            (!args.where.id || r.id === args.where.id) &&
            (!args.where.tenantId || r.tenantId === args.where.tenantId)
        ) ?? null,
      findMany: async (args: any) =>
        ctx.keywords
          .filter(
            (r) => !args.where.tenantId || r.tenantId === args.where.tenantId
          )
          .sort((a, b) => b._seq - a._seq),
      update: async (args: any) => {
        const row = ctx.keywords.find((r) => r.id === args.where.id);
        if (!row) throw new Error("not found");
        for (const [k, v] of Object.entries(args.data)) {
          if (
            k === "warningCount" &&
            v &&
            typeof v === "object" &&
            "increment" in (v as any)
          ) {
            row.warningCount += (v as any).increment;
          } else {
            row[k] = v;
          }
        }
        return row;
      },
    },
  };

  const app = Fastify({ logger: false });
  const services = { prisma: fake as unknown as PrismaClient };
  const auth = { mode: "disabled" as const, registry: [] };
  return registerBrandKeywordRoutes(app, services, auth).then(() => app);
}

function headers(tenant = TENANT) {
  return { "content-type": "application/json", "x-tenant-id": tenant };
}

describe("brand-keywords routes", () => {
  it("POST creates ACTIVE + biddingEnabled; GET lists only own tenant's words", async () => {
    const ctx: Ctx = { keywords: [] };
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/brand-keywords",
      headers: headers(),
      payload: { keyword: "roborock", brand: "Roborock" },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json().keyword;
    expect(created.status).toBe("ACTIVE");
    expect(created.biddingEnabled).toBe(true);
    expect(created.warningCount).toBe(0);

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/brand-keywords",
      headers: headers(),
    });
    expect(list.json().keywords).toHaveLength(1);

    const other = await app.inject({
      method: "GET",
      url: "/api/v1/brand-keywords",
      headers: headers(OTHER_TENANT),
    });
    expect(other.json().keywords).toHaveLength(0);
  });

  it("POST rejects an empty keyword", async () => {
    const ctx: Ctx = { keywords: [] };
    const app = await buildApp(ctx);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/brand-keywords",
      headers: headers(),
      payload: { keyword: "   " },
    });
    expect(res.statusCode).toBe(400);
  });

  it("first warning downgrades immediately; later warnings keep downgrade and keep counting", async () => {
    const ctx: Ctx = { keywords: [] };
    const app = await buildApp(ctx);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/brand-keywords",
      headers: headers(),
      payload: { keyword: "vevor" },
    });
    const id = created.json().keyword.id;

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/brand-keywords/${id}/warning`,
      headers: headers(),
      payload: { kind: "ADVERTISER_REJECT" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().keyword).toMatchObject({
      status: "DOWNGRADED",
      biddingEnabled: false,
      warningCount: 1,
      lastWarningKind: "ADVERTISER_REJECT",
    });
    expect(first.json().keyword.lastWarningAt).toBeTruthy();

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/brand-keywords/${id}/warning`,
      headers: headers(),
      payload: { kind: "NETWORK_WARNING" },
    });
    expect(second.json().keyword).toMatchObject({
      status: "DOWNGRADED",
      biddingEnabled: false,
      warningCount: 2,
      lastWarningKind: "NETWORK_WARNING",
    });
  });

  it("reenable restores ACTIVE + bidding but keeps the warning history", async () => {
    const id = randomUUID();
    const ctx: Ctx = {
      keywords: [
        {
          id,
          tenantId: TENANT,
          keyword: "vevor",
          brand: null,
          offerId: null,
          biddingEnabled: false,
          status: "DOWNGRADED",
          warningCount: 1,
          lastWarningKind: "OTHER",
          lastWarningAt: new Date(),
        },
      ],
    };
    const app = await buildApp(ctx);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/brand-keywords/${id}/reenable`,
      headers: headers(),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().keyword).toMatchObject({
      status: "ACTIVE",
      biddingEnabled: true,
      warningCount: 1,
      lastWarningKind: "OTHER",
    });
  });

  it("PATCH edits switch/status/brand; other tenant gets 404; bad status/kind rejected", async () => {
    const id = randomUUID();
    const ctx: Ctx = {
      keywords: [
        {
          id,
          tenantId: TENANT,
          keyword: "roborock",
          brand: "Roborock",
          offerId: null,
          biddingEnabled: true,
          status: "ACTIVE",
          warningCount: 0,
          lastWarningKind: null,
          lastWarningAt: null,
        },
      ],
    };
    const app = await buildApp(ctx);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/brand-keywords/${id}`,
      headers: headers(),
      payload: { biddingEnabled: false, status: "PAUSED", brand: "Roborock EU" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().keyword).toMatchObject({
      biddingEnabled: false,
      status: "PAUSED",
      brand: "Roborock EU",
    });

    const forbidden = await app.inject({
      method: "PATCH",
      url: `/api/v1/brand-keywords/${id}`,
      headers: headers(OTHER_TENANT),
      payload: { biddingEnabled: true },
    });
    expect(forbidden.statusCode).toBe(404);

    const badStatus = await app.inject({
      method: "PATCH",
      url: `/api/v1/brand-keywords/${id}`,
      headers: headers(),
      payload: { status: "BANNED" },
    });
    expect(badStatus.statusCode).toBe(400);

    const badKind = await app.inject({
      method: "POST",
      url: `/api/v1/brand-keywords/${id}/warning`,
      headers: headers(),
      payload: { kind: "SPAM" },
    });
    expect(badKind.statusCode).toBe(400);
  });
});
