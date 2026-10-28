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
      select: { id: true, name: true, prescreenVerdict: true },
      orderBy: { updatedAt: "desc" },
      take: 2000,
    })) as Array<{ id: string; name: string; prescreenVerdict: string | null }>;

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

    return {
      counts: {
        total: offers.length,
        go,
        unknown,
        stop,
        notScreened,
      },
      toTest,
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
