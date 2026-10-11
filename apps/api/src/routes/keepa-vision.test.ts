/**
 * Keepa 截图 AI 看图判断 API 单测：
 * - POST /api/v1/keepa/vision-judge：成功（注入 visionImpl）、无 LLM 配置 400、
 *   非图片 400、超限 400、无图 400、模型不支持 vision 400 明确指引
 * - GET /api/v1/keepa/vision-status：llmConfigured 布尔值
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { registerKeepaRoutes } from "./keepa.js";
import { AiError, type ChatJsonVisionArgs } from "../ai/llm.js";
import {
  TEST_AI_SETTINGS_PEPPER,
  encryptSecret,
} from "../ai/crypto.js";

process.env.AI_SETTINGS_PEPPER = TEST_AI_SETTINGS_PEPPER;

function makeFakePrisma(llmConfigured: boolean) {
  const rows = llmConfigured
    ? [
        { key: "llm.baseUrl", value: "https://api.example.com/v1" },
        { key: "llm.model", value: "vision-model" },
        {
          key: "llm.apiKeyEnc",
          value: encryptSecret("test-key", TEST_AI_SETTINGS_PEPPER),
        },
      ]
    : [];
  return {
    aiSetting: {
      findMany: vi.fn(async () => rows),
      findUnique: vi.fn(async () => null),
    },
  };
}
type FakePrisma = ReturnType<typeof makeFakePrisma>;

function makeFakeRedis() {
  const store = new Map<string, string>();
  return {
    incr: vi.fn(async (key: string) => {
      const n = Number(store.get(key) ?? "0") + 1;
      store.set(key, String(n));
      return n;
    }),
    expire: vi.fn(async () => 1),
  };
}

const JUDGMENT = {
  verdict: "kill",
  reasons: ["近30天跌幅约30%"],
  metrics: { priceDrop30dPct: 30, rankStable: false, confidence: "high" },
};

async function buildApp(
  fake: FakePrisma,
  opts: {
    visionImpl?: (args: ChatJsonVisionArgs) => Promise<unknown>;
  } = {}
) {
  const app = Fastify({ logger: false });
  // 与生产一致：multipart 由 routes/index.ts 统一注册一次，模块不再自注册
  const { default: multipart } = await import("@fastify/multipart");
  await app.register(multipart, {
    limits: { files: 3, fileSize: 8 * 1024 * 1024 },
  });
  app.addHook("onRequest", (request, _reply, done) => {
    request.sessionAuth = {
      id: "u1",
      email: "u@example.com",
      name: "u",
      role: "member",
      tenantId: "t1",
    };
    done();
  });
  await registerKeepaRoutes(app, {
    prisma: fake as unknown as PrismaClient,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    redis: makeFakeRedis() as any,
    visionImpl:
      opts.visionImpl ??
      (async () => JUDGMENT as unknown as Record<string, unknown>),
  });
  return app;
}

const BOUNDARY = "----keepavisiontest";

interface Part {
  name: string;
  filename?: string;
  mimetype?: string;
  content: Buffer | string;
}

/** 构造 multipart payload（支持多文件 + 文本字段）。 */
function multipart(parts: Part[]): { payload: Buffer; headers: Record<string, string> } {
  const bufs: Buffer[] = [];
  for (const p of parts) {
    const disp =
      p.filename !== undefined
        ? `form-data; name="${p.name}"; filename="${p.filename}"`
        : `form-data; name="${p.name}"`;
    const head = Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: ${disp}\r\n` +
        (p.mimetype ? `Content-Type: ${p.mimetype}\r\n` : "") +
        `\r\n`
    );
    bufs.push(head, Buffer.isBuffer(p.content) ? p.content : Buffer.from(p.content));
    bufs.push(Buffer.from("\r\n"));
  }
  bufs.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return {
    payload: Buffer.concat(bufs),
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

const fakePng = (size = 100) => Buffer.alloc(size, 0x89);

describe("GET /api/v1/keepa/vision-status", () => {
  it("LLM 已配置 → true", async () => {
    const app = await buildApp(makeFakePrisma(true));
    const res = await app.inject({ method: "GET", url: "/api/v1/keepa/vision-status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ llmConfigured: true });
    await app.close();
  });

  it("LLM 未配置 → false", async () => {
    const app = await buildApp(makeFakePrisma(false));
    const res = await app.inject({ method: "GET", url: "/api/v1/keepa/vision-status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ llmConfigured: false });
    await app.close();
  });
});

describe("POST /api/v1/keepa/manual-judge", () => {
  const good = {
    amazonPriceNow: 100,
    amazonPrice30dAgo: 100,
    priceLow90d: 96,
    priceHigh90d: 104,
    rankNow: 50,
    rankBest90d: 45,
    rankWorst90d: 60,
    reviewsNow: 700,
    reviews90dAgo: 500,
  };

  it("平稳品 → pass（纯计算，无外部调用）", async () => {
    const app = await buildApp(makeFakePrisma(false)); // 无 LLM 配置也不影响
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/keepa/manual-judge",
      payload: good,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ verdict: "pass" });
    await app.close();
  });

  it("跳水品 → kill", async () => {
    const app = await buildApp(makeFakePrisma(true));
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/keepa/manual-judge",
      payload: { ...good, amazonPriceNow: 70 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ verdict: "kill" });
    await app.close();
  });

  it("负数 → 400", async () => {
    const app = await buildApp(makeFakePrisma(true));
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/keepa/manual-judge",
      payload: { ...good, rankNow: -5 },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("最低价高于最高价 → 400", async () => {
    const app = await buildApp(makeFakePrisma(true));
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/keepa/manual-judge",
      payload: { ...good, priceLow90d: 200, priceHigh90d: 100 },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain("最低价不能高于最高价");
    await app.close();
  });

  it("缺字段 → 400", async () => {
    const app = await buildApp(makeFakePrisma(true));
    const { reviewsNow: _drop, ...rest } = good;
    void _drop;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/keepa/manual-judge",
      payload: rest,
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("POST /api/v1/keepa/vision-judge", () => {
  let fake: FakePrisma;
  beforeEach(() => {
    fake = makeFakePrisma(true);
  });

  it("成功：两张图 → 返回 verdict（注入 impl，不调真实 LLM）", async () => {
    const seen: ChatJsonVisionArgs[] = [];
    const app = await buildApp(fake, {
      visionImpl: async (args) => {
        seen.push(args);
        return JUDGMENT;
      },
    });
    const { payload, headers } = multipart([
      { name: "price", filename: "p.png", mimetype: "image/png", content: fakePng() },
      { name: "rank", filename: "r.png", mimetype: "image/png", content: fakePng() },
      { name: "asin", content: "B012345678" },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/keepa/vision-judge",
      payload,
      headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ verdict: "kill", asin: "B012345678" });
    expect(seen).toHaveLength(1);
    expect(seen[0].images).toHaveLength(2);
    expect(seen[0].images[0]).toMatch(/^data:image\/png;base64,/);
    await app.close();
  });

  it("只有一张图也允许（unknown 由模型判）", async () => {
    const app = await buildApp(fake);
    const { payload, headers } = multipart([
      { name: "price", filename: "p.jpg", mimetype: "image/jpeg", content: fakePng() },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/keepa/vision-judge",
      payload,
      headers,
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("无 LLM 配置 → 400 指引", async () => {
    const app = await buildApp(makeFakePrisma(false));
    const { payload, headers } = multipart([
      { name: "price", filename: "p.png", mimetype: "image/png", content: fakePng() },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/keepa/vision-judge",
      payload,
      headers,
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain("AI 设置");
    await app.close();
  });

  it("非图片 → 400", async () => {
    const app = await buildApp(fake);
    const { payload, headers } = multipart([
      { name: "price", filename: "note.txt", mimetype: "text/plain", content: "hello" },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/keepa/vision-judge",
      payload,
      headers,
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("图片超限（>5MB）→ 400", async () => {
    const app = await buildApp(fake);
    const { payload, headers } = multipart([
      {
        name: "price",
        filename: "big.png",
        mimetype: "image/png",
        content: Buffer.alloc(5 * 1024 * 1024 + 1, 0x89),
      },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/keepa/vision-judge",
      payload,
      headers,
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain("5MB");
    await app.close();
  });

  it("无图 → 400", async () => {
    const app = await buildApp(fake);
    const { payload, headers } = multipart([{ name: "asin", content: "B012345678" }]);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/keepa/vision-judge",
      payload,
      headers,
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("模型不支持 vision → 400 明确指引（不抛 500）", async () => {
    const app = await buildApp(fake, {
      visionImpl: async () => {
        throw new AiError(
          "LLM request failed (status 400): image input is not supported for this model"
        );
      },
    });
    const { payload, headers } = multipart([
      { name: "price", filename: "p.png", mimetype: "image/png", content: fakePng() },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/keepa/vision-judge",
      payload,
      headers,
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain("不支持图片识别");
    await app.close();
  });

  it("LLM 其他错误 → 不抛 500（AiError 502）", async () => {
    const app = await buildApp(fake, {
      visionImpl: async () => {
        throw new AiError("LLM request failed: network error");
      },
    });
    const { payload, headers } = multipart([
      { name: "price", filename: "p.png", mimetype: "image/png", content: fakePng() },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/keepa/vision-judge",
      payload,
      headers,
    });
    expect(res.statusCode).not.toBe(500);
    await app.close();
  });
});
