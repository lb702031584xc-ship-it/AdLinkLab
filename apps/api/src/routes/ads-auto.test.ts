/**
 * 功能2 — 自动化广告：preview/confirm 全流程路由测试。
 * In-memory fake Prisma + Fastify inject，fake LLM / fake 页面抓取。
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
  assertAiSettingsPepperConfigured,
  encryptSecret,
} from "../ai/crypto.js";
import {
  CREATE_CAMPAIGN_TASK_TYPE,
  createPlanStore,
  registerAdsAutoRoutes,
} from "./ads-auto.js";
import type { PlanStore } from "../ai/ad-generator.js";

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
  const aiSettings: Row[] = [];
  const integrations: Row[] = [];
  const targets: Row[] = [];
  const auditLogs: Row[] = [];
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
    aiSetting: { findMany: async () => [...aiSettings] },
    googleAdsScriptIntegration: mkStore(integrations),
    scriptSyncTarget: mkStore(targets),
    auditLog: mkStore(auditLogs),
    _rows: { tenants, users, sessions, aiSettings, integrations, targets, auditLogs },
  };
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

function cookie(token: string) {
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

async function seedAuth(fake: FakePrisma, role: "admin" | "member" = "member") {
  const tenantId = randomUUID();
  await (fake as any).tenant.create({
    data: { id: tenantId, name: `${role}@t`, slug: `u-${role}`, status: "ACTIVE" },
  });
  const user = await (fake as any).user.create({
    data: {
      id: randomUUID(),
      tenantId,
      email: `${role}@example.com`,
      name: role,
      role,
      status: "ACTIVE",
    },
  });
  const session = await createSession(fake as unknown as PrismaClient, user.id);
  return { tenantId, user, token: session.token };
}

function seedAiSettings(fake: FakePrisma) {
  const pepper = assertAiSettingsPepperConfigured();
  fake._rows.aiSettings.push(
    { key: "llm.baseUrl", value: "https://fake-llm.example/v1" },
    { key: "llm.model", value: "fake-model" },
    { key: "llm.apiKeyEnc", value: encryptSecret("fake-key", pepper) }
  );
}

function fakeDraft() {
  return {
    campaignName: "Route Test Campaign",
    dailyBudget: { amount: 25, currency: "USD" },
    geoTargets: ["US"],
    bidding: { strategy: "MANUAL_CPC", maxCpc: 1.0 },
    brandTerms: ["acme"],
    adGroupName: "Route Test Group",
    keywords: [
      { text: "buy test widgets", matchType: "EXACT" },
      { text: "acme widgets cheap", matchType: "BROAD" },
    ],
    suggestedNegatives: ["free"],
    headlines: Array.from({ length: 15 }, (_, i) => `H${i + 1} test headline`),
    descriptions: Array.from({ length: 4 }, (_, i) => `Test description ${i + 1} for the ad.`),
    path1: null,
    path2: null,
  };
}

async function buildApp(fake: FakePrisma, planStore?: PlanStore) {
  const app = Fastify();
  app.setErrorHandler(createObservabilityErrorHandler() as any);
  await registerAdsAutoRoutes(app, {
    prisma: fake as unknown as PrismaClient,
    chatJsonImpl: (async () => fakeDraft()) as any,
    fetchPageImpl: (async (url: string) => ({
      finalUrl: url,
      text: "Test offer page text about widgets, price $49.",
    })) as any,
    planStore: planStore ?? createPlanStore(),
  });
  return app;
}

describe("POST /api/v1/ads/auto-create", () => {
  let fake: FakePrisma;
  let token: string;
  let tenantId: string;

  beforeEach(async () => {
    fake = makeFakePrisma();
    const auth = await seedAuth(fake);
    token = auth.token;
    tenantId = auth.tenantId;
    seedAiSettings(fake);
  });

  it("requires authentication", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ads/auto-create",
      payload: { urls: ["https://m.example/offer"] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects empty / too many / invalid urls", async () => {
    const app = await buildApp(fake);
    const headers = cookie(token);
    for (const payload of [
      { urls: [] },
      { urls: ["https://a.example", "https://b.example", "https://c.example", "https://d.example", "https://e.example", "https://f.example"] },
      { urls: ["not-a-url"] },
      { urls: ["ftp://m.example/offer"] },
    ]) {
      const res = await app.inject({ method: "POST", url: "/api/v1/ads/auto-create", headers, payload });
      expect(res.statusCode).toBe(400);
    }
  });

  it("returns a preview plan with 15 headlines / 4 descriptions", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ads/auto-create",
      headers: cookie(token),
      payload: { urls: ["https://merchant.example/offer1", "https://merchant.example/offer2"] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.planId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.plan.campaign.name).toBe("Route Test Campaign");
    expect(body.plan.campaign.dailyBudget.amount).toBe(25);
    expect(body.plan.campaign.status).toBe("PAUSED");
    expect(body.plan.adGroups).toHaveLength(2);
    const block = body.plan.adGroups[0];
    expect(block.rsa.headlines).toHaveLength(15);
    expect(block.rsa.descriptions).toHaveLength(4);
    // "acme widgets cheap" conflicts with brand term "acme" → moved to negatives.
    expect(block.group.keywords).toHaveLength(1);
    expect(block.group.keywords[0].text).toBe("buy test widgets");
    // brand-check negatives: "acme widgets cheap" contains brand term "acme".
    const negTexts = block.group.negativeKeywords.map(
      (n: any) => `${n.matchType}:${n.text}`
    );
    expect(negTexts).toContain("EXACT:acme widgets cheap");
    expect(negTexts).toContain("PHRASE:acme widgets cheap");
    expect(negTexts).toContain("PHRASE:free");
    expect(body.plan.dataQuality).toBe("PREDICTED");
    expect(body.plan.tenantId).toBe(tenantId);
  });

  it("pageTexts skips the page fetch (manual text for anti-scraping sites)", async () => {
    let fetchCalls = 0;
    const app = Fastify();
    app.setErrorHandler(createObservabilityErrorHandler() as any);
    await registerAdsAutoRoutes(app, {
      prisma: fake as unknown as PrismaClient,
      chatJsonImpl: (async () => fakeDraft()) as any,
      fetchPageImpl: (async (url: string) => {
        fetchCalls++;
        return { finalUrl: url, text: "should not be used" };
      }) as any,
      planStore: createPlanStore(),
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ads/auto-create",
      headers: cookie(token),
      payload: {
        urls: ["https://www.amazon.com/dp/EXAMPLE"],
        pageTexts: ["Manual product title, price $99, great vacuum."],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(fetchCalls).toBe(0);
    expect(res.json().plan.adGroups).toHaveLength(1);
  });

  it("copyStyle=official flows into the plan", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ads/auto-create",
      headers: cookie(token),
      payload: {
        urls: ["https://merchant.example/offer1"],
        copyStyle: "official",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().plan.copyStyle).toBe("official");
  });

  it("copyStyle defaults to affiliate", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ads/auto-create",
      headers: cookie(token),
      payload: { urls: ["https://merchant.example/offer1"] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().plan.copyStyle).toBe("affiliate");
  });

  it("user keywords override AI-generated keywords", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ads/auto-create",
      headers: cookie(token),
      payload: {
        urls: ["https://merchant.example/offer1"],
        keywords: [
          { text: "merach vibration plate", matchType: "phrase" },
          { text: "vibration plate machine", matchType: "exact" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const group = res.json().plan.adGroups[0].group;
    expect(group.keywordsSource).toBe("user");
    const texts = group.keywords.map((k: any) => k.text);
    expect(texts).toContain("merach vibration plate");
    expect(texts).toContain("vibration plate machine");
    // AI 生成的词不应出现
    expect(texts).not.toContain("buy test widgets");
  });

  it("fails when AI is not configured", async () => {
    const bare = makeFakePrisma();
    const auth = await seedAuth(bare);
    const app = await buildApp(bare);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ads/auto-create",
      headers: cookie(auth.token),
      payload: { urls: ["https://m.example/offer"] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code ?? res.json().error).toBeDefined();
  });
});

describe("POST /api/v1/ads/auto-create/confirm", () => {
  let fake: FakePrisma;
  let token: string;
  let tenantId: string;
  let planStore: PlanStore;
  let planId: string;

  async function preview(): Promise<string> {
    const app = await buildApp(fake, planStore);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ads/auto-create",
      headers: cookie(token),
      payload: { urls: ["https://merchant.example/offer"] },
    });
    expect(res.statusCode).toBe(200);
    return res.json().planId as string;
  }

  beforeEach(async () => {
    fake = makeFakePrisma();
    const auth = await seedAuth(fake);
    token = auth.token;
    tenantId = auth.tenantId;
    seedAiSettings(fake);
    planStore = createPlanStore();
    planId = await preview();
  });

  it("queues a create-campaign ScriptSyncTarget and writes an AuditLog", async () => {
    const googleAccountId = randomUUID();
    await (fake as any).googleAdsScriptIntegration.create({
      data: {
        id: randomUUID(),
        tenantId,
        googleAccountId,
        name: "Test integration",
        status: "ACTIVE",
        tokenKeyId: "k1",
        tokenPrefix: "alk_s_ab12",
        tokenHash: "hash-1",
      },
    });

    const app = await buildApp(fake, planStore);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ads/auto-create/confirm",
      headers: cookie(token),
      payload: { planId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.taskType).toBe(CREATE_CAMPAIGN_TASK_TYPE);
    expect(body.taskType).toBe("create-campaign");
    expect(body.status).toBe("QUEUED");
    expect(body.alreadyQueued).toBe(false);
    expect(body.targetId).toBeDefined();

    const targets = await (fake as any).scriptSyncTarget.findMany({});
    expect(targets).toHaveLength(1);
    expect(targets[0].entityType).toBe("CAMPAIGN");
    expect(targets[0].entityId).toBe(planId);
    expect(targets[0].desiredVersion).toBe(1);

    const logs = await (fake as any).auditLog.findMany({});
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("ADS_AUTO_CREATE_CONFIRMED");
    expect(logs[0].entityType).toBe("ScriptSyncTarget");
    expect(logs[0].after.taskType).toBe("create-campaign");

    // Confirming again is idempotent.
    const res2 = await app.inject({
      method: "POST",
      url: "/api/v1/ads/auto-create/confirm",
      headers: cookie(token),
      payload: { planId },
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().alreadyQueued).toBe(true);
    expect(res2.json().targetId).toBe(body.targetId);
    expect(await (fake as any).scriptSyncTarget.count({})).toBe(1);
  });

  it("rejects confirm when no Script integration exists", async () => {
    const app = await buildApp(fake, planStore);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ads/auto-create/confirm",
      headers: cookie(token),
      payload: { planId },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects unknown planId", async () => {
    const app = await buildApp(fake, planStore);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ads/auto-create/confirm",
      headers: cookie(token),
      payload: { planId: randomUUID() },
    });
    expect(res.statusCode).toBe(410);
  });

  it("applies preview budget + geo overrides to the plan and audit log", async () => {
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
    const app = await buildApp(fake, planStore);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ads/auto-create/confirm",
      headers: cookie(token),
      payload: { planId, dailyBudget: 50, geoTargets: ["US", "CA"] },
    });
    expect(res.statusCode).toBe(200);
    const stored = planStore.get(planId);
    expect(stored?.plan.campaign.dailyBudget.amount).toBe(50);
    expect(stored?.plan.campaign.geoTargets).toEqual(["US", "CA"]);
    const logs = await (fake as any).auditLog.findMany({});
    expect(logs[0].after.dailyBudget.amount).toBe(50);
  });

  it("rejects invalid budget / geo overrides", async () => {
    const app = await buildApp(fake, planStore);
    for (const payload of [
      { planId, dailyBudget: 0 },
      { planId, dailyBudget: -10 },
      { planId, dailyBudget: "abc" },
      { planId, geoTargets: [] },
      { planId, geoTargets: ["US", "XX"] },
      { planId, geoTargets: ["US", "GB", "CA", "AU", "DE", "FR"] },
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/ads/auto-create/confirm",
        headers: cookie(token),
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
    // Failed overrides leave the plan untouched.
    const stored = planStore.get(planId);
    expect(stored?.plan.campaign.dailyBudget.amount).toBe(25);
    expect(stored?.plan.campaign.geoTargets).toEqual(["US"]);
  });
});

describe("GET copy-pack and script", () => {
  let fake: FakePrisma;
  let token: string;
  let planStore: PlanStore;
  let planId: string;

  beforeEach(async () => {
    fake = makeFakePrisma();
    const auth = await seedAuth(fake);
    token = auth.token;
    seedAiSettings(fake);
    planStore = createPlanStore();
    const app = await buildApp(fake, planStore);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ads/auto-create",
      headers: cookie(token),
      payload: { urls: ["https://merchant.example/offer"] },
    });
    planId = res.json().planId;
  });

  it("copy-pack is plain text marked for Amazon/manual placement", async () => {
    const app = await buildApp(fake, planStore);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/ads/auto-create/${planId}/copy-pack`,
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.body).toContain("Amazon/手动投放用，需手动创建");
    expect(res.body).toContain("[buy test widgets]");
    expect(res.body).toContain("[RSA 标题 × 15]");
    expect(res.body).toContain("[RSA 描述 × 4]");
  });

  it("script endpoint returns the create-campaign Script source", async () => {
    const app = await buildApp(fake, planStore);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/ads/auto-create/${planId}/script`,
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.planId).toBe(planId);
    expect(body.source).toContain("Route Test Campaign");
    expect(body.source).toContain("create-campaign");
    expect(body.source).toContain('status: "PAUSED"');
  });

  it("tenant isolation: another tenant cannot read the plan", async () => {
    const other = await seedAuth(fake);
    const app = await buildApp(fake, planStore);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/ads/auto-create/${planId}/copy-pack`,
      headers: cookie(other.token),
    });
    expect(res.statusCode).toBe(404);
  });
});
