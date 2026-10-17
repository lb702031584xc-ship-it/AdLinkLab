/**
 * Phase 12 (P0 anti-ban) — offer TERMS parsing + batch screening +
 * direct-link compliance URL checker.
 * In-memory fake Prisma (no live DB) + Fastify inject, mirroring ai.test.ts.
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
import { AiError } from "./llm.js";
import { encryptSecret } from "./crypto.js";
import {
  checkUrlVerdict,
  detectAffiliateParams,
  isOwnedDomain,
  normalizeOwnedDomain,
  registrableDomain,
} from "./compliance.js";
import {
  buildTermsPrompt,
  validateTermsShape,
  type TermsShape,
} from "./prompts.js";
import { registerAiRoutes } from "../routes/ai.js";
import { TEST_AI_SETTINGS_PEPPER } from "./crypto.js";

// ---------------------------------------------------------------------------
// Fake Prisma (same shape as ai.test.ts)
// ---------------------------------------------------------------------------

type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v !== null && typeof v === "object") return false;
    return row[k] === v;
  });
}

function makeFakePrisma() {
  const tenants: Row[] = [];
  const users: Row[] = [];
  const sessions: Row[] = [];
  const aiSettings: Row[] = [];
  const aiAnalyses: Row[] = [];

  const user = {
    findFirst: async ({ where }: any) =>
      users.find((r) => matches(r, where)) ?? null,
    create: async ({ data }: any) => {
      const row = { ...data };
      users.push(row);
      return { ...row };
    },
  };
  const tenant = {
    findUnique: async ({ where }: any) =>
      tenants.find((r) => matches(r, where)) ?? null,
    create: async ({ data }: any) => {
      const row = { ...data };
      tenants.push(row);
      return { ...row };
    },
  };
  const session = {
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
    delete: async ({ where }: any) => {
      const i = sessions.findIndex((r) => matches(r, where));
      if (i >= 0) sessions.splice(i, 1);
    },
    deleteMany: async ({ where }: any) => {
      for (let i = sessions.length - 1; i >= 0; i--) {
        if (matches(sessions[i], where)) sessions.splice(i, 1);
      }
    },
  };
  const aiSetting = {
    findMany: async () => aiSettings.map((r) => ({ ...r })),
    upsert: async ({ where, create, update }: any) => {
      let row = aiSettings.find((r) => r.key === where.key);
      if (row) Object.assign(row, update);
      else {
        row = { ...create };
        aiSettings.push(row);
      }
      return { ...row };
    },
  };
  const aiAnalysis = {
    create: async ({ data }: any) => {
      const row = { createdAt: new Date(), ...data };
      aiAnalyses.push(row);
      return { ...row };
    },
    findMany: async ({ where, orderBy, take }: any) => {
      let rows = aiAnalyses.filter((r) => matches(r, where));
      if (orderBy?.createdAt === "desc")
        rows = [...rows].sort((a, b) => b.createdAt - a.createdAt);
      if (typeof take === "number") rows = rows.slice(0, take);
      return rows.map((r) => ({ ...r }));
    },
    findFirst: async ({ where }: any) =>
      aiAnalyses.find((r) => matches(r, where)) ?? null,
  };
  return {
    user,
    tenant,
    session,
    aiSetting,
    aiAnalysis,
    _stores: { tenants, users, sessions, aiSettings, aiAnalyses },
  };
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

const GOOD_TERMS: TermsShape = {
  overallVerdict: "caution",
  traffic: {
    search: "allowed",
    display: "unknown",
    email: "forbidden",
    social: "unknown",
    incentivized: "forbidden",
  },
  brandBidding: "forbidden",
  brandBiddingBasis: null,
  directLinking: "restricted",
  directLinkingBasis: null,
  geoRestrictions: ["US only"],
  caps: "100 leads/day",
  payoutTerms: "Net-30",
  redFlags: [
    { severity: "high", title: "No brand bidding", detail: "Brand terms banned." },
  ],
  summary: "Search allowed, brand bidding banned.",
};

async function buildTestApp(
  fake: FakePrisma,
  opts: { chatJsonImpl?: any; fetchPageImpl?: any } = {}
) {
  const app = Fastify({ logger: false });
  app.setErrorHandler(createObservabilityErrorHandler());
  await registerAiRoutes(app, {
    prisma: fake as unknown as PrismaClient,
    chatJsonImpl: opts.chatJsonImpl,
    fetchPageImpl: opts.fetchPageImpl,
  });
  return app;
}

async function seedAuth(fake: FakePrisma, role: "admin" | "member") {
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
  const session = await createSession(
    fake as unknown as PrismaClient,
    user.id
  );
  return { tenantId, user, token: session.token };
}

function cookie(token: string) {
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

function seedAiSettings(fake: FakePrisma) {
  process.env.AI_SETTINGS_PEPPER = TEST_AI_SETTINGS_PEPPER;
  const stores = (fake as any)._stores;
  stores.aiSettings.push(
    { key: "llm.baseUrl", value: "https://llm.test" },
    { key: "llm.model", value: "test-model" },
    {
      key: "llm.apiKeyEnc",
      value: encryptSecret("test-key", TEST_AI_SETTINGS_PEPPER),
    }
  );
}

const TERMS_TEXT =
  "Offer terms: paid search is allowed. Brand bidding is strictly prohibited. " +
  "Incentivized and cashback traffic is not allowed. US traffic only. " +
  "Direct linking requires prior approval from your affiliate manager.";

// ---------------------------------------------------------------------------
// validateTermsShape
// ---------------------------------------------------------------------------

describe("validateTermsShape", () => {
  it("1. accepts a valid terms shape", () => {
    expect(validateTermsShape(GOOD_TERMS)).toEqual(GOOD_TERMS);
  });

  it("2. rejects a bad verdict enum", () => {
    expect(() =>
      validateTermsShape({ ...GOOD_TERMS, overallVerdict: "maybe" })
    ).toThrow(AiError);
  });

  it("3. rejects missing summary", () => {
    const bad = { ...GOOD_TERMS } as any;
    delete bad.summary;
    expect(() => validateTermsShape(bad)).toThrow(AiError);
  });

  it("4. rejects non-string geoRestrictions entries", () => {
    expect(() =>
      validateTermsShape({ ...GOOD_TERMS, geoRestrictions: ["US", 42] })
    ).toThrow(AiError);
  });

  it("5. buildTermsPrompt mentions conservative unknown rule", () => {
    const { system } = buildTermsPrompt(TERMS_TEXT, "zh");
    expect(system).toContain("unknown");
    expect(system).toContain("NEVER invent");
  });
});

// ---------------------------------------------------------------------------
// compliance.ts helpers
// ---------------------------------------------------------------------------

describe("compliance helpers", () => {
  it("6. detectAffiliateParams finds exact param names", () => {
    const u = new URL("https://example.com/?aff_id=1&x=2&AFFILIATE_ID=3");
    expect(detectAffiliateParams(u)).toEqual(["aff_id", "affiliate_id"]);
  });

  it("7. detectAffiliateParams returns [] for clean URLs", () => {
    const u = new URL("https://example.com/page?utm_source=google");
    expect(detectAffiliateParams(u)).toEqual([]);
  });

  it("8. isOwnedDomain: exact and subdomain match", () => {
    expect(isOwnedDomain("mydomain.com", ["mydomain.com"])).toBe(true);
    expect(isOwnedDomain("sub.mydomain.com", ["mydomain.com"])).toBe(true);
    expect(isOwnedDomain("MYDOMAIN.COM", ["mydomain.com"])).toBe(true);
  });

  it("9. isOwnedDomain: evil-mydomain.com must NOT match", () => {
    expect(isOwnedDomain("evil-mydomain.com", ["mydomain.com"])).toBe(false);
    expect(isOwnedDomain("mydomain.com.evil.com", ["mydomain.com"])).toBe(false);
    expect(isOwnedDomain("other.com", ["mydomain.com"])).toBe(false);
  });

  it("10. registrableDomain handles multi-label suffixes", () => {
    expect(registrableDomain("sub.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("a.b.example.com")).toBe("example.com");
    expect(registrableDomain("example.com")).toBe("example.com");
  });

  it("11. normalizeOwnedDomain validates and tolerates pasted URLs", () => {
    expect(normalizeOwnedDomain("MyDomain.COM ")).toBe("mydomain.com");
    expect(normalizeOwnedDomain("https://shop.mydomain.com/path")).toBe(
      "shop.mydomain.com"
    );
    expect(normalizeOwnedDomain("not a domain")).toBe(null);
    expect(normalizeOwnedDomain("localhost")).toBe(null);
    expect(normalizeOwnedDomain("")).toBe(null);
  });

  it("12. checkUrlVerdict priority: owned > affiliate > suspicious > unknown", () => {
    expect(
      checkUrlVerdict({
        finalHost: "a.mydomain.com",
        redirected: true,
        affiliateParams: ["aff_id"],
        ownedDomains: ["mydomain.com"],
      })
    ).toBe("owned");
    expect(
      checkUrlVerdict({
        finalHost: "net.com",
        redirected: false,
        affiliateParams: ["sid"],
        ownedDomains: ["mydomain.com"],
      })
    ).toBe("affiliate_direct");
    expect(
      checkUrlVerdict({
        finalHost: "net.com",
        redirected: true,
        affiliateParams: [],
        ownedDomains: ["mydomain.com"],
      })
    ).toBe("suspicious");
    expect(
      checkUrlVerdict({
        finalHost: "net.com",
        redirected: false,
        affiliateParams: [],
        ownedDomains: ["mydomain.com"],
      })
    ).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------

describe("ai compliance routes", () => {
  let fake: FakePrisma;
  beforeEach(() => {
    fake = makeFakePrisma();
    delete process.env.AI_SETTINGS_PEPPER;
  });

  it("13. POST /ai/analyze-terms persists inputKind=terms and returns terms", async () => {
    const { token } = await seedAuth(fake, "member");
    seedAiSettings(fake);
    const app = await buildTestApp(fake, {
      chatJsonImpl: async () => GOOD_TERMS,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/analyze-terms",
      headers: cookie(token),
      payload: { text: TERMS_TEXT, language: "en" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.terms.overallVerdict).toBe("caution");
    expect(body.language).toBe("en");
    const stored = (fake as any)._stores.aiAnalyses;
    expect(stored).toHaveLength(1);
    expect(stored[0].inputKind).toBe("terms");
    await app.close();
  });

  it("14. POST /ai/analyze-terms rejects short text", async () => {
    const { token } = await seedAuth(fake, "member");
    seedAiSettings(fake);
    const app = await buildTestApp(fake, {
      chatJsonImpl: async () => GOOD_TERMS,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/analyze-terms",
      headers: cookie(token),
      payload: { text: "too short" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("15. POST /ai/screen-offers sorts go→caution→stop and caps at 10", async () => {
    const { token } = await seedAuth(fake, "member");
    seedAiSettings(fake);
    const byMarker: Record<string, TermsShape> = {
      STOP: { ...GOOD_TERMS, overallVerdict: "stop", summary: "s-stop" },
      GO: { ...GOOD_TERMS, overallVerdict: "go", summary: "s-go" },
      CAUTION: { ...GOOD_TERMS, overallVerdict: "caution", summary: "s-caution" },
    };
    const app = await buildTestApp(fake, {
      chatJsonImpl: async (args: any) => {
        const marker = Object.keys(byMarker).find((m) =>
          args.user.includes(m)
        ) as keyof typeof byMarker;
        return byMarker[marker];
      },
    });
    const mk = (m: string) => ({ name: m, text: `${TERMS_TEXT} MARKER=${m}` });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/screen-offers",
      headers: cookie(token),
      payload: { items: [mk("STOP"), mk("GO"), mk("CAUTION")] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results.map((r: any) => r.verdict)).toEqual([
      "go",
      "caution",
      "stop",
    ]);
    expect(body.results[0].keyRisks).toEqual(["No brand bidding"]);
    const stored = (fake as any)._stores.aiAnalyses;
    expect(stored).toHaveLength(1);
    expect(stored[0].inputKind).toBe("screen");

    const tooMany = await app.inject({
      method: "POST",
      url: "/api/v1/ai/screen-offers",
      headers: cookie(token),
      payload: { items: Array.from({ length: 11 }, (_, i) => mk(`m${i}`)) },
    });
    expect(tooMany.statusCode).toBe(400);
    await app.close();
  });

  it("16. POST /ai/check-urls: SSRF-blocked URL yields per-item unknown, not 400", async () => {
    const { token } = await seedAuth(fake, "member");
    const app = await buildTestApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/check-urls",
      headers: cookie(token),
      payload: { urls: ["http://127.0.0.1/secret"] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].verdict).toBe("unknown");
    expect(body.results[0].finalUrl).toBe("http://127.0.0.1/secret");
    await app.close();
  });

  it("17. POST /ai/check-urls: owned vs affiliate_direct verdicts", async () => {
    const { token } = await seedAuth(fake, "member");
    const app = await buildTestApp(fake, {
      fetchPageImpl: async (inputUrl: string) => {
        if (inputUrl.includes("owned")) {
          return {
            finalUrl: "https://shop.mydomain.com/p?aff_id=9",
            text: "",
          };
        }
        return { finalUrl: "https://net.example/x?sid=1", text: "" };
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/check-urls",
      headers: cookie(token),
      payload: {
        urls: ["https://t.co/owned", "https://t.co/other"],
        ownedDomains: ["mydomain.com"],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ownedDomains).toEqual(["mydomain.com"]);
    const [a, b] = body.results;
    expect(a.verdict).toBe("owned");
    expect(a.isOwnedDomain).toBe(true);
    expect(a.affiliateParams).toEqual(["aff_id"]);
    expect(a.finalDomain).toBe("mydomain.com");
    expect(b.verdict).toBe("affiliate_direct");
    expect(b.isOwnedDomain).toBe(false);
    // persisted to settings for next time
    const stored = (fake as any)._stores.aiSettings.find(
      (r: any) => r.key === "compliance.ownedDomains"
    );
    expect(stored?.value).toBe("mydomain.com");
    await app.close();
  });

  it("18. GET /ai/settings includes ownedDomains; PUT validates them", async () => {
    const { token } = await seedAuth(fake, "admin");
    const app = await buildTestApp(fake);
    const get1 = await app.inject({
      method: "GET",
      url: "/api/v1/ai/settings",
      headers: cookie(token),
    });
    expect(get1.json().ownedDomains).toEqual([]);

    const bad = await app.inject({
      method: "PUT",
      url: "/api/v1/ai/settings",
      headers: cookie(token),
      payload: { ownedDomains: ["not a domain"] },
    });
    expect(bad.statusCode).toBe(400);

    const good = await app.inject({
      method: "PUT",
      url: "/api/v1/ai/settings",
      headers: cookie(token),
      payload: { ownedDomains: ["Shop.Example.COM", "example.com"] },
    });
    expect(good.statusCode).toBe(200);
    const get2 = await app.inject({
      method: "GET",
      url: "/api/v1/ai/settings",
      headers: cookie(token),
    });
    expect(get2.json().ownedDomains).toEqual([
      "shop.example.com",
      "example.com",
    ]);
    await app.close();
  });

  it("19. check-urls requires session; analyze-terms requires AI configured", async () => {
    const { token } = await seedAuth(fake, "member");
    const app = await buildTestApp(fake, {
      chatJsonImpl: async () => GOOD_TERMS,
    });
    const noAuth = await app.inject({
      method: "POST",
      url: "/api/v1/ai/check-urls",
      payload: { urls: ["https://example.com/"] },
    });
    expect(noAuth.statusCode).toBe(401);

    const unconfigured = await app.inject({
      method: "POST",
      url: "/api/v1/ai/analyze-terms",
      headers: cookie(token),
      payload: { text: TERMS_TEXT },
    });
    expect(unconfigured.statusCode).toBe(400);
    expect(unconfigured.json().error).toBe("AI_NOT_CONFIGURED");
    await app.close();
  });
});
