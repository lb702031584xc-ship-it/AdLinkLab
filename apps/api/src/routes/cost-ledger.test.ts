/**
 * 清单 #1 — 成本账路由测试。
 * In-memory fake Prisma + Fastify inject；auth 用 disabled 模式，
 * 以 x-tenant-id 头区分租户（与 budget-rules.test.ts 同写法）。
 * prisma 用 mock，不连真实数据库。
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { registerCostLedgerRoutes } from "./cost-ledger.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";

interface Ctx {
  params: any[];
  offers: any[];
}

function buildApp(ctx: Ctx) {
  const fake = {
    riskParam: {
      findMany: async (args: any) =>
        ctx.params.filter((p) => p.tenantId === args.where.tenantId),
      findUnique: async (args: any) => {
        const w = args.where.tenantId_network_operationType;
        return (
          ctx.params.find(
            (p) =>
              p.tenantId === w.tenantId &&
              p.network === w.network &&
              p.operationType === w.operationType
          ) ?? null
        );
      },
      upsert: async (args: any) => {
        const w = args.where.tenantId_network_operationType;
        const hit = ctx.params.find(
          (p) =>
            p.tenantId === w.tenantId &&
            p.network === w.network &&
            p.operationType === w.operationType
        );
        if (hit) {
          Object.assign(hit, args.update);
          return hit;
        }
        const row = { ...args.create };
        ctx.params.push(row);
        return row;
      },
    },
    offer: {
      findFirst: async (args: any) =>
        ctx.offers.find(
          (o) =>
            o.id === args.where.id && o.tenantId === args.where.tenantId
        ) ?? null,
    },
  };
  const app = Fastify({ logger: false });
  const services = { prisma: fake as unknown as PrismaClient };
  const auth = { mode: "disabled" as const, registry: [] };
  return registerCostLedgerRoutes(app, services, auth).then(() => app);
}

function headers(tenant = TENANT) {
  return { "content-type": "application/json", "x-tenant-id": tenant };
}

describe("cost-ledger routes", () => {
  it("GET risk-params 只列本租户覆盖值；POST upsert 创建后再改写", async () => {
    const ctx: Ctx = {
      params: [
        {
          tenantId: OTHER_TENANT,
          network: "Admitad",
          operationType: "DIRECT_LINK",
          banProbability: 0.9,
        },
      ],
      offers: [],
    };
    const app = await buildApp(ctx);

    const empty = await app.inject({
      method: "GET",
      url: "/api/v1/cost-ledger/risk-params",
      headers: headers(),
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().params).toEqual([]);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/cost-ledger/risk-params",
      headers: headers(),
      payload: {
        network: "Admitad",
        operationType: "DIRECT_LINK",
        banProbability: 0.2,
      },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().param).toMatchObject({
      network: "Admitad",
      operationType: "DIRECT_LINK",
      banProbability: 0.2,
    });

    const updated = await app.inject({
      method: "POST",
      url: "/api/v1/cost-ledger/risk-params",
      headers: headers(),
      payload: {
        network: "Admitad",
        operationType: "DIRECT_LINK",
        banProbability: 0.35,
      },
    });
    expect(updated.json().param.banProbability).toBe(0.35);

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/cost-ledger/risk-params",
      headers: headers(),
    });
    expect(list.json().params).toHaveLength(1);

    const other = await app.inject({
      method: "GET",
      url: "/api/v1/cost-ledger/risk-params",
      headers: headers(OTHER_TENANT),
    });
    expect(other.json().params).toHaveLength(1);
    expect(other.json().params[0].banProbability).toBe(0.9);
  });

  it("POST 校验：banProbability 超出 0–1、缺 network 均 400", async () => {
    const app = await buildApp({ params: [], offers: [] });
    for (const payload of [
      { network: "Admitad", operationType: "OTHER", banProbability: 1.5 },
      { network: "Admitad", operationType: "OTHER", banProbability: -0.1 },
      { network: "Admitad", operationType: "OTHER" },
      { operationType: "OTHER", banProbability: 0.5 },
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/cost-ledger/risk-params",
        headers: headers(),
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it("GET evaluate：默认值按操作类型区分，覆盖值优先，算术与比值正确", async () => {
    const ctx: Ctx = {
      params: [
        {
          tenantId: TENANT,
          network: "Admitad",
          operationType: "DIRECT_LINK",
          banProbability: 0.2,
        },
      ],
      offers: [],
    };
    const app = await buildApp(ctx);

    // 覆盖值优先：0.2 × (100 + 50) = 30；30 / 60 = 0.5
    const overridden = await app.inject({
      method: "GET",
      url: "/api/v1/cost-ledger/evaluate?network=Admitad&operationType=DIRECT_LINK&balanceUsd=100&pendingUsd=50&expectedProfitUsd=60",
      headers: headers(),
    });
    expect(overridden.statusCode).toBe(200);
    expect(overridden.json()).toMatchObject({
      network: "Admitad",
      operationType: "DIRECT_LINK",
      banProbability: 0.2,
      banProbabilitySource: "override",
      sunkCost: 150,
      expectedLossUsd: 30,
      lossToProfitRatio: 0.5,
      riskTier: "high-reward-high-risk",
      offer: null,
    });

    // 默认值：品牌词 0.25；直链 0.15；其他 0.10
    const brand = await app.inject({
      method: "GET",
      url: "/api/v1/cost-ledger/evaluate?network=UnknownNet&operationType=BRAND_KEYWORD&balanceUsd=200&pendingUsd=0",
      headers: headers(),
    });
    expect(brand.json()).toMatchObject({
      banProbability: 0.25,
      banProbabilitySource: "default",
      sunkCost: 200,
      expectedLossUsd: 50,
      lossToProfitRatio: null, // 预期利润未知 → null，不编比值
      riskTier: "high-reward-high-risk",
    });

    const other = await app.inject({
      method: "GET",
      url: "/api/v1/cost-ledger/evaluate?network=UnknownNet&operationType=DISPLAY&balanceUsd=80&pendingUsd=20&expectedProfitUsd=0",
      headers: headers(),
    });
    expect(other.json()).toMatchObject({
      operationType: "OTHER", // 未知操作类型归入 OTHER
      banProbability: 0.1,
      banProbabilitySource: "default",
      sunkCost: 100,
      expectedLossUsd: 10,
      lossToProfitRatio: null, // 预期利润 ≤0 → null
      riskTier: "standard",
    });
  });

  it("GET evaluate：offerId 原样展示 verdict、不拦截；无此 Offer 则 404；缺 network 则 400", async () => {
    const ctx: Ctx = {
      params: [],
      offers: [
        {
          id: "offer-1",
          tenantId: TENANT,
          prescreenVerdict: "stop",
          prescreenReason: "广告数为 0",
        },
      ],
    };
    const app = await buildApp(ctx);

    // verdict=stop 也只展示：照常 200，不拦截
    const shown = await app.inject({
      method: "GET",
      url: "/api/v1/cost-ledger/evaluate?network=Admitad&operationType=DIRECT_LINK&offerId=offer-1",
      headers: headers(),
    });
    expect(shown.statusCode).toBe(200);
    expect(shown.json().offer).toMatchObject({
      id: "offer-1",
      prescreenVerdict: "stop",
      prescreenReason: "广告数为 0",
    });

    const missing = await app.inject({
      method: "GET",
      url: "/api/v1/cost-ledger/evaluate?network=Admitad&offerId=nope",
      headers: headers(),
    });
    expect(missing.statusCode).toBe(404);

    const noNetwork = await app.inject({
      method: "GET",
      url: "/api/v1/cost-ledger/evaluate?operationType=DIRECT_LINK",
      headers: headers(),
    });
    expect(noNetwork.statusCode).toBe(400);
  });

  it("GET bid-math 默认 CPC $0.20、ROI 2：EPC 须 $0.40；payout 反推 CR；$100 买 500 点击", async () => {
    const app = await buildApp({ params: [], offers: [] });

    // 默认口径：$0.20 × 2 = $0.40 EPC；$100 预算买 500 点击
    const defaults = await app.inject({
      method: "GET",
      url: "/api/v1/cost-ledger/bid-math?budgetUsd=100",
      headers: headers(),
    });
    expect(defaults.statusCode).toBe(200);
    expect(defaults.json()).toMatchObject({
      cpcUsd: 0.2,
      roiTarget: 2,
      requiredEpcUsd: 0.4,
      clicksForBudget: 500,
    });
    expect(defaults.json().scaleNote).toContain("500");

    // $2 SOI：0.20 × 2 / 2 = 20% CR
    const soi = await app.inject({
      method: "GET",
      url: "/api/v1/cost-ledger/bid-math?payoutUsd=2",
      headers: headers(),
    });
    expect(soi.json().requiredCr).toBe(0.2);

    // $13.50 注册：0.20 × 2 / 13.50 ≈ 3% CR
    const reg = await app.inject({
      method: "GET",
      url: "/api/v1/cost-ledger/bid-math?payoutUsd=13.5",
      headers: headers(),
    });
    expect(reg.json().requiredCr).toBeCloseTo(0.0296, 4);

    // GEO/格式覆盖：cpcUsd 覆盖生效，geo/format 回显
    const override = await app.inject({
      method: "GET",
      url: "/api/v1/cost-ledger/bid-math?cpcUsd=0.05&roiTarget=2&payoutUsd=2&geo=BR&format=push",
      headers: headers(),
    });
    expect(override.json()).toMatchObject({
      cpcUsd: 0.05,
      requiredEpcUsd: 0.1,
      requiredCr: 0.05,
      geo: "BR",
      format: "push",
    });

    // 非法参数 400
    const bad = await app.inject({
      method: "GET",
      url: "/api/v1/cost-ledger/bid-math?cpcUsd=0",
      headers: headers(),
    });
    expect(bad.statusCode).toBe(400);
  });
});
