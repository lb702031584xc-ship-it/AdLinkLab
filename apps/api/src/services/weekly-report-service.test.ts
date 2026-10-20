/**
 * Automation round 2 — weekly report service tests.
 * In-memory fake Prisma; chatJson is injected (no network, no crypto).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@adlinklab/database";
import {
  affiliateConversionRate,
  generateWeeklyReport,
  getLastWeekRange,
  getPrevWeekRange,
  getWeeklyReport,
  listWeeklyReports,
  netValidOrderCount,
  roiStatusFor,
  sendViaEmail,
  type WeeklyReportData,
} from "./weekly-report-service.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const TENANT_B = "00000000-0000-4000-8000-000000000002";

const WEEK_START = new Date("2026-09-28T04:00:00.000Z"); // Mon 00:00 America/New_York (EDT)
const WEEK_END = new Date("2026-10-05T03:59:59.999Z"); // Sun 23:59:59.999 EDT

type Row = Record<string, any>;

function inRange(v: Date, where: any): boolean {
  const gte = where?.gte as Date | undefined;
  const lte = where?.lte as Date | undefined;
  if (gte && v < gte) return false;
  if (lte && v > lte) return false;
  return true;
}

function mkFakePrisma() {
  const clicks: Row[] = [];
  const conversions: Row[] = [];
  const alerts: Row[] = [];
  const healthChecks: Row[] = [];
  const suggestions: Row[] = [];
  const lpTasks: Row[] = [];
  const offers: Row[] = [];
  const reports: Row[] = [];

  const prisma: any = {
    click: {
      count: async ({ where }: any) =>
        clicks.filter(
          (r) =>
            r.tenantId === where.tenantId &&
            inRange(r.createdAt, where.createdAt) &&
            !(where.NOT?.isTest === true && r.isTest === true),
        ).length,
      groupBy: async ({ where }: any) => {
        const groups = new Map<string, number>();
        for (const r of clicks) {
          if (r.tenantId !== where.tenantId) continue;
          if (!inRange(r.createdAt, where.createdAt)) continue;
          if (where.NOT?.isTest === true && r.isTest === true) continue;
          if (r.offerId == null) continue;
          groups.set(r.offerId, (groups.get(r.offerId) ?? 0) + 1);
        }
        return [...groups.entries()].map(([offerId, n]) => ({
          offerId,
          _count: { offerId: n },
        }));
      },
    },
    conversion: {
      findMany: async ({ where }: any) =>
        conversions
          .filter(
            (r) =>
              r.tenantId === where.tenantId &&
              inRange(r.conversionTime, where.conversionTime),
          )
          .map((r) => ({
            value: r.value,
            id: r.id,
            status: r.status,
            orders: r.orders,
            click: { offerId: r.offerId ?? null },
          })),
    },
    alert: {
      count: async ({ where }: any) =>
        alerts.filter(
          (r) =>
            r.tenantId === where.tenantId &&
            inRange(r.createdAt, where.createdAt),
        ).length,
      groupBy: async ({ where }: any) => {
        const groups = new Map<string, number>();
        for (const r of alerts) {
          if (r.tenantId !== where.tenantId) continue;
          if (!inRange(r.createdAt, where.createdAt)) continue;
          groups.set(r.severity, (groups.get(r.severity) ?? 0) + 1);
        }
        return [...groups.entries()].map(([severity, n]) => ({
          severity,
          _count: { severity: n },
        }));
      },
    },
    linkHealthCheck: {
      count: async ({ where }: any) =>
        healthChecks.filter(
          (r) =>
            r.tenantId === where.tenantId &&
            inRange(r.checkedAt, where.checkedAt) &&
            (where.isAlive === undefined || r.isAlive === where.isAlive),
        ).length,
    },
    searchTermSuggestion: {
      count: async ({ where }: any) =>
        suggestions.filter(
          (r) =>
            r.tenantId === where.tenantId &&
            inRange(r.createdAt, where.createdAt) &&
            (where.status === undefined || r.status === where.status),
        ).length,
    },
    landingPageOptimizationTask: {
      count: async ({ where }: any) =>
        lpTasks.filter(
          (r) =>
            r.tenantId === where.tenantId &&
            inRange(r.createdAt, where.createdAt),
        ).length,
    },
    offer: {
      findMany: async ({ where }: any) =>
        offers
          .filter(
            (r) =>
              r.tenantId === where.tenantId && where.id.in.includes(r.id),
          )
          .map((r) => ({ id: r.id, name: r.name, network: r.network })),
    },
    aiSetting: { findMany: async () => [] },
    weeklyReport: {
      upsert: async ({ where, create, update }: any) => {
        const key = where.tenantId_weekStart_weekEnd;
        const existing = reports.find(
          (r) =>
            r.tenantId === key.tenantId &&
            r.weekStart.getTime() === key.weekStart.getTime() &&
            r.weekEnd.getTime() === key.weekEnd.getTime(),
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { ...create, createdAt: new Date() };
        reports.push(row);
        return row;
      },
      findMany: async ({ where, orderBy }: any) => {
        let out = reports.filter((r) => r.tenantId === where.tenantId);
        if (orderBy?.weekStart === "desc") {
          out = [...out].sort(
            (a, b) => b.weekStart.getTime() - a.weekStart.getTime(),
          );
        }
        return out;
      },
      findFirst: async ({ where }: any) =>
        reports.find((r) => r.id === where.id && r.tenantId === where.tenantId) ??
        null,
    },
  };
  return {
    prisma: prisma as unknown as PrismaClient,
    seed: { clicks, conversions, alerts, healthChecks, suggestions, lpTasks, offers, reports },
  };
}

function seedBasics(seed: ReturnType<typeof mkFakePrisma>["seed"]) {
  const t = (d: string) => new Date(d);
  seed.offers.push(
    { id: "offer-a", tenantId: TENANT, name: "Offer A", network: "Impact" },
    { id: "offer-b", tenantId: TENANT, name: "Offer B", network: "CJ" },
  );
  // 3 real clicks (2 on offer-a, 1 on offer-b) + 1 test click (offer-a) + 1 out-of-range click
  seed.clicks.push(
    { tenantId: TENANT, createdAt: t("2026-09-29T10:00:00Z"), isTest: false, offerId: "offer-a" },
    { tenantId: TENANT, createdAt: t("2026-09-30T10:00:00Z"), isTest: false, offerId: "offer-a" },
    { tenantId: TENANT, createdAt: t("2026-10-01T10:00:00Z"), isTest: false, offerId: "offer-b" },
    { tenantId: TENANT, createdAt: t("2026-10-02T10:00:00Z"), isTest: true, offerId: "offer-a" },
    { tenantId: TENANT, createdAt: t("2026-09-20T10:00:00Z"), isTest: false, offerId: "offer-a" },
    { tenantId: TENANT_B, createdAt: t("2026-10-01T10:00:00Z"), isTest: false, offerId: "offer-a" },
  );
  seed.conversions.push(
    { tenantId: TENANT, conversionTime: t("2026-09-29T12:00:00Z"), value: 10, offerId: "offer-a" },
    { tenantId: TENANT, conversionTime: t("2026-09-30T12:00:00Z"), value: 25, offerId: "offer-a" },
    { tenantId: TENANT, conversionTime: t("2026-10-01T12:00:00Z"), value: 100, offerId: "offer-b" },
    // previous week baseline (rise/fall context)
    { tenantId: TENANT, conversionTime: t("2026-09-22T12:00:00Z"), value: 50, offerId: "offer-a" },
    { tenantId: TENANT, conversionTime: t("2026-09-22T12:00:00Z"), value: 20, offerId: "offer-b" },
  );
  seed.alerts.push(
    { tenantId: TENANT, createdAt: t("2026-10-01T10:00:00Z"), severity: "HIGH" },
    { tenantId: TENANT, createdAt: t("2026-10-02T10:00:00Z"), severity: "LOW" },
    { tenantId: TENANT, createdAt: t("2026-09-10T10:00:00Z"), severity: "HIGH" },
  );
  seed.healthChecks.push(
    { tenantId: TENANT, checkedAt: t("2026-10-01T10:00:00Z"), isAlive: false },
    { tenantId: TENANT, checkedAt: t("2026-10-01T10:00:00Z"), isAlive: true },
  );
  seed.suggestions.push(
    { tenantId: TENANT, createdAt: t("2026-10-01T10:00:00Z"), status: "APPLIED" },
    { tenantId: TENANT, createdAt: t("2026-10-01T10:00:00Z"), status: "PENDING" },
  );
  seed.lpTasks.push({ tenantId: TENANT, createdAt: t("2026-10-01T10:00:00Z") });
}

describe("weekly-report-service", () => {
  let fx: ReturnType<typeof mkFakePrisma>;
  beforeEach(() => {
    fx = mkFakePrisma();
    seedBasics(fx.seed);
  });

  const gen = (overrides: any = {}) =>
    generateWeeklyReport(fx.prisma, TENANT, WEEK_START, WEEK_END, {
      llmSettings: null, // template fallback — no AI needed for aggregation tests
      ...overrides,
    });

  it("excludes test clicks and out-of-range/other-tenant clicks", async () => {
    const report = await gen();
    expect(report.data.clicks).toBe(3);
  });

  it("counts conversions and sums revenue from conversion.value", async () => {
    const report = await gen();
    expect(report.data.conversions).toBe(3);
    expect(report.data.revenue).toBe(135);
  });

  it("ranks top offers by revenue desc and carries prev-week revenue", async () => {
    const report = await gen();
    expect(report.data.topOffers).toHaveLength(2);
    // offer-b revenue 100 > offer-a revenue 35
    expect(report.data.topOffers[0]!.offerName).toBe("Offer B");
    expect(report.data.topOffers[0]!.revenue).toBe(100);
    expect(report.data.topOffers[0]!.prevRevenue).toBe(20);
    expect(report.data.topOffers[1]!.offerName).toBe("Offer A");
    expect(report.data.topOffers[1]!.clicks).toBe(2); // test click excluded
    expect(report.data.topOffers[1]!.prevRevenue).toBe(50);
  });

  it("aggregates alerts, dead links, negatives and LP tasks", async () => {
    const report = await gen();
    expect(report.data.alerts).toBe(2);
    expect(report.data.alertsBySeverity).toEqual({ HIGH: 1, LOW: 1 });
    expect(report.data.deadLinks).toBe(1);
    expect(report.data.newNegatives).toBe(1);
    expect(report.data.newTasks).toBe(1);
  });

  it("marks spend as null and notes missing spend in the fallback summary", async () => {
    const report = await gen();
    expect(report.data.spend).toBeNull();
    expect(report.aiSummary).toContain("花费数据缺失");
  });

  it("handles empty data without crashing", async () => {
    const report = await generateWeeklyReport(
      fx.prisma,
      "00000000-0000-4000-8000-000000000099",
      WEEK_START,
      WEEK_END,
      { llmSettings: null },
    );
    expect(report.data.clicks).toBe(0);
    expect(report.data.revenue).toBe(0);
    expect(report.data.topOffers).toEqual([]);
    expect(report.status).toBe("GENERATED");
    expect(report.aiSummary.length).toBeGreaterThan(0);
  });

  it("rejects an invalid week range", async () => {
    await expect(
      generateWeeklyReport(fx.prisma, TENANT, WEEK_END, WEEK_START, {
        llmSettings: null,
      }),
    ).rejects.toThrow();
  });

  it("is idempotent for the same tenant+week (upsert, not duplicate)", async () => {
    const first = await gen();
    const second = await gen();
    expect(second.id).toBe(first.id);
    const all = await listWeeklyReports(fx.prisma, TENANT);
    expect(all).toHaveLength(1);
  });

  it("uses the injected LLM summary when AI settings are provided", async () => {
    const chatJsonImpl = vi.fn(async () => ({
      summary:
        "本周总览：点击 3，转化 3，收入 135.00。Offer B 以 100.00 收入领跑。花费数据缺失，无法计算 ROI。下周建议：加大 Offer B 预算。",
    }));
    const report = await gen({
      llmSettings: {
        baseUrl: "https://example.test",
        model: "test-model",
        apiKey: "sk-test",
      },
      chatJsonImpl: chatJsonImpl as any,
    });
    expect(chatJsonImpl).toHaveBeenCalledTimes(1);
    expect(report.aiSummary).toContain("Offer B");
    expect(report.aiSummary).toContain("花费数据缺失");
  });

  it("getLastWeekRange returns Mon-Sun of the previous week in New York", () => {
    // 2026-10-07 12:00 UTC = Wednesday 08:00 EDT
    const { weekStart, weekEnd } = getLastWeekRange(
      new Date("2026-10-07T12:00:00.000Z"),
    );
    expect(weekStart.toISOString()).toBe("2026-09-28T04:00:00.000Z");
    expect(weekEnd.toISOString()).toBe("2026-10-05T03:59:59.999Z");
  });

  it("getPrevWeekRange covers the 7 days right before weekStart", () => {
    const { gte, lte } = getPrevWeekRange(WEEK_START);
    expect(gte.toISOString()).toBe("2026-09-21T04:00:00.000Z");
    expect(lte.getTime()).toBe(WEEK_START.getTime() - 1);
  });

  it("listWeeklyReports returns newest week first", async () => {
    await gen();
    await generateWeeklyReport(
      fx.prisma,
      TENANT,
      new Date("2026-09-21T04:00:00.000Z"),
      new Date("2026-09-28T03:59:59.999Z"),
      { llmSettings: null },
    );
    const all = await listWeeklyReports(fx.prisma, TENANT);
    expect(all).toHaveLength(2);
    expect((all[0] as any).weekStart.getTime()).toBe(WEEK_START.getTime());
  });

  it("getWeeklyReport is tenant-isolated", async () => {
    const report = await gen();
    await expect(
      getWeeklyReport(fx.prisma, TENANT_B, report.id),
    ).rejects.toThrow();
    const found = await getWeeklyReport(fx.prisma, TENANT, report.id);
    expect(found.id).toBe(report.id);
  });

  it("补强 #20：validOrders/conversionRate 按有效唯一订单 ÷ 点击计算；无花费 → ROI 不判定", async () => {
    const report = await gen();
    // 3 条 Conversion、无 Order 明细 → 各计一单；点击 3（不含测试）。
    expect(report.data.validOrders).toBe(3);
    expect(report.data.conversionRate).toBeCloseTo(1);
    expect(report.data.roiRatio).toBeNull();
    expect(report.data.roiStatus).toBe("insufficient");
    expect(report.aiSummary).toContain("转化率");
    const a = report.data.topOffers.find((o) => o.offerName === "Offer A");
    expect(a?.validOrders).toBe(2);
    expect(a?.conversionRate).toBeCloseTo(1); // 2 有效订单 ÷ 2 点击
  });

  it("补强 #20：同订单下单+全额退货合并净值为 0 → 不计有效订单", async () => {
    fx.seed.conversions.push({
      tenantId: TENANT,
      conversionTime: new Date("2026-10-02T12:00:00Z"),
      value: 40,
      offerId: "offer-a",
      orders: [
        { orderId: "ord-x", value: 40, status: "CONFIRMED" },
        { orderId: "ord-x", value: 40, status: "REFUNDED" },
      ],
    });
    const report = await gen();
    expect(report.data.conversions).toBe(4); // 原始转化行仍计数
    expect(report.data.validOrders).toBe(3); // 退货单净值 0，不计
  });

  it("补强 #20 helpers：netValidOrderCount 部分退款仍计 1 单；转化率与 ROI 阈值", () => {
    expect(
      netValidOrderCount([
        { orderId: "a", value: 100, status: "CONFIRMED" },
        { orderId: "a", value: 30, status: "REFUNDED" },
        { orderId: "b", value: 50, status: "CONFIRMED" },
        { orderId: "b", value: 50, status: "REFUNDED" },
      ]),
    ).toBe(1);
    expect(affiliateConversionRate(5, 200)).toBeCloseTo(0.025);
    expect(affiliateConversionRate(5, 0)).toBeNull();
    expect(roiStatusFor(99, 3)).toBe("insufficient"); // 点击 < 100 不判定
    expect(roiStatusFor(100, 0.5)).toBe("loss");
    expect(roiStatusFor(100, 1.5)).toBe("neutral");
    expect(roiStatusFor(100, 2)).toBe("profitable");
    expect(roiStatusFor(500, null)).toBe("insufficient");
  });

  it("sendViaEmail is not implemented (501)", async () => {
    await expect(sendViaEmail(TENANT, "some-id")).rejects.toMatchObject({
      statusCode: 501,
    });
  });
});
