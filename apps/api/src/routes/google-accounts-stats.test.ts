/**
 * Google Ads campaign-stats route tests. In-memory fake Prisma (session
 * auth only) + stub stats service + Fastify inject.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import {
  SESSION_COOKIE_NAME,
  createSession,
} from "../auth/sessions.js";
import { createObservabilityErrorHandler } from "../observability/index.js";
import { registerGoogleAccountsStatsRoutes } from "./google-accounts-stats.js";

type Row = Record<string, any>;

interface Ctx {
  tenants: Row[];
  users: Row[];
  sessions: Row[];
}

function baseCtx(): Ctx {
  return { tenants: [], users: [], sessions: [] };
}

function makeFake(ctx: Ctx) {
  return {
    tenant: {
      create: async (args: any) => {
        const row = { ...args.data };
        ctx.tenants.push(row);
        return row;
      },
      findUnique: async (args: any) =>
        ctx.tenants.find((t) => t.id === args.where.id) ?? null,
    },
    user: {
      create: async (args: any) => {
        const row = { ...args.data };
        ctx.users.push(row);
        return row;
      },
      findUnique: async (args: any) =>
        ctx.users.find((u) => u.id === args.where.id) ?? null,
    },
    session: {
      create: async (args: any) => {
        const row = { ...args.data };
        ctx.sessions.push(row);
        return row;
      },
      findUnique: async (args: any) => {
        const row = ctx.sessions.find(
          (s) => s.tokenHash === args.where.tokenHash
        );
        if (!row) return null;
        return {
          ...row,
          user: ctx.users.find((u) => u.id === row.userId) ?? null,
        };
      },
      delete: async (args: any) => {
        const idx = ctx.sessions.findIndex((s) => s.id === args.where.id);
        if (idx >= 0) ctx.sessions.splice(idx, 1);
        return { id: args.where.id };
      },
    },
    tokenRevocation: {
      findUnique: async () => null,
    },
  } as unknown as PrismaClient;
}

type FakePrisma = ReturnType<typeof makeFake>;

function cookie(token: string) {
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

describe("google-accounts campaign-stats routes", () => {
  let ctx: Ctx;
  let fake: FakePrisma;
  let app: any;
  let auth: { tenantId: string; token: string };
  let accountId: string;
  let lastInput: any;

  beforeEach(async () => {
    ctx = baseCtx();
    fake = makeFake(ctx);
    lastInput = undefined;
    const stubStats = {
      getCampaignStats: async (input: any) => {
        lastInput = input;
        return {
          accountId: input.googleAccountId,
          customerId: "1234567890",
          provider: "mock",
          currency: "CNY",
          startDate: input.startDate,
          endDate: input.endDate,
          stats: [
            {
              campaignId: "111",
              campaignName: "Alpha",
              impressions: 150,
              clicks: 7,
              costMicros: 1500000,
              conversions: 1,
            },
          ],
        };
      },
    };
    app = Fastify({ logger: false });
    app.setErrorHandler(createObservabilityErrorHandler());
    await registerGoogleAccountsStatsRoutes(app, {
      prisma: fake,
      googleAdsStats: stubStats as never,
    });

    const tenantId = randomUUID();
    await (fake as any).tenant.create({
      data: { id: tenantId, name: "t", slug: `t-${tenantId.slice(0, 8)}`, status: "ACTIVE" },
    });
    const user = await (fake as any).user.create({
      data: {
        id: randomUUID(),
        tenantId,
        email: "member@example.com",
        name: "member",
        role: "member",
        status: "ACTIVE",
      },
    });
    const session = await createSession(fake, user.id);
    auth = { tenantId, token: session.token };
    accountId = randomUUID();
  });

  function getStats(
    query: string,
    id: string = accountId,
    token?: string
  ) {
    return app.inject({
      method: "GET",
      url: `/api/v1/google-accounts/${id}/campaign-stats${query}`,
      headers: token === undefined ? {} : cookie(token),
    });
  }

  it("returns provider stats for a valid range", async () => {
    const res = await getStats(
      "?startDate=2026-10-20&endDate=2026-10-27",
      accountId,
      auth.token
    );
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.provider).toBe("mock");
    expect(body.customerId).toBe("1234567890");
    expect(body.stats).toHaveLength(1);
    expect(body.stats[0].campaignId).toBe("111");
    expect(body.stats[0].costMicros).toBe(1500000);
    expect(lastInput.tenantId).toBe(auth.tenantId);
    expect(lastInput.googleAccountId).toBe(accountId);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await getStats("?startDate=2026-10-20&endDate=2026-10-27");
    expect(res.statusCode).toBe(401);
  });

  it("rejects bad dates and non-UUID ids", async () => {
    const badRange = await getStats(
      "?startDate=2026-10-27&endDate=2026-10-20",
      accountId,
      auth.token
    );
    expect(badRange.statusCode).toBe(400);
    const badFormat = await getStats(
      "?startDate=10/20/2026&endDate=2026-10-27",
      accountId,
      auth.token
    );
    expect(badFormat.statusCode).toBe(400);
    const badId = await getStats(
      "?startDate=2026-10-20&endDate=2026-10-27",
      "not-a-uuid",
      auth.token
    );
    expect(badId.statusCode).toBe(400);
    const badCampaign = await getStats(
      "?startDate=2026-10-20&endDate=2026-10-27&campaignIds=abc",
      accountId,
      auth.token
    );
    expect(badCampaign.statusCode).toBe(400);
  });
});
