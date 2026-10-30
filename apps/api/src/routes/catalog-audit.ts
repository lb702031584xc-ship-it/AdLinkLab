/**
 * POST /api/v1/catalog/audit —— 全站体检。
 *
 * 读全站商品 + 历史 CPC 样本，按类目判定「能不能投」，返回按佣金降序的清单。
 * 只读，不写库：判定是可重算的，物化会像 recommended 那样过期。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { UnauthorizedError } from "@adlinklab/shared";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import { auditCatalog, type AuditProduct } from "../services/catalog-audit.js";
import type { CpcSample } from "../services/cpc-baseline.js";
import { probeCategoryCpc } from "../services/catalog-cpc-probe.js";
import { DataForSeoKeywordService } from "../services/dataforseo-keywords.js";
import { getTenantDataForSeoCredentials } from "../services/tenant-dataforseo.js";

export interface CatalogAuditRouteDeps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: CatalogAuditRouteDeps,
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

export async function registerCatalogAuditRoutes(
  app: FastifyInstance,
  deps: CatalogAuditRouteDeps
): Promise<void> {
  app.post<{ Body: Record<string, unknown> }>(
    "/api/v1/catalog/audit",
    async (request) => {
      const info = await requireSession(deps, request);
      const body = (request.body ?? {}) as Record<string, unknown>;

      const products = (await deps.prisma.networkProduct.findMany({
        where: { tenantId: info.tenantId, status: "active" },
        select: {
          id: true,
          name: true,
          brand: true,
          price: true,
          commissionAmount: true,
          commissionRate: true,
          reviewCount: true,
          countryCode: true,
        },
        take: 5000,
      })) as Array<{
        id: string;
        name: string;
        brand: string | null;
        price: unknown;
        commissionAmount: unknown;
        commissionRate: unknown;
        reviewCount: number | null;
        countryCode: string | null;
      }>;

      /* 历史 CPC 样本：按 offer 类目聚合 */
      const snaps = (await deps.prisma.adPerfSnapshot.findMany({
        where: { tenantId: info.tenantId },
        select: {
          avgCpc: true,
          clicks: true,
          archive: { select: { offerId: true } },
        },
        take: 3000,
      })) as Array<{
        avgCpc: unknown;
        clicks: number | null;
        archive: { offerId: string | null } | null;
      }>;

      const offerIds = [
        ...new Set(
          snaps.map((r) => r.archive?.offerId).filter((x): x is string => !!x)
        ),
      ];
      const offers = offerIds.length
        ? ((await deps.prisma.offer.findMany({
            where: { id: { in: offerIds }, tenantId: info.tenantId },
            select: { id: true, category: true },
          })) as Array<{ id: string; category: string | null }>)
        : [];
      const catById = new Map(offers.map((o) => [o.id, o.category]));

      const cpcSamples: CpcSample[] = snaps
        .map((r) => ({
          category: r.archive?.offerId
            ? (catById.get(r.archive.offerId) ?? null)
            : null,
          cpcUsd: Number(r.avgCpc),
          clicks: r.clicks,
        }))
        .filter((s) => Number.isFinite(s.cpcUsd) && s.cpcUsd > 0);

      const candidates: AuditProduct[] = products.map((p) => ({
        productId: p.id,
        name: p.name,
        brand: p.brand,
        priceUsd: numOrNull(p.price),
        payoutUsd: payoutOf(p),
        reviewCount: p.reviewCount,
        countryCode: p.countryCode,
      }));

      /* 历史样本不足时，用 DataForSEO 补类目 CPC（只查美国，批量一次） */
      let probeSamples: CpcSample[] = [];
      let probeNote: string | null = null;
      if (cpcSamples.length === 0 && body.probeCpc !== false) {
        try {
          const creds = await getTenantDataForSeoCredentials(
            deps.prisma,
            info.tenantId
          );
          const service = new DataForSeoKeywordService(
            deps.prisma,
            fetch,
            creds ?? undefined
          );
          const probe = await probeCategoryCpc(
            candidates.map((c) => ({
              productId: c.productId,
              name: c.name,
              payoutUsd: c.payoutUsd,
              priceUsd: c.priceUsd,
              countryCode: c.countryCode,
            })),
            (keywords, locale) =>
              service.getKeywordOverviewCpc({
                keywords,
                locationCode: locale.locationCode,
                languageCode: locale.languageCode,
              }),
            { topPerCategory: 12 }
          );
          probeSamples = probe.samples;
          // 无论成败都记下规模，否则「覆盖 2 个类目」这种结果无法诊断
          probeNote =
            "查了 " +
            probe.countries +
            " 个国家批次，命中 " +
            probeSamples.length +
            " 个词，未命中 " +
            probe.misses +
            " 个";
          if (probeSamples.length === 0) {
            probeNote += "（没有任何词查到 CPC，类目基线仍然缺失）";
          }
        } catch (error) {
          probeNote =
            "DataForSEO 探测失败（" +
            (error instanceof Error ? error.message : String(error)) +
            "），类目基线仍然缺失";
        }
      }

      const minReviews = numOrNull(body.minReviews);
      const minPayout = numOrNull(body.minPayoutUsd);
      const assumed = numOrNull(body.assumedCpcUsd);

      const result = auditCatalog(candidates, {
        cpcSamples: [...cpcSamples, ...probeSamples],
        assumedCpcUsd: assumed,
        ...(minReviews != null ? { minReviews } : {}),
        ...(minPayout != null ? { minPayoutUsd: minPayout } : {}),
      });
      return {
        ...result,
        probe: {
          used: probeSamples.length > 0,
          categories: new Set(probeSamples.map((s) => s.category)).size,
          note: probeNote,
        },
      };
    }
  );
}
