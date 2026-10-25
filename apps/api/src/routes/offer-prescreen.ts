/**
 * Offer 一键初筛接口：
 * POST /api/v1/offers/prescreen { ids: string[1..50] }
 * 对勾选的 Offer 跑与商品库一键筛选同一条阶梯（services/offer-prescreen），
 * 结论写回 Offer 的 prescreenVerdict / prescreenReason / prescreenedAt。
 * 判停只标注不删除；免费层不设授权门，广告数层经付费数据网关
 * （拒绝 → skippedPaidLayer=true，报告可见）。
 *
 * 宽松型（mode=loose）：同一路径的模式参数，不新增路由。
 * POST /api/v1/offers/prescreen {
 *   ids, mode: "loose", minCommissionUsd?, excludedBrands?,
 *   excludedCategories?, evidence?: {
 *     seasonal?: { [offerId]: string },        // 当季热销依据（用户填）
 *     stock?: { [offerId]: "in_stock" | "out_of_stock" },
 *     rating?: { [offerId]: number },
 *     reviewCount?: { [offerId]: number },
 *     monthlySales?: { [offerId]: number },
 *     epcUsd?: { [offerId]: number },
 *     conversionRate?: { [offerId]: number },
 *     lowPriceTraffic?: { [offerId]: "winnable" | "not_winnable" },
 *   }
 * }
 * 跑 services/loose-screen 的纯函数筛查：当季热销 + 佣金下限 +
 * 有货 + 需求佐证 + 低价流量判断，条款禁令只进 riskCost 栏，
 * 同品牌只留一条。只作本轮筛查报告，不写回 prescreenVerdict。
 *
 * 可能热销推荐（hotPicks）：默认一键初筛返回的附加输出，与
 * outcomes 并存、不互相覆盖。同一请求里可选传 excludedBrands /
 * excludedCategories / evidence（与宽松型同形），只影响推荐榜，
 * 绝不改变初筛阶梯与写回结论。推荐榜跑 services/hot-picks 的
 * 纯函数：跨品类按热销潜力排序、一品牌一款、无依据不推荐、
 * 0% 不推荐、禁令只进 riskCost 栏。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { UnauthorizedError, ValidationError } from "@adlinklab/shared";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import { prescreenOffers } from "../services/offer-prescreen.js";
import {
  DEFAULT_LOOSE_MIN_COMMISSION_USD,
  screenLooseOffers,
  type LooseStock,
  type LooseTraffic,
} from "../services/loose-screen.js";
import { parseCatalogIdempotencyKey } from "../services/offer-priority.js";
import { rankHotPicks } from "../services/hot-picks.js";
import { writeCatalogAudit } from "../services/catalog-blacklist.js";

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

/* ── 宽松型证据输入解析：非法值直接忽略，绝不抛错、不编造 ── */
function stringMap(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string" && val.trim()) out[k] = val;
  }
  return out;
}

function numberMap(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "number" && Number.isFinite(val)) out[k] = val;
  }
  return out;
}

function enumMap<T extends string>(
  v: unknown,
  allowed: readonly T[]
): Record<string, T> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, T> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string" && (allowed as readonly string[]).includes(val))
      out[k] = val as T;
  }
  return out;
}

function stringList(v: unknown, field: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !x.trim())) {
    throw new ValidationError(`${field} 必须为字符串数组`);
  }
  return v.map((x) => (x as string).trim());
}

/* ── 关联商品库商品与风险成本：宽松型分支与默认分支的推荐榜共用 ──
 * 关联口径与 offer-priority 一致（经 idempotencyKey 精确关联）；
 * 风险成本与 offer-prescreen 同源（最新一条政策快照的 FORBIDDEN 三项）。 */
interface LinkedProductRow {
  id: string;
  networkId: string;
  externalId: string;
  asin: string | null;
  price: unknown;
  commissionRate: unknown;
  reviewCount: number | null;
}

async function loadLinkedProducts(
  prisma: PrismaClient,
  tenantId: string,
  found: Array<Record<string, unknown>>
): Promise<Map<string, LinkedProductRow | null>> {
  const links = found
    .map((o) => ({
      id: o.id as string,
      key: parseCatalogIdempotencyKey(o.idempotencyKey as string | null),
    }))
    .filter(
      (l): l is { id: string; key: { networkId: string; externalId: string } } =>
        l.key !== null
    );
  const products =
    links.length > 0
      ? ((await prisma.networkProduct.findMany({
          where: {
            tenantId,
            networkId: { in: [...new Set(links.map((l) => l.key.networkId))] },
            externalId: { in: [...new Set(links.map((l) => l.key.externalId))] },
          },
          select: {
            id: true,
            networkId: true,
            externalId: true,
            asin: true,
            price: true,
            commissionRate: true,
            reviewCount: true,
          },
        })) as LinkedProductRow[])
      : [];
  const productByPair = new Map(
    products.map((p) => [`${p.networkId}:${p.externalId}`, p])
  );
  return new Map(
    links.map((l) => [
      l.id,
      productByPair.get(`${l.key.networkId}:${l.key.externalId}`) ?? null,
    ])
  );
}

async function loadRiskCost(
  prisma: PrismaClient,
  tenantId: string,
  ids: string[]
): Promise<Map<string, string[]>> {
  // 先取 Promise 再 await：offerPolicy 缺失时为 undefined，await 后经 ?? 回空数组。
  const policyPromise = prisma.offerPolicy?.findMany({
    where: { tenantId, offerId: { in: ids } },
    select: { offerId: true, rules: true },
    orderBy: { createdAt: "desc" },
  }) as
    | Promise<Array<{ offerId: string; rules: unknown }>>
    | undefined;
  const policyRows = (await policyPromise) ?? [];
  const riskCostByOffer = new Map<string, string[]>();
  for (const p of policyRows) {
    if (riskCostByOffer.has(p.offerId)) continue; // 已取到最新一条
    const rules = (p.rules ?? {}) as Record<string, unknown>;
    const cost: string[] = [];
    if (rules.PPC === "FORBIDDEN" || rules.SEARCH_ADS === "FORBIDDEN")
      cost.push("禁付费搜索（SEM）");
    if (rules.BRAND_BIDDING === "FORBIDDEN") cost.push("禁品牌词竞价");
    if (rules.DIRECT_LINK === "FORBIDDEN") cost.push("禁直链");
    riskCostByOffer.set(p.offerId, cost);
  }
  return riskCostByOffer;
}

export async function registerOfferPrescreenRoutes(
  app: FastifyInstance,
  deps: OfferPrescreenRouteDeps
): Promise<void> {
  app.post<{
    Body: {
      ids?: unknown;
      mode?: unknown;
      minCommissionUsd?: unknown;
      excludedBrands?: unknown;
      excludedCategories?: unknown;
      evidence?: unknown;
    };
  }>("/api/v1/offers/prescreen", async (request) => {
    const info = await requireSession(deps, request);
    const body = request.body ?? {};
    const raw = body.ids;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) {
      throw new ValidationError("ids 必须为 1–50 个");
    }
    const ids = raw.map((v) => {
      if (typeof v !== "string" || !v.trim()) {
        throw new ValidationError("ids 必须为字符串数组");
      }
      return v.trim();
    });
    const mode = body.mode;
    if (mode !== undefined && mode !== "loose") {
      throw new ValidationError("mode 仅支持 loose（缺省为一键初筛）");
    }
    const offers = (await deps.prisma.offer.findMany({
      where: { tenantId: info.tenantId, id: { in: ids }, deletedAt: null },
    })) as Array<Record<string, unknown>>;
    const byId = new Map(offers.map((o) => [o.id as string, o]));
    const found = ids
      .map((id) => byId.get(id))
      .filter((o): o is Record<string, unknown> => !!o);

    /* ── 宽松型：纯函数筛查，不跑一键阶梯、不写回 verdict ── */
    if (mode === "loose") {
      let floor = DEFAULT_LOOSE_MIN_COMMISSION_USD;
      if (body.minCommissionUsd !== undefined) {
        if (
          typeof body.minCommissionUsd !== "number" ||
          !Number.isFinite(body.minCommissionUsd) ||
          body.minCommissionUsd <= 0
        ) {
          throw new ValidationError("minCommissionUsd 必须为正数");
        }
        floor = body.minCommissionUsd;
      }
      const excludedBrands = stringList(body.excludedBrands, "excludedBrands");
      const excludedCategories = stringList(
        body.excludedCategories,
        "excludedCategories"
      );
      const ev = (body.evidence ?? {}) as Record<string, unknown>;
      const seasonal = stringMap(ev.seasonal);
      const stock = enumMap<LooseStock>(ev.stock, ["in_stock", "out_of_stock"]);
      const rating = numberMap(ev.rating);
      const reviewCount = numberMap(ev.reviewCount);
      const monthlySales = numberMap(ev.monthlySales);
      const epcUsd = numberMap(ev.epcUsd);
      const conversionRate = numberMap(ev.conversionRate);
      const lowPriceTraffic = enumMap<LooseTraffic>(ev.lowPriceTraffic, [
        "winnable",
        "not_winnable",
      ]);

      // 关联商品库商品（经 idempotencyKey 精确关联，同 offer-priority 口径）。
      const productByOffer = await loadLinkedProducts(
        deps.prisma,
        info.tenantId,
        found
      );

      // 风险成本：与 offer-prescreen 同源（最新一条政策快照的 FORBIDDEN 三项）。
      const riskCostByOffer = await loadRiskCost(
        deps.prisma,
        info.tenantId,
        ids
      );

      const result = screenLooseOffers(
        found.map((o) => {
          const id = o.id as string;
          const product = productByOffer.get(id) ?? null;
          return {
            id,
            name: o.name as string,
            brandName: (o.brandName as string | null) ?? null,
            category: (o.category as string | null) ?? null,
            destinationUrl: o.destinationUrl as string,
            affiliateUrl: (o.affiliateUrl as string | null) ?? null,
            commissionValue: o.commissionValue ?? null,
            commissionType: (o.commissionType as string | null) ?? null,
            avgPrice: o.avgPrice ?? null,
            productId: product?.id ?? null,
            asin: product?.asin ?? null,
            productPrice: product?.price ?? null,
            productReviewCount: product?.reviewCount ?? null,
            productCommissionRate: product?.commissionRate ?? null,
            seasonalEvidence: seasonal[id] ?? null,
            stock: stock[id] ?? null,
            rating: rating[id] ?? null,
            reviewCount: reviewCount[id] ?? null,
            monthlySales: monthlySales[id] ?? null,
            epcUsd: epcUsd[id] ?? null,
            conversionRate: conversionRate[id] ?? null,
            lowPriceTraffic: lowPriceTraffic[id] ?? null,
            riskCost: riskCostByOffer.get(id) ?? [],
          };
        }),
        {
          minCommissionUsd: floor,
          excludedBrands,
          excludedCategories,
        }
      );
      await writeCatalogAudit(deps.prisma, {
        tenantId: info.tenantId,
        actorId: info.id,
        action: "LOOSE_SCREEN_BATCH",
        detail: {
          requested: ids.length,
          qualified: result.counts.qualified,
          dropped: result.counts.dropped,
          minCommissionUsd: floor,
        },
      });
      return {
        mode: "loose" as const,
        qualified: result.qualified,
        dropped: result.dropped,
        counts: { ...result.counts, notFound: ids.length - found.length },
      };
    }

    /* ── 默认：一键初筛阶梯（行为不变）+ 附加的可能热销推荐榜 ── */
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
    // 推荐榜是附加输出：初筛结论已写回，榜单只读 outcomes、不改写任何 verdict。
    // 证据与排除清单可选（与宽松型同形），缺失时只用站内已有字段；非法证据值忽略。
    const hotEv = (body.evidence ?? {}) as Record<string, unknown>;
    const hotSeasonal = stringMap(hotEv.seasonal);
    const hotStock = enumMap<LooseStock>(hotEv.stock, [
      "in_stock",
      "out_of_stock",
    ]);
    const hotRating = numberMap(hotEv.rating);
    const hotReviewCount = numberMap(hotEv.reviewCount);
    const hotMonthlySales = numberMap(hotEv.monthlySales);
    const hotEpc = numberMap(hotEv.epcUsd);
    const hotConversion = numberMap(hotEv.conversionRate);
    const hotTraffic = enumMap<LooseTraffic>(hotEv.lowPriceTraffic, [
      "winnable",
      "not_winnable",
    ]);
    const hotProductByOffer = await loadLinkedProducts(
      deps.prisma,
      info.tenantId,
      found
    );
    const hotRiskCostByOffer = await loadRiskCost(
      deps.prisma,
      info.tenantId,
      ids
    );
    const verdictByOffer = new Map(
      outcomes.map((oc) => [oc.offerId, oc])
    );
    const hotPicks = rankHotPicks(
      found.map((o) => {
        const id = o.id as string;
        const product = hotProductByOffer.get(id) ?? null;
        const verdict = verdictByOffer.get(id);
        return {
          id,
          name: o.name as string,
          brandName: (o.brandName as string | null) ?? null,
          category: (o.category as string | null) ?? null,
          destinationUrl: o.destinationUrl as string,
          affiliateUrl: (o.affiliateUrl as string | null) ?? null,
          commissionValue: o.commissionValue ?? null,
          commissionType: (o.commissionType as string | null) ?? null,
          avgPrice: o.avgPrice ?? null,
          productId: product?.id ?? null,
          asin: product?.asin ?? null,
          productPrice: product?.price ?? null,
          productReviewCount: product?.reviewCount ?? null,
          productCommissionRate: product?.commissionRate ?? null,
          seasonalEvidence: hotSeasonal[id] ?? null,
          stock: hotStock[id] ?? null,
          rating: hotRating[id] ?? null,
          reviewCount: hotReviewCount[id] ?? null,
          monthlySales: hotMonthlySales[id] ?? null,
          epcUsd: hotEpc[id] ?? null,
          conversionRate: hotConversion[id] ?? null,
          lowPriceTraffic: hotTraffic[id] ?? null,
          riskCost: hotRiskCostByOffer.get(id) ?? [],
          prescreenVerdict: verdict?.verdict,
          prescreenReason: verdict?.reason ?? "",
        };
      }),
      {
        excludedBrands: stringList(body.excludedBrands, "excludedBrands"),
        excludedCategories: stringList(
          body.excludedCategories,
          "excludedCategories"
        ),
      }
    );
    return {
      outcomes,
      counts: { ...counts, notFound: ids.length - found.length },
      skippedPaidLayer,
      hotPicks,
    };
  });
}
