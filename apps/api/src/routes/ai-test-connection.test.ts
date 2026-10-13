/**
 * POST /api/v1/ai/test-connection：分层诊断 LLM 连接。
 * stub global fetch 模拟 DNS 故障 / 401 / 200。
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { registerAiRoutes } from "./ai.js";

type Row = { key: string; value: string };

function makeFakePrisma() {
  const store = new Map<string, string>();
  return {
    store,
    aiSetting: {
      findMany: async (): Promise<Row[]> =>
        [...store.entries()].map(([key, value]) => ({ key, value })),
      findUnique: async ({ where }: { where: { key: string } }): Promise<Row | null> => {
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

async function seedSettings(app: Awaited<ReturnType<typeof buildApp>>) {
  const put = await app.inject({
    method: "PUT",
    url: "/api/v1/ai/settings",
    payload: {
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "test-key-123",
    },
  });
  expect(put.statusCode).toBe(200);
}

describe("POST /api/v1/ai/test-connection", () => {
  let fake: FakePrisma;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const realFetch = globalThis.fetch;

  beforeEach(async () => {
    fake = makeFakePrisma();
    app = await buildApp(fake);
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("未配置时返回 stage=config", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/test-connection",
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.stage).toBe("config");
  });

  it("DNS 失败定位到 dns 层", async () => {
    await seedSettings(app);
    const err = new Error("getaddrinfo ENOTFOUND api.deepseek.com") as Error & {
      cause: { code: string };
    };
    err.cause = { code: "ENOTFOUND" };
    globalThis.fetch = vi.fn().mockRejectedValue(err) as unknown as typeof fetch;

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/test-connection",
      payload: {},
    });
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.stage).toBe("dns");
    expect(body.message).toContain("DNS");
  });

  it("401 定位到 http 层并提示 key 无效", async () => {
    await seedSettings(app);
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 401,
      ok: false,
      text: async () => '{"error":"invalid key"}',
    }) as unknown as typeof fetch;

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/test-connection",
      payload: {},
    });
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.stage).toBe("http");
    expect(body.httpStatus).toBe(401);
  });

  it("200 返回 ok 并带延迟", async () => {
    await seedSettings(app);
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => '{"data":[]}',
    }) as unknown as typeof fetch;

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/test-connection",
      payload: {},
    });
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.stage).toBe("ok");
    expect(typeof body.latencyMs).toBe("number");
  });

  it("可用 body 覆盖值测试保存前的新配置", async () => {
    // 不 seed：用 body 传完整配置
    globalThis.fetch = vi.fn().mockImplementation(async (url: unknown) => {
      expect(String(url)).toBe("https://custom.example.com/models");
      return { status: 200, ok: true, text: async () => "{}" };
    }) as unknown as typeof fetch;

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/test-connection",
      payload: {
        baseUrl: "https://custom.example.com/",
        model: "x",
        apiKey: "k",
      },
    });
    expect(res.json().ok).toBe(true);
  });
});
