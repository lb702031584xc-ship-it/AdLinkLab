/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
/**
 * 广告数计算入口路由测试（Fastify inject + in-memory fake Prisma）：
 * POST /catalog/products/calc-ad-count 的 force/scope 透传与审计、
 * POST /catalog/products/calc-ad-count/preview 的网关判定合并与
 * 非法 scope 400。calc/preview 本体以 vi.mock 替身捕获入参（服务层
 * 行为由 brand-ad-count.test.ts 覆盖）。
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { registerCatalogRoutes } from "./catalog.js";
import {
  makeCatalogFakePrisma,
  TEST_TENANT,
  TEST_USER,
  type CatalogFakeCtx,
} from "../services/catalog-fake-prisma.js";
import type { OfferService } from "../services/offer-engine.js";

const mocks = vi.hoisted(() => ({
  calc: vi.fn(),
  preview: vi.fn(),
}));

vi.mock("../services/brand-ad-count.js", async (importOriginal) => {
  const orig = await importOriginal<any>();
  return {
    ...orig,
    calcBrandAdCounts: mocks.calc,
    previewBrandAdCounts: mocks.preview,
  };
});

function buildApp(
  ctx: CatalogFakeCtx,
  role: "owner" | "member"
): { app: ReturnType<typeof Fastify> } {
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
    create: async () => {
      throw new Error("not used");
    },
  } as unknown as OfferService;
  void registerCatalogRoutes(app, { prisma, offers });
  return { app };
}

function setup(role: "owner" | "member") {
  const { ctx } = makeCatalogFakePrisma();
  mocks.calc.mockReset().mockResolvedValue({
    groupsQueried: 2,
    groupsSkippedCache: 1,
    skippedDeadGroups: 3,
    productsUpdated: 5,
    errors: [],
  });
  mocks.preview.mockReset().mockResolvedValue({
    groupsTotal: 10,
    groupsFresh: 4,
    groupsStale: 6,
    deadGroupsSkipped: 2,
    maxQueriesPerGroup: 12,
    depth: 12,
    expectedQueries: 40,
    worstCaseQueries: 72,
    unitPriceUsd: 0.002,
    estimatedCostUsd: 0.08,
  });
  return { ctx, app: buildApp(ctx, role).app };
}

describe("POST /catalog/products/calc-ad-count", () => {
  it("force/scope 透传给 calc（alive → aliveOnly），审计带 force/scope", async () => {
    const { ctx, app } = setup("owner");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/products/calc-ad-count",
      payload: { force: true, scope: "alive" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.groupsQueried).toBe(2);
    expect(body.skippedDeadGroups).toBe(3);
    expect(mocks.calc).toHaveBeenCalledTimes(1);
    const deps = mocks.calc.mock.calls[0][3];
    expect(deps.force).toBe(true);
    expect(deps.aliveOnly).toBe(true);
    const audit = ctx.adminGrantAudit.find(
      (a) => a.action === "catalog.calc_ad_count"
    );
    expect(audit?.detail.force).toBe(true);
    expect(audit?.detail.scope).toBe("alive");
  });

  it("缺省 body：force=false、scope=all（aliveOnly=false）", async () => {
    const { app } = setup("owner");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/products/calc-ad-count",
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const deps = mocks.calc.mock.calls[0][3];
    expect(deps.force).toBe(false);
    expect(deps.aliveOnly).toBe(false);
  });

  it("force 非 true（字符串）不生效", async () => {
    const { app } = setup("owner");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/products/calc-ad-count",
      payload: { force: "yes" },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.calc.mock.calls[0][3].force).toBe(false);
  });

  it("非法 scope → 400，calc 不被调用", async () => {
    const { app } = setup("owner");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/products/calc-ad-count",
      payload: { scope: "bogus" },
    });
    expect(res.statusCode).toBe(400);
    expect(mocks.calc).not.toHaveBeenCalled();
  });

  it("depth 透传给 calc，审计带 depth", async () => {
    const { ctx, app } = setup("owner");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/products/calc-ad-count",
      payload: { depth: 8 },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.calc.mock.calls[0][3].depth).toBe(8);
    const audit = ctx.adminGrantAudit.find(
      (a) => a.action === "catalog.calc_ad_count"
    );
    expect(audit?.detail.depth).toBe(8);
  });

  it("缺省 depth：deps.depth 为 undefined（服务层默认 12），审计记 12", async () => {
    const { ctx, app } = setup("owner");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/products/calc-ad-count",
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.calc.mock.calls[0][3].depth).toBeUndefined();
    const audit = ctx.adminGrantAudit.find(
      (a) => a.action === "catalog.calc_ad_count"
    );
    expect(audit?.detail.depth).toBe(12);
  });

  it("非法 depth（5 / 字符串）→ 400，calc 不被调用", async () => {
    const { app } = setup("owner");
    for (const depth of [5, "12", 0]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/catalog/products/calc-ad-count",
        payload: { depth },
      });
      expect(res.statusCode).toBe(400);
    }
    expect(mocks.calc).not.toHaveBeenCalled();
  });
});

describe("POST /catalog/products/calc-ad-count/preview", () => {
  it("owner：allowed + keySource=owner + 预估数字合并返回", async () => {
    const { app } = setup("owner");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/products/calc-ad-count/preview",
      payload: { scope: "alive" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      allowed: true,
      keySource: "owner",
      groupsTotal: 10,
      groupsFresh: 4,
      groupsStale: 6,
      deadGroupsSkipped: 2,
      // 每组最坏查询数口径（深度 12）随预估一并带出，供确认框估算。
      maxQueriesPerGroup: 12,
      // 深度回显 + 费用预估（预计查询数/最坏查询数/单价/预计费用）。
      depth: 12,
      expectedQueries: 40,
      worstCaseQueries: 72,
      unitPriceUsd: 0.002,
      estimatedCostUsd: 0.08,
    });
    expect(mocks.preview).toHaveBeenCalledWith(
      expect.anything(),
      TEST_TENANT,
      { aliveOnly: true, force: false, depth: undefined }
    );
  });

  it("depth/force 透传给 preview（切换深度重新预估的入参面）", async () => {
    const { app } = setup("owner");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/products/calc-ad-count/preview",
      payload: { scope: "all", depth: 4, force: true },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.preview).toHaveBeenCalledWith(
      expect.anything(),
      TEST_TENANT,
      { aliveOnly: false, force: true, depth: 4 }
    );
  });

  it("非法 depth → 400，preview 不被调用", async () => {
    const { app } = setup("owner");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/products/calc-ad-count/preview",
      payload: { depth: 6 },
    });
    expect(res.statusCode).toBe(400);
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("member 无授权：allowed=false、keySource=null，预估数字仍返回", async () => {
    const { app } = setup("member");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/products/calc-ad-count/preview",
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.allowed).toBe(false);
    expect(body.keySource).toBeNull();
    expect(body.groupsTotal).toBe(10);
  });

  it("非法 scope → 400，preview 不被调用", async () => {
    const { app } = setup("owner");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/products/calc-ad-count/preview",
      payload: { scope: "dead-only" },
    });
    expect(res.statusCode).toBe(400);
    expect(mocks.preview).not.toHaveBeenCalled();
  });
});
