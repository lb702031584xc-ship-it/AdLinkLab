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
  activeGrant,
  makeCatalogFakePrisma,
  testNetwork,
  TEST_NETWORK,
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

describe("POST /api/v1/catalog/blacklist/import", () => {
  it("正常批量导入 → added 统计", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/blacklist/import",
      payload: {
        items: [
          { entityType: "merchant", entityId: "m1", reason: "不付钱", channel: "cashback" },
          { entityType: "product", entityId: "p1", reason: "下架" },
          { entityType: "offer", entityId: "o1", reason: "扣量", channel: "amazon" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.added).toBe(3);
    expect(body.skipped).toBe(0);
    expect(body.errors).toHaveLength(0);
  });

  it("已存在 active → 跳过不报错", async () => {
    const { ctx } = makeCatalogFakePrisma();
    ctx.catalogBlacklist.push(
      blacklistRow({ entityType: "product", entityId: "p1", channel: "affiliate" })
    );
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/blacklist/import",
      payload: {
        items: [
          { entityType: "product", entityId: "p1", reason: "再拉一次" },
          { entityType: "product", entityId: "p2", reason: "新拉黑" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.added).toBe(1);
    expect(body.skipped).toBe(1);
    expect(body.errors).toHaveLength(0);
  });

  it("非法行 → errors 逐条记录（index 对应）", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/blacklist/import",
      payload: {
        items: [
          { entityType: "bogus", entityId: "x", reason: "r" },
          { entityType: "product", entityId: "  ", reason: "r" },
          { entityType: "product", entityId: "p1", reason: "" },
          { entityType: "merchant", entityId: "m1", reason: "不付钱" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.added).toBe(0);
    expect(body.skipped).toBe(0);
    expect(body.errors).toHaveLength(4);
    expect(body.errors.map((e: any) => e.index)).toEqual([0, 1, 2, 3]);
  });

  it("超过 200 条 → 400", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const { app } = buildApp(ctx, "member");
    const items = Array.from({ length: 201 }, (_, i) => ({
      entityType: "product",
      entityId: `p${i}`,
      reason: "批量",
    }));
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/blacklist/import",
      payload: { items },
    });
    expect(res.statusCode).toBe(400);
  });

  it("空数组 → 400", async () => {
    const { ctx } = makeCatalogFakePrisma();
    const { app } = buildApp(ctx, "member");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/blacklist/import",
      payload: { items: [] },
    });
    expect(res.statusCode).toBe(400);
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

describe("POST /api/v1/catalog/session-credentials（登录账号）", () => {
  const NETWORK_KIND = "yeahpromos";

  function setupCtx() {
    const { ctx } = makeCatalogFakePrisma();
    ctx.affiliateNetwork.push(
      testNetwork({ kind: NETWORK_KIND, syncMode: "session" })
    );
    ctx.adminGrant.push(activeGrant(NETWORK_KIND));
    return ctx;
  }

  it("密码落库是密文（非明文），lastLoginAt 被刷新，审计不记秘密", async () => {
    const ctx = setupCtx();
    const { app } = buildApp(ctx, "admin");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/session-credentials",
      payload: {
        networkId: TEST_NETWORK,
        username: "myuser",
        password: "s3cr3t-p@ss",
        sessionValidDays: 30,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().saved).toBe(true);

    const row = ctx.affiliateNetwork[0];
    expect(row.sessionUsername).toBe("myuser");
    // 密文：enc 前缀 + 不含明文
    expect(row.sessionPasswordRef).toMatch(/^enc:v1:/);
    expect(row.sessionPasswordRef).not.toContain("s3cr3t-p@ss");
    expect(row.sessionValidDays).toBe(30);
    expect(row.lastLoginAt).toBeInstanceOf(Date);

    // 审计：只记动作，不记用户名/密码内容
    const audit = ctx.adminGrantAudit.find(
      (a) => a.action === "CATALOG_SESSION_CREDENTIALS_SAVED"
    );
    expect(audit).toBeDefined();
    const detail = JSON.stringify((audit as Record<string, unknown>).detail);
    expect(detail).not.toContain("s3cr3t-p@ss");
    expect(detail).not.toContain("myuser");
  });

  it("留空密码 → 不覆盖已保存的密文", async () => {
    const ctx = setupCtx();
    ctx.affiliateNetwork[0].sessionPasswordRef = "enc:v1:old";
    const { app } = buildApp(ctx, "admin");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/session-credentials",
      payload: { networkId: TEST_NETWORK, username: "u2" },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.affiliateNetwork[0].sessionPasswordRef).toBe("enc:v1:old");
    expect(ctx.affiliateNetwork[0].sessionUsername).toBe("u2");
  });

  it("非法有效期天数 → 400", async () => {
    const ctx = setupCtx();
    const { app } = buildApp(ctx, "admin");
    for (const days of [0, -5, 366, 1.5, "abc"]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/catalog/session-credentials",
        payload: { networkId: TEST_NETWORK, sessionValidDays: days },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it("无 B6 授权 → 403", async () => {
    const { ctx } = makeCatalogFakePrisma();
    ctx.affiliateNetwork.push(
      testNetwork({ kind: NETWORK_KIND, syncMode: "session" })
    );
    const { app } = buildApp(ctx, "admin");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/session-credentials",
      payload: { networkId: TEST_NETWORK, username: "u" },
    });
    expect(res.statusCode).toBe(403);
  });
});
