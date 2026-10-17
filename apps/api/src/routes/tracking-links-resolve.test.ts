/**
 * P2-7 只读解析 + §5 授权白名单 — 路由测试（fake prisma + fake fetch）。
 */
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import {
  registerTrackingLinkResolveRoutes,
  resolveSuffix,
} from "./tracking-links-resolve.js";

const TENANT = randomUUID();
const USER = randomUUID();

async function buildApp(opts: {
  ownedDomains: string;
  grants: Array<Record<string, unknown>>;
}) {
  const app = Fastify();
  const prisma = {
    aiSetting: {
      findUnique: async () => ({ value: opts.ownedDomains }),
    },
    adminGrant: {
      findMany: async () =>
        opts.grants.filter(
          (g) => g.tenantId === TENANT && g.capability === "tracking-link-resolve" && g.status === "active"
        ),
      findUnique: async () => null,
    },
  };
  // 会话钩子：把 sessionAuth 直接挂到请求上（绕过真实认证）。
  app.addHook("onRequest", async (req: any) => {
    req.sessionAuth = { id: USER, tenantId: TENANT, role: "member", email: "m@example.com" };
  });
  await registerTrackingLinkResolveRoutes(app as any, {
    prisma: prisma as any,
    fetchPageImpl: (async (url: string) => ({
      finalUrl: url + "/final",
      text: "",
      redirectChain: [{ url, status: 302 }],
    })) as any,
  });
  return app;
}

describe("POST /api/v1/tracking-links/resolve", () => {
  it("自有域名 → 解析成功，suffix = 最终 URL 路径+查询", async () => {
    const app = await buildApp({ ownedDomains: "example.com", grants: [] });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tracking-links/resolve",
      payload: { url: "https://go.example.com/click?x=1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.finalUrl).toBe("https://go.example.com/click?x=1/final");
    expect(body.suffix).toBe("/click?x=1/final");
    expect(body.hops).toBe(1);
    expect(body.viaGrant).toBe(false);
  });

  it("非自有域名且无授权 → 403 + 需申请提示", async () => {
    const app = await buildApp({ ownedDomains: "example.com", grants: [] });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tracking-links/resolve",
      payload: { url: "https://other.com/abc" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message ?? res.json().error).toMatch(/Grant required/);
  });

  it("非自有域名但白名单授权包含该域 → 解析成功", async () => {
    const app = await buildApp({
      ownedDomains: "example.com",
      grants: [
        {
          id: randomUUID(),
          tenantId: TENANT,
          capability: "tracking-link-resolve",
          whitelist: ["other.com"],
          usageLimit: {},
          usageCount: 0,
          status: "active",
          endsAt: new Date(Date.now() + 86400 * 1000),
        },
      ],
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tracking-links/resolve",
      payload: { url: "https://other.com/abc" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().viaGrant).toBe(true);
  });

  it("授权白名单不含该域 → 403（管理员也不能绕过）", async () => {
    const app = await buildApp({
      ownedDomains: "example.com",
      grants: [
        {
          id: randomUUID(),
          tenantId: TENANT,
          capability: "tracking-link-resolve",
          whitelist: ["allowed.com"],
          usageLimit: {},
          usageCount: 0,
          status: "active",
          endsAt: new Date(Date.now() + 86400 * 1000),
        },
      ],
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tracking-links/resolve",
      payload: { url: "https://other.com/abc" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("通配符白名单永不匹配", async () => {
    const app = await buildApp({
      ownedDomains: "",
      grants: [
        {
          id: randomUUID(),
          tenantId: TENANT,
          capability: "tracking-link-resolve",
          whitelist: ["*.other.com"],
          usageLimit: {},
          usageCount: 0,
          status: "active",
          endsAt: new Date(Date.now() + 86400 * 1000),
        },
      ],
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tracking-links/resolve",
      payload: { url: "https://sub.other.com/abc" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("过期授权 → 403", async () => {
    const app = await buildApp({
      ownedDomains: "",
      grants: [
        {
          id: randomUUID(),
          tenantId: TENANT,
          capability: "tracking-link-resolve",
          whitelist: ["other.com"],
          usageLimit: {},
          usageCount: 0,
          status: "active",
          endsAt: new Date(Date.now() - 1000),
        },
      ],
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tracking-links/resolve",
      payload: { url: "https://other.com/abc" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("resolveSuffix：路径 + 查询；无查询时只有路径", () => {
    expect(resolveSuffix("https://x.com/go/a?b=1")).toBe("/go/a?b=1");
    expect(resolveSuffix("https://x.com/")).toBe("/");
  });
});
