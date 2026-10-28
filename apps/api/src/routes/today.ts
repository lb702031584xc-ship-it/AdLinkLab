/**
 * GET /api/v1/today
 *
 * 新手唯一需要的一屏：今天该做什么。
 * 只聚合四件事，不堆指标：
 *   1. 待测（初筛 go 的 offer）
 *   2. 该停（最近触发过止损）
 *   3. 缺证据（unknown 的 offer，补齐才能判）
 *   4. 校准（假设 EPC 是否系统性偏高）
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { UnauthorizedError } from "@adlinklab/shared";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import { calibrateFromArchives } from "../services/calibration.js";
import { deriveCommissionPerSaleUsd } from "../services/offer-priority.js";
import { judgeTestStage } from "../services/test-verdict.js";

export interface TodayRouteDeps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: TodayRouteDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) throw new UnauthorizedError("Authentication required");
  return info;
}

export async function registerTodayRoutes(
  app: FastifyInstance,
  deps: TodayRouteDeps
): Promise<void> {
  app.get("/api/v1/today", async (request) => {
    const info = await requireSession(deps, request);
    const tenantId = info.tenantId;

    // Offer 初筛结论分布。Offer 量级是「一个人的选品池」，全量取回在内存计数
    // 足够，且避免 groupBy 在不同 fake 上的兼容问题。
    const offers = (await deps.prisma.offer.findMany({
      where: { tenantId, deletedAt: null, archivedAt: null },
      select: {
        id: true,
        name: true,
        prescreenVerdict: true,
        commissionValue: true,
        commissionType: true,
        avgPrice: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 2000,
    })) as Array<{
      id: string;
      name: string;
      prescreenVerdict: string | null;
      commissionValue: unknown;
      commissionType: string | null;
      avgPrice: unknown;
    }>;

    let go = 0;
    let unknown = 0;
    let stop = 0;
    let notScreened = 0;
    const toTest: Array<{ id: string; name: string }> = [];
    for (const o of offers) {
      const v = (o.prescreenVerdict ?? "").trim().toLowerCase();
      if (v === "go") {
        go += 1;
        if (toTest.length < 8) toTest.push({ id: o.id, name: o.name });
      } else if (v === "unknown") unknown += 1;
      else if (v === "stop") stop += 1;
      else notScreened += 1;
    }

    // 最近止损事件（最多 3 条）：这是「该停」的来源。
    const killEvents =
      (await deps.prisma.killRuleEvent?.findMany({
        where: { tenantId, actionTaken: { not: "SKIPPED_DISABLED" } },
        select: { offerId: true, actionTaken: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 3,
      })) ?? [];
    const offerNameById = new Map(offers.map((o) => [o.id, o.name]));
    const recentKills = (killEvents as Array<{
      offerId: string | null;
      actionTaken: string;
      createdAt: Date;
    }>).map((e) => ({
      offerId: e.offerId,
      name: e.offerId ? (offerNameById.get(e.offerId) ?? null) : null,
      actionTaken: e.actionTaken,
      at: e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt),
    }));

    // 校准：计划 EPC vs 实测 EPC
    const archives = (await deps.prisma.launchArchive.findMany({
      where: { tenantId, offerId: { not: null } },
      select: {
        offerId: true,
        offerName: true,
        epc: true,
        clicks: true,
        conversions: true,
        impressions: true,
        revenue: true,
        spend: true,
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    })) as Array<{
      offerId: string | null;
      offerName: string;
      epc: number | null;
      clicks: number | null;
      conversions: number | null;
      impressions: number | null;
      revenue: number | null;
      spend: number | null;
    }>;
    const calibration = calibrateFromArchives(
      archives.map((a) => ({
        offerId: a.offerId,
        offerName: a.offerName,
        plannedEpcUsd: a.epc,
        clicks: a.clicks,
        revenueUsd: a.revenue,
        spendUsd: a.spend,
      }))
    );

    // 每个待测 offer 的测试阶段：小额测试 → 看到结果 → 扩量。
    // 用该 offer 的归档聚合算实测 CPC，再推保本 CVR，最后交给判定器。
    const aggByOffer = new Map<
      string,
      {
        clicks: number;
        spend: number;
        conversions: number;
        impressions: number;
        revenue: number;
      }
    >();
    for (const a of archives) {
      if (!a.offerId) continue;
      const cur = aggByOffer.get(a.offerId) ?? {
        clicks: 0,
        spend: 0,
        conversions: 0,
        impressions: 0,
        revenue: 0,
      };
      cur.clicks += Number(a.clicks ?? 0) || 0;
      cur.spend += Number(a.spend ?? 0) || 0;
      cur.conversions += Number(a.conversions ?? 0) || 0;
      cur.impressions += Number(a.impressions ?? 0) || 0;
      cur.revenue += Number(a.revenue ?? 0) || 0;
      aggByOffer.set(a.offerId, cur);
    }
    const offerById = new Map(offers.map((o) => [o.id, o]));
    const toTestWithStage = toTest.map((o) => {
      const agg = aggByOffer.get(o.id) ?? {
        clicks: 0,
        spend: 0,
        conversions: 0,
        impressions: 0,
        revenue: 0,
      };
      const row = offerById.get(o.id);
      const payoutUsd = row
        ? deriveCommissionPerSaleUsd({
            commissionValue: row.commissionValue,
            commissionType: row.commissionType,
            avgPrice: row.avgPrice,
          })
        : null;
      const cpc = agg.clicks > 0 ? agg.spend / agg.clicks : null;
      const netPayout =
        payoutUsd != null && payoutUsd > 0
          ? payoutUsd * (1 - 0.15) * (1 - 0.05)
          : null;
      const breakevenCvrPct =
        netPayout != null && netPayout > 0 && cpc != null
          ? (cpc / netPayout) * 100
          : null;
      const verdict = judgeTestStage({
        clicks: agg.clicks,
        spendUsd: agg.spend,
        conversions: agg.conversions,
        impressions: agg.impressions,
        revenueUsd: agg.revenue,
        payoutUsd,
        breakevenCvrPct,
      });
      return {
        ...o,
        test: {
          stage: verdict.stage,
          action: verdict.action,
          reason: verdict.reasons[0] ?? "",
        },
      };
    });

    return {
      counts: {
        total: offers.length,
        go,
        unknown,
        stop,
        notScreened,
      },
      toTest: toTestWithStage,
      recentKills,
      calibration: {
        samples: calibration.samples,
        k: calibration.k,
        confidence: calibration.confidence,
        notes: calibration.notes,
      },
    };
  });
}
