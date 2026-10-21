/**
 * paid-data 路由测试（Fastify inject + fake prisma）。
 * 锁死：GET /settings/dataforseo 永不回显明文（响应全文断言不含凭证）；
 * PUT 保存后 GET 只见 configured；DELETE 后回落未配置；
 * /paid-data/access 对 owner 直通、对无授权 member 返回结构化拒绝原因；
 * verify 用 fake fetch 模拟 appendix/user_data（不计费接口）。
 */
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { registerPaidDataRoutes } from "./paid-data.js";

function makeStore() {
  return new Map<string, string>();
}

function makePrisma(store: Map<string, string>) {
  const prisma = {
    tenantSetting: {
      findUnique: async ({
        where,
      }: {
        where: { tenant_settings_tenant_key_unique: { tenantId: string; key: string } };
      }) => {
        const u = where.tenant_settings_tenant_key_unique;
        const v = store.get(`${u.tenantId}|${u.key}`);
        return v === undefined ? null : { value: v };
      },
      upsert: async (args: {
        where: { tenant_settings_tenant_key_unique: { tenantId: string; key: string } };
        create: { value: string };
      }) => {
        const u = args.where.tenant_settings_tenant_key_unique;
        store.set(`${u.tenantId}|${u.key}`, args.create.value);
        return {};
      },
      deleteMany: async ({ where }: { where: { tenantId: string; key: string } }) => {
        store.delete(`${where.tenantId}|${where.key}`);
        return { count: 1 };
      },
    },
    aiSetting: { findUnique: async () => null },
    adminGrant: { findMany: async () => [] },
  };
  return prisma as unknown as PrismaClient;
}

function buildApp(role: string, store: Map<string, string>, fetchImpl?: typeof fetch) {
  const app = Fastify();
  app.addHook("preHandler", (request, _reply, done) => {
    (request as unknown as Record<string, unknown>).sessionAuth = {
      id: "u1",
      email: "u@test.dev",
      name: "U",
      role,
      tenantId: "t1",
    };
    done();
  });
  void registerPaidDataRoutes(app, { prisma: makePrisma(store), fetchImpl });
  return app;
}

describe("paid-data routes / BYOK", () => {
  it("PUT 保存 → GET 只回 configured，响应全文无明文", async () => {
    const store = makeStore();
    const app = buildApp("member", store);
    const put = await app.inject({
      method: "PUT",
      url: "/api/v1/settings/dataforseo",
      payload: { login: "me@example.com", password: "super-secret-pw" },
    });
    expect(put.statusCode).toBe(200);
    expect(put.body).not.toContain("super-secret-pw");
    expect(put.body).not.toContain("me@example.com");

    const get = await app.inject({ method: "GET", url: "/api/v1/settings/dataforseo" });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual({ configured: true, verifiedAt: null });
    expect(get.body).not.toContain("super-secret-pw");
    expect(get.body).not.toContain("me@example.com");
    await app.close();
  });

  it("DELETE 删除后 GET 回落未配置", async () => {
    const store = makeStore();
    const app = buildApp("member", store);
    await app.inject({
      method: "PUT",
      url: "/api/v1/settings/dataforseo",
      payload: { login: "a@b.c", password: "pw" },
    });
    const del = await app.inject({ method: "DELETE", url: "/api/v1/settings/dataforseo" });
    expect(del.statusCode).toBe(200);
    const get = await app.inject({ method: "GET", url: "/api/v1/settings/dataforseo" });
    expect(get.json()).toEqual({ configured: false, verifiedAt: null });
    await app.close();
  });

  it("verify：fake fetch 模拟 appendix/user_data 成功 → verified + 落验证时间", async () => {
    const store = makeStore();
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          status_code: 20000,
          status_message: "Ok.",
          tasks: [
            {
              result: [
                { login: "me@example.com", money: { balance: 12.5 } },
              ],
            },
          ],
        }),
        { status: 200 }
      )) as typeof fetch;
    const app = buildApp("member", store, fakeFetch);
    await app.inject({
      method: "PUT",
      url: "/api/v1/settings/dataforseo",
      payload: { login: "me@example.com", password: "pw" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/settings/dataforseo/verify",
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().verified).toBe(true);
    const get = await app.inject({ method: "GET", url: "/api/v1/settings/dataforseo" });
    expect(get.json().configured).toBe(true);
    expect(get.json().verifiedAt).toBeTruthy();
    await app.close();
  });

  it("access 预告：owner 直通 allowed/keySource=owner；member 无授权 → no_grant", async () => {
    const store = makeStore();
    const ownerApp = buildApp("owner", store);
    const r1 = await ownerApp.inject({
      method: "GET",
      url: "/api/v1/paid-data/access?feature=catalog-ad-count",
    });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ allowed: true, keySource: "owner" });
    await ownerApp.close();

    const memberApp = buildApp("member", store);
    const r2 = await memberApp.inject({
      method: "GET",
      url: "/api/v1/paid-data/access?feature=catalog-ad-count",
    });
    expect(r2.statusCode).toBe(200);
    expect(r2.json()).toMatchObject({ allowed: false, reason: "no_grant" });
    await memberApp.close();
  });

  it("access 预告：feature 非法 → 400", async () => {
    const app = buildApp("owner", makeStore());
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/paid-data/access?feature=nope",
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
