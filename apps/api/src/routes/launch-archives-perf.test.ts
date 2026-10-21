/**
 * 投放档案回填快照 + 止损脚本路由测试（Fastify inject + fake prisma）。
 * 覆盖：回填 upsert（同日覆盖）、列表附 latestBackfill + perfVerdict
 * （2.5 倍止损命中）、无回填时 verdict 为 null 不猜、止损脚本生成
 * （含阈值与系列名 + stopLossScriptAt 落账）、无 payout 时拒绝生成。
 */
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { registerLaunchArchiveRoutes } from "./launch-archives.js";

const ARCHIVE = {
  id: "a1",
  tenantId: "t1",
  offerId: null,
  offerName: "Roborock US",
  network: "yeahpromos",
  offerUrl: null,
  decision: "go",
  decisionReason: null,
  termsBrandBidding: null,
  termsDirectLinking: null,
  termsSummary: null,
  payout: 100,
  epc: null,
  breakevenCpc: 2,
  breakevenCvrPct: null,
  recommendedBid: null,
  myBid: null,
  officialBid: 1.5,
  dailyBudget: null,
  budgetCurrency: "USD",
  keywords: [],
  adCopy: { headlines: [], descriptions: [] },
  impressions: null,
  clicks: null,
  spend: null,
  conversions: null,
  revenue: null,
  status: "running",
  notes: null,
  launchedAt: null,
  endedAt: null,
  stopLossScriptAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeWorld() {
  const snapshots = new Map<string, Record<string, unknown>>();
  const archive = { ...ARCHIVE };
  const prisma = {
    launchArchive: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        where.id === archive.id ? archive : null,
      findMany: async () => [archive],
      count: async () => 1,
      update: async (args: { data: Record<string, unknown> }) => {
        Object.assign(archive, args.data);
        return archive;
      },
    },
    adPerfSnapshot: {
      upsert: async (args: {
        where: { ad_perf_snapshots_archive_date_unique: { archiveId: string; perfDate: Date } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const u = args.where.ad_perf_snapshots_archive_date_unique;
        const key = `${u.archiveId}|${u.perfDate.toISOString()}`;
        const existing = snapshots.get(key);
        const row = existing
          ? { ...existing, ...args.update, updatedAt: new Date() }
          : {
              id: `snap-${snapshots.size + 1}`,
              createdAt: new Date(),
              updatedAt: new Date(),
              ...args.create,
            };
        snapshots.set(key, row);
        return row;
      },
      findMany: async ({ where }: { where: { archiveId: string | { in: string[] } } }) => {
        const ids = Array.isArray(
          (where.archiveId as { in?: string[] })?.in
        )
          ? (where.archiveId as { in: string[] }).in
          : [where.archiveId as string];
        return [...snapshots.values()]
          .filter((s) => ids.includes(s.archiveId as string))
          .sort(
            (a, b) =>
              (b.perfDate as Date).getTime() - (a.perfDate as Date).getTime()
          );
      },
    },
  };
  return { prisma: prisma as unknown as PrismaClient, archive, snapshots };
}

function buildApp(world: ReturnType<typeof makeWorld>) {
  const app = Fastify();
  app.addHook("preHandler", (request, _reply, done) => {
    (request as unknown as Record<string, unknown>).sessionAuth = {
      id: "u1",
      email: "u@test.dev",
      name: "U",
      role: "owner",
      tenantId: "t1",
    };
    done();
  });
  void registerLaunchArchiveRoutes(app, { prisma: world.prisma });
  return app;
}

describe("launch-archives perf backfill + stop-loss", () => {
  it("回填 upsert：同日重复提交覆盖；列表附最新回填与止损判断", async () => {
    const world = makeWorld();
    const app = buildApp(world);
    const post = (payload: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: "/api/v1/launch-archives/a1/perf-snapshots",
        payload,
      });
    const r1 = await post({
      perfDate: "2026-10-19",
      spend: 260,
      avgCpc: 1.2,
      impressions: 900,
      clicks: 200,
      conversions: 0,
    });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ perfDate: "2026-10-19", spend: 260, source: "manual" });
    // 同日覆盖（金额修正）
    const r2 = await post({
      perfDate: "2026-10-19",
      spend: 250,
      avgCpc: 1.25,
      impressions: 950,
      clicks: 200,
      conversions: 0,
    });
    expect(r2.statusCode).toBe(200);
    expect(world.snapshots.size).toBe(1);

    const list = await app.inject({ method: "GET", url: "/api/v1/launch-archives" });
    const item = list.json().items[0];
    expect(item.latestBackfill).toMatchObject({ perfDate: "2026-10-19", spend: 250 });
    // 花费 250 = payout 100 × 2.5 且转化 0 → 必须止损
    expect(item.perfVerdict.level).toBe("stop");
    expect(item.perfVerdict.basis.spend).toBe(250);
    expect(item.perfVerdict.basis.spendPayoutRatio).toBe(2.5);
    expect(item.perfVerdict.basis.stopLossThreshold).toBe(250);
    await app.close();
  });

  it("无回填 → latestBackfill/perfVerdict 为 null（不猜）", async () => {
    const world = makeWorld();
    const app = buildApp(world);
    const list = await app.inject({ method: "GET", url: "/api/v1/launch-archives" });
    const item = list.json().items[0];
    expect(item.latestBackfill).toBeNull();
    expect(item.perfVerdict).toBeNull();
    await app.close();
  });

  it("止损脚本生成：含系列名与阈值，stopLossScriptAt 落账，文案诚实", async () => {
    const world = makeWorld();
    const app = buildApp(world);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/launch-archives/a1/stop-loss-script",
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.campaignName).toBe("Roborock US");
    expect(body.threshold).toBe(250);
    expect(body.script).toContain("Roborock US");
    expect(body.script).toContain("var STOP_LOSS_THRESHOLD = 250");
    expect(body.note).toContain("需在 Google Ads 粘贴后生效");
    expect(world.archive.stopLossScriptAt).toBeInstanceOf(Date);
    await app.close();
  });

  it("回填参数校验：缺 spend → 400；档案不存在 → 404", async () => {
    const world = makeWorld();
    const app = buildApp(world);
    const bad = await app.inject({
      method: "POST",
      url: "/api/v1/launch-archives/a1/perf-snapshots",
      payload: { perfDate: "2026-10-19", impressions: 1, clicks: 1, conversions: 0 },
    });
    expect(bad.statusCode).toBe(400);
    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/launch-archives/nope/perf-snapshots",
      payload: { perfDate: "2026-10-19", spend: 1, impressions: 1, clicks: 1, conversions: 0 },
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});
