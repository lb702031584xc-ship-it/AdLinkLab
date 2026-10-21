/**
 * Offer 一键初筛接口：
 * POST /api/v1/offers/prescreen { ids: string[1..50] }
 * 对勾选的 Offer 跑与商品库一键筛选同一条阶梯（services/offer-prescreen），
 * 结论写回 Offer 的 prescreenVerdict / prescreenReason / prescreenedAt。
 * 判停只标注不删除；免费层不设授权门，广告数层经付费数据网关
 * （拒绝 → skippedPaidLayer=true，报告可见）。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { UnauthorizedError, ValidationError } from "@adlinklab/shared";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import { prescreenOffers } from "../services/offer-prescreen.js";

export interface OfferPrescreenRouteDeps {
  prisma: PrismaClient;
  fetchImpl?: typeof fetch;
}

async function requireSession(
  deps: OfferPrescreenRouteDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) throw new UnauthorizedError("Authentication required");
  return info;
}

export async function registerOfferPrescreenRoutes(
  app: FastifyInstance,
  deps: OfferPrescreenRouteDeps
): Promise<void> {
  app.post<{ Body: { ids?: unknown } }>(
    "/api/v1/offers/prescreen",
    async (request) => {
      const info = await requireSession(deps, request);
      const raw = request.body?.ids;
      if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) {
        throw new ValidationError("ids 必须为 1–50 个");
      }
      const ids = raw.map((v) => {
        if (typeof v !== "string" || !v.trim()) {
          throw new ValidationError("ids 必须为字符串数组");
        }
        return v.trim();
      });
      const offers = (await deps.prisma.offer.findMany({
        where: { tenantId: info.tenantId, id: { in: ids }, deletedAt: null },
      })) as Array<Record<string, unknown>>;
      const byId = new Map(offers.map((o) => [o.id as string, o]));
      const found = ids
        .map((id) => byId.get(id))
        .filter((o): o is Record<string, unknown> => !!o);
      const { outcomes, skippedPaidLayer, counts } = await prescreenOffers(
        { prisma: deps.prisma, fetchImpl: deps.fetchImpl },
        {
          tenantId: info.tenantId,
          actorId: info.id,
          userRole: info.role,
          offers: found.map((o) => ({
            id: o.id as string,
            name: o.name as string,
            network: o.network as string,
            source: (o.source as string) ?? "affiliate",
            destinationUrl: o.destinationUrl as string,
            merchantId: (o.merchantId as string | null) ?? null,
            brandName: (o.brandName as string | null) ?? null,
            commissionValue: o.commissionValue ?? null,
            commissionType: (o.commissionType as string | null) ?? null,
            avgPrice: o.avgPrice ?? null,
          })),
        }
      );
      return {
        outcomes,
        counts: { ...counts, notFound: ids.length - found.length },
        skippedPaidLayer,
      };
    }
  );
}
