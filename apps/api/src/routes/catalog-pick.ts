/**
 * POST /api/v1/catalog/pick
 *
 * 商品库挑选：把 NetworkProduct 池筛成「可以建成 Offer」的名单。
 * 这是新手流程第 2 步，之前只有纯函数没有入口。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { UnauthorizedError } from "@adlinklab/shared";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import { pickFromCatalog, type CatalogCandidate } from "../services/catalog-pick.js";
import {
  deriveMinCommissionAmount,
  resolveCpcBaseline,
  type CpcSample,
} from "../services/cpc-baseline.js";

export interface CatalogPickRouteDeps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: CatalogPickRouteDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) throw new UnauthorizedError("Authentication required");
  return info;
}

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 佣金率可能是 0.1（小数）或 10（百分数），两种都兼容。 */
function payoutOf(p: {
  commissionAmount: unknown;
  commissionRate: unknown;
  price: unknown;
}): number | null {
  const amount = numOrNull(p.commissionAmount);
  if (amount != null && amount > 0) return amount;
  const rate = numOrNull(p.commissionRate);
  const price = numOrNull(p.price);
  if (rate == null || price == null || price <= 0) return null;
  const frac = rate > 1 ? rate / 100 : rate;
  return Math.round(price * frac * 100) / 100;
}

export async function registerCatalogPickRoutes(
  app: FastifyInstance,
  deps: CatalogPickRouteDeps
): Promise<void> {
  app.post<{ Body: Record<string, unknown> }>(
    "/api/v1/catalog/pick",
    async (request) => {
      const info = await requireSession(deps, request);
      const body = (request.body ?? {}) as Record<string, unknown>;

      const category =
        typeof body.category === "string" ? body.category.trim() : null;
      const broadCategory =
        typeof body.broadCategory === "string" ? body.broadCategory.trim() : null;

      /* 1. 取商品池 */
      const products = (await deps.prisma.networkProduct.findMany({
        where: { tenantId: info.tenantId, status: "active" },
        select: {
          id: true,
          name: true,
          brand: true,
          price: true,
          commissionAmount: true,
          commissionRate: true,
          countryCode: true,
        },
        take: 2000,
      })) as Array<{
        id: string;
        name: string;
        brand: string | null;
        price: unknown;
        commissionAmount: unknown;
        commissionRate: unknown;
        countryCode: string | null;
      }>;

      /* 2. 算类目 CPC 基线（精确类目 → 大类 → 全站 → 假定） */
      const snapRows = (await deps.prisma.adPerfSnapshot.findMany({
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
          snapRows.map((r) => r.archive?.offerId).filter((x): x is string => !!x)
        ),
      ];
      const offers = offerIds.length
        ? ((await deps.prisma.offer.findMany({
            where: { id: { in: offerIds }, tenantId: info.tenantId },
            select: { id: true, category: true },
          })) as Array<{ id: string; category: string | null }>)
        : [];
      const catById = new Map(offers.map((o) => [o.id, o.category]));
      const samples: CpcSample[] = snapRows
        .map((r) => ({
          category: r.archive?.offerId
            ? (catById.get(r.archive.offerId) ?? null)
            : null,
          cpcUsd: Number(r.avgCpc),
          clicks: r.clicks,
        }))
        .filter((s) => Number.isFinite(s.cpcUsd) && s.cpcUsd > 0);

      const assumed = numOrNull(body.assumedCpcUsd);
      const baseline = resolveCpcBaseline(samples, {
        category,
        broadCategory,
        assumedCpcUsd: assumed,
      });

      /* 3. 挑 */
      const candidates: CatalogCandidate[] = products.map((p) => ({
        productId: p.id,
        name: p.name,
        brand: p.brand,
        priceUsd: numOrNull(p.price),
        payoutUsd: payoutOf(p),
        countryCode: p.countryCode ?? null,
      }));

      const result = pickFromCatalog(candidates, {
        minPayoutUsd:
          numOrNull(body.minPayoutUsd) != null
            ? (numOrNull(body.minPayoutUsd) as number)
            : undefined,
        perBrand:
          numOrNull(body.perBrand) != null
            ? (numOrNull(body.perBrand) as number)
            : undefined,
        limit:
          numOrNull(body.limit) != null
            ? (numOrNull(body.limit) as number)
            : undefined,
        categoryCpcUsd: baseline.cpcUsd > 0 ? baseline.cpcUsd : null,
      });

      // 建议门槛：由类目 CPC 反推，新手不必手填
      const suggestedMinCommissionUsd =
        baseline.cpcUsd > 0
          ? deriveMinCommissionAmount({ categoryCpcUsd: baseline.cpcUsd })
          : 0;

      return { baseline, suggestedMinCommissionUsd, result };
    }
  );
}
