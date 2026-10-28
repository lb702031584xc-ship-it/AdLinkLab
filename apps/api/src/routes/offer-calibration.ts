/**
 * GET /api/v1/offers/calibration?days=90
 *
 * 复盘：把「计划时的 EPC」与「实测 EPC」摆在一起，算出高估倍数 k。
 * 数据来自投放归档（LaunchArchive），不做任何推断。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { UnauthorizedError } from "@adlinklab/shared";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import {
  calibrateFromArchives,
  type CalibrationSourceRow,
} from "../services/calibration.js";

export interface OfferCalibrationRouteDeps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: OfferCalibrationRouteDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) throw new UnauthorizedError("Authentication required");
  return info;
}

const DEFAULT_DAYS = 90;
const MAX_DAYS = 365;

export async function registerOfferCalibrationRoutes(
  app: FastifyInstance,
  deps: OfferCalibrationRouteDeps
): Promise<void> {
  app.get<{ Querystring: { days?: string } }>(
    "/api/v1/offers/calibration",
    async (request) => {
      const info = await requireSession(deps, request);
      const raw = Number(request.query?.days);
      const days =
        Number.isFinite(raw) && raw > 0 && raw <= MAX_DAYS
          ? Math.round(raw)
          : DEFAULT_DAYS;
      const since = new Date(Date.now() - days * 86_400_000);

      const archives = (await deps.prisma.launchArchive.findMany({
        where: {
          tenantId: info.tenantId,
          offerId: { not: null },
          createdAt: { gte: since },
        },
        select: {
          offerId: true,
          offerName: true,
          epc: true,
          clicks: true,
          revenue: true,
          spend: true,
        },
        orderBy: { createdAt: "desc" },
        take: 2000,
      })) as Array<{
        offerId: string | null;
        offerName: string;
        epc: number | null;
        clicks: number | null;
        revenue: number | null;
        spend: number | null;
      }>;

      const rows: CalibrationSourceRow[] = archives.map((a) => ({
        offerId: a.offerId,
        offerName: a.offerName,
        plannedEpcUsd: a.epc,
        clicks: a.clicks,
        revenueUsd: a.revenue,
        spendUsd: a.spend,
      }));

      const result = calibrateFromArchives(rows);
      return {
        windowDays: days,
        since: since.toISOString(),
        scanned: archives.length,
        ...result,
      };
    }
  );
}
