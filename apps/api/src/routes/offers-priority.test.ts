/**
 * Offer 测试优先分 — 路由契约测试（buildApp + memory 服务 + fake prisma 注入）：
 * - GET /api/v1/offers 默认：每条带 testPriority（score + reasons）
 * - ?sort=priority：按分数降序（与默认插入序不同，证明排序生效）、分页切页正确
 * - 商品关联（catalog 幂等键 → fake NetworkProduct 广告数据）穿透全栈生效
 * - 租户隔离：别的租户看不到本租户 Offer
 *
 * fake prisma 只补路由级联会碰的表（networkProduct / offerMetrics /
 * aiPrompt / ipBan / session），与生产注册路径一致。
 */
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@adlinklab/database";
import { buildApp, createServices } from "../app.js";

const T = "t-offer-priority";
const T_OTHER = "t-offer-priority-other";
const NET = "net-prio-1";

interface ProductRow {
  tenantId: string;
  networkId: string;
  externalId: string;
  adCount: number | null;
  lastAdCount: number | null;
}

function makeFakePrisma(pool: ProductRow[]) {
  return {
    networkProduct: {
      findMany: async (args: {
        where: {
          tenantId: string;
          OR?: Array<{ networkId: string; externalId: string }>;
        };
      }) =>
        pool
          .filter(
            (r) =>
              r.tenantId === args.where.tenantId &&
              (args.where.OR ?? []).some(
                (p) => p.networkId === r.networkId && p.externalId === r.externalId
              )
          )
          .map((r) => ({
            networkId: r.networkId,
            externalId: r.externalId,
            adCount: r.adCount,
            lastAdCount: r.lastAdCount,
          })),
    },
    offerMetrics: { findMany: async () => [] },
    aiPrompt: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async () => ({}),
      updateMany: async () => ({ count: 0 }),
    },
    ipBan: { findMany: async () => [] },
    session: {
      findUnique: async () => null,
      create: async () => ({}),
      delete: async () => ({}),
      deleteMany: async () => ({ count: 0 }),
    },
  };
}

interface OfferItem {
  id: string;
  name: string;
  testPriority?: { score: number; reasons: string[] };
}

async function buildSeededApp() {
  const services = createServices();
  const pool: ProductRow[] = [
    { tenantId: T, networkId: NET, externalId: "ext-sweet", adCount: 10, lastAdCount: 8 },
  ];
  services.prisma = makeFakePrisma(pool) as unknown as PrismaClient;
  // 播种顺序即 memory 仓库的默认列表序：rich(47) → sweet(61) → poor(25)，
  // 与优先分序不同，排序断言才有区分度。
  const mk = (input: Parameters<typeof services.offers.create>[0]) =>
    services.offers.create({ destinationUrl: "https://example.com/landing", ...input });
  const rich = await mk({
    tenantId: T,
    name: "plain-rich",
    network: "yeahpromos",
    commissionValue: 60,
    commissionType: "fixed",
  });
  const sweet = await mk({
    tenantId: T,
    name: "catalog-sweet",
    network: "yeahpromos",
    commissionValue: 10,
    commissionType: "FIXED",
    idempotencyKey: `catalog:${NET}:ext-sweet`,
  });
  const poor = await mk({
    tenantId: T,
    name: "plain-poor",
    network: "yeahpromos",
    commissionValue: 2,
    commissionType: "fixed",
  });
  const app = await buildApp(services);
  return {
    app,
    ids: {
      rich: rich.offer.id,
      sweet: sweet.offer.id,
      poor: poor.offer.id,
    },
  };
}

async function listOffers(
  app: Awaited<ReturnType<typeof buildApp>>,
  url: string,
  tenant = T
) {
  const res = await app.inject({
    method: "GET",
    url,
    headers: { "x-tenant-id": tenant },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as {
    items: OfferItem[];
    total: number;
    page: number;
    pageSize: number;
  };
}

describe("GET /api/v1/offers 测试优先分", () => {
  it("默认列表：每条带 testPriority，分数与纯函数口径一致", async () => {
    const { app, ids } = await buildSeededApp();
    try {
      const body = await listOffers(app, "/api/v1/offers");
      expect(body.total).toBe(3);
      const byId = new Map(body.items.map((o) => [o.id, o]));
      // 未初筛 5 + 广告中性 12 + 佣金 $60→30 = 47
      expect(byId.get(ids.rich)?.testPriority?.score).toBe(47);
      // 未初筛 5 + sweet 40（active +2 封顶）+ 佣金 $10→16 = 61
      expect(byId.get(ids.sweet)?.testPriority?.score).toBe(61);
      expect(byId.get(ids.sweet)?.testPriority?.reasons).toContain("广告稳定投放（甜蜜点）");
      // 未初筛 5 + 中性 12 + 佣金 $2→8 = 25
      expect(byId.get(ids.poor)?.testPriority?.score).toBe(25);
      for (const o of body.items) {
        expect(Array.isArray(o.testPriority?.reasons)).toBe(true);
      }
    } finally {
      await app.close();
    }
  });

  it("sort=priority：按分数降序，与默认顺序不同", async () => {
    const { app, ids } = await buildSeededApp();
    try {
      const def = await listOffers(app, "/api/v1/offers");
      const prio = await listOffers(app, "/api/v1/offers?sort=priority");
      expect(def.items.map((o) => o.id)).toEqual([ids.rich, ids.sweet, ids.poor]);
      expect(prio.items.map((o) => o.id)).toEqual([ids.sweet, ids.rich, ids.poor]);
      expect(prio.items.map((o) => o.testPriority?.score)).toEqual([61, 47, 25]);
      expect(prio.total).toBe(3);
    } finally {
      await app.close();
    }
  });

  it("sort=priority 分页：pageSize=2 时第 2 页是第 3 名，total 不变", async () => {
    const { app, ids } = await buildSeededApp();
    try {
      const p1 = await listOffers(app, "/api/v1/offers?sort=priority&page=1&pageSize=2");
      expect(p1.items.map((o) => o.id)).toEqual([ids.sweet, ids.rich]);
      expect(p1.page).toBe(1);
      expect(p1.pageSize).toBe(2);
      const p2 = await listOffers(app, "/api/v1/offers?sort=priority&page=2&pageSize=2");
      expect(p2.items.map((o) => o.id)).toEqual([ids.poor]);
      expect(p2.total).toBe(3);
    } finally {
      await app.close();
    }
  });

  it("租户隔离：别的租户默认与 priority 排序都看不到本租户 Offer", async () => {
    const { app } = await buildSeededApp();
    try {
      const def = await listOffers(app, "/api/v1/offers", T_OTHER);
      expect(def.total).toBe(0);
      expect(def.items).toEqual([]);
      const prio = await listOffers(app, "/api/v1/offers?sort=priority", T_OTHER);
      expect(prio.total).toBe(0);
      expect(prio.items).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
