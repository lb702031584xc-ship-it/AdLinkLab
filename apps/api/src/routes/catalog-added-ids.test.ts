/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
/**
 * 按新增日期取商品 id 路由测试（Fastify inject + in-memory fake Prisma）：
 * POST /catalog/products/added-ids 的区间命中 [from, to)、上限截断、
 * 非法范围 400、networkId 过滤与租户隔离。纯选择辅助，不触发计算。
 */
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import { registerCatalogRoutes } from "./catalog.js";
import {
  makeCatalogFakePrisma,
  testNetwork,
  TEST_NETWORK,
  TEST_TENANT,
  TEST_USER,
  type CatalogFakeCtx,
} from "../services/catalog-fake-prisma.js";
import type { OfferService } from "../services/offer-engine.js";

const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const OTHER_NETWORK = "44444444-4444-4444-8444-444444444444";

function buildApp(ctx: CatalogFakeCtx): { app: ReturnType<typeof Fastify> } {
  const { prisma } = makeCatalogFakePrisma(ctx as any);
  const app = Fastify();
  app.addHook("preHandler", (request, _reply, done) => {
    (request as any).sessionAuth = {
      id: TEST_USER,
      email: "u@test.dev",
      name: "Tester",
      role: "member",
      tenantId: TEST_TENANT,
    };
    done();
  });
  const offers = {
    create: async () => {
      throw new Error("not used");
    },
  } as unknown as OfferService;
  void registerCatalogRoutes(app, { prisma, offers });
  return { app };
}

function product(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: randomUUID(),
    tenantId: TEST_TENANT,
    networkId: TEST_NETWORK,
    externalId: `ext-${Math.random().toString(36).slice(2, 8)}`,
    name: "P",
    brand: "Roborock",
    countryCode: "US",
    price: 100,
    status: "active",
    poolStage: "inbox",
    createdAt: new Date("2026-10-20T12:00:00.000Z"),
    ...overrides,
  };
}

const FROM = "2026-10-20T04:00:00.000Z"; // 纽约 10/20 当天 00:00（EDT）
const TO = "2026-10-21T04:00:00.000Z";

describe("POST /catalog/products/added-ids", () => {
  it("区间命中 [from, to)：含 from、不含 to；按 createdAt 升序", async () => {
    const { ctx } = makeCatalogFakePrisma();
    ctx.affiliateNetwork.push(testNetwork());
    const atFrom = product({ createdAt: new Date(FROM) });
    const mid = product({ createdAt: new Date("2026-10-20T15:00:00.000Z") });
    const atTo = product({ createdAt: new Date(TO) });
    const before = product({ createdAt: new Date("2026-10-19T15:00:00.000Z") });
    ctx.networkProduct.push(atTo, before, mid, atFrom);
    const { app } = buildApp(ctx);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/products/added-ids",
      payload: { from: FROM, to: TO },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ids).toEqual([atFrom.id, mid.id]);
    expect(body.total).toBe(2);
    expect(body.truncated).toBe(false);
  });

  it("那天没有新增 → ids 为空、total 0", async () => {
    const { ctx } = makeCatalogFakePrisma();
    ctx.affiliateNetwork.push(testNetwork());
    ctx.networkProduct.push(product());
    const { app } = buildApp(ctx);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/products/added-ids",
      payload: { from: "2026-11-01T00:00:00.000Z", to: "2026-11-02T00:00:00.000Z" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ids: [], total: 0, truncated: false });
  });

  it("租户隔离：其他租户同日新增不返回", async () => {
    const { ctx } = makeCatalogFakePrisma();
    ctx.affiliateNetwork.push(testNetwork());
    ctx.networkProduct.push(
      product(),
      product({ tenantId: OTHER_TENANT })
    );
    const { app } = buildApp(ctx);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/products/added-ids",
      payload: { from: FROM, to: TO },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(1);
  });

  it("networkId 过滤：只返回该网络的新增", async () => {
    const { ctx } = makeCatalogFakePrisma();
    ctx.affiliateNetwork.push(testNetwork());
    const mine = product();
    ctx.networkProduct.push(mine, product({ networkId: OTHER_NETWORK }));
    const { app } = buildApp(ctx);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/products/added-ids",
      payload: { from: FROM, to: TO, networkId: TEST_NETWORK },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ids).toEqual([mine.id]);
  });

  it("上限 1000 截断：total 为真实总数、truncated=true", async () => {
    const { ctx } = makeCatalogFakePrisma();
    ctx.affiliateNetwork.push(testNetwork());
    for (let i = 0; i < 1005; i += 1) ctx.networkProduct.push(product());
    const { app } = buildApp(ctx);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/products/added-ids",
      payload: { from: FROM, to: TO },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1005);
    expect(body.ids).toHaveLength(1000);
    expect(body.truncated).toBe(true);
  });

  it("非法范围 400：from>=to / 跨度 >366 天 / 不可解析 / 缺字段", async () => {
    const { ctx } = makeCatalogFakePrisma();
    ctx.affiliateNetwork.push(testNetwork());
    const { app } = buildApp(ctx);
    const badPayloads: Array<Record<string, unknown>> = [
      { from: TO, to: FROM },
      { from: FROM, to: FROM },
      { from: "2025-01-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
      { from: "not-a-date", to: TO },
      { to: TO },
      {},
    ];
    for (const payload of badPayloads) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/catalog/products/added-ids",
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });
});
