/**
 * GET /api/v1/nav-progress
 *
 * 给导航分层用的「毕业进度」：跑够多少之后可以解锁更深的模块。
 * 只做两个轻量统计，不返回明细，供每页导航调用。
 *
 * 毕业标准（与产品口径一致）：
 *   第 1 层：跑过 3 个 offer，或筛过 10 个 offer，或累计花费 ≥ $500
 *   第 2 层：跑过 3 个 offer 且（有正 ROI 的投放，或累计花费 ≥ $3000）
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { UnauthorizedError } from "@adlinklab/shared";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";

export interface NavProgressRouteDeps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: NavProgressRouteDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) throw new UnauthorizedError("Authentication required");
  return info;
}

const L1_ARCHIVES = 3;
const L1_SCREENED = 10;
const L1_SPEND = 500;
const L2_SPEND = 3000;

export async function registerNavProgressRoutes(
  app: FastifyInstance,
  deps: NavProgressRouteDeps
): Promise<void> {
  app.get("/api/v1/nav-progress", async (request) => {
    const info = await requireSession(deps, request);
    const tenantId = info.tenantId;

    const screened = await deps.prisma.offer.count({
      where: {
        tenantId,
        deletedAt: null,
        prescreenVerdict: { not: null },
      },
    });

    // 只看最近 200 条归档：毕业判定不需要全量，避免大租户慢查询。
    const archives = (await deps.prisma.launchArchive.findMany({
      where: { tenantId },
      select: { spend: true, revenue: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    })) as Array<{ spend: number | null; revenue: number | null }>;

    const archivesRun = archives.length;
    let totalSpend = 0;
    let hasPositiveRoi = false;
    for (const a of archives) {
      const spend = Number(a.spend ?? 0);
      const revenue = Number(a.revenue ?? 0);
      if (Number.isFinite(spend)) totalSpend += spend;
      if (Number.isFinite(spend) && Number.isFinite(revenue) && spend > 0 && revenue > spend) {
        hasPositiveRoi = true;
      }
    }

    const reasons: string[] = [];
    let suggestedLevel: 0 | 1 | 2 = 0;

    const l1 = archivesRun >= L1_ARCHIVES || screened >= L1_SCREENED || totalSpend >= L1_SPEND;
    if (l1) {
      suggestedLevel = 1;
      if (archivesRun >= L1_ARCHIVES) reasons.push(`已投放 ${archivesRun} 个 offer`);
      else if (screened >= L1_SCREENED) reasons.push(`已筛 ${screened} 个 offer`);
      else reasons.push(`累计花费 $${Math.round(totalSpend)}`);
    }

    const l2 = archivesRun >= L1_ARCHIVES && (hasPositiveRoi || totalSpend >= L2_SPEND);
    if (l2) {
      suggestedLevel = 2;
      reasons.push(
        hasPositiveRoi ? "已有正 ROI 的投放" : `累计花费 $${Math.round(totalSpend)}`
      );
    }

    return {
      suggestedLevel,
      reasons,
      progress: {
        screenedOffers: screened,
        archivesRun,
        totalSpend: Math.round(totalSpend * 100) / 100,
        hasPositiveRoi,
      },
      thresholds: {
        level1: { archives: L1_ARCHIVES, screened: L1_SCREENED, spend: L1_SPEND },
        level2: { archives: L1_ARCHIVES, spend: L2_SPEND },
      },
    };
  });
}
