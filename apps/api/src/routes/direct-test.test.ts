/**
 * 直链速测 API 路由测试。
 * In-memory fake Prisma + Fastify inject，不连真实库。
 * 认证与 ads-auto.test.ts 同款：fake session + alk_session cookie。
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
import {
  createDirectTestStore,
  registerDirectTestRoutes,
  type DirectTestPlanStore,
} from "./direct-test.js";

type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v === null || v === undefined) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}

function mkStore(rows: Row[]) {
  return {
    findFirst: async ({ where }: any) =>
      rows.filter((r) => matches(r, where))[0] ?? null,
    findMany: async ({ where }: any) =>
      rows.filter((r) => matches(r, where)).map((r) => ({ ...r })),
    create: async ({ data }: any) => {
      const row = {
        id: data.id ?? randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...data,
      };
      rows.push(row);
      return { ...row };
    },
    count: async ({ where }: any) => rows.filter((r) => matches(r, where)).length,
  };
}

function makeFakePrisma() {
  const tenants: Row[] = [];
  const users: Row[] = [];
  const sessions: Row[] = [];
  const integrations: Row[] = [];
  const targets: Row[] = [];
  const googleAccounts: Row[] = [];
  return {
    tenant: mkStore(tenants),
    user: mkStore(users),
    session: {
      create: async ({ data }: any) => {
        const row = { createdAt: new Date(), ...data };
        sessions.push(row);
        return { ...row };
      },
      findUnique: async ({ where, include }: any) => {
        const row = sessions.find((r) => matches(r, where)) ?? null;
        if (!row) return null;
        const out = { ...row };
        if (include?.user) {
          out.user = users.find((u) => u.id === row.userId) ?? null;
        }
        return out;
      },
    },
    googleAdsScriptIntegration: mkStore(integrations),
    scriptSyncTarget: mkStore(targets),
    googleAccount: mkStore(googleAccounts),
    _rows: { tenants, users, sessions, integrations, targets, googleAccounts },
  };
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

function cookie(token: string) {
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

async function seedAuth(fake: FakePrisma) {
  const tenantId = randomUUID();
  await (fake as any).tenant.create({
    data: { id: tenantId, name: "t", slug: `u-${tenantId.slice(0, 8)}`, status: "ACTIVE" },
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
  const session = await createSession(fake as unknown as PrismaClient, user.id);
  return { tenantId, user, token: session.token };
}

async function buildApp(fake: FakePrisma, planStore?: DirectTestPlanStore) {
  const app = Fastify();
  app.setErrorHandler(createObservabilityErrorHandler() as any);
  await registerDirectTestRoutes(app, {
    prisma: fake as unknown as PrismaClient,
    planStore: planStore ?? createDirectTestStore(),
  });
  return app;
}

async function seedIntegration(fake: FakePrisma, tenantId: string) {
  await (fake as any).googleAdsScriptIntegration.create({
    data: {
      id: randomUUID(),
      tenantId,
      googleAccountId: randomUUID(),
      name: "Test integration",
      status: "ACTIVE",
      tokenKeyId: "k1",
      tokenPrefix: "alk_s_ab12",
      tokenHash: "hash-1",
    },
  });
}

describe("POST /api/v1/direct-test", () => {
  let fake: FakePrisma;
  let token: string;
  let tenantId: string;
  let planStore: DirectTestPlanStore;

  beforeEach(async () => {
    fake = makeFakePrisma();
    const auth = await seedAuth(fake);
    token = auth.token;
    tenantId = auth.tenantId;
    planStore = createDirectTestStore();
  });

  it("requires authentication", async () => {
    const app = await buildApp(fake, planStore);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/direct-test",
      payload: { finalUrl: "https://merchant.example/offer" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects invalid URLs with 400", async () => {
    const app = await buildApp(fake, planStore);
    for (const payload of [
      {},
      { finalUrl: "" },
      { finalUrl: "not-a-url" },
      { finalUrl: "ftp://merchant.example/offer" },
      { finalUrl: "https://merchant.example/offer", offerId: "not-a-uuid" },
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/direct-test",
        headers: cookie(token),
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it("creates a DRAFT plan and lists it newest first", async () => {
    const app = await buildApp(fake, planStore);
    const offerId = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/direct-test",
      headers: cookie(token),
      payload: { finalUrl: "https://merchant.example/offer", offerId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.planId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.plan.status).toBe("DRAFT");
    expect(body.plan.tenantId).toBe(tenantId);
    expect(body.plan.finalUrl).toBe("https://merchant.example/offer");
    expect(body.plan.offerId).toBe(offerId);
    expect(body.plan.landingPageLinked).toBe(false);
    expect(body.finalUrl).toBe("https://merchant.example/offer");
    expect(body.suggestedCampaignName).toContain("merchant.example");
    expect(body.expiresInSeconds).toBe(2 * 60 * 60);

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/direct-test/plans",
      headers: cookie(token),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().plans).toHaveLength(1);
    expect(list.json().plans[0].planId).toBe(body.planId);
  });
});

describe("POST /api/v1/direct-test/:planId/confirm", () => {
  let fake: FakePrisma;
  let token: string;
  let tenantId: string;
  let planStore: DirectTestPlanStore;
  let planId: string;

  beforeEach(async () => {
    fake = makeFakePrisma();
    const auth = await seedAuth(fake);
    token = auth.token;
    tenantId = auth.tenantId;
    planStore = createDirectTestStore();
    const app = await buildApp(fake, planStore);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/direct-test",
      headers: cookie(token),
      payload: { finalUrl: "https://merchant.example/offer" },
    });
    expect(res.statusCode).toBe(200);
    planId = res.json().planId;
  });

  it("returns 410 for an unknown plan", async () => {
    const app = await buildApp(fake, planStore);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/direct-test/${randomUUID()}/confirm`,
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(410);
  });

  it("returns 410 for an expired plan", async () => {
    const shortStore = createDirectTestStore(1);
    const app = await buildApp(fake, shortStore);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/direct-test",
      headers: cookie(token),
      payload: { finalUrl: "https://merchant.example/offer" },
    });
    const shortPlanId = res.json().planId;
    await new Promise((r) => setTimeout(r, 5));
    const confirm = await app.inject({
      method: "POST",
      url: `/api/v1/direct-test/${shortPlanId}/confirm`,
      headers: cookie(token),
    });
    expect(confirm.statusCode).toBe(410);
  });

  it("rejects confirm when no Script integration exists", async () => {
    const app = await buildApp(fake, planStore);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/direct-test/${planId}/confirm`,
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(400);
  });

  it("queues a create-campaign ScriptSyncTarget and marks CONFIRMED", async () => {
    await seedIntegration(fake, tenantId);
    const app = await buildApp(fake, planStore);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/direct-test/${planId}/confirm`,
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.taskType).toBe("create-campaign");
    expect(body.status).toBe("QUEUED");
    expect(body.alreadyQueued).toBe(false);
    expect(body.targetId).toBeDefined();
    expect(body.plan.status).toBe("CONFIRMED");

    const targets = await (fake as any).scriptSyncTarget.findMany({});
    expect(targets).toHaveLength(1);
    expect(targets[0].entityType).toBe("CAMPAIGN");
    expect(targets[0].entityId).toBe(planId);
    expect(targets[0].desiredVersion).toBe(1);

    // Confirming again is idempotent.
    const res2 = await app.inject({
      method: "POST",
      url: `/api/v1/direct-test/${planId}/confirm`,
      headers: cookie(token),
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().alreadyQueued).toBe(true);
    expect(res2.json().targetId).toBe(body.targetId);
    expect(await (fake as any).scriptSyncTarget.count({})).toBe(1);
  });

  it("tenant isolation: another tenant gets 404, not 410", async () => {
    const other = await seedAuth(fake);
    const app = await buildApp(fake, planStore);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/direct-test/${planId}/confirm`,
      headers: cookie(other.token),
    });
    expect(res.statusCode).toBe(404);
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/direct-test/plans",
      headers: cookie(other.token),
    });
    expect(list.json().plans).toHaveLength(0);
  });
});

describe("POST /api/v1/direct-test/:planId/upgrade", () => {
  let fake: FakePrisma;
  let token: string;
  let tenantId: string;
  let planStore: DirectTestPlanStore;
  let planId: string;

  beforeEach(async () => {
    fake = makeFakePrisma();
    const auth = await seedAuth(fake);
    token = auth.token;
    tenantId = auth.tenantId;
    planStore = createDirectTestStore();
    const app = await buildApp(fake, planStore);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/direct-test",
      headers: cookie(token),
      payload: { finalUrl: "https://merchant.example/offer" },
    });
    planId = res.json().planId;
  });

  it("links a landing page and states the Script target is untouched", async () => {
    const app = await buildApp(fake, planStore);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/direct-test/${planId}/upgrade`,
      headers: cookie(token),
      payload: { landingPageId: randomUUID() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan.landingPageLinked).toBe(true);
    expect(body.plan.landingPageId).toBeTruthy();
    expect(body.scriptSyncUpdated).toBe(false);
    expect(body.scriptSyncNote).toBeTruthy();
    expect(body.targetId).toBeNull();
  });

  it("after confirm, upgrade still only records the association", async () => {
    await seedIntegration(fake, tenantId);
    const app = await buildApp(fake, planStore);
    const confirm = await app.inject({
      method: "POST",
      url: `/api/v1/direct-test/${planId}/confirm`,
      headers: cookie(token),
    });
    expect(confirm.statusCode).toBe(200);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/direct-test/${planId}/upgrade`,
      headers: cookie(token),
      payload: { landingPageId: randomUUID() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().plan.landingPageLinked).toBe(true);
    expect(res.json().scriptSyncUpdated).toBe(false);
    expect(res.json().targetId).toBe(confirm.json().targetId);
    expect(await (fake as any).scriptSyncTarget.count({})).toBe(1);
  });

  it("rejects a missing landingPageId and an unknown plan", async () => {
    const app = await buildApp(fake, planStore);
    const empty = await app.inject({
      method: "POST",
      url: `/api/v1/direct-test/${planId}/upgrade`,
      headers: cookie(token),
      payload: {},
    });
    expect(empty.statusCode).toBe(400);
    const unknown = await app.inject({
      method: "POST",
      url: `/api/v1/direct-test/${randomUUID()}/upgrade`,
      headers: cookie(token),
      payload: { landingPageId: randomUUID() },
    });
    expect(unknown.statusCode).toBe(410);
  });
});
