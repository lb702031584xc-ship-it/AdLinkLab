/**
 * POST /api/v1/keywords/recommend
 *
 * 输入：{ offerId, targetCvrPct?, maxKeywords?, rejectionRate?, refundRate? }
 * 按 Offer 的佣金算保本 CPC，再按意图模板生成候选关键词。
 * 不调外部 API、不猜搜索量；品牌词禁令从 OfferPolicy 最新快照读取。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { UnauthorizedError, ValidationError } from "@adlinklab/shared";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import { recommendKeywords } from "../services/keyword-recommend.js";
import { deriveCommissionPerSaleUsd } from "../services/offer-priority.js";
import { riskCostFromPolicyRules } from "../services/policy-risk-cost.js";

export interface KeywordRecommendRouteDeps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: KeywordRecommendRouteDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) throw new UnauthorizedError("Authentication required");
  return info;
}

function optionalPositive(v: unknown, field: string): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ValidationError(`${field} 必须为正数`);
  }
  return n;
}

export async function registerKeywordRecommendRoutes(
  app: FastifyInstance,
  deps: KeywordRecommendRouteDeps
): Promise<void> {
  app.post<{ Body: Record<string, unknown> }>(
    "/api/v1/keywords/recommend",
    async (request) => {
      const info = await requireSession(deps, request);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const offerId =
        typeof body.offerId === "string" ? body.offerId.trim() : "";
      if (!offerId) throw new ValidationError("offerId 必填");

      const offer = (await deps.prisma.offer.findFirst({
        where: { id: offerId, tenantId: info.tenantId, deletedAt: null },
        select: {
          id: true,
          name: true,
          brandName: true,
          commissionValue: true,
          commissionType: true,
          avgPrice: true,
        },
      })) as {
        id: string;
        name: string;
        brandName: string | null;
        commissionValue: unknown;
        commissionType: string | null;
        avgPrice: unknown;
      } | null;
      if (!offer) throw new ValidationError("Offer 不存在或不属于当前租户");

      // 品牌词禁令：取该 Offer 最新一条政策快照（与初筛 riskCost 同源）
      const policy = (await deps.prisma.offerPolicy?.findFirst({
        where: { tenantId: info.tenantId, offerId },
        select: { rules: true },
        orderBy: { createdAt: "desc" },
      })) as { rules: unknown } | null | undefined;
      const riskCost = riskCostFromPolicyRules(policy?.rules);
      const brandBiddingForbidden = riskCost.includes("禁品牌词竞价");

      const payoutUsd = deriveCommissionPerSaleUsd({
        commissionValue: offer.commissionValue,
        commissionType: offer.commissionType,
        avgPrice: offer.avgPrice,
      });

      const result = recommendKeywords({
        offerName: offer.name,
        brandName: offer.brandName,
        payoutUsd,
        targetCvrPct: optionalPositive(body.targetCvrPct, "targetCvrPct"),
        rejectionRate: optionalPositive(body.rejectionRate, "rejectionRate"),
        refundRate: optionalPositive(body.refundRate, "refundRate"),
        brandBiddingForbidden,
        maxKeywords: optionalPositive(body.maxKeywords, "maxKeywords"),
      });

      return {
        offerId: offer.id,
        payoutUsd,
        riskCost,
        brandBiddingForbidden,
        ...result,
      };
    }
  );
}
