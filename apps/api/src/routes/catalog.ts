/**
 * 商品库同步 HTTP 路由（2026-10-18）。
 *
 * 全部先 requireSession（与 tracking-links-resolve.ts 同模式）；B6 授权
 * （capability catalog-sync）在 syncCatalog / session 保存 / sync-mode 切换 /
 * screen 接口内强制执行，无授权 403。绝不返回 session 明文。
 *
 *   POST   /api/v1/catalog/sync                    {networkId} → 同步商品库
 *   GET    /api/v1/catalog/products                商品分页（白名单置顶标记；sort=id_desc 默认主键倒序）
 *   GET    /api/v1/catalog/screening-preset        当前预设（无则默认 + saved:false）
 *   PUT    /api/v1/catalog/screening-preset        改预设（auto* 仅管理员）
 *   POST   /api/v1/catalog/screen                  {networkId?} 重跑筛选
 *   POST   /api/v1/catalog/session                 {networkId, sessionCookie} 保存登录态
 *   GET    /api/v1/catalog/session-status          ?networkId → {status, updatedAt}
 *   POST   /api/v1/catalog/offers/batch            {productIds[]} 批量建 Offer
 *   GET    /api/v1/catalog/blacklist               ?entityType&channel
 *   POST   /api/v1/catalog/blacklist               {entityType, entityId, reason, channel?}
 *   POST   /api/v1/catalog/blacklist/import        {items[]} 批量导入（上限200，已存在跳过）
 *   DELETE /api/v1/catalog/blacklist/:id           {reason} 仅管理员（软删除+观察期）
 *   POST   /api/v1/catalog/blacklist/:id/recheck   手动复检（不自动移除）
 *   POST   /api/v1/catalog/blacklist/check-offer   {offerId} 建 Offer 前检查
 *   GET    /api/v1/catalog/whitelist               ?channel
 *   POST   /api/v1/catalog/whitelist               {entityType, entityId, note?, channel?}
 *   DELETE /api/v1/catalog/whitelist/:id           移除
 *   POST   /api/v1/catalog/whitelist/:id/confirm   确认建议 → manual
 *   POST   /api/v1/catalog/merchants/evaluate      {channel?} 商家自动评估
 *   GET    /api/v1/catalog/merchants/signals       ?merchantId&channel 信号历史
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { NotFoundError, ValidationError } from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import { requireAdmin, requireSession } from "./auth.js";
import {
  assertNetworkApiPepperConfigured,
  encryptApiKey,
} from "../networks/network-crypto.js";
import {
  requireActiveGrant,
  incrementGrantUsage,
} from "../services/admin-grants.js";
import {
  createOfferFromProduct,
  syncCatalog,
} from "../services/catalog-sync.js";
import {
  DEFAULT_PRESET,
  scoreProduct,
} from "../services/catalog-screening.js";
import { calcRecommendationScore } from "../services/recommendation-score.js";
import { calcBrandAdCounts } from "../services/brand-ad-count.js";
import {
  addToBlacklist,
  addWhitelistEntry,
  confirmWhitelistEntry,
  getBlacklistEntry,
  isBlacklistEntityType,
  isCatalogChannel,
  isMerchantObserved,
  isWhitelistEntityType,
  networkKindToChannel,
  removeFromBlacklist,
  removeWhitelistEntry,
  writeCatalogAudit,
  type CatalogChannel,
} from "../services/catalog-blacklist.js";
import {
  DEFAULT_MERCHANT_POLICY,
  evaluateMerchants,
} from "../services/merchant-eval.js";
import type { OfferService } from "../services/offer-engine.js";

export interface CatalogRouteDeps {
  prisma: PrismaClient;
  offers: OfferService;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertId(id: unknown, label = "id"): string {
  const s = typeof id === "string" ? id.trim() : "";
  if (!s || !UUID_RE.test(s)) throw new NotFoundError(label);
  return s;
}

function asTrimmed(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function pageArgs(query: Record<string, unknown>): { page: number; pageSize: number } {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
  return { page, pageSize };
}

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * 从 rawData 提取数字型商品主键（PB product_id，如 62837599）。
 * 找不到数字 id → 用数字型 externalId → 都没有 → null。
 * （历史 session 同步可能把哈希写进了 externalId，那些行显示十六进制。）
 */
export function extractProductId(
  rawData: unknown,
  externalId: unknown
): string | null {
  let raw: Record<string, unknown> = {};
  if (rawData && typeof rawData === "object")
    raw = rawData as Record<string, unknown>;
  else if (typeof rawData === "string") {
    try {
      raw = JSON.parse(rawData) as Record<string, unknown>;
    } catch {
      raw = {};
    }
  }
  const isNumericId = (v: unknown): v is string => {
    const s = String(v ?? "").trim();
    return s !== "" && /^\d+$/.test(s);
  };
  for (const k of ["product_id", "productId", "productID", "id"]) {
    if (isNumericId(raw[k])) return String(raw[k]).trim();
  }
  if (isNumericId(externalId)) return String(externalId).trim();
  return null;
}

function serializeProduct(r: Record<string, unknown>, whitelisted: boolean) {
  // MID：网络侧商家 ID（PB rawData.brand_id），内部 merchantId 是 UUID 不对外展示。
  let raw: Record<string, unknown> = {};
  const rawVal = r.rawData;
  if (rawVal && typeof rawVal === "object") raw = rawVal as Record<string, unknown>;
  else if (typeof rawVal === "string") {
    try {
      raw = JSON.parse(rawVal) as Record<string, unknown>;
    } catch {
      raw = {};
    }
  }
  const mid =
    raw.brand_id != null && String(raw.brand_id).trim() !== ""
      ? String(raw.brand_id)
      : (raw.brandId != null && String(raw.brandId).trim() !== ""
        ? String(raw.brandId)
        : null);
  return {
    id: r.id,
    externalId: r.externalId,
    /** 数字型商品主键（autoads 式，主键ID 列展示用；无数字 id 时回退 externalId）。 */
    productId: extractProductId(r.rawData, r.externalId) ?? r.externalId,
    networkId: r.networkId ?? null,
    name: r.name,
    brand: r.brand,
    asin: r.asin,
    price: numOrNull(r.price),
    commissionAmount: numOrNull(r.commissionAmount),
    commissionRate: numOrNull(r.commissionRate),
    currency: r.currency,
    reviewCount: r.reviewCount,
    recommended: r.recommended,
    recommendationScore: numOrNull(r.recommendationScore),
    promoUrl: r.promoUrl,
    merchantId: r.merchantId ?? null,
    mid,
    landingPageType: (r.landingPageType as string) ?? null,
    countryCode: (r.countryCode as string) ?? null,
    status: (r.status as string) ?? "active",
    adCount: numOrNull(r.adCount),
    adCountSelf: numOrNull(r.adCountSelf),
    adCountOthers: numOrNull(r.adCountOthers),
    adCountCheckedAt:
      (r.adCountCheckedAt as Date)?.toISOString?.() ??
      (typeof r.adCountCheckedAt === "string" ? r.adCountCheckedAt : null),
    syncStreak: r.syncStreak ?? 0,
    whitelisted,
    syncedAt: (r.syncedAt as Date)?.toISOString?.() ?? null,
    createdAt: (r.createdAt as Date)?.toISOString?.() ?? null,
  };
}

async function findNetwork(prisma: PrismaClient, tenantId: string, id: string) {
  const row = await prisma.affiliateNetwork.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
  if (!row) throw new NotFoundError("Network not found");
  return row as {
    id: string;
    kind: string;
    name: string;
    syncMode: string;
  };
}

/**
 * 商品列表排序（autoads 式：默认按数字主键 ID 倒序，最新商品在前）。
 * externalId 归一化后是数字串；同长度数字串的字典序 = 数字序。
 */
export function buildProductOrderBy(sort: unknown): Array<Record<string, string>> {
  const s = typeof sort === "string" ? sort.trim() : "";
  switch (s) {
    case "id_asc":
      return [{ externalId: "asc" }];
    case "price_desc":
      return [{ price: "desc" }, { externalId: "desc" }];
    case "price_asc":
      return [{ price: "asc" }, { externalId: "desc" }];
    case "reviews_desc":
      return [{ reviewCount: "desc" }, { externalId: "desc" }];
    case "reviews_asc":
      return [{ reviewCount: "asc" }, { externalId: "desc" }];
    case "score_desc":
      return [{ recommendationScore: "desc" }, { externalId: "desc" }];
    case "score_asc":
      return [{ recommendationScore: "asc" }, { externalId: "desc" }];
    case "brand_desc":
      return [{ brand: "desc" }, { externalId: "desc" }];
    case "brand_asc":
      return [{ brand: "asc" }, { externalId: "desc" }];
    case "asin_desc":
      return [{ asin: "desc" }, { externalId: "desc" }];
    case "asin_asc":
      return [{ asin: "asc" }, { externalId: "desc" }];
    case "created_desc":
      return [{ createdAt: "desc" }, { externalId: "desc" }];
    case "created_asc":
      return [{ createdAt: "asc" }, { externalId: "desc" }];
    case "recommended":
      return [{ recommended: "desc" }, { syncedAt: "desc" }];
    case "id_desc":
    default:
      return [{ externalId: "desc" }];
  }
}

/**
 * 筛选预设 → Prisma where 条件（AutoAds 式自动过滤）。
 * 规则：阈值 > 0 才生效；字段为 null（未知）不拦——与 $8 佣金门槛
 * "未知不拦"原则一致，只过滤明确低于阈值的商品。
 */
export function buildPresetWhere(preset: {
  minReviews?: number | null;
  minCommissionAmount?: number | null;
  minCommissionRate?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  minScore?: number | null;
}): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const minReviews = num(preset.minReviews);
  if (minReviews != null && minReviews > 0)
    and.push({ OR: [{ reviewCount: { gte: minReviews } }, { reviewCount: null }] });
  const minAmount = num(preset.minCommissionAmount);
  if (minAmount != null && minAmount > 0)
    and.push({
      OR: [{ commissionAmount: { gte: minAmount } }, { commissionAmount: null }],
    });
  const minRate = num(preset.minCommissionRate);
  if (minRate != null && minRate > 0)
    and.push({
      OR: [{ commissionRate: { gte: minRate } }, { commissionRate: null }],
    });
  const minPrice = num(preset.minPrice);
  if (minPrice != null && minPrice > 0)
    and.push({ OR: [{ price: { gte: minPrice } }, { price: null }] });
  const maxPrice = num(preset.maxPrice);
  if (maxPrice != null && maxPrice > 0)
    and.push({ OR: [{ price: { lte: maxPrice } }, { price: null }] });
  const minScore = num(preset.minScore);
  if (minScore != null && minScore > 0)
    and.push({
      OR: [{ recommendationScore: { gte: minScore } }, { recommendationScore: null }],
    });
  return and.length > 0 ? { AND: and } : {};
}

export async function registerCatalogRoutes(
  app: FastifyInstance,
  deps: CatalogRouteDeps
): Promise<void> {
  const { prisma } = deps;

  /* ── 同步 ── */

  /* ── 同步 ── */

  app.post<{ Body: { networkId?: unknown; brandId?: unknown } }>(
    "/api/v1/catalog/sync",
    async (request) => {
      const info = await requireSession(deps, request);
      const networkId = assertId(request.body?.networkId, "networkId");
      // 按商家同步：可选的 PB brand_id（字符串，trim 后非空才生效）。
      const rawBrandId = request.body?.brandId;
      const brandId =
        typeof rawBrandId === "string" && rawBrandId.trim() !== ""
          ? rawBrandId.trim()
          : typeof rawBrandId === "number" && Number.isFinite(rawBrandId)
            ? String(rawBrandId)
            : undefined;
      const summary = await syncCatalog(
        {
          prisma,
          createOfferImpl: (input) => deps.offers.create(input),
        },
        {
          tenantId: info.tenantId,
          userId: info.id,
          userRole: info.role,
          networkId,
          ...(brandId ? { brandId } : {}),
        }
      );
      return { sync: summary };
    }
  );

  /**
   * 历史投放次数（批量）：商品 → 由它建的 Offer（idempotencyKey=catalog:<networkId>:<externalId>）
   * → 投放档案条数。只读聚合，真实数据，未投过的商品计 0。
   */
  app.get("/api/v1/catalog/products/launch-counts", async (request) => {
    const info = await requireSession(deps, request);
    const q = request.query as Record<string, unknown>;
    const ids = String(typeof q.ids === "string" ? q.ids : "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 100);
    const counts: Record<string, number> = {};
    if (ids.length === 0) return { counts };
    const products = (await prisma.networkProduct.findMany({
      where: { tenantId: info.tenantId, id: { in: ids } },
      select: { id: true, networkId: true, externalId: true },
    })) as Array<{ id: string; networkId: string; externalId: string }>;
    if (products.length === 0) return { counts };
    const keys = products.map(
      (p) => `catalog:${p.networkId}:${p.externalId}`
    );
    const offers = (await prisma.offer.findMany({
      where: { tenantId: info.tenantId, idempotencyKey: { in: keys } },
      select: { id: true, idempotencyKey: true },
    })) as Array<{ id: string; idempotencyKey: string | null }>;
    const offerToProduct = new Map<string, string>();
    for (const o of offers) {
      const p = products.find(
        (pp) => `catalog:${pp.networkId}:${pp.externalId}` === o.idempotencyKey
      );
      if (p) offerToProduct.set(o.id, p.id);
    }
    if (offerToProduct.size > 0) {
      const archives = (await prisma.launchArchive.findMany({
        where: {
          tenantId: info.tenantId,
          offerId: { in: [...offerToProduct.keys()] },
        },
        select: { offerId: true },
      })) as Array<{ offerId: string | null }>;
      for (const a of archives) {
        if (!a.offerId) continue;
        const pid = offerToProduct.get(a.offerId);
        if (pid) counts[pid] = (counts[pid] ?? 0) + 1;
      }
    }
    return { counts };
  });

  /** 单个商品的投放历史：建过的 Offer + 每次投放档案（真实数据）。 */
  app.get("/api/v1/catalog/products/:id/launch-history", async (request) => {
    const info = await requireSession(deps, request);
    const { id } = request.params as { id: string };
    const product = (await prisma.networkProduct.findFirst({
      where: { tenantId: info.tenantId, id },
      select: { id: true, networkId: true, externalId: true, name: true },
    })) as { id: string; networkId: string; externalId: string; name: string } | null;
    if (!product) {
      return { offers: [], archives: [] };
    }
    const key = `catalog:${product.networkId}:${product.externalId}`;
    const offers = (await prisma.offer.findMany({
      where: { tenantId: info.tenantId, idempotencyKey: key },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, status: true, createdAt: true },
    })) as Array<{ id: string; name: string; status: string; createdAt: Date }>;
    const archives =
      offers.length === 0
        ? []
        : ((await prisma.launchArchive.findMany({
            where: {
              tenantId: info.tenantId,
              offerId: { in: offers.map((o) => o.id) },
            },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              offerName: true,
              decision: true,
              impressions: true,
              clicks: true,
              spend: true,
              conversions: true,
              revenue: true,
              launchedAt: true,
              endedAt: true,
              createdAt: true,
            },
          })) as Array<Record<string, unknown>>);
    return {
      offers: offers.map((o) => ({
        offerId: o.id,
        name: o.name,
        status: o.status,
        createdAt: o.createdAt.toISOString(),
      })),
      archives: archives.map((a) => ({
        id: a.id,
        offerName: a.offerName,
        decision: a.decision,
        impressions: a.impressions,
        clicks: a.clicks,
        spend: a.spend,
        conversions: a.conversions,
        revenue: a.revenue,
        launchedAt: a.launchedAt ? (a.launchedAt as Date).toISOString() : null,
        endedAt: a.endedAt ? (a.endedAt as Date).toISOString() : null,
        createdAt: (a.createdAt as Date).toISOString(),
      })),
    };
  });

  app.get("/api/v1/catalog/products", async (request) => {
    const info = await requireSession(deps, request);
    const query = request.query as Record<string, unknown>;
    const { page, pageSize } = pageArgs(query);
    const where: Record<string, unknown> = { tenantId: info.tenantId };
    if (query.networkId) where.networkId = assertId(query.networkId, "networkId");
    if (query.recommended === "true" || query.recommended === "1") {
      where.recommended = true;
    } else if (query.recommended === "false" || query.recommended === "0") {
      where.recommended = false;
    }
    const q = asTrimmed(query.q);
    if (q)
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { brand: { contains: q, mode: "insensitive" } },
        { asin: { contains: q, mode: "insensitive" } },
      ];
    // 筛选预设自动过滤：用户填过条件并保存后，列表自动隐藏不符合的商品。
    // preset=0 可临时关闭。未保存过预设 → 不过滤。
    const applyPreset = query.preset !== "0" && query.preset !== "false";
    let presetApplied = false;
    let presetExcluded = 0;
    if (applyPreset) {
      const presetRow = (await prisma.catalogScreeningPreset.findUnique({
        where: { tenantId: info.tenantId },
      })) as {
        minReviews: number | null;
        minCommissionAmount: unknown;
        minCommissionRate: unknown;
        minPrice: unknown;
        maxPrice: unknown;
        minScore: number | null;
      } | null;
      if (presetRow) {
        const pw = buildPresetWhere({
          minReviews: presetRow.minReviews,
          minCommissionAmount:
            presetRow.minCommissionAmount == null
              ? null
              : Number(presetRow.minCommissionAmount),
          minCommissionRate:
            presetRow.minCommissionRate == null
              ? null
              : Number(presetRow.minCommissionRate),
          minPrice:
            presetRow.minPrice == null ? null : Number(presetRow.minPrice),
          maxPrice:
            presetRow.maxPrice == null ? null : Number(presetRow.maxPrice),
          minScore: presetRow.minScore,
        });
        if (Object.keys(pw).length > 0) {
          presetApplied = true;
          const baseWhere = { ...where };
          Object.assign(where, pw);
          presetExcluded =
            ((await prisma.networkProduct.count({ where: baseWhere })) as number) -
            ((await prisma.networkProduct.count({ where })) as number);
          if (presetExcluded < 0) presetExcluded = 0;
        }
      }
    }
    const [total, rows] = await Promise.all([
      prisma.networkProduct.count({ where }),
      prisma.networkProduct.findMany({
        where,
        orderBy: buildProductOrderBy(query.sort) as never,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    // 白名单置顶（channel 按商品所属网络映射；观察期商家不置顶）。
    const ids = (rows as Array<{ id: string }>).map((r) => r.id);
    const whiteRows =
      ids.length === 0
        ? []
        : ((await prisma.catalogWhitelist.findMany({
            where: {
              tenantId: info.tenantId,
              entityType: "product",
              entityId: { in: ids },
              source: "manual", // 只有确认的白名单才置顶，建议（suggested）不置顶
            },
            select: { entityId: true },
          })) as Array<{ entityId: string }>);
    const whiteSet = new Set(whiteRows.map((r) => r.entityId));
    const merchantIds = [
      ...new Set(
        (rows as Array<{ merchantId: string | null }>)
          .map((r) => r.merchantId)
          .filter((v): v is string => Boolean(v))
      ),
    ];
    const observed = new Set<string>();
    for (const mid of merchantIds) {
      // channel 取商品网络映射；此处简化：任一 channel 观察期都算（保守）。
      for (const ch of ["cashback", "affiliate", "amazon"] as const) {
        if (await isMerchantObserved(prisma, info.tenantId, ch, "merchant", mid)) {
          observed.add(mid);
          break;
        }
      }
    }
    // 黑名单商品行标记（供前端置灰 + "已拉黑"徽标 + 禁止勾选）。
    const blackProductIds = new Set(
      (
        (await prisma.catalogBlacklist.findMany({
          where: {
            tenantId: info.tenantId,
            status: "active",
            entityType: "product",
            entityId: { in: ids },
          },
          select: { entityId: true },
        })) as Array<{ entityId: string }>
      ).map((r) => r.entityId)
    );
    const blackMerchantIds = new Set(
      (
        (await prisma.catalogBlacklist.findMany({
          where: {
            tenantId: info.tenantId,
            status: "active",
            entityType: "merchant",
          },
          select: { entityId: true },
        })) as Array<{ entityId: string }>
      ).map((r) => r.entityId)
    );
    const merchantNameById = new Map<string, string>();
    if (merchantIds.length > 0) {
      const merchants = (await prisma.merchant.findMany({
        where: { tenantId: info.tenantId, id: { in: merchantIds } },
        select: { id: true, name: true },
      })) as Array<{ id: string; name: string }>;
      for (const m of merchants) merchantNameById.set(m.id, m.name);
    }
    // 联盟平台/账号列：一次查出本页涉及的网络（kind + name）。
    const networkIds = [
      ...new Set(
        (rows as Array<{ networkId: string | null }>)
          .map((r) => r.networkId)
          .filter((v): v is string => Boolean(v))
      ),
    ];
    const networkById = new Map<string, { kind: string; name: string }>();
    if (networkIds.length > 0) {
      const nets = (await prisma.affiliateNetwork.findMany({
        where: { tenantId: info.tenantId, id: { in: networkIds } },
        select: { id: true, kind: true, name: true },
      })) as Array<{ id: string; kind: string; name: string }>;
      for (const n of nets) networkById.set(n.id, { kind: n.kind, name: n.name });
    }
    const products = (rows as Record<string, unknown>[]).map((r) => {
      const mid = (r.merchantId as string) ?? "";
      const pinned = whiteSet.has(r.id as string) && !observed.has(mid);
      const blacklisted =
        blackProductIds.has(r.id as string) || blackMerchantIds.has(mid);
      const net = networkById.get((r.networkId as string) ?? "");
      return {
        ...serializeProduct(r, whiteSet.has(r.id as string)),
        pinned,
        blacklisted,
        merchantName: mid ? (merchantNameById.get(mid) ?? null) : null,
        networkKind: net?.kind ?? null,
        networkName: net?.name ?? null,
      };
    });
    products.sort((a, b) => Number(b.pinned) - Number(a.pinned));
    return {
      total,
      page,
      pageSize,
      products,
      items: products,
      presetApplied,
      presetExcluded,
    };
  });

  /* ── 回填：从 rawData 补缺失字段（老数据同步时适配器没映射） ──
   *  - brand/asin/price/reviewCount/currency：只补空
   *  - externalId：十六进制哈希 → 数字 product_id（解决主键ID显示哈希串；
   *    归一化后未来同步 upsert 能按数字 id 命中，不再产生重复行；冲突则跳过）
   *  - landingPageType：null/unknown 时按 promoUrl 重新推导
   */

  app.post<{ Body: { networkId?: unknown } }>(
    "/api/v1/catalog/products/backfill",
    async (request) => {
      const info = await requireSession(deps, request);
      const where: Record<string, unknown> = { tenantId: info.tenantId };
      if (request.body?.networkId)
        where.networkId = assertId(request.body.networkId, "networkId");
      const parseNum = (v: unknown): number | null => {
        if (v == null) return null;
        if (typeof v === "number") return Number.isFinite(v) ? v : null;
        const n = parseFloat(String(v).replace(/[^0-9.]/g, ""));
        return Number.isFinite(n) ? n : null;
      };
      const parseInt0 = (v: unknown): number | null => {
        if (v == null) return null;
        const n =
          typeof v === "number"
            ? v
            : parseInt(String(v).replace(/[^0-9]/g, ""), 10);
        return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
      };
      const deriveType = (url: unknown): string => {
        const u = String(url ?? "").toLowerCase();
        if (!u.trim()) return "unknown";
        if (u.includes("/stores/") || u.includes("amazon.com/s?"))
          return "amazon_storefront";
        if (u.includes("/dp/") || u.includes("/gp/product/"))
          return "amazon_product";
        return "dtc";
      };
      let scanned = 0;
      let backfilled = 0;
      let normalizedIds = 0;
      const BATCH = 500;
      for (let skip = 0; ; skip += BATCH) {
        const rows = (await prisma.networkProduct.findMany({
          where,
          select: {
            id: true,
            networkId: true,
            externalId: true,
            brand: true,
            asin: true,
            price: true,
            reviewCount: true,
            currency: true,
            promoUrl: true,
            landingPageType: true,
            rawData: true,
          },
          skip,
          take: BATCH,
        })) as Array<{
          id: string;
          networkId: string;
          externalId: string;
          brand: string | null;
          asin: string | null;
          price: unknown;
          reviewCount: number | null;
          currency: string | null;
          promoUrl: string | null;
          landingPageType: string | null;
          rawData: unknown;
        }>;
        if (rows.length === 0) break;
        scanned += rows.length;
        for (const r of rows) {
          let raw: Record<string, unknown> = {};
          if (r.rawData && typeof r.rawData === "object")
            raw = r.rawData as Record<string, unknown>;
          else if (typeof r.rawData === "string") {
            try {
              raw = JSON.parse(r.rawData) as Record<string, unknown>;
            } catch {
              continue;
            }
          } else continue;
          const data: Record<string, unknown> = {};
          if (r.brand == null) {
            const b =
              (raw.brand_name as string) ?? (raw.brand as string) ?? null;
            if (typeof b === "string" && b.trim()) data.brand = b.trim();
          }
          if (r.asin == null) {
            const a = (raw.asin as string) ?? (raw.sku as string) ?? null;
            if (typeof a === "string" && a.trim()) data.asin = a.trim();
          }
          if (r.price == null) {
            const pr = parseNum(raw.discount_price ?? raw.original_price ?? raw.price);
            if (pr != null) data.price = pr;
          }
          if (r.reviewCount == null) {
            const rc = parseInt0(raw.reviews ?? raw.review_count ?? raw.reviewCount);
            if (rc != null) data.reviewCount = rc;
          }
          if (r.currency == null || r.currency === "%") {
            const c = raw.currency;
            if (typeof c === "string" && c.trim() && c.trim() !== "%")
              data.currency = c.trim().toUpperCase();
            else if (r.currency === "%") data.currency = "USD";
          }
          if (r.landingPageType == null || r.landingPageType === "unknown") {
            const t = deriveType(
              r.promoUrl ?? raw.partnerboost_link ?? raw.link ?? raw.url
            );
            if (t !== "unknown") data.landingPageType = t;
          }
          // externalId 归一化：哈希串 → rawData 里的数字 product_id
          const numericPid = extractProductId(r.rawData, null);
          const extIsNumeric = /^\d+$/.test(String(r.externalId ?? "").trim());
          if (!extIsNumeric && numericPid && numericPid !== r.externalId) {
            const clash = (await prisma.networkProduct.findUnique({
              where: {
                tenantId_networkId_externalId: {
                  tenantId: info.tenantId,
                  networkId: r.networkId,
                  externalId: numericPid,
                },
              },
              select: { id: true },
            })) as { id: string } | null;
            if (!clash) {
              data.externalId = numericPid;
              normalizedIds += 1;
            }
          }
          if (Object.keys(data).length > 0) {
            await prisma.networkProduct.update({
              where: { id: r.id },
              data: data as never,
            });
            backfilled += 1;
          }
        }
        if (rows.length < BATCH) break;
      }
      return { scanned, backfilled, normalizedIds };
    }
  );

  /* ── 批量操作：推荐指数计算 / 批量下线 / 全局暂停开关 ── */

  const SCORE_CALC_PAUSED_KEY = "catalogScoreCalcPaused";

  async function isScoreCalcPaused(): Promise<boolean> {
    const row = (await prisma.aiSetting.findUnique({
      where: { key: SCORE_CALC_PAUSED_KEY },
    })) as { value: string } | null;
    return row?.value === "1";
  }

  function asIdArray(v: unknown, label: string): string[] {
    if (!Array.isArray(v)) throw new ValidationError(`${label} 必须是数组`);
    const ids = v
      .filter((x): x is string => typeof x === "string" && UUID_RE.test(x.trim()))
      .map((x) => x.trim());
    if (ids.length === 0) throw new ValidationError(`${label} 不能为空`);
    if (ids.length > 500) throw new ValidationError("单次最多 500 个");
    return [...new Set(ids)];
  }

  app.post<{ Body: { ids?: unknown } }>(
    "/api/v1/catalog/products/calc-score",
    async (request) => {
      const info = await requireSession(deps, request);
      const ids = asIdArray(request.body?.ids, "ids");
      if (await isScoreCalcPaused()) {
        throw new ValidationError("全局推荐指数计算已暂停");
      }
      // 推荐指数用固定权重公式（services/recommendation-score.ts），不绑定
      // 用户筛选预设；缺数据的项按中性处理，$8 门槛直接限分。
      let updated = 0;
      const scored: Array<{ productId: string; score: number; recommended: boolean }> = [];
      for (const id of ids) {
        const p = (await prisma.networkProduct.findFirst({
          where: { id, tenantId: info.tenantId },
        })) as Record<string, unknown> | null;
        if (!p) continue;
        const r = calcRecommendationScore({
          price: numOrNull(p.price),
          commissionAmount: numOrNull(p.commissionAmount),
          commissionRate: numOrNull(p.commissionRate),
          reviewCount:
            typeof p.reviewCount === "number" && Number.isFinite(p.reviewCount)
              ? p.reviewCount
              : null,
        });
        await prisma.networkProduct.update({
          where: { id },
          data: { recommended: r.recommended, recommendationScore: r.score },
        });
        updated += 1;
        scored.push({ productId: id, score: r.score, recommended: r.recommended });
      }
      await writeCatalogAudit(prisma, {
        tenantId: info.tenantId,
        actorId: info.id,
        action: "CATALOG_CALC_SCORE",
        detail: { requested: ids.length, updated },
      });
      return { updated, requested: ids.length, scored };
    }
  );

  app.post<{ Body: { ids?: unknown } }>(
    "/api/v1/catalog/products/offline",
    async (request) => {
      const info = await requireSession(deps, request);
      const ids = asIdArray(request.body?.ids, "ids");
      const res = await prisma.networkProduct.updateMany({
        where: { id: { in: ids }, tenantId: info.tenantId },
        data: { status: "inactive" },
      });
      await writeCatalogAudit(prisma, {
        tenantId: info.tenantId,
        actorId: info.id,
        action: "CATALOG_PRODUCTS_OFFLINE",
        detail: { requested: ids.length, updated: res.count },
      });
      return { updated: res.count, requested: ids.length };
    }
  );

  // 广告投放数量计算（按品牌+国家查 DataForSEO SERP，14 天缓存增量）。
  // ids 缺省/空 = 该 tenant 全部商品增量；凭证未配置 → 明确报错不静默。
  app.post<{ Body: { ids?: unknown } }>(
    "/api/v1/catalog/products/calc-ad-count",
    async (request) => {
      const info = await requireSession(deps, request);
      let productIds: string[] | undefined;
      const rawIds = request.body?.ids;
      if (Array.isArray(rawIds) && rawIds.length > 0) {
        productIds = asIdArray(rawIds, "ids");
      }
      let result;
      try {
        result = await calcBrandAdCounts(prisma, info.tenantId, productIds);
      } catch (e) {
        if (
          e instanceof Error &&
          e.message === "DataForSEO credentials not configured"
        ) {
          throw new ValidationError(
            "DataForSEO 凭证未配置：请先在管理控制台 → AI 设置里填写 DataForSEO API login / password"
          );
        }
        throw e;
      }
      await writeCatalogAudit(prisma, {
        tenantId: info.tenantId,
        actorId: info.id,
        action: "catalog.calc_ad_count",
        detail: {
          requested: productIds?.length ?? null,
          groupsQueried: result.groupsQueried,
          groupsSkippedCache: result.groupsSkippedCache,
          productsUpdated: result.productsUpdated,
          errors: result.errors.length,
        },
      });
      return result;
    }
  );

  app.get("/api/v1/catalog/score-calc-paused", async (request) => {
    await requireSession(deps, request);
    return { paused: await isScoreCalcPaused() };
  });

  app.put<{ Body: { paused?: unknown } }>(
    "/api/v1/catalog/score-calc-paused",
    async (request) => {
      const info = await requireSession(deps, request);
      await requireAdmin(deps, request);
      const paused = request.body?.paused === true;
      await prisma.aiSetting.upsert({
        where: { key: SCORE_CALC_PAUSED_KEY },
        update: { value: paused ? "1" : "0" },
        create: { key: SCORE_CALC_PAUSED_KEY, value: paused ? "1" : "0" },
      });
      await writeCatalogAudit(prisma, {
        tenantId: info.tenantId,
        actorId: info.id,
        action: "CATALOG_SCORE_CALC_PAUSE_SET",
        detail: { paused },
      });
      return { paused };
    }
  );

  /* ── 筛选预设 ── */

  app.get("/api/v1/catalog/screening-preset", async (request) => {
    const info = await requireSession(deps, request);
    const row = await prisma.catalogScreeningPreset.findUnique({
      where: { tenantId: info.tenantId },
    });
    if (!row) {
      return {
        preset: { ...DEFAULT_PRESET, autoCreateOffer: false, autoCreateTopN: 20 },
        saved: false,
      };
    }
    const r = row as Record<string, unknown>;
    return {
      preset: {
        minReviews: r.minReviews,
        minCommissionAmount: numOrNull(r.minCommissionAmount),
        minCommissionRate: numOrNull(r.minCommissionRate),
        minPrice: numOrNull(r.minPrice),
        maxPrice: numOrNull(r.maxPrice),
        minScore: r.minScore,
        autoCreateOffer: r.autoCreateOffer,
        autoCreateTopN: r.autoCreateTopN,
      },
      saved: true,
    };
  });

  app.put<{ Body: Record<string, unknown> }>(
    "/api/v1/catalog/screening-preset",
    async (request) => {
      const info = await requireSession(deps, request);
      const body = request.body ?? {};
      // autoCreateOffer / autoCreateTopN 仅管理员可改。
      if (
        body.autoCreateOffer !== undefined ||
        body.autoCreateTopN !== undefined
      ) {
        await requireAdmin(deps, request);
      }
      const patch: Record<string, unknown> = {};
      for (const k of [
        "minReviews",
        "minCommissionAmount",
        "minCommissionRate",
        "minPrice",
        "maxPrice",
        "minScore",
      ]) {
        const n = asNumber(body[k]);
        if (n !== undefined) {
          if (n < 0) throw new ValidationError(`${k} 不能为负数`);
          patch[k] = n;
        }
      }
      if (body.autoCreateOffer !== undefined) {
        patch.autoCreateOffer = body.autoCreateOffer === true;
      }
      if (body.autoCreateTopN !== undefined) {
        const n = asNumber(body.autoCreateTopN);
        if (n === undefined || !Number.isInteger(n) || n < 1 || n > 50) {
          throw new ValidationError("autoCreateTopN 必须为 1–50 的整数");
        }
        patch.autoCreateTopN = n;
      }
      if (Object.keys(patch).length === 0) {
        throw new ValidationError("没有可更新的字段");
      }
      const preset = await prisma.catalogScreeningPreset.upsert({
        where: { tenantId: info.tenantId },
        create: {
          id: randomUUID(),
          tenantId: info.tenantId,
          ...patch,
        },
        update: patch,
      });
      await writeCatalogAudit(prisma, {
        tenantId: info.tenantId,
        actorId: info.id,
        action: "CATALOG_PRESET_UPDATED",
        detail: { fields: Object.keys(patch) },
      });
      return { preset };
    }
  );

  app.post<{ Body: { networkId?: unknown } }>(
    "/api/v1/catalog/screen",
    async (request) => {
      const info = await requireSession(deps, request);
      const networkId = request.body?.networkId
        ? assertId(request.body.networkId, "networkId")
        : null;
      // B6：指定网络 → 按其 kind 校验；不指定 → 租户需至少一条有效授权。
      if (networkId) {
        const n = await findNetwork(prisma, info.tenantId, networkId);
        await requireActiveGrant(prisma, {
          tenantId: info.tenantId,
          userId: info.id,
          userRole: info.role,
          capability: "catalog-sync",
          whitelistValue: n.kind,
        });
      } else {
        const grants = await prisma.adminGrant.findMany({
          where: {
            tenantId: info.tenantId,
            capability: "catalog-sync",
            status: "active",
          },
        });
        const now = new Date();
        const valid = (grants as Array<{ endsAt: Date }>).filter(
          (g) => new Date(g.endsAt) > now
        );
        if (valid.length === 0) {
          const { ForbiddenError } = await import("@adlinklab/shared");
          throw new ForbiddenError(
            "Grant required: capability catalog-sync needs an active admin-approved grant. Apply at /admin/grants."
          );
        }
      }
      const presetRow = await prisma.catalogScreeningPreset.findUnique({
        where: { tenantId: info.tenantId },
      });
      const preset = presetRow
        ? {
            minReviews: (presetRow as { minReviews: number | null }).minReviews,
            minCommissionAmount: numOrNull(
              (presetRow as Record<string, unknown>).minCommissionAmount
            ),
            minCommissionRate: numOrNull(
              (presetRow as Record<string, unknown>).minCommissionRate
            ),
            minPrice: numOrNull((presetRow as Record<string, unknown>).minPrice),
            maxPrice: numOrNull((presetRow as Record<string, unknown>).maxPrice),
            minScore: (presetRow as { minScore: number | null }).minScore,
          }
        : { ...DEFAULT_PRESET };
      const where: Record<string, unknown> = { tenantId: info.tenantId };
      if (networkId) where.networkId = networkId;
      const products = (await prisma.networkProduct.findMany({
        where,
      })) as Array<Record<string, unknown>>;
      // 黑名单（商品/商家）→ 排除。
      const blackRows = (await prisma.catalogBlacklist.findMany({
        where: { tenantId: info.tenantId, status: "active" },
        select: { channel: true, entityType: true, entityId: true },
      })) as Array<{ channel: string; entityType: string; entityId: string }>;
      const blackProducts = new Set(
        blackRows.filter((r) => r.entityType === "product").map((r) => r.entityId)
      );
      const blackMerchants = new Set(
        blackRows.filter((r) => r.entityType === "merchant").map((r) => r.entityId)
      );
      let screened = 0;
      let recommended = 0;
      for (const p of products) {
        const mid = p.merchantId as string | null;
        if (
          blackProducts.has(p.id as string) ||
          (mid && blackMerchants.has(mid))
        ) {
          await prisma.networkProduct.update({
            where: { id: p.id as string },
            data: { recommended: false, recommendationScore: 0 },
          });
          continue;
        }
        const r = scoreProduct(
          {
            price: numOrNull(p.price),
            commissionAmount: numOrNull(p.commissionAmount),
            commissionRate: numOrNull(p.commissionRate),
            reviewCount: (p.reviewCount as number) ?? null,
          },
          preset
        );
        await prisma.networkProduct.update({
          where: { id: p.id as string },
          data: { recommended: r.recommended, recommendationScore: r.score },
        });
        screened += 1;
        if (r.recommended) recommended += 1;
      }
      await writeCatalogAudit(prisma, {
        tenantId: info.tenantId,
        actorId: info.id,
        action: "CATALOG_SCREEN_DONE",
        detail: { networkId, screened, recommended },
      });
      return { screened, recommended };
    }
  );

  /* ── 登录态 ── */

  app.post<{ Body: { networkId?: unknown; sessionCookie?: unknown } }>(
    "/api/v1/catalog/session",
    async (request) => {
      const info = await requireSession(deps, request);
      const networkId = assertId(request.body?.networkId, "networkId");
      const network = await findNetwork(prisma, info.tenantId, networkId);
      // B6：保存登录态同样要求授权（whitelist=kind）；owner 豁免。
      const grant = await requireActiveGrant(prisma, {
        tenantId: info.tenantId,
        userId: info.id,
        userRole: info.role,
        capability: "catalog-sync",
        whitelistValue: network.kind,
      });
      const cookie =
        typeof request.body?.sessionCookie === "string"
          ? request.body.sessionCookie
          : "";
      if (!cookie.trim()) throw new ValidationError("sessionCookie 不能为空");
      if (cookie.length > 8192) {
        throw new ValidationError("sessionCookie 过长（上限 8KB）");
      }
      const pepper = assertNetworkApiPepperConfigured();
      const sessionRef = encryptApiKey(cookie, pepper);
      await prisma.affiliateNetwork.update({
        where: { id: network.id },
        data: {
          sessionRef,
          sessionStatus: "OK",
          sessionUpdatedAt: new Date(),
          sessionError: null,
          sessionExpireStrikes: 0,
          // 粘贴 Cookie = 一次新的登录确认：刷新 lastLoginAt，用于有效期预检。
          lastLoginAt: new Date(),
        },
      });
      await writeCatalogAudit(prisma, {
        tenantId: info.tenantId,
        grantId: grant?.id ?? null,
        actorId: info.id,
        // 绝不记 cookie 内容。
        action: "CATALOG_SESSION_SAVED",
        detail: {
          kind: network.kind,
          networkId: network.id,
          ...(grant ? {} : { exempt: "owner-admin" }),
        },
      });
      if (grant) await incrementGrantUsage(prisma, grant);
      return { saved: true };
    }
  );

  app.get("/api/v1/catalog/session-status", async (request) => {
    const info = await requireSession(deps, request);
    const query = request.query as Record<string, unknown>;
    const networkId = assertId(query.networkId, "networkId");
    const network = (await prisma.affiliateNetwork.findFirst({
      where: { id: networkId, tenantId: info.tenantId, deletedAt: null },
      select: { sessionStatus: true, sessionUpdatedAt: true },
    })) as { sessionStatus: string; sessionUpdatedAt: Date | null } | null;
    if (!network) throw new NotFoundError("Network not found");
    return {
      status: network.sessionStatus ?? "NEVER",
      updatedAt: network.sessionUpdatedAt?.toISOString() ?? null,
    };
  });

  /* ── 登录账号（用户名/密码/有效期；密码只写不读，绝不回显） ── */

  app.post<{
    Body: {
      networkId?: unknown;
      username?: unknown;
      password?: unknown;
      sessionValidDays?: unknown;
    };
  }>("/api/v1/catalog/session-credentials", async (request) => {
    const info = await requireSession(deps, request);
    const networkId = assertId(request.body?.networkId, "networkId");
    const network = await findNetwork(prisma, info.tenantId, networkId);
    // B6：保存登录账号同样要求授权（whitelist=kind）；owner 豁免。
    const grant = await requireActiveGrant(prisma, {
      tenantId: info.tenantId,
      userId: info.id,
      userRole: info.role,
      capability: "catalog-sync",
      whitelistValue: network.kind,
    });
    const body = request.body ?? {};
    const data: Record<string, unknown> = {
      sessionUpdatedAt: new Date(),
      sessionExpireStrikes: 0,
    };
    if (body.username !== undefined) {
      const username =
        typeof body.username === "string" ? body.username.trim() : "";
      if (username.length > 200) throw new ValidationError("用户名过长（上限 200）");
      data.sessionUsername = username || null;
    }
    if (typeof body.password === "string" && body.password) {
      // 密码 8KB 上限与其他凭证一致；加密存储，绝不明文落库/日志。
      if (body.password.length > 8192) {
        throw new ValidationError("密码过长（上限 8KB）");
      }
      const pepper = assertNetworkApiPepperConfigured();
      data.sessionPasswordRef = encryptApiKey(body.password, pepper);
    }
    if (body.sessionValidDays !== undefined && body.sessionValidDays !== null) {
      const days = Number(body.sessionValidDays);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        throw new ValidationError("有效期天数必须为 1–365 的整数");
      }
      data.sessionValidDays = days;
    }
    // 保存账号信息 = 一次新的登录确认：刷新 lastLoginAt。
    data.lastLoginAt = new Date();
    await prisma.affiliateNetwork.update({
      where: { id: network.id },
      data: data as never,
    });
    await writeCatalogAudit(prisma, {
      tenantId: info.tenantId,
      grantId: grant?.id ?? null,
      actorId: info.id,
      // 绝不记用户名/密码内容，只记动作。
      action: "CATALOG_SESSION_CREDENTIALS_SAVED",
      detail: {
        kind: network.kind,
        networkId: network.id,
        ...(grant ? {} : { exempt: "owner-admin" }),
      },
    });
    if (grant) await incrementGrantUsage(prisma, grant);
    return { saved: true };
  });

  /* ── 批量建 Offer ── */

  app.post<{ Body: { productIds?: unknown } }>(
    "/api/v1/catalog/offers/batch",
    async (request) => {
      const info = await requireSession(deps, request);
      const ids = request.body?.productIds;
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50) {
        throw new ValidationError("productIds 必须为 1–50 个");
      }
      const productIds = ids.map((v) => assertId(v, "productId"));
      const products = (await prisma.networkProduct.findMany({
        where: { tenantId: info.tenantId, id: { in: productIds } },
      })) as Array<Record<string, unknown>>;
      const networks = (await prisma.affiliateNetwork.findMany({
        where: { tenantId: info.tenantId, deletedAt: null },
        select: { id: true, kind: true },
      })) as Array<{ id: string; kind: string }>;
      const kindOf = new Map(networks.map((n) => [n.id, n.kind]));
      const blackRows = (await prisma.catalogBlacklist.findMany({
        where: { tenantId: info.tenantId, status: "active" },
        select: { channel: true, entityType: true, entityId: true, reason: true },
      })) as Array<{
        channel: string;
        entityType: string;
        entityId: string;
        reason: string;
      }>;
      const created: Array<{ offerId: string; productId: string }> = [];
      const failed: Array<{ productId: string; reason: string }> = [];
      const skippedBlacklist: Array<{ productId: string; reason: string }> = [];
      for (const pid of productIds) {
        const p = products.find((r) => r.id === pid);
        if (!p) {
          failed.push({ productId: pid, reason: "商品不存在" });
          continue;
        }
        const kind = kindOf.get(p.networkId as string) ?? "unknown";
        const channel = networkKindToChannel(kind);
        const bl = blackRows.find(
          (r) =>
            r.channel === channel &&
            ((r.entityType === "product" && r.entityId === pid) ||
              (r.entityType === "merchant" &&
                p.merchantId &&
                r.entityId === p.merchantId))
        );
        if (bl) {
          skippedBlacklist.push({
            productId: pid,
            reason: `黑名单（${bl.entityType}）：${bl.reason}`,
          });
          continue;
        }
        try {
          const { offerId } = await createOfferFromProduct(
            { prisma, createOfferImpl: (input) => deps.offers.create(input) },
            { id: p.networkId as string, kind },
            {
              tenantId: info.tenantId,
              externalId: p.externalId as string,
              name: p.name as string,
              brand: p.brand as string | null,
              price: numOrNull(p.price),
              commissionAmount: numOrNull(p.commissionAmount),
              commissionRate: numOrNull(p.commissionRate),
              promoUrl: p.promoUrl as string | null,
            }
          );
          created.push({ offerId, productId: pid });
        } catch (error) {
          failed.push({
            productId: pid,
            reason: (error instanceof Error ? error.message : String(error)).slice(0, 300),
          });
        }
      }
      await writeCatalogAudit(prisma, {
        tenantId: info.tenantId,
        actorId: info.id,
        action: "CATALOG_BATCH_OFFER_CREATED",
        detail: {
          created: created.length,
          failed: failed.length,
          skippedBlacklist: skippedBlacklist.length,
        },
      });
      return { created, failed, skippedBlacklist };
    }
  );

  /* ── 黑名单 ── */

  app.get("/api/v1/catalog/blacklist", async (request) => {
    const info = await requireSession(deps, request);
    const query = request.query as Record<string, unknown>;
    // includeRemoved=true 时同时返回已移除（观察期）条目，供前端展示观察期徽标。
    const includeRemoved =
      query.includeRemoved === "true" || query.includeRemoved === "1";
    const where: Record<string, unknown> = {
      tenantId: info.tenantId,
      ...(includeRemoved ? {} : { status: "active" }),
    };
    if (query.entityType) {
      if (!isBlacklistEntityType(query.entityType)) {
        throw new ValidationError("entityType 非法");
      }
      where.entityType = query.entityType;
    }
    if (query.channel) {
      if (!isCatalogChannel(query.channel)) throw new ValidationError("channel 非法");
      where.channel = query.channel;
    }
    const rows = (await prisma.catalogBlacklist.findMany({
      where,
      orderBy: { lastConfirmedAt: "desc" },
      take: 200,
    })) as BlacklistRow[];
    return {
      items: rows.map((r) => ({
        id: r.id,
        channel: r.channel,
        entityType: r.entityType,
        entityId: r.entityId,
        networkKind: r.networkKind,
        reason: r.reason,
        firstSeenAt: r.firstSeenAt.toISOString(),
        lastConfirmedAt: r.lastConfirmedAt.toISOString(),
        source: r.source,
        status: r.status,
        removeReason: r.removeReason ?? null,
        observationUntil: r.observationUntil?.toISOString() ?? null,
      })),
    };
  });

  app.post<{
    Body: {
      entityType?: unknown;
      entityId?: unknown;
      reason?: unknown;
      channel?: unknown;
      networkKind?: unknown;
    };
  }>("/api/v1/catalog/blacklist", async (request) => {
    const info = await requireSession(deps, request);
    const body = request.body ?? {};
    if (!isBlacklistEntityType(body.entityType)) {
      throw new ValidationError("entityType 非法");
    }
    const entityId = asTrimmed(body.entityId);
    if (!entityId) throw new ValidationError("entityId 不能为空");
    const reason = asTrimmed(body.reason);
    if (!reason) throw new ValidationError("reason 不能为空");
    let channel: CatalogChannel = "affiliate";
    if (body.channel !== undefined) {
      if (!isCatalogChannel(body.channel)) throw new ValidationError("channel 非法");
      channel = body.channel;
    }
    if (body.entityType === "merchant" && body.channel === undefined) {
      throw new ValidationError("商家黑名单必须指定 channel（cashback/affiliate/amazon）");
    }
    const row = await addToBlacklist(prisma, {
      tenantId: info.tenantId,
      channel,
      entityType: body.entityType,
      entityId,
      networkKind: asTrimmed(body.networkKind) ?? null,
      reason,
      source: "manual",
      createdBy: info.id,
    });
    return { item: { id: row.id, status: row.status } };
  });

  app.post<{
    Body: { items?: unknown };
  }>("/api/v1/catalog/blacklist/import", async (request) => {
    // 批量导入黑名单（与单条 POST 同权限：登录即可，DELETE 才要 admin）。
    // 逐条复用单条接口的校验口径；已存在 active → 跳过不报错；单次上限 200 条。
    const info = await requireSession(deps, request);
    const items = request.body?.items;
    if (!Array.isArray(items) || items.length === 0) {
      throw new ValidationError("items 非空数组必填");
    }
    if (items.length > 200) {
      throw new ValidationError("单次最多导入 200 条");
    }
    let added = 0;
    let skipped = 0;
    const errors: Array<{ index: number; entityId: string; message: string }> = [];
    for (let i = 0; i < items.length; i++) {
      const it = (items[i] ?? {}) as Record<string, unknown>;
      try {
        if (!isBlacklistEntityType(it.entityType)) {
          throw new ValidationError("entityType 非法");
        }
        const entityId = asTrimmed(it.entityId);
        if (!entityId) throw new ValidationError("entityId 不能为空");
        const reason = asTrimmed(it.reason);
        if (!reason) throw new ValidationError("reason 不能为空");
        let channel: CatalogChannel = "affiliate";
        if (it.channel !== undefined) {
          if (!isCatalogChannel(it.channel)) throw new ValidationError("channel 非法");
          channel = it.channel;
        }
        if (it.entityType === "merchant" && it.channel === undefined) {
          throw new ValidationError("商家黑名单必须指定 channel（cashback/affiliate/amazon）");
        }
        const existing = await getBlacklistEntry(
          prisma,
          info.tenantId,
          channel,
          it.entityType,
          entityId
        );
        if (existing) {
          skipped += 1;
          continue;
        }
        await addToBlacklist(prisma, {
          tenantId: info.tenantId,
          channel,
          entityType: it.entityType,
          entityId,
          networkKind: asTrimmed(it.networkKind) ?? null,
          reason,
          source: "manual",
          createdBy: info.id,
        });
        added += 1;
      } catch (err) {
        errors.push({
          index: i,
          entityId: asTrimmed(it.entityId) ?? "",
          message: err instanceof Error ? err.message : "导入失败",
        });
      }
    }
    return { added, skipped, errors };
  });

  app.delete<{
    Params: { id: string };
    Body: { reason?: unknown };
  }>("/api/v1/catalog/blacklist/:id", async (request) => {
    // 仅管理员可移除（软删除 + 观察期）。
    const admin = await requireAdmin(deps, request);
    const id = assertId(request.params.id, "id");
    const reason = asTrimmed(request.body?.reason);
    if (!reason) throw new ValidationError("移除原因（reason）必填");
    const policy = (await prisma.catalogMerchantPolicy.findUnique({
      where: { tenantId: admin.tenantId },
    })) as { observationDays: number } | null;
    const row = await removeFromBlacklist(prisma, {
      tenantId: admin.tenantId,
      id,
      actorId: admin.id,
      reason,
      observationDays: policy?.observationDays ?? DEFAULT_MERCHANT_POLICY.observationDays,
    });
    return {
      removed: true,
      observationUntil: row.observationUntil?.toISOString() ?? null,
    };
  });

  app.post<{ Params: { id: string } }>(
    "/api/v1/catalog/blacklist/:id/recheck",
    async (request) => {
      const info = await requireSession(deps, request);
      const id = assertId(request.params.id, "id");
      const row = (await prisma.catalogBlacklist.findFirst({
        where: { id, tenantId: info.tenantId },
      })) as BlacklistRow | null;
      if (!row) throw new NotFoundError("黑名单条目不存在");
      // 手动复检：返回验证结果，不自动移除，由管理员决定。
      if (row.entityType === "product") {
        const p = (await prisma.networkProduct.findUnique({
          where: { id: row.entityId },
          select: { id: true, tenantId: true, syncedAt: true, networkId: true },
        })) as {
          id: string;
          tenantId: string;
          syncedAt: Date;
          networkId: string;
        } | null;
        if (!p || p.tenantId !== info.tenantId) {
          return { stillBlacklisted: true, evidence: "商品已不在库中（可能被删除）" };
        }
        const net = (await prisma.affiliateNetwork.findUnique({
          where: { id: p.networkId },
          select: { lastPullAt: true },
        })) as { lastPullAt: Date | null } | null;
        const reappeared =
          net?.lastPullAt && new Date(p.syncedAt) >= new Date(net.lastPullAt);
        return {
          stillBlacklisted: !reappeared,
          evidence: reappeared
            ? `商品在最近一次同步（${net?.lastPullAt?.toISOString()}）中重新出现，可考虑移出黑名单`
            : `商品最后同步于 ${new Date(p.syncedAt).toISOString()}，仍处于消失状态`,
        };
      }
      if (row.entityType === "network_account") {
        const n = (await prisma.affiliateNetwork.findUnique({
          where: { id: row.entityId },
          select: { sessionStatus: true, pullStatus: true, lastPullAt: true },
        })) as {
          sessionStatus: string;
          pullStatus: string;
          lastPullAt: Date | null;
        } | null;
        return {
          stillBlacklisted: true,
          evidence: n
            ? `账号状态：session=${n.sessionStatus}, pull=${n.pullStatus}, lastPullAt=${n.lastPullAt?.toISOString() ?? "never"}（账号类请人工确认后移除）`
            : "账号已不存在",
        };
      }
      if (row.entityType === "merchant") {
        const mcnt = await prisma.offer.count({
          where: { tenantId: info.tenantId, merchantId: row.entityId },
        });
        return {
          stillBlacklisted: true,
          evidence: `商家当前关联 Offer 数：${mcnt}（商家类请人工确认后移除）`,
        };
      }
      // offer
      const o = await prisma.offer.findUnique({
        where: { id: row.entityId },
        select: { id: true, tenantId: true, status: true },
      });
      return {
        stillBlacklisted: true,
        evidence:
          o && (o as { tenantId: string }).tenantId === info.tenantId
            ? `Offer 状态：${(o as { status: string }).status}（请人工确认后移除）`
            : "Offer 已不存在",
      };
    }
  );

  app.post<{ Body: { offerId?: unknown } }>(
    "/api/v1/catalog/blacklist/check-offer",
    async (request) => {
      const info = await requireSession(deps, request);
      const offerId = assertId(request.body?.offerId, "offerId");
      const offer = (await prisma.offer.findFirst({
        where: { id: offerId, tenantId: info.tenantId },
        select: { id: true, source: true, network: true, idempotencyKey: true },
      })) as {
        id: string;
        source: string;
        network: string;
        idempotencyKey: string | null;
      } | null;
      if (!offer) throw new NotFoundError("Offer not found");
      const channel: CatalogChannel =
        offer.source === "cashback"
          ? "cashback"
          : offer.source === "amazon"
            ? "amazon"
            : "affiliate";
      // 1) Offer 本体是否在黑名单。
      const direct = await getBlacklistEntry(
        prisma,
        info.tenantId,
        channel,
        "offer",
        offer.id
      );
      if (direct) {
        return {
          blacklisted: true,
          reason: direct.reason,
          matched: { entityType: "offer", entityId: offer.id },
        };
      }
      // 2) 来源商品是否在黑名单（经 idempotencyKey catalog:{networkId}:{externalId} 回查）。
      const key = offer.idempotencyKey ?? "";
      if (key.startsWith("catalog:")) {
        const parts = key.split(":");
        const networkId = parts[1] ?? "";
        const externalId = parts.slice(2).join(":");
        if (UUID_RE.test(networkId) && externalId) {
          const product = (await prisma.networkProduct.findUnique({
            where: {
              tenantId_networkId_externalId: {
                tenantId: info.tenantId,
                networkId,
                externalId,
              },
            },
            select: { id: true, merchantId: true },
          })) as { id: string; merchantId: string | null } | null;
          if (product) {
            const pbl = await getBlacklistEntry(
              prisma,
              info.tenantId,
              channel,
              "product",
              product.id
            );
            if (pbl) {
              return {
                blacklisted: true,
                reason: pbl.reason,
                matched: { entityType: "product", entityId: product.id },
              };
            }
            if (product.merchantId) {
              const mbl = await getBlacklistEntry(
                prisma,
                info.tenantId,
                channel,
                "merchant",
                product.merchantId
              );
              if (mbl) {
                return {
                  blacklisted: true,
                  reason: mbl.reason,
                  matched: { entityType: "merchant", entityId: product.merchantId },
                };
              }
            }
          }
        }
      }
      return { blacklisted: false };
    }
  );

  /* ── 白名单 ── */

  app.get("/api/v1/catalog/whitelist", async (request) => {
    const info = await requireSession(deps, request);
    const query = request.query as Record<string, unknown>;
    const where: Record<string, unknown> = { tenantId: info.tenantId };
    if (query.channel) {
      if (!isCatalogChannel(query.channel)) throw new ValidationError("channel 非法");
      where.channel = query.channel;
    }
    const rows = (await prisma.catalogWhitelist.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 200,
    })) as Array<{
      id: string;
      channel: string;
      entityType: string;
      entityId: string;
      note: string | null;
      source: string;
      suggestedAt: Date | null;
      confirmedAt: Date | null;
    }>;
    return {
      items: rows.map((r) => ({
        id: r.id,
        channel: r.channel,
        entityType: r.entityType,
        entityId: r.entityId,
        note: r.note,
        source: r.source,
        suggestedAt: r.suggestedAt?.toISOString() ?? null,
        confirmedAt: r.confirmedAt?.toISOString() ?? null,
      })),
    };
  });

  app.post<{
    Body: { entityType?: unknown; entityId?: unknown; note?: unknown; channel?: unknown };
  }>("/api/v1/catalog/whitelist", async (request) => {
    const info = await requireSession(deps, request);
    const body = request.body ?? {};
    if (!isWhitelistEntityType(body.entityType)) {
      throw new ValidationError("entityType 非法");
    }
    const entityId = asTrimmed(body.entityId);
    if (!entityId) throw new ValidationError("entityId 不能为空");
    let channel: CatalogChannel = "affiliate";
    if (body.channel !== undefined) {
      if (!isCatalogChannel(body.channel)) throw new ValidationError("channel 非法");
      channel = body.channel;
    }
    const row = await addWhitelistEntry(prisma, {
      tenantId: info.tenantId,
      channel,
      entityType: body.entityType,
      entityId,
      note: asTrimmed(body.note) ?? null,
      actorId: info.id,
    });
    return { item: { id: row.id, source: row.source } };
  });

  app.delete<{ Params: { id: string } }>(
    "/api/v1/catalog/whitelist/:id",
    async (request) => {
      const info = await requireSession(deps, request);
      const id = assertId(request.params.id, "id");
      await removeWhitelistEntry(prisma, {
        tenantId: info.tenantId,
        id,
        actorId: info.id,
      });
      return { removed: true };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/v1/catalog/whitelist/:id/confirm",
    async (request) => {
      const info = await requireSession(deps, request);
      const id = assertId(request.params.id, "id");
      const row = await confirmWhitelistEntry(prisma, {
        tenantId: info.tenantId,
        id,
        actorId: info.id,
      });
      return { item: { id: row.id, source: row.source } };
    }
  );

  /* ── 商家评估 ── */

  app.post<{ Body: { channel?: unknown } }>(
    "/api/v1/catalog/merchants/evaluate",
    async (request) => {
      // 分析自有数据，不要求 B6（不涉及外部采集）。
      const info = await requireSession(deps, request);
      const channel = request.body?.channel;
      if (channel !== undefined && !isCatalogChannel(channel)) {
        throw new ValidationError("channel 非法");
      }
      const result = await evaluateMerchants(
        { prisma },
        { tenantId: info.tenantId, channel: channel as CatalogChannel | undefined }
      );
      return { evaluation: result };
    }
  );

  app.get("/api/v1/catalog/merchants/signals", async (request) => {
    const info = await requireSession(deps, request);
    const query = request.query as Record<string, unknown>;
    const where: Record<string, unknown> = { tenantId: info.tenantId };
    if (query.merchantId) where.merchantId = assertId(query.merchantId, "merchantId");
    if (query.channel) {
      if (!isCatalogChannel(query.channel)) throw new ValidationError("channel 非法");
      where.channel = query.channel;
    }
    const rows = (await prisma.catalogMerchantSignal.findMany({
      where,
      orderBy: { periodStart: "desc" },
      take: 100,
    })) as Array<Record<string, unknown>>;
    return {
      signals: rows.map((r) => ({
        id: r.id,
        merchantId: r.merchantId,
        channel: r.channel,
        periodStart: (r.periodStart as Date).toISOString(),
        periodDays: r.periodDays,
        ownConversions: r.ownConversions,
        networkOrders: r.networkOrders,
        shavePct: numOrNull(r.shavePct),
        adSpend: numOrNull(r.adSpend),
        commission: numOrNull(r.commission),
        roas: numOrNull(r.roas),
        pendingOrders: r.pendingOrders,
        oldestPendingDays: r.oldestPendingDays,
        note: r.note,
      })),
    };
  });
}

interface BlacklistRow {
  id: string;
  channel: string;
  entityType: string;
  entityId: string;
  networkKind: string | null;
  reason: string;
  firstSeenAt: Date;
  lastConfirmedAt: Date;
  source: string;
  status: string;
  removeReason: string | null;
  observationUntil: Date | null;
}
