/**
 * DataForSEO 关键词流水线路由单测（POST /api/v1/keywords/expand |
 * intent-filter | ad-measure）。
 *
 * 口径（用户拍板）：
 * - 参数默认值：扩词上限默认 100、测算返回默认 20、默认美国 2840 / en。
 * - 广告测算服务端硬门：未勾选（keywords 为空）直接 400 拒绝，不能只靠前端。
 * - 意图过滤 fail-soft：DataForSEO 失败 → 200 + verified=false，词不丢，
 *   且错误要透出 DataForSEO 的 status_message，不是只剩状态码。
 * - 测算结果：按搜索量降序取前 N；CPC 来自 Labs Overview（Keywords Data
 *   无 cpc 字段）；缺失字段为 null（未知），不用 0 冒充。
 *
 * DataForSEO 响应均为按官方文档形状构造的模拟 fixture，非真实抓取。
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { registerKeywordDataForSeoRoutes } from "./keywords-dataforseo.js";
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

function seedCredentials(fake: FakePrisma) {
  fake.store.set(
    "traffic.dataforseoLogin",
    encryptSecret("dfs-login", TEST_AI_SETTINGS_PEPPER)
  );
  fake.store.set(
    "traffic.dataforseoPassword",
    encryptSecret("dfs-pass", TEST_AI_SETTINGS_PEPPER)
  );
}

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
  await registerKeywordDataForSeoRoutes(app, {
    prisma: fake as unknown as PrismaClient,
    cache: null,
  });
  return app;
}

const ORIGINAL_FETCH = globalThis.fetch;

/** 记录发往 DataForSEO 的请求体（断言默认参数用）。 */
const sentBodies: Array<{ url: string; body: Array<Record<string, unknown>> }> = [];
let intentFails = false;

function mockFetch() {
  sentBodies.length = 0;
  intentFails = false;
  globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    const body = init?.body
      ? (JSON.parse(init.body) as Array<Record<string, unknown>>)
      : [];
    sentBodies.push({ url, body });

    if (url.includes("related_keywords")) {
      return {
        ok: true,
        json: async () => ({
          tasks: [
            {
              status_code: 20000,
              result: [
                {
                  items: [
                    {
                      keyword_data: {
                        keyword: "best robot vacuum for pet hair",
                        keyword_info: {
                          search_volume: 33100,
                          cpc: 1.12,
                          competition: 0.64,
                          competition_level: "MEDIUM",
                        },
                      },
                    },
                    {
                      keyword_data: {
                        keyword: "robot vacuum with self empty base",
                        keyword_info: { search_volume: 8100 },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      } as Response;
    }

    if (url.includes("search_intent")) {
      if (intentFails) {
        return {
          ok: false,
          status: 403,
          text: async () =>
            JSON.stringify({ status_message: "Account is not verified." }),
          json: async () => ({}),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          tasks: [
            {
              status_code: 20000,
              result: [
                {
                  items: [
                    {
                      keyword: "best robot vacuum for pet hair",
                      keyword_intent: { label: "commercial", probability: 0.9 },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      } as Response;
    }

    if (url.includes("keyword_overview")) {
      return {
        ok: true,
        json: async () => ({
          tasks: [
            {
              status_code: 20000,
              result: [
                {
                  items: [
                    {
                      keyword_data: {
                        keyword: "kw 25",
                        keyword_info: { cpc: 2.5 },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      } as Response;
    }

    if (url.includes("keywords_data/google_ads/search_volume")) {
      // 按请求词动态生成：kw i 的搜索量 = i*100（输入升序，服务端须重排降序）
      const keywords = (body[0]?.keywords ?? []) as string[];
      return {
        ok: true,
        json: async () => ({
          tasks: [
            {
              status_code: 20000,
              result: keywords.map((keyword) => {
                const n = Number(keyword.replace(/\D/g, "")) || 0;
                return {
                  keyword,
                  search_volume: n * 100,
                  competition: "LOW",
                  competition_index: 10,
                  low_top_of_page_bid: 0.5,
                  high_top_of_page_bid: 1.5,
                };
              }),
            },
          ],
        }),
      } as Response;
    }

    return { ok: false, status: 404, text: async () => "", json: async () => ({}) } as Response;
  }) as typeof fetch;
}

describe("DataForSEO 关键词流水线路由", () => {
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

  it("expand：未配置 DataForSEO 凭证 → 400 且带 DATAFORSEO_NOT_CONFIGURED", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/keywords/expand",
      payload: { seed: "robot vacuum" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { code?: string; message?: string };
    expect(body.code).toBe("DATAFORSEO_NOT_CONFIGURED");
    expect(sentBodies).toHaveLength(0);
  });

  it("expand：默认参数 limit=100 / 美国 2840 / en，候选带量与 CPC", async () => {
    seedCredentials(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/keywords/expand",
      payload: { seed: "robot vacuum" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      candidates: Array<Record<string, unknown>>;
      total: number;
      cached: boolean;
    };
    expect(body.total).toBe(2);
    expect(body.cached).toBe(false);
    expect(body.candidates[0]).toEqual({
      keyword: "best robot vacuum for pet hair",
      searchVolume: 33100,
      cpc: 1.12,
      competition: 0.64,
      competitionLevel: "MEDIUM",
    });
    expect(body.candidates[1].cpc).toBeNull();
    const sent = sentBodies.find((s) => s.url.includes("related_keywords"));
    expect(sent?.body[0]).toMatchObject({
      keyword: "robot vacuum",
      location_code: 2840,
      language_code: "en",
      limit: 100,
    });
  });

  it("expand：显式 limit 透传；超出 10–200 范围 → 400", async () => {
    seedCredentials(fake);
    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/keywords/expand",
      payload: { seed: "robot vacuum", limit: 50 },
    });
    expect(ok.statusCode).toBe(200);
    const sent = sentBodies.find((s) => s.url.includes("related_keywords"));
    expect(sent?.body[0].limit).toBe(50);

    for (const bad of [9, 201, 10.5]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/keywords/expand",
        payload: { seed: "robot vacuum", limit: bad },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it("ad-measure：未勾选任何词（keywords 空/缺失）→ 服务端 400 拒绝，不调 DataForSEO", async () => {
    seedCredentials(fake);
    for (const payload of [{ keywords: [] }, {}, { keywords: ["", "  "] }]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/keywords/ad-measure",
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
    expect(sentBodies).toHaveLength(0);
  });

  it("ad-measure：默认返回 20 条、按搜索量降序、CPC 由 Labs Overview 合并", async () => {
    seedCredentials(fake);
    const keywords = Array.from({ length: 25 }, (_, i) => `kw ${i + 1}`);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/keywords/ad-measure",
      payload: { keywords },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      rows: Array<Record<string, unknown>>;
      total: number;
      requestedCount: number;
      limit: number;
      estimate: boolean;
    };
    expect(body.limit).toBe(20);
    expect(body.requestedCount).toBe(25);
    expect(body.total).toBe(20);
    expect(body.estimate).toBe(true);
    // 搜索量降序：第一名 kw 25（2500），最后一名 kw 6（600）
    expect(body.rows[0].keyword).toBe("kw 25");
    expect(body.rows[0].searchVolume).toBe(2500);
    expect(body.rows[19].keyword).toBe("kw 6");
    // CPC 只有 kw 25 在 Overview fixture 里有 → 其余 null（未知）
    expect(body.rows[0].cpc).toBe(2.5);
    expect(body.rows[1].cpc).toBeNull();
    expect(body.rows[0].lowTopBid).toBe(0.5);
    expect(body.rows[0].highTopBid).toBe(1.5);
    expect(body.rows[0].competitionIndex).toBe(10);
  });

  it("ad-measure：显式 limit 生效；超出 5–100 → 400", async () => {
    seedCredentials(fake);
    const keywords = Array.from({ length: 8 }, (_, i) => `kw ${i + 1}`);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/keywords/ad-measure",
      payload: { keywords, limit: 5 },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { rows: unknown[] }).rows).toHaveLength(5);

    const bad = await app.inject({
      method: "POST",
      url: "/api/v1/keywords/ad-measure",
      payload: { keywords, limit: 101 },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("intent-filter：正常返回对齐请求词，响应缺失的词 intent=null", async () => {
    seedCredentials(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/keywords/intent-filter",
      payload: {
        keywords: ["best robot vacuum for pet hair", "robot vacuum"],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      verified: boolean;
      results: Array<Record<string, unknown>>;
    };
    expect(body.verified).toBe(true);
    expect(body.results).toEqual([
      { keyword: "best robot vacuum for pet hair", intent: "commercial", probability: 0.9 },
      { keyword: "robot vacuum", intent: null, probability: null },
    ]);
  });

  it("intent-filter：DataForSEO 403 → fail-soft 200 + verified=false + 透出 status_message，词不丢", async () => {
    seedCredentials(fake);
    intentFails = true;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/keywords/intent-filter",
      payload: { keywords: ["best robot vacuum for pet hair"] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      verified: boolean;
      error?: string;
      results: Array<Record<string, unknown>>;
    };
    expect(body.verified).toBe(false);
    expect(body.error).toContain("Account is not verified.");
    expect(body.results).toEqual([
      { keyword: "best robot vacuum for pet hair", intent: null, probability: null },
    ]);
  });

  it("intent-filter：未配置凭证 → fail-soft verified=false + configured=false", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/keywords/intent-filter",
      payload: { keywords: ["robot vacuum"] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { verified: boolean; configured?: boolean };
    expect(body.verified).toBe(false);
    expect(body.configured).toBe(false);
  });
});
