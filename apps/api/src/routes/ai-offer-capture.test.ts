/**
 * 浏览器插件抓取：POST /api/v1/ai/offer-capture 存记录，
 * GET /api/v1/ai/offer-captures 列最近记录。fake prisma 注入。
 */
import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { registerAiRoutes } from "./ai.js";

interface CaptureRow {
  id: string;
  tenantId: string;
  url: string;
  title: string | null;
  description: string | null;
  price: number | null;
  currency: string | null;
  pageText: string;
  source: string;
  createdAt: Date;
}

function makeFakePrisma() {
  const rows: CaptureRow[] = [];
  return {
    rows,
    offerCapture: {
      create: async ({ data }: { data: Omit<CaptureRow, "id" | "createdAt"> }) => {
        const row: CaptureRow = {
          ...data,
          id: `cap-${rows.length + 1}`,
          createdAt: new Date(),
        };
        rows.push(row);
        return row;
      },
      findMany: async (): Promise<CaptureRow[]> => [...rows].reverse(),
    },
  };
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

async function buildApp(fake: FakePrisma) {
  const app = Fastify({ logger: false });
  app.addHook("onRequest", (request, _reply, done) => {
    request.sessionAuth = {
      id: "u1",
      email: "u@example.com",
      name: "u",
      role: "user",
      tenantId: "t1",
    };
    done();
  });
  await registerAiRoutes(app, { prisma: fake as unknown as PrismaClient });
  return app;
}

describe("POST /api/v1/ai/offer-capture", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp(makeFakePrisma());
  });

  it("插件正文 → 价格提取 + 存记录", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/offer-capture",
      payload: {
        url: "https://www.amazon.com/dp/B0EXAMPLE",
        title: "MERACH Vibration Plate",
        text: "MERACH Vibration Plate Exercise Machine $119.99 with great reviews",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBeTruthy();
    expect(body.price).toBe(119.99);
    expect(body.currency).toBe("USD");
    expect(body.source).toBe("extension");
  });

  it("空正文 → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/offer-capture",
      payload: { url: "https://example.com/", text: "   " },
    });
    expect(res.statusCode).toBe(400);
  });

  it("非 http(s) → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/offer-capture",
      payload: { url: "ftp://example.com/x", text: "hello" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET 列出抓取记录", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/ai/offer-capture",
      payload: { url: "https://example.com/a", text: "Product A $9.99" },
    });
    const res = await app.inject({ method: "GET", url: "/api/v1/ai/offer-captures" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].price).toBe(9.99);
    expect(body.items[0].source).toBe("extension");
  });
});
