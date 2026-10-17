/**
 * P1-28：预算总览 + 盈亏平衡点。
 *
 * GET /api/v1/reports/budget-overview — 聚合 LaunchArchive（真实数据，无数据 → null/“—”，绝不编造）。
 *
 * - utilization：已花 / 测试总预算（仅含填了 testingPhase.totalBudget 的档案）。
 * - remaining：测试总预算 − 已花。
 * - dailyAvg：已花 / 活跃天数（自最早 launchedAt 起，至少 1 天）。
 * - projected30d：dailyAvg × 30。
 * - remainingDays：remaining / dailyAvg；dailyAvg 为 0 → null（前端显示“—”）。
 * - activeCampaignCount：launchedAt 非空且 endedAt 为空的档案数。
 * - perOffer：按 offerName 聚合（预算/已花/转化/佣金/ROAS）。
 * - top10：按日预算 Top-10 档案对比。
 * - breakeven：requiredConversions = 测试总预算 / 加权盈亏平衡 CPA；
 *   单档案盈亏平衡 CPA = breakevenCpc / (breakevenCvrPct/100)（两项齐全才计入）；
 *   并列 totalROAS、totalCommission（转化 × 单转佣金）、conversionEfficiency
 *   （转化/点击）、commissionRate（Offer 佣金率加权，无数据 → null）、
 *   commissionPerConversion（总佣金 / 总转化）。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { UnauthorizedError } from "@adlinklab/shared";
import { authenticateSessionRequest, type SessionAuthInfo } from "../auth/sessions.js";

export interface BudgetOverviewDeps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: BudgetOverviewDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) throw new UnauthorizedError("Authentication required");
  return info;
}

interface TestingPhase {
  totalBudget?: unknown;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function registerBudgetOverviewRoutes(
  app: FastifyInstance,
  deps: BudgetOverviewDeps
): Promise<void> {
  const { prisma } = deps;

  app.get("/api/v1/reports/budget-overview", async (request) => {
    const info = await requireSession(deps, request);
    const archives = await prisma.launchArchive.findMany({
      where: { tenantId: info.tenantId },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });

    let totalBudget = 0;
    let hasBudget = false;
    let totalSpend = 0;
    let totalClicks = 0;
    let totalConversions = 0;
    let totalRevenue = 0;
    let totalCommission = 0;
    let totalDailyBudget = 0;
    let activeCampaignCount = 0;
    let earliestLaunchedAt: Date | null = null;
    let breakevenCpaWeighted = 0;
    let breakevenCpaWeight = 0;

    const perOfferMap = new Map<
      string,
      {
        offerName: string;
        budget: number;
        spent: number;
        conversions: number;
        commission: number;
        revenue: number;
      }
    >();

    for (const a of archives) {
      const spend = a.spend ?? 0;
      const clicks = a.clicks ?? 0;
      const conversions = a.conversions ?? 0;
      const revenue = a.revenue ?? 0;
      const payout = a.payout ?? 0;
      const commission = conversions * payout;
      totalSpend += spend;
      totalClicks += clicks;
      totalConversions += conversions;
      totalRevenue += revenue;
      totalCommission += commission;
      if (a.dailyBudget) totalDailyBudget += a.dailyBudget;
      if (a.launchedAt && !a.endedAt) activeCampaignCount++;
      if (a.launchedAt && (!earliestLaunchedAt || a.launchedAt < earliestLaunchedAt)) {
        earliestLaunchedAt = a.launchedAt;
      }
      const tp = (a.testingPhase ?? {}) as TestingPhase;
      const tb = num(tp.totalBudget);
      if (tb !== null && tb > 0) {
        totalBudget += tb;
        hasBudget = true;
      }
      // 盈亏平衡 CPA（两项齐全才计入，按转化加权）。
      if (a.breakevenCpc && a.breakevenCvrPct && a.breakevenCvrPct > 0) {
        const cpa = a.breakevenCpc / (a.breakevenCvrPct / 100);
        const w = conversions > 0 ? conversions : 1;
        breakevenCpaWeighted += cpa * w;
        breakevenCpaWeight += w;
      }
      const key = a.offerName || "—";
      const prev = perOfferMap.get(key) ?? {
        offerName: key,
        budget: 0,
        spent: 0,
        conversions: 0,
        commission: 0,
        revenue: 0,
      };
      prev.budget += tb ?? 0;
      prev.spent += spend;
      prev.conversions += conversions;
      prev.commission += commission;
      prev.revenue += revenue;
      perOfferMap.set(key, prev);
    }

    const daysActive = earliestLaunchedAt
      ? Math.max(1, Math.ceil((Date.now() - earliestLaunchedAt.getTime()) / 86400000))
      : null;
    const dailyAvg = daysActive !== null && daysActive > 0 ? totalSpend / daysActive : null;
    const utilization = hasBudget && totalBudget > 0 ? totalSpend / totalBudget : null;
    const remaining = hasBudget ? totalBudget - totalSpend : null;
    const remainingDays =
      remaining !== null && dailyAvg !== null && dailyAvg > 0
        ? remaining / dailyAvg
        : null;
    const avgBreakevenCpa =
      breakevenCpaWeight > 0 ? breakevenCpaWeighted / breakevenCpaWeight : null;
    const requiredConversions =
      hasBudget && avgBreakevenCpa !== null && avgBreakevenCpa > 0
        ? totalBudget / avgBreakevenCpa
        : null;

    // 佣金率：Offer 佣金率按转化加权（percent 直接用；fixed 用 佣金/均价）。
    let rateWeighted = 0;
    let rateWeight = 0;
    const offerIds = [...new Set(archives.map((a) => a.offerId).filter(Boolean))] as string[];
    if (offerIds.length > 0) {
      const offerRows = await prisma.offer.findMany({
        where: { id: { in: offerIds }, tenantId: info.tenantId },
        select: { id: true, commissionType: true, commissionValue: true, avgPrice: true },
      });
      const byId = new Map(offerRows.map((o) => [o.id, o]));
      for (const a of archives) {
        if (!a.offerId) continue;
        const o = byId.get(a.offerId);
        if (!o || o.commissionValue === null) continue;
        const cv = Number(o.commissionValue);
        let rate: number | null = null;
        if (o.commissionType === "percent") rate = cv;
        else if (o.commissionType === "fixed" && o.avgPrice && Number(o.avgPrice) > 0) {
          rate = cv / Number(o.avgPrice);
        }
        if (rate === null) continue;
        const w = (a.conversions ?? 0) > 0 ? (a.conversions ?? 0) : 1;
        rateWeighted += rate * w;
        rateWeight += w;
      }
    }
    const commissionRate = rateWeight > 0 ? rateWeighted / rateWeight : null;

    const perOffer = [...perOfferMap.values()]
      .map((o) => ({
        ...o,
        roas: o.spent > 0 ? o.revenue / o.spent : null,
      }))
      .sort((x, y) => y.spent - x.spent);

    const top10 = [...archives]
      .sort((x, y) => (y.dailyBudget ?? 0) - (x.dailyBudget ?? 0))
      .slice(0, 10)
      .map((a) => ({
        id: a.id,
        offerName: a.offerName,
        dailyBudget: a.dailyBudget,
        spend: a.spend,
        conversions: a.conversions,
        roas: a.spend ? (a.revenue ?? 0) / a.spend : null,
      }));

    const detail = archives.map((a) => ({
      id: a.id,
      offerName: a.offerName,
      network: a.network,
      dailyBudget: a.dailyBudget,
      spend: a.spend,
      clicks: a.clicks,
      conversions: a.conversions,
      revenue: a.revenue,
      roas: a.spend ? (a.revenue ?? 0) / a.spend : null,
      launchedAt: a.launchedAt,
      endedAt: a.endedAt,
    }));

    return {
      totals: {
        totalBudget: hasBudget ? totalBudget : null,
        totalSpend,
        totalDailyBudget,
        utilization,
        remaining,
        dailyAvg,
        projected30d: dailyAvg !== null ? dailyAvg * 30 : null,
        remainingDays,
        activeCampaignCount,
        archiveCount: archives.length,
      },
      perOffer,
      top10,
      breakeven: {
        requiredConversions,
        avgBreakevenCpa,
        totalRoas: totalSpend > 0 ? totalRevenue / totalSpend : null,
        totalCommission,
        conversionEfficiency: totalClicks > 0 ? totalConversions / totalClicks : null,
        commissionRate,
        commissionPerConversion:
          totalConversions > 0 ? totalCommission / totalConversions : null,
      },
      detail,
    };
  });
}
