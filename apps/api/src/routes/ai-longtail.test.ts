/**
 * 长尾词候选路由 POST /api/v1/ai/longtail-suggestions 单测。
 *
 * - 不 AI 现编：候选只来自 Google 联想（免费）+ DataForSEO 关键词建议（付费，需凭证）。
 * - 无 DataForSEO 凭证时只返回联想候选；联想失败时返回空候选，绝不 500。
 * - 返回的候选不含种子词本身；DataForSEO 与联想重复时保留带搜索量的 DataForSEO 版。
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { registerAiRoutes } from "./ai.js";
import {
  encryptSecret,
  TEST_AI_SETTINGS_PEPPER,
} from "../ai/crypto.js";

type Row = { key: string; value: string };

function makeFakePrisma() {
  const store = new Map<string, string>();
  return {
    store,
    aiSetting: {
      findMany: async (): Promise<Row[]> =>
        [...store.entries()].map(([key, value]) => ({ key, value })),
      findUnique: async ({
        where,
      }: {
        where: { key: string };
      }): Promise<Row | null> => {
        const value = store.get(where.key);
        return value === undefined ? null : { key: where.key, value };
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { key: string };
        create: Row;
        update: Partial<Row>;
      }): Promise<Row> => {
        const value = (update.value ?? create.value) as string;
        store.set(where.key, value);
        return { key: where.key, value };
      },
    },
  };
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

async function buildApp(fake: FakePrisma) {
  const app = Fastify({ logger: false });
  app.addHook("onRequest", (request, _reply, done) => {
    request.sessionAuth = {
      id: "u-admin",
      email: "admin@example.com",
      name: "admin",
      role: "admin",
      tenantId: "t1",
    };
    done();
  });
  await registerAiRoutes(app, { prisma: fake as unknown as PrismaClient });
  return app;
}

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch() {
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.includes("suggestqueries.google.com")) {
      const q = new URL(url).searchParams.get("q") ?? "";
      const suggestions =
        q === "roborock"
          ? ["roborock s8 maxv ultra", "roborock vacuum", "roborock"]
          : q === "roborock best"
            ? ["roborock best vacuum 2026", "roborock s8 maxv ultra"]
            : ["roborock review s8", "roborock s8 maxv ultra"];
      return { ok: true, json: async () => [q, suggestions] } as Response;
    }
    if (url.includes("api.dataforseo.com")) {
      return {
        ok: true,
        json: async () => ({
          tasks: [
            {
              result: [
                {
                  items: [
                    { keyword: "roborock s8 maxv ultra", keyword_info: { search_volume: 5400 } },
                    { keyword: "roborock saros 10r", keyword_info: { search_volume: 2900 } },
                    { keyword: "roborock", keyword_info: { search_volume: 100000 } },
                  ],
                },
              ],
            },
          ],
        }),
      } as Response;
    }
    return { ok: false, json: async () => ({}) } as Response;
  }) as typeof fetch;
}

describe("长尾词候选路由", () => {
  let fake: FakePrisma;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    fake = makeFakePrisma();
    app = await buildApp(fake);
    mockFetch();
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it("无 DataForSEO 凭证时只返回联想候选，且不含种子词本身", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/longtail-suggestions",
      payload: { seed: "roborock" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.seed).toBe("roborock");
    expect(body.sources.autocomplete).toBe(true);
    expect(body.sources.dataforseo).toBe(false);
    const kws = body.candidates.map((c: { keyword: string }) => c.keyword);
    expect(kws).toContain("roborock s8 maxv ultra");
    expect(kws).toContain("roborock best vacuum 2026");
    expect(kws).not.toContain("roborock");
    expect(body.candidates.every((c: { source: string }) => c.source === "autocomplete")).toBe(true);
  });

  it("有 DataForSEO 凭证时合并两来源，重复词保留带搜索量的 DataForSEO 版", async () => {
    fake.store.set(
      "traffic.dataforseoLogin",
      encryptSecret("dfs-login", TEST_AI_SETTINGS_PEPPER)
    );
    fake.store.set(
      "traffic.dataforseoPassword",
      encryptSecret("dfs-pass", TEST_AI_SETTINGS_PEPPER)
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/longtail-suggestions",
      payload: { seed: "roborock" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sources.dataforseo).toBe(true);
    const dup = body.candidates.find(
      (c: { keyword: string }) => c.keyword === "roborock s8 maxv ultra"
    );
    expect(dup.source).toBe("dataforseo");
    expect(dup.volume).toBe(5400);
    expect(body.candidates.some((c: { keyword: string }) => c.keyword === "roborock saros 10r")).toBe(true);
    expect(body.candidates.some((c: { keyword: string }) => c.keyword === "roborock best vacuum 2026")).toBe(true);
  });

  it("种子词太短时 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/longtail-suggestions",
      payload: { seed: "a" },
    });
    expect(res.statusCode).toBe(400);
  });
});
