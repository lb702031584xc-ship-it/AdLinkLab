/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
/**
 * 商品库路由测试（Fastify inject + in-memory fake Prisma）。
 *
 * 覆盖：非管理员删黑名单 → 403；删除缺 reason → 400；白名单建议→确认流；
 * 管理员删除 → 软删除 + 观察期。
 */
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import { registerCatalogRoutes } from "./catalog.js";
import {
  makeCatalogFakePrisma,
  TEST_TENANT,
  TEST_USER,
  type CatalogFakeCtx,
} from "../services/catalog-fake-prisma.js";
import type { OfferService } from "../services/offer-engine.js";

function buildApp(
  ctx: CatalogFakeCtx,
  role: string
): { app: ReturnType<typeof Fastify>; prisma: PrismaClient } {
  const { prisma } = makeCatalogFakePrisma(ctx as any);
  const app = Fastify();
  app.addHook("preHandler", (request, _reply, done) => {
    (request as any).sessionAuth = {
      id: TEST_USER,
      email: "u@test.dev",
      name: "Tester",
      role,
      tenantId: TEST_TENANT,
    };
    done();
  });
  const offers = {
    create: async (input: any) => ({
      offer: { id: randomUUID(), ...input },
      created: true,
      replayed: false,
    }),
  } as unknown as OfferService;
  void registerCatalogRoutes(app, { prisma, offers });
  return { app, prisma };
}

function blacklistRow(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: randomUUID(),
    tenantId: TEST_TENANT,
    channel: "affiliate",
    entityType: "product",
    entityId: randomUUID(),
    networkKind: null,
    reason: "sync_disappeared",
    firstSeenAt: new Date(),
    lastConfirmedAt: new Date(),
    source: "auto",
    createdBy: null,
    status: "active",
    removedAt: null,
    removedBy: null,
    removeReason: null,
    observationUntil: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("DELETE /api/v1/catalog/blacklist/:id", () => {
  it("非管理员 → 403", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const row = blacklistRow();
    ctx.catalogBlacklist.push(row);
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/catalog/blacklist/${row.id}`,
      payload: { reason: "误删" },
    });
    expect(res.statusCode).toBe(403);
    // 未被删除
    expect(ctx.catalogBlacklist[0].status).toBe("active");
  });

  it("管理员但缺 reason → 400", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const row = blacklistRow();
    ctx.catalogBlacklist.push(row);
    const { app } = buildApp(ctx, "admin");
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/catalog/blacklist/${row.id}`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("管理员删除 → 软删除 + 观察期 + 审计", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const row = blacklistRow();
    ctx.catalogBlacklist.push(row);
    const { app } = buildApp(ctx, "admin");
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/catalog/blacklist/${row.id}`,
      payload: { reason: "申诉通过" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.removed).toBe(true);
    expect(body.observationUntil).toBeTruthy();
    expect(ctx.catalogBlacklist[0].status).toBe("removed");
    expect(ctx.catalogBlacklist[0].removeReason).toBe("申诉通过");
    expect(
      ctx.adminGrantAudit.some((a: any) => a.action === "CATALOG_BLACKLIST_REMOVED")
    ).toBe(true);
  });
});

describe("白名单建议→确认", () => {
  it("POST /whitelist 添加（manual）→ POST /:id/confirm", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const { app } = buildApp(ctx, "member");
    const add = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/whitelist",
      payload: { entityType: "product", entityId: randomUUID(), note: "手动" },
    });
    expect(add.statusCode).toBe(200);
    expect(add.json().item.source).toBe("manual");

    const list = await app.inject({ method: "GET", url: "/api/v1/catalog/whitelist" });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(1);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/catalog/whitelist/${add.json().item.id}`,
    });
    expect(del.statusCode).toBe(200);
    const list2 = await app.inject({ method: "GET", url: "/api/v1/catalog/whitelist" });
    expect(list2.json().items).toHaveLength(0);
  });

  it("GET /blacklist 按 entityType/channel 过滤", async () => {
    const { ctx } = makeCatalogFakePrisma();
    ctx.catalogBlacklist.push(blacklistRow({ entityType: "product", channel: "affiliate" }));
    ctx.catalogBlacklist.push(blacklistRow({ entityType: "merchant", channel: "amazon" }));
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/blacklist?entityType=merchant",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0].channel).toBe("amazon");
  });
});
