/**
 * Offer 指标抓取 API 单测：
 * - POST /:id/fetch-metrics：成功落库、offer 不存在 → 404、抓取失败不抛 500、限流 → 429
 * - attachMetricsSummaries：批量附带，无 N+1
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import {
  registerOfferMetricsRoutes,
  attachMetricsSummaries,
} from "./offer-metrics.js";
import type { OfferMetrics } from "../offer-metrics/scrape.js";

const fakeMetrics: OfferMetrics = {
  url: "https://www.example.com/p/1",
  finalUrl: "https://www.example.com/p/1",
  title: "Test",
  price: 29.99,
  currency: "USD",
  rating: 4.6,
  reviewCount: 12834,
  soldCount: null,
  availability: "InStock",
  bsr: null,
  fetchedAt: new Date().toISOString(),
  failures: ["未获取到销量"],
};

function makeFakePrisma() {
  const offers = new Map<string, { id: string; destinationUrl: string }>();
  const metrics = new Map<string, Record<string, unknown>>();
  return {
    offers,
    metrics,
    offer: {
      findFirst: vi.fn(
        async ({ where }: { where: { id: string; tenantId: string } }) => {
          const o = offers.get(where.id);
          return o ? { id: o.id, destinationUrl: o.destinationUrl } : null;
        }
      ),
    },
    offerMetrics: {
      upsert: vi.fn(
        async (args: {
          where: { offerId: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const row = { ...args.create, ...args.update };
          metrics.set(args.where.offerId, row);
          return {
            score: row.score,
            grade: row.grade,
            fetchedAt: row.fetchedAt,
          };
        }
      ),
      findMany: vi.fn(
        async ({ where }: { where: { tenantId: string; offerId: { in: string[] } } }) => {
          return [...metrics.entries()]
            .filter(([offerId]) => where.offerId.in.includes(offerId))
            .map(([offerId, row]) => ({
              offerId,
              score: row.score,
              grade: row.grade,
              fetchedAt: row.fetchedAt,
            }));
        }
      ),
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

async function buildApp(
  fake: FakePrisma,
  opts: {
    scrapeImpl?: (url: string) => Promise<OfferMetrics>;
    ocrImpl?: (buf: Buffer) => Promise<Record<string, unknown>>;
    ocrNetworkImpl?: (buf: Buffer) => Promise<Record<string, unknown>>;
    redis?: unknown;
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
  await registerOfferMetricsRoutes(app, {
    prisma: fake as unknown as PrismaClient,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    redis: (opts.redis ?? makeFakeRedis()) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    scrapeImpl: (opts.scrapeImpl ?? (async () => fakeMetrics)) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ocrImpl: opts.ocrImpl as any,
    ocrNetworkImpl: opts.ocrNetworkImpl as any,
  });
  return app;
}

describe("POST /api/v1/offers/:id/fetch-metrics", () => {
  let fake: FakePrisma;
  beforeEach(() => {
    fake = makeFakePrisma();
    fake.offers.set("o1", { id: "o1", destinationUrl: "https://www.example.com/p/1" });
  });

  it("成功：抓取→算分→落库→返回", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({ method: "POST", url: "/api/v1/offers/o1/fetch-metrics" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.offerId).toBe("o1");
    expect(body.score).toBeGreaterThan(0);
    expect(body.grade).toBeTruthy();
    expect(body.breakdown).toHaveLength(3);
    expect(body.metricsSummary.score).toBe(body.score);
    // 落库了
    expect(fake.metrics.get("o1")?.score).toBe(body.score);
    await app.close();
  });

  it("offer 不存在 → 404", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({ method: "POST", url: "/api/v1/offers/nope/fetch-metrics" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("抓取全失败 → 200 + score null，绝不 500", async () => {
    const app = await buildApp(fake, {
      scrapeImpl: async (url: string) => ({
        url,
        finalUrl: null,
        title: null,
        price: null,
        currency: null,
        rating: null,
        reviewCount: null,
        soldCount: null,
        availability: null,
        bsr: null,
        fetchedAt: new Date().toISOString(),
        failures: ["最终页抓取失败：Page fetch failed (status 403)"],
      }),
    });
    const res = await app.inject({ method: "POST", url: "/api/v1/offers/o1/fetch-metrics" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.score).toBe(null);
    expect(body.grade).toBe(null);
    expect(body.metrics.failures.length).toBeGreaterThan(0);
    await app.close();
  });

  it("超限 → 429", async () => {
    const redis = makeFakeRedis();
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-T:]/g, "");
    const realKey = `offer-metrics:ratelimit:t1:${stamp}`;
    // 预置 10 次（本分钟已达上限）
    for (let i = 0; i < 10; i++) await redis.incr(realKey);
    const app = await buildApp(fake, { redis });
    const res = await app.inject({ method: "POST", url: "/api/v1/offers/o1/fetch-metrics" });
    expect(res.statusCode).toBe(429);
    await app.close();
  });
});

describe("attachMetricsSummaries", () => {
  it("批量附带：有数据/无数据", async () => {
    const fake = makeFakePrisma();
    const now = new Date();
    fake.metrics.set("o1", { score: 85, grade: "strong", fetchedAt: now });
    const out = await attachMetricsSummaries(
      fake as unknown as PrismaClient,
      "t1",
      [{ id: "o1" }, { id: "o2" }]
    );
    expect(out[0]!.metricsSummary).toMatchObject({ score: 85, grade: "strong" });
    expect(out[1]!.metricsSummary).toBe(null);
    // 一次查询
    expect(fake.offerMetrics.findMany).toHaveBeenCalledTimes(1);
  });

  it("空列表 → 空数组", async () => {
    const fake = makeFakePrisma();
    const out = await attachMetricsSummaries(fake as unknown as PrismaClient, "t1", []);
    expect(out).toEqual([]);
  });
});

describe("POST /api/v1/offer-metrics/ocr", () => {
  let fake: FakePrisma;
  beforeEach(() => {
    fake = makeFakePrisma();
  });

  const BOUNDARY = "----testboundary1234";
  function multipart(
    filename: string,
    mimetype: string,
    content: Buffer | string
  ): { payload: Buffer; headers: Record<string, string> } {
    const head = Buffer.from(
      `--${BOUNDARY}\r\n` +
        `Content-Disposition: form-data; name="screenshot"; filename="${filename}"\r\n` +
        `Content-Type: ${mimetype}\r\n\r\n`
    );
    const tail = Buffer.from(`\r\n--${BOUNDARY}--\r\n`);
    return {
      payload: Buffer.concat([
        head,
        Buffer.isBuffer(content) ? content : Buffer.from(content),
        tail,
      ]),
      headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    };
  }

  const ocrOk = {
    rating: 4.5,
    reviewCount: 999,
    price: 10.99,
    currency: "USD",
    soldCount: 500,
    confidence: 87,
    needsReview: true,
  };

  it("成功：返回识别值 + needsReview", async () => {
    const app = await buildApp(fake, { ocrImpl: async () => ocrOk });
    const { payload, headers } = multipart("shot.png", "image/png", Buffer.from("fakeimg"));
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/offer-metrics/ocr",
      payload,
      headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ rating: 4.5, needsReview: true });
    await app.close();
  });

  it("非图片 → 400", async () => {
    const app = await buildApp(fake, { ocrImpl: async () => ocrOk });
    const { payload, headers } = multipart("note.txt", "text/plain", "hello");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/offer-metrics/ocr",
      payload,
      headers,
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("无文件 → 400", async () => {
    const app = await buildApp(fake, { ocrImpl: async () => ocrOk });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/offer-metrics/ocr",
      payload: `------x\r\nContent-Disposition: form-data; name="a"\r\n\r\nx\r\n------x--\r\n`,
      headers: { "content-type": "multipart/form-data; boundary=----x" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("kind=network：走网络后台识别（EPC/转化率/点击数）", async () => {
    const networkOk = {
      epc: 1.25,
      conversionRate: 2.5,
      clicks: 12345,
      confidence: 87,
      needsReview: true,
    };
    const app = await buildApp(fake, { ocrNetworkImpl: async () => networkOk });
    const { payload, headers } = multipart("shot.png", "image/png", Buffer.from("fakeimg"));
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/offer-metrics/ocr?kind=network",
      payload,
      headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ epc: 1.25, conversionRate: 2.5 });
    await app.close();
  });

  it("OCR 失败 → 422（不抛 500）", async () => {
    const { OcrError } = await import("../offer-metrics/ocr.js");
    const app = await buildApp(fake, {
      ocrImpl: async () => {
        throw new OcrError("截图中未识别出任何文字");
      },
    });
    const { payload, headers } = multipart("shot.png", "image/png", Buffer.from("fakeimg"));
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/offer-metrics/ocr",
      payload,
      headers,
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});
