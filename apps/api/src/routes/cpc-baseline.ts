/**
 * GET /api/v1/catalog/cpc-baseline?category=xxx&broadCategory=yyy
 *
 * 返回该类目的 CPC 基线（逐级降级：exact → broad → global → assumed），
 * 以及一份探针计划（没有基线时先小预算测）。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { UnauthorizedError } from "@adlinklab/shared";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import {
  planCpcProbe,
  resolveCpcBaseline,
  type CpcSample,
} from "../services/cpc-baseline.js";

export interface CpcBaselineRouteDeps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: CpcBaselineRouteDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) throw new UnauthorizedError("Authentication required");
  return info;
}

export async function registerCpcBaselineRoutes(
  app: FastifyInstance,
  deps: CpcBaselineRouteDeps
): Promise<void> {
  app.get<{ Querystring: { category?: string; broadCategory?: string; assumedCpcUsd?: string } }>(
    "/api/v1/catalog/cpc-baseline",
    async (request) => {
      const info = await requireSession(deps, request);

      // 取该租户的全部日均 CPC 快照（带归档与 offer 的关联），
      // 用 offer.category 做分组。量级很小（几百条），不必下推聚合。
      const rows = (await deps.prisma.adPerfSnapshot.findMany({
        where: { tenantId: info.tenantId },
        select: {
          avgCpc: true,
          clicks: true,
          archive: { select: { offerId: true } },
        },
        take: 2000,
      })) as Array<{
        avgCpc: unknown;
        clicks: number | null;
        archive: { offerId: string | null } | null;
      }>;

      const offerIds = [
        ...new Set(
          rows.map((r) => r.archive?.offerId).filter((x): x is string => !!x)
        ),
      ];
      const offers = offerIds.length
        ? ((await deps.prisma.offer.findMany({
            where: { id: { in: offerIds }, tenantId: info.tenantId },
            select: { id: true, category: true },
          })) as Array<{ id: string; category: string | null }>)
        : [];
      const catById = new Map(offers.map((o) => [o.id, o.category]));

      const samples: CpcSample[] = rows
        .map((r) => ({
          category: r.archive?.offerId
            ? (catById.get(r.archive.offerId) ?? null)
            : null,
          cpcUsd: Number(r.avgCpc),
          clicks: r.clicks,
        }))
        .filter((s) => Number.isFinite(s.cpcUsd) && s.cpcUsd > 0);

      const category = request.query?.category?.trim() || null;
      const broadCategory = request.query?.broadCategory?.trim() || null;
      const assumed = Number(request.query?.assumedCpcUsd);

      const baseline = resolveCpcBaseline(samples, {
        category,
        broadCategory,
        assumedCpcUsd: Number.isFinite(assumed) && assumed > 0 ? assumed : null,
      });

      return {
        category,
        broadCategory,
        sampleCount: samples.length,
        baseline,
        probe:
          baseline.cpcUsd > 0
            ? planCpcProbe({ assumedCpcUsd: baseline.cpcUsd })
            : null,
      };
    }
  );
}
