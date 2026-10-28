/**
 * POST /api/v1/keywords/gate
 *
 * 把 AI / 规则生成的关键词过一遍闸门：能投的、待验证的、直接扔的分开。
 * 不依赖搜索量也能用——没数据的一律进「待验证」，绝不给「可投」。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { UnauthorizedError, ValidationError } from "@adlinklab/shared";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import {
  filterKeywords,
  type KeywordGateContext,
} from "../services/keyword-gate.js";

export interface KeywordGateRouteDeps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: KeywordGateRouteDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) throw new UnauthorizedError("Authentication required");
  return info;
}

export async function registerKeywordGateRoutes(
  app: FastifyInstance,
  deps: KeywordGateRouteDeps
): Promise<void> {
  app.post<{ Body: Record<string, unknown> }>(
    "/api/v1/keywords/gate",
    async (request) => {
      await requireSession(deps, request);
      const body = (request.body ?? {}) as Record<string, unknown>;

      const raw = body.keywords;
      if (!Array.isArray(raw) || raw.length === 0 || raw.length > 500) {
        throw new ValidationError("keywords 必须为 1–500 个字符串");
      }
      const keywords = raw.map((k, i) => {
        if (typeof k !== "string" || !k.trim()) {
          throw new ValidationError(`keywords[${i}] 必须为非空字符串`);
        }
        return k.trim();
      });

      // 可选上下文：不传就用保守默认（没有对比页、没有折扣、价格未知）
      const ctx: KeywordGateContext = {
        brandName: typeof body.brandName === "string" ? body.brandName : null,
        brandBiddingForbidden: body.brandBiddingForbidden === true,
        hasComparisonPage: body.hasComparisonPage === true,
        hasDiscountCode: body.hasDiscountCode === true,
        priceUsd:
          typeof body.priceUsd === "number" && Number.isFinite(body.priceUsd)
            ? body.priceUsd
            : null,
        premiumPriceUsd:
          typeof body.premiumPriceUsd === "number" &&
          Number.isFinite(body.premiumPriceUsd)
            ? body.premiumPriceUsd
            : undefined,
        minMonthlySearches:
          typeof body.minMonthlySearches === "number" &&
          Number.isFinite(body.minMonthlySearches)
            ? body.minMonthlySearches
            : undefined,
      };

      return filterKeywords(keywords, ctx);
    }
  );
}
