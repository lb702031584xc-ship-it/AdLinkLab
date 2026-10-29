/**
 * 商品库同步 HTTP 路由（2026-10-18）。
 *
 * 全部先 requireSession（与 tracking-links-resolve.ts 同模式）；B6 授权
 * （capability catalog-sync）在 syncCatalog / session 保存 / sync-mode 切换 /
 * screen 接口内强制执行，无授权 403。绝不返回 session 明文。
 *
 *   POST   /api/v1/catalog/sync                    {networkId, brandId?} → 建后台同步任务，立即返回 {jobId, status}
 *   GET    /api/v1/catalog/sync-jobs               最近 20 条同步任务（?networkId）
 *   GET    /api/v1/catalog/sync-jobs/:id           单条同步任务（轮询进度/结果）
 *   GET    /api/v1/catalog/funnel                  ?networkId → 可投流漏斗计数
 *   GET    /api/v1/catalog/brands                  品牌榜（品牌聚合 + brandScore；?networkId&country&q）
 *   PUT    /api/v1/catalog/brands/landing-url      品牌档案写入（落地页链接 + promoMode 标注，部分更新）
 *   GET    /api/v1/catalog/products                商品分页（白名单置顶标记；sort=id_desc 默认主键倒序；?poolStage=inbox|pool|testing/live 过滤；recommended=true 时排除黑名单，与漏斗口径一致）
 *   PATCH  /api/v1/catalog/products/:id/pool-stage {poolStage} 单条移动备选池阶段（B6 catalog-sync 门禁+审计）
 *   POST   /api/v1/catalog/products/pool-stage     {ids[], poolStage} 批量移动阶段（B6 catalog-sync 门禁+审计）
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
import {
  estimateCommissionFigure,
  NotFoundError,
  ValidationError,
} from "@adlinklab/shared";
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
  evaluateProduct,
  type ScreeningPreset,
} from "../services/catalog-screening.js";
import {
  adBandOf,
  calcBrandAdCounts,
  deriveAdTrend,
  previewBrandAdCounts,
  type AdBand,
  type AdTrend,
} from "../services/brand-ad-count.js";
import {
  forceSelectProducts,
  runOneClickScreen,
  ONE_CLICK_SCREEN_MAX_PRODUCTS,
  type OneClickProductRow,
} from "../services/one-click-screen.js";
import {
  catalogPriorityInputFromRow,
  computeCatalogTestPriority,
} from "../services/catalog-priority.js";
import { riskCostFromPolicyRules } from "../services/policy-risk-cost.js";
import {
  recordPaidDataUsage,
  requirePaidDataAccess,
  resolvePaidDataAccess,
} from "../services/paid-data-gateway.js";
import { countryCodeFromMarketPlace } from "../networks/yeahpromos-adapter.js";
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
 * 预设 mode 归一化：缺失/null/非法值 → regular（常规默认）。
 * 非法值入库本不应发生（PUT 已 400 拦截）；读侧仍防御性回落 regular，
 * 绝不因脏数据让筛选口径静默走松绑。
 */
function normalizePresetMode(v: unknown): "regular" | "loose" {
  return v === "loose" ? "loose" : "regular";
}

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
    /** 补强 #1：所属商家结算率（百分比；列表接口按 merchantId 查 merchants 组装注入，查不到/无商家 → null，显示「未验证」）。 */
    settlementRatePct: numOrNull(r.settlementRatePct),
    /** 补强 #3：备选池阶段 inbox | pool | testing | live（存量默认 inbox）。 */
    poolStage: (r.poolStage as string) ?? "inbox",
    /** 补强 #4：offer 通过率（百分比；未知 → null，绝不编造）。 */
    approvalRatePct: numOrNull(r.approvalRatePct),
    /** 补强 #4：返款/结算周期天数（未知 → null）。 */
    payoutCycleDays:
      numOrNull(r.payoutCycleDays) === null
        ? null
        : Math.trunc(numOrNull(r.payoutCycleDays) as number),
    mid,
    landingPageType: (r.landingPageType as string) ?? null,
    countryCode: (r.countryCode as string) ?? null,
    status: (r.status as string) ?? "active",
    adCount: numOrNull(r.adCount),
    adCountSelf: numOrNull(r.adCountSelf),
    adCountOthers: numOrNull(r.adCountOthers),
    /** 广告落地拆分：落首页/旗舰店 vs 落商品页的条数（other 不计入两者）。 */
    adCountHome: numOrNull(r.adCountHome),
    adCountProduct: numOrNull(r.adCountProduct),
    /** 长尾探针广告数（品牌+型号/品类词的文字广告＋购物广告数 MAX）；无可派生探针 → null。 */
    adCountLongtail: numOrNull(r.adCountLongtail),
    /** 探针明细（本次计算实际跑的每条探针：裸词 + 长尾，逐条 {q, kind, paid, shopping, total}）；
     * 形状不对/未按明细口径计算过 → null，不猜。 */
    adProbeDetail: Array.isArray(r.adProbeDetail) ? r.adProbeDetail : null,
    /** 政策风险：品牌组 Top 商品命中武器配件类模式（付费广告禁投类目）。 */
    adPolicyRisk: r.adPolicyRisk === true,
    adCountCheckedAt:
      (r.adCountCheckedAt as Date)?.toISOString?.() ??
      (typeof r.adCountCheckedAt === "string" ? r.adCountCheckedAt : null),
    /** 透明中心广告主数（组级旁证，SERP 双 0 时补查）：null = 从未查过
     * （前端不显示，绝不拿空冒充 0）；0 = 查过且透明中心无广告主。 */
    tcAdvertisersCount: numOrNull(r.tcAdvertisersCount),
    /** 透明中心头部广告主 [{name, approxAds}]（仅展示）；形状不对 → null。 */
    tcTopAdvertisers: Array.isArray(r.tcTopAdvertisers)
      ? r.tcTopAdvertisers
      : null,
    tcCheckedAt:
      (r.tcCheckedAt as Date)?.toISOString?.() ??
      (typeof r.tcCheckedAt === "string" ? r.tcCheckedAt : null),
    /** 上一次广告数快照（重算时由旧 adCount 挪入）与快照时间；趋势现算不落库：
     * first（首次）/ new（新投）/ stopped（疑似停投）/ active（持续）/ none / null（未计算）。 */
    lastAdCount: numOrNull(r.lastAdCount),
    lastAdCountAt:
      (r.lastAdCountCheckedAt as Date)?.toISOString?.() ??
      (typeof r.lastAdCountCheckedAt === "string"
        ? r.lastAdCountCheckedAt
        : null),
    adTrend: deriveAdTrend(numOrNull(r.adCount), numOrNull(r.lastAdCount)),
    syncStreak: r.syncStreak ?? 0,
    whitelisted,
    /** 商品级测试优先分（与 Offer 侧同构同数值，建 Offer 前排名用）：
     * 初筛腿（screenVerdict 映射）+ 广告腿（品牌组广告数/长尾/趋势）+
     * 佣金腿（estimateCommissionFigure），纯内存现算，每行都带。 */
    testPriority: computeCatalogTestPriority(catalogPriorityInputFromRow(r)),
    /** 一键筛选结论（未筛 → null）：pass | kill | review + 原因 + 时间。 */
    screenVerdict: (r.screenVerdict as string) ?? null,
    screenReason: (r.screenReason as string) ?? null,
    screenedAt:
      (r.screenedAt as Date)?.toISOString?.() ??
      (typeof r.screenedAt === "string" ? r.screenedAt : null),
    syncedAt: (r.syncedAt as Date)?.toISOString?.() ?? null,
    createdAt: (r.createdAt as Date)?.toISOString?.() ?? null,
  };
}

/** 品牌归一化键：trim + 小写 + 连续空白折叠（品牌聚合与 BrandProfile 共用同一口径）。 */
export function normalizeBrandKey(brand: string): string {
  return brand.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * 品牌投放分（0–100，确定性，全部真实输入；公式见 GET /catalog/brands）：
 * 广告分 0–40 + 佣金分 0–30 + 价格分 0–20 + 丰富分 0–10。
 */
function computeBrandScore(args: {
  adCount: number | null;
  adBand: AdBand | null;
  adTrend: AdTrend | null;
  maxCommissionUsd: number | null;
  ge80Count: number;
  productCount: number;
}): number {
  let adScore: number;
  // 档位已含长尾地板规则（adBandOf(adCount, adCountLongtail)）：只有分档
  // 本身为 null（裸词与长尾都未算）才记「未计算」中性分，不能再用
  // adCount===null 卡住——否则裸词未算但长尾有广告的组拿不到 small 分。
  if (args.adBand === null) adScore = 10;
  else
    adScore = { none: 5, small: 30, sweet: 40, hot: 30, redocean: 15 }[
      args.adBand
    ];
  // 疑似停投：曾经投、现在停了，广告分封顶到「无人投放」档。
  if (args.adTrend === "stopped") adScore = Math.min(adScore, 5);
  let commissionScore: number;
  const c = args.maxCommissionUsd;
  if (c === null) commissionScore = 5;
  else if (c >= 50) commissionScore = 30;
  else if (c >= 25) commissionScore = 24;
  else if (c >= 8) commissionScore = 16;
  else if (c > 0) commissionScore = 8;
  else commissionScore = 0;
  const priceScore =
    args.productCount > 0
      ? Math.round((20 * args.ge80Count) / args.productCount)
      : 0;
  const richnessScore = Math.min(args.productCount, 10);
  return adScore + commissionScore + priceScore + richnessScore;
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
 * 租户筛选预设解析（三处评分调用点共用，保证结果一致）：
 * 已保存 → 行值；未保存 → DEFAULT_PRESET（与 GET /screening-preset 的
 * saved:false 返回口径一致，即"默认预设"就是该租户的有效预设）。
 */
async function resolveScreeningPreset(
  prisma: PrismaClient,
  tenantId: string
): Promise<ScreeningPreset> {
  const row = (await prisma.catalogScreeningPreset.findUnique({
    where: { tenantId },
  })) as Record<string, unknown> | null;
  if (!row) return { ...DEFAULT_PRESET };
  return {
    minReviews: (row.minReviews as number | null) ?? null,
    minCommissionAmount: numOrNull(row.minCommissionAmount),
    minCommissionRate: numOrNull(row.minCommissionRate),
    minPrice: numOrNull(row.minPrice),
    maxPrice: numOrNull(row.maxPrice),
    minScore: (row.minScore as number | null) ?? null,
    mode: normalizePresetMode(row.mode),
  };
}

/**
 * 商品列表排序（autoads 式：默认按数字主键 ID 倒序，最新商品在前）。
 * externalId 归一化后是数字串；同长度数字串的字典序 = 数字序。
 * 注意：priority / commission_desc 不走本函数——二者是派生值排序，
 * 由分页端点全量取数后内存排序再分页（见端点内注释）。
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
      // 品牌内次级序：推荐指数 → 评论数 → 主键（同品牌最好的排最前，不再按编号乱序）。
      return [
        { brand: "desc" },
        { recommendationScore: "desc" },
        { reviewCount: "desc" },
        { externalId: "desc" },
      ];
    case "brand_asc":
      return [
        { brand: "asc" },
        { recommendationScore: "desc" },
        { reviewCount: "desc" },
        { externalId: "desc" },
      ];
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

/**
 * 广告投放数量过滤（列表查询参数，与预设过滤可组合）：
 * minAdCount=N → adCount >= N；hasAds=1（或 true）→ adCount > 0（即 >= 1）。
 * 两者同时给取更严的一个；都无效 → 不过滤。
 * maxAdCount=N → adCount <= N（新增区间上限；与 min 合成区间，
 * 「甜蜜点」快捷档 = min 1 / max 20）。单独给 max 时同样生效。
 * 注意：adCount 为 null（未计算）不命中——无数据不能当"有广告"，
 * 与预设过滤"null 不拦"的口径不同，这里是用户主动按广告数筛选。
 * 分档口径见 @adlinklab/shared ad-count-tier（经验口径，非竞价者数）。
 */
export function buildAdCountWhere(query: {
  minAdCount?: unknown;
  hasAds?: unknown;
  maxAdCount?: unknown;
}): Record<string, unknown> {
  let floor = 0;
  const min = asNumber(query.minAdCount);
  if (min != null && min > 0) floor = Math.max(floor, Math.floor(min));
  if (query.hasAds === "1" || query.hasAds === "true")
    floor = Math.max(floor, 1);
  const range: { gte?: number; lte?: number } = {};
  if (floor > 0) range.gte = floor;
  const max = asNumber(query.maxAdCount);
  if (max != null && max >= 0) range.lte = Math.floor(max);
  return Object.keys(range).length > 0 ? { adCount: range } : {};
}

/**
 * 黑名单排除（商品级 + 商家级），与漏斗 recommended/launchable 口径一致：
 * status='active' 的黑名单行。列表 `recommended=true` 过滤同样排除，
 * 保证"漏斗推荐数 = 列表按推荐筛出的条数"自洽（2026-10-20 巡检）。
 */
async function getBlacklistExclusion(
  prisma: PrismaClient,
  tenantId: string,
  candidateProductIds?: string[]
): Promise<{ productIds: string[]; merchantIds: string[] }> {
  const [pRows, mRows] = await Promise.all([
    prisma.catalogBlacklist.findMany({
      where: {
        tenantId,
        status: "active",
        entityType: "product",
        ...(candidateProductIds && candidateProductIds.length > 0
          ? { entityId: { in: candidateProductIds } }
          : {}),
      },
      select: { entityId: true },
    }),
    prisma.catalogBlacklist.findMany({
      where: { tenantId, status: "active", entityType: "merchant" },
      select: { entityId: true },
    }),
  ]);
  return {
    productIds: (pRows as Array<{ entityId: string }>).map((r) => r.entityId),
    merchantIds: (mRows as Array<{ entityId: string }>).map((r) => r.entityId),
  };
}

/**
 * 投放国家过滤（列表查询参数 country，逗号分隔可多选，如 country=US,CA）：
 * 只接受两位大写国家代码，非法片段忽略；无有效代码 → 不过滤。
 * countryCode 为 null（国家未知）的商品不命中——与广告数过滤同口径：
 * 用户主动按国家筛选时，没数据的不能冒充属于某国。
 */
export function buildCountryWhere(query: {
  country?: unknown;
}): Record<string, unknown> {
  const raw = typeof query.country === "string" ? query.country : "";
  const codes = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z]{2}$/.test(s))
    ),
  ];
  if (codes.length === 0) return {};
  return codes.length === 1
    ? { countryCode: codes[0] }
    : { countryCode: { in: codes } };
}

/** 补强 #3：备选池阶段（与 schema NetworkProduct.poolStage 口径一致）。 */
export const POOL_STAGES = ["inbox", "pool", "testing", "live"] as const;
export type PoolStage = (typeof POOL_STAGES)[number];

export function isPoolStage(v: unknown): v is PoolStage {
  return (
    typeof v === "string" &&
    (POOL_STAGES as readonly string[]).includes(v)
  );
}

/**
 * 备选池阶段过滤（列表查询参数 poolStage）：
 * 合法阶段 → 等值过滤；缺省/"all" → 不过滤；非法值由调用方先行 400。
 */
export function buildPoolStageWhere(query: {
  poolStage?: unknown;
}): Record<string, unknown> {
  const v = typeof query.poolStage === "string" ? query.poolStage.trim() : "";
  return isPoolStage(v) ? { poolStage: v } : {};
}

export async function registerCatalogRoutes(
  app: FastifyInstance,
  deps: CatalogRouteDeps
): Promise<void> {
  const { prisma } = deps;

  /* ── 同步（后台任务） ──
   * POST 只做参数/B6 校验 + 建 CatalogSyncJob 行，立即返回 {jobId, status}；
   * 真正的同步在后台执行（runCatalogSyncJob），进度/结果写回 job 行，
   * 前端轮询 GET /sync-jobs/:id。B6 授权在建 job 前先校验一次（失败直接
   * 报错、不建 job）；syncCatalog 内部还会再校验一次（双保险）。
   */

  interface SyncJobRow {
    id: string;
    tenantId: string;
    networkId: string;
    userId: string;
    scope: string;
    brandId: string | null;
    status: string;
    stage: string | null;
    result: unknown;
    error: string | null;
    createdAt: Date | string;
    startedAt: Date | string | null;
    finishedAt: Date | string | null;
  }

  function serializeSyncJob(r: SyncJobRow) {
    const iso = (v: Date | string | null | undefined): string | null =>
      v == null
        ? null
        : v instanceof Date
          ? v.toISOString()
          : typeof v === "string"
            ? v
            : null;
    return {
      id: r.id,
      networkId: r.networkId,
      scope: r.scope,
      brandId: r.brandId ?? null,
      status: r.status,
      stage: r.stage ?? null,
      result: r.result ?? null,
      error: r.error ?? null,
      createdAt: iso(r.createdAt),
      startedAt: iso(r.startedAt),
      finishedAt: iso(r.finishedAt),
    };
  }

  async function runCatalogSyncJob(
    jobId: string,
    args: {
      tenantId: string;
      userId: string;
      userRole: string;
      networkId: string;
      brandId?: string;
    }
  ): Promise<void> {
    const updateJob = async (data: Record<string, unknown>): Promise<void> => {
      try {
        await prisma.catalogSyncJob.update({ where: { id: jobId }, data });
      } catch {
        /* job 行更新失败不影响同步本身（观测信号） */
      }
    };
    try {
      await updateJob({ status: "running", startedAt: new Date() });
      const summary = await syncCatalog(
        {
          prisma,
          createOfferImpl: (input) => deps.offers.create(input),
          onProgress: async (stage, partial) => {
            await updateJob({
              stage,
              ...(partial ? { result: partial as never } : {}),
            });
          },
        },
        {
          tenantId: args.tenantId,
          userId: args.userId,
          userRole: args.userRole,
          networkId: args.networkId,
          ...(args.brandId ? { brandId: args.brandId } : {}),
        }
      );
      await updateJob({
        status: summary.skipped ? "skipped" : "succeeded",
        stage: "done",
        result: summary as never,
        error: null,
        finishedAt: new Date(),
      });
    } catch (error) {
      await updateJob({
        status: "failed",
        error: (error instanceof Error ? error.message : String(error)).slice(
          0,
          2000
        ),
        finishedAt: new Date(),
      });
    }
  }

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
      // B6 授权在建 job 前校验：失败直接报错，不建 job、不浪费执行。
      const network = await findNetwork(prisma, info.tenantId, networkId);
      await requireActiveGrant(prisma, {
        tenantId: info.tenantId,
        userId: info.id,
        userRole: info.role,
        capability: "catalog-sync",
        whitelistValue: network.kind,
      });
      const jobId = randomUUID();
      await prisma.catalogSyncJob.create({
        data: {
          id: jobId,
          tenantId: info.tenantId,
          networkId,
          userId: info.id,
          scope: brandId ? "brand" : "full",
          brandId: brandId ?? null,
          status: "queued",
        },
      });
      // 后台执行：不 await，请求立即返回；runCatalogSyncJob 内部全捕获。
      void runCatalogSyncJob(jobId, {
        tenantId: info.tenantId,
        userId: info.id,
        userRole: info.role,
        networkId,
        ...(brandId ? { brandId } : {}),
      });
      return { jobId, status: "running" };
    }
  );

  app.get("/api/v1/catalog/sync-jobs", async (request) => {
    const info = await requireSession(deps, request);
    const query = request.query as Record<string, unknown>;
    const where: Record<string, unknown> = { tenantId: info.tenantId };
    if (query.networkId)
      where.networkId = assertId(query.networkId, "networkId");
    const rows = (await prisma.catalogSyncJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 20,
    })) as unknown as SyncJobRow[];
    return { jobs: rows.map(serializeSyncJob) };
  });

  app.get("/api/v1/catalog/sync-jobs/:id", async (request) => {
    const info = await requireSession(deps, request);
    const { id } = request.params as { id: string };
    const jobId = assertId(id, "jobId");
    const row = (await prisma.catalogSyncJob.findFirst({
      where: { id: jobId, tenantId: info.tenantId },
    })) as unknown as SyncJobRow | null;
    if (!row) throw new NotFoundError("Sync job not found");
    return { job: serializeSyncJob(row) };
  });

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
    // 测试优先分排序：分数是多字段现算，Prisma orderBy 表达不了，在
    // 过滤后的候选集上内存算分排序再分页（与品牌聚合的全量加载同模式）。
    // priority 与 priority_desc 同义（分数降序）；priority_asc 为分数升序
    // （前端列头方向切换产生的状态值）。buildProductOrderBy 不加此分支。
    const sortRaw = typeof query.sort === "string" ? query.sort.trim() : "";
    const isPrioritySort =
      sortRaw === "priority" ||
      sortRaw === "priority_desc" ||
      sortRaw === "priority_asc";
    // commission_desc：有效佣金降序（见下方内存排序分支，与 priority 同机制）。
    const isCommissionSort = sortRaw === "commission_desc";
    const where: Record<string, unknown> = { tenantId: info.tenantId };
    if (query.networkId) where.networkId = assertId(query.networkId, "networkId");
    if (query.recommended === "true" || query.recommended === "1") {
      where.recommended = true;
    } else if (query.recommended === "false" || query.recommended === "0") {
      where.recommended = false;
    }
    // 备选池阶段过滤（补强 #3）：非法阶段值直接 400，不静默忽略。
    const poolStageRaw =
      typeof query.poolStage === "string" ? query.poolStage.trim() : "";
    if (poolStageRaw && poolStageRaw !== "all" && !isPoolStage(poolStageRaw)) {
      throw new ValidationError("poolStage 非法（inbox/pool/testing/live）");
    }
    Object.assign(where, buildPoolStageWhere(query));
    const q = asTrimmed(query.q);
    if (q) {
      // 分词匹配：查询按空格拆开，每个词都要命中（AND），
      // 但每个词可命中 name / brand / asin 任一字段。
      // 原来整串连续匹配，"roborock Qrevo" 搜不到
      // "roborock 2026 New Qrevo ..."（中间隔着别的词）。
      const tokens = q.split(/\s+/).filter(Boolean).slice(0, 6);
      const groups = tokens.map((t) => ({
        OR: [
          { name: { contains: t, mode: "insensitive" } },
          { brand: { contains: t, mode: "insensitive" } },
          { asin: { contains: t, mode: "insensitive" } },
        ],
      }));
      where.AND = [...((where.AND as unknown[]) ?? []), ...groups];
    }
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
    // 广告投放数量过滤（minAdCount / hasAds=1）：与预设过滤叠加生效。
    Object.assign(where, buildAdCountWhere(query));
    // 投放国家过滤（country=US,CA）：与预设/广告数过滤叠加生效。
    Object.assign(where, buildCountryWhere(query));
    // 仅看推荐 → 排除黑名单（商品级 + 商家级），与漏斗 recommended/launchable
    // 口径对齐，保证"漏斗推荐数 = 列表按推荐筛出的条数"（2026-10-20 巡检）。
    // 不用 AND（fake prisma 不支持）：直接键 notIn，真 Prisma 同样合法。
    if (query.recommended === "true" || query.recommended === "1") {
      const { productIds: blProducts, merchantIds: blMerchants } =
        await getBlacklistExclusion(prisma, info.tenantId);
      if (blProducts.length > 0) where.id = { notIn: blProducts };
      if (blMerchants.length > 0)
        where.merchantId = { notIn: blMerchants };
    }
    let total: number;
    let rows: Array<Record<string, unknown>>;
    if (isPrioritySort) {
      // 先过滤（where 与普通路径完全一致）→ 全量候选集内存算分排序 → 切片。
      // total = 过滤后候选总数，与普通路径 count 口径一致。
      const allRows = (await prisma.networkProduct.findMany({
        where,
      })) as Array<Record<string, unknown>>;
      const dir = sortRaw === "priority_asc" ? 1 : -1;
      const scored = allRows.map((r) => ({
        r,
        score: computeCatalogTestPriority(catalogPriorityInputFromRow(r))
          .score,
      }));
      scored.sort((a, b) => {
        if (a.score !== b.score) return dir * (a.score - b.score);
        // 同分兜底（两个方向一致，保证序确定）：推荐指数降序 → externalId 降序。
        const ra = numOrNull(a.r.recommendationScore);
        const rb = numOrNull(b.r.recommendationScore);
        if (ra !== rb) return (rb ?? -Infinity) - (ra ?? -Infinity);
        const ea = String(a.r.externalId ?? "");
        const eb = String(b.r.externalId ?? "");
        return ea < eb ? 1 : ea > eb ? -1 : 0;
      });
      total = allRows.length;
      rows = scored
        .slice((page - 1) * pageSize, page * pageSize)
        .map((s) => s.r);
    } else if (isCommissionSort) {
      // commission_desc：有效佣金是 Prisma orderBy 表达不了的派生值
      // （固定佣金优先，否则 price×佣金率，与筛选同口径），故沿用
      // priority 的机制：过滤后的候选集全量取数 → 内存算佣金排序 → 切片。
      // 局限（与 priority 同款，必须明说）：全量加载候选集，大库下分页
      // 成本高于页内排序；total 仍为过滤后候选总数。
      // 排序口径：有效佣金降序，null（未知）排后，次级序 externalId 降序。
      // 商品库商品没有 EPC/转化率数据：EPC→佣金→转化率在商品库的投影
      // 就是有效佣金降序（EPC 与转化率对所有行未知、全部打平，由佣金
      // 决定顺序），本分支绝不假装算出了 EPC。
      const allRows = (await prisma.networkProduct.findMany({
        where,
      })) as Array<Record<string, unknown>>;
      const withFigure = allRows.map((r) => ({
        r,
        figure: estimateCommissionFigure({
          amount: numOrNull(r.commissionAmount),
          ratePct: numOrNull(r.commissionRate),
          price: numOrNull(r.price),
        }).figure,
      }));
      withFigure.sort((a, b) => {
        const af = a.figure;
        const bf = b.figure;
        if (af !== null && bf !== null && af !== bf) return bf - af;
        if (af !== null && bf === null) return -1;
        if (af === null && bf !== null) return 1;
        const ea = String(a.r.externalId ?? "");
        const eb = String(b.r.externalId ?? "");
        return ea < eb ? 1 : ea > eb ? -1 : 0;
      });
      total = allRows.length;
      rows = withFigure
        .slice((page - 1) * pageSize, page * pageSize)
        .map((s) => s.r);
    } else {
      const [t, rs] = await Promise.all([
        prisma.networkProduct.count({ where }),
        prisma.networkProduct.findMany({
          where,
          orderBy: buildProductOrderBy(query.sort) as never,
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      total = t as number;
      rows = rs as Array<Record<string, unknown>>;
    }
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
    const merchantById = new Map<
      string,
      { name: string; settlementRatePct: number | null }
    >();
    if (merchantIds.length > 0) {
      const merchants = (await prisma.merchant.findMany({
        where: { tenantId: info.tenantId, id: { in: merchantIds } },
        select: { id: true, name: true, settlementRatePct: true },
      })) as Array<{ id: string; name: string; settlementRatePct: unknown }>;
      for (const m of merchants)
        merchantById.set(m.id, {
          name: m.name,
          settlementRatePct: numOrNull(m.settlementRatePct),
        });
    }
    // 商家级 riskCost（松绑口径，2026-10-25）：商品行本身没有逐条禁令数据，
    // 故本栏位只能来自商家级证据——该商家各 Offer 的最新 OfferPolicy 快照
    // （每商家取最新一条；createdAt 倒序后首条胜出，内存排序为准），
    // 经 policy-risk-cost 共享函数映射。这是商家级证据，不是商品级条款：
    // 只能读作「该商家某 Offer 的最新政策含禁令」，绝不写成「该商品被禁」。
    // 无禁令或无政策数据时不挂 riskCost 字段（与 Offer 侧「仅非空才附」一致）。
    // /screen 不写 riskCost（它只写 recommended/score），本栏位只在列表读取时现算。
    const riskCostByMerchant = new Map<string, string[]>();
    if (merchantIds.length > 0) {
      const offersOfMerchants = (await prisma.offer.findMany({
        where: { tenantId: info.tenantId, merchantId: { in: merchantIds } },
        select: { id: true, merchantId: true },
      })) as Array<{ id: string; merchantId: string | null }>;
      const offerMerchant = new Map<string, string>();
      for (const o of offersOfMerchants) {
        if (o.merchantId) offerMerchant.set(o.id, o.merchantId);
      }
      const offerIds = [...offerMerchant.keys()];
      if (offerIds.length > 0) {
        const policyRows = ((await prisma.offerPolicy?.findMany({
          where: { tenantId: info.tenantId, offerId: { in: offerIds } },
          select: { offerId: true, rules: true, createdAt: true },
        })) as
          | Array<{ offerId: string; rules: unknown; createdAt: Date }>
          | undefined) ?? [];
        policyRows.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        for (const p of policyRows) {
          const mid = offerMerchant.get(p.offerId);
          if (!mid || riskCostByMerchant.has(mid)) continue;
          riskCostByMerchant.set(mid, riskCostFromPolicyRules(p.rules));
        }
      }
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
      const merchantRisk = riskCostByMerchant.get(mid);
      return {
        ...serializeProduct(r, whiteSet.has(r.id as string)),
        pinned,
        blacklisted,
        // riskCost：商家级证据（见上方注释），不是商品级条款；空则不挂字段。
        ...(merchantRisk && merchantRisk.length > 0
          ? { riskCost: merchantRisk }
          : {}),
        merchantName: mid ? (merchantById.get(mid)?.name ?? null) : null,
        // 补强 #1：所属商家结算率（查不到商家/未验证 → null，前端显示「未验证」）。
        settlementRatePct: mid
          ? (merchantById.get(mid)?.settlementRatePct ?? null)
          : null,
        networkKind: net?.kind ?? null,
        networkName: net?.name ?? null,
      };
    });
    // 白名单本页置顶只对普通排序生效：priority / commission_desc 排序下
    // 顺序必须纯粹（前者按"先测"名次、后者按佣金），pinned 仅保留标记不重排。
    if (!isPrioritySort && !isCommissionSort) {
      products.sort((a, b) => Number(b.pinned) - Number(a.pinned));
    }
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

  /* ── 投放国家清单（当前租户在库商品出现过的国家，供列表国家筛选下拉） ── */
  app.get("/api/v1/catalog/countries", async (request) => {
    const info = await requireSession(deps, request);
    const query = request.query as Record<string, unknown>;
    const where: Record<string, unknown> = {
      tenantId: info.tenantId,
      countryCode: { not: null },
    };
    if (query.networkId) where.networkId = assertId(query.networkId, "networkId");
    const rows = (await prisma.networkProduct.findMany({
      where,
      select: { countryCode: true },
      distinct: ["countryCode"],
    })) as Array<{ countryCode: string | null }>;
    const countries = rows
      .map((r) => (typeof r.countryCode === "string" ? r.countryCode : ""))
      .filter((c) => /^[A-Z]{2}$/.test(c))
      .sort();
    return { countries };
  });

  /* ── 品牌榜（按品牌聚合：投放决策单位是品牌，不是单品） ──
   * 分组键 = 归一化品牌名（brandKey）× 国家（countryCode，空 = 单独成组）× 网络。
   * brandScore（0–100，确定性）：广告分 0–40（未计算 10 / none 5 / small 30 /
   * sweet 40 / hot 30 / redocean 15；疑似停投封顶 5）+ 佣金分 0–30
   * （maxCommissionUsd：未知 5 / ≥50→30 / ≥25→24 / ≥8→16 / >0→8 / 0→0）
   * + 价格分 0–20（≥$80 件数占比 ×20，价格按原始数字直比不换汇）
   * + 丰富分 0–10（min(商品数, 10)）。
   * landingUrl / promoMode 来自 BrandProfile（品牌级落地页链接 + 投放方式
   * 显式标注）；无行 → 都为 null，表示该品牌未标注投放方式、走单品投放
   * ——中性状态，不是缺失（有些联盟品牌没有品牌级投放链接）。 */
  app.get("/api/v1/catalog/brands", async (request) => {
    const info = await requireSession(deps, request);
    const query = request.query as Record<string, unknown>;
    const where: Record<string, unknown> = { tenantId: info.tenantId };
    if (query.networkId)
      where.networkId = assertId(query.networkId, "networkId");
    if (typeof query.country === "string" && query.country.trim())
      where.countryCode = query.country.trim().toUpperCase();
    const rows = (await prisma.networkProduct.findMany({
      where,
      select: {
        id: true,
        name: true,
        brand: true,
        countryCode: true,
        networkId: true,
        price: true,
        commissionAmount: true,
        commissionRate: true,
        recommendationScore: true,
        promoUrl: true,
        poolStage: true,
        adCount: true,
        adCountSelf: true,
        adCountOthers: true,
        adCountHome: true,
        adCountProduct: true,
        adCountLongtail: true,
        adPolicyRisk: true,
        adProbeDetail: true,
        tcAdvertisersCount: true,
        tcTopAdvertisers: true,
        tcCheckedAt: true,
        lastAdCount: true,
      },
    })) as Array<Record<string, unknown>>;
    const q =
      typeof query.q === "string" ? query.q.trim().toLowerCase() : "";

    interface BrandGroup {
      brand: string;
      brandCounts: Map<string, number>;
      brandKey: string;
      countryCode: string | null;
      networkId: string;
      productCount: number;
      priceMin: number | null;
      priceMax: number | null;
      maxRatePct: number | null;
      maxCommissionUsd: number | null;
      ge80Count: number;
      adCount: number | null;
      adCountSelf: number | null;
      adCountOthers: number | null;
      adCountHome: number | null;
      adCountProduct: number | null;
      adCountLongtail: number | null;
      adPolicyRisk: boolean;
      /** 探针明细（组级统一写入，取第一个非 null 即组值）；未按明细口径算过 → null。 */
      adProbeDetail: unknown;
      /** 透明中心广告主数（组级，第一个非 null 即组值）；从未查过 → null。 */
      tcAdvertisersCount: number | null;
      /** 透明中心头部广告主（组级，第一个非 null 数组即组值）；仅展示。 */
      tcTopAdvertisers: unknown;
      /** TC 上次查询时间（组级，第一个非 null 即组值；ISO 输出）。 */
      tcCheckedAt: Date | string | null;
      lastAdCount: number | null;
      products: Array<Record<string, unknown>>;
    }
    const groups = new Map<string, BrandGroup>();
    for (const r of rows) {
      const rawBrand = typeof r.brand === "string" ? r.brand.trim() : "";
      if (!rawBrand) continue;
      if (q && !rawBrand.toLowerCase().includes(q)) continue;
      const brandKey = normalizeBrandKey(rawBrand);
      const countryCode =
        typeof r.countryCode === "string" && r.countryCode.trim()
          ? r.countryCode.trim().toUpperCase()
          : null;
      const networkId = (r.networkId as string) ?? "";
      const key = `${networkId}${brandKey}${countryCode ?? ""}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          brand: rawBrand,
          brandCounts: new Map(),
          brandKey,
          countryCode,
          networkId,
          productCount: 0,
          priceMin: null,
          priceMax: null,
          maxRatePct: null,
          maxCommissionUsd: null,
          ge80Count: 0,
          adCount: null,
          adCountSelf: null,
          adCountOthers: null,
          adCountHome: null,
          adCountProduct: null,
          adCountLongtail: null,
          adPolicyRisk: false,
          adProbeDetail: null,
          tcAdvertisersCount: null,
          tcTopAdvertisers: null,
          tcCheckedAt: null,
          lastAdCount: null,
          products: [],
        };
        groups.set(key, g);
      }
      g.brandCounts.set(rawBrand, (g.brandCounts.get(rawBrand) ?? 0) + 1);
      g.productCount += 1;
      const price = numOrNull(r.price);
      if (price !== null) {
        g.priceMin = g.priceMin === null ? price : Math.min(g.priceMin, price);
        g.priceMax = g.priceMax === null ? price : Math.max(g.priceMax, price);
        if (price >= 80) g.ge80Count += 1;
      }
      const ratePct = numOrNull(r.commissionRate);
      if (ratePct !== null)
        g.maxRatePct =
          g.maxRatePct === null ? ratePct : Math.max(g.maxRatePct, ratePct);
      // 单品佣金金额沿用全站口径：固定佣金优先，否则 价格 × 佣金率估算；算不出不参与。
      const fig = estimateCommissionFigure({
        amount: r.commissionAmount,
        ratePct: r.commissionRate,
        price: r.price,
      });
      if (fig.figure !== null)
        g.maxCommissionUsd =
          g.maxCommissionUsd === null
            ? fig.figure
            : Math.max(g.maxCommissionUsd, fig.figure);
      // 广告数是组级统一写入的，取第一个非 null 即组值。
      if (g.adCount === null) g.adCount = numOrNull(r.adCount);
      if (g.adCountSelf === null) g.adCountSelf = numOrNull(r.adCountSelf);
      if (g.adCountOthers === null)
        g.adCountOthers = numOrNull(r.adCountOthers);
      if (g.adCountHome === null) g.adCountHome = numOrNull(r.adCountHome);
      if (g.adCountProduct === null)
        g.adCountProduct = numOrNull(r.adCountProduct);
      // 长尾探针组值同口径（第一个非 null）；政策风险取 any true（组级统一写入）。
      if (g.adCountLongtail === null)
        g.adCountLongtail = numOrNull(r.adCountLongtail);
      // 探针明细同口径：第一个非 null（且形状为数组）即组值。
      if (g.adProbeDetail === null && Array.isArray(r.adProbeDetail))
        g.adProbeDetail = r.adProbeDetail;
      // 透明中心旁证同口径：计数/头部名单/查询时间都取第一个非 null。
      if (g.tcAdvertisersCount === null)
        g.tcAdvertisersCount = numOrNull(r.tcAdvertisersCount);
      if (g.tcTopAdvertisers === null && Array.isArray(r.tcTopAdvertisers))
        g.tcTopAdvertisers = r.tcTopAdvertisers;
      if (g.tcCheckedAt === null && (r.tcCheckedAt ?? null) !== null)
        g.tcCheckedAt = r.tcCheckedAt as Date | string;
      if (r.adPolicyRisk === true) g.adPolicyRisk = true;
      if (g.lastAdCount === null) g.lastAdCount = numOrNull(r.lastAdCount);
      g.products.push({
        id: r.id,
        name: r.name,
        price,
        ratePct,
        commissionUsd: fig.figure,
        score: numOrNull(r.recommendationScore),
        promoUrl: (r.promoUrl as string) ?? null,
        poolStage: (r.poolStage as string) ?? null,
      });
    }

    // 品牌落地页链接 + 投放方式标注：一次查全租户 BrandProfile，按 网络×品牌×国家 对号。
    const profiles = (await prisma.brandProfile.findMany({
      where: { tenantId: info.tenantId },
      select: {
        networkId: true,
        brandKey: true,
        countryCode: true,
        landingUrl: true,
        promoMode: true,
      },
    })) as Array<Record<string, unknown>>;
    const profileByKey = new Map<
      string,
      { landingUrl: string; promoMode: string | null }
    >();
    for (const p of profiles) {
      profileByKey.set(
        `${(p.networkId as string) ?? ""}${(p.brandKey as string) ?? ""}${(p.countryCode as string) ?? ""}`,
        {
          landingUrl: (p.landingUrl as string) ?? "",
          promoMode: (p.promoMode as string) ?? null,
        }
      );
    }

    const brands = [...groups.values()].map((g) => {
      // 展示名 = 组内最常见的原始 brand 写法（并列取先出现者）。
      let display = g.brand;
      let best = 0;
      for (const [name, count] of g.brandCounts) {
        if (count > best) {
          best = count;
          display = name;
        }
      }
      const adTrend = deriveAdTrend(g.adCount, g.lastAdCount);
      // 分档含长尾地板：裸词 none/未算但长尾 ≥1 → small（与 Offer 优先分共用）。
      const adBand = adBandOf(g.adCount, g.adCountLongtail);
      const brandScore = computeBrandScore({
        adCount: g.adCount,
        adBand,
        adTrend,
        maxCommissionUsd: g.maxCommissionUsd,
        ge80Count: g.ge80Count,
        productCount: g.productCount,
      });
      const topProducts = [...g.products]
        .sort((a, b) => {
          const sa = (a.score as number | null) ?? null;
          const sb = (b.score as number | null) ?? null;
          if (sa === null && sb === null) return 0;
          if (sa === null) return 1;
          if (sb === null) return -1;
          return sb - sa;
        })
        .slice(0, 5);
      const profile = profileByKey.get(
        `${g.networkId}${g.brandKey}${g.countryCode ?? ""}`
      );
      return {
        brand: display,
        brandKey: g.brandKey,
        countryCode: g.countryCode,
        networkId: g.networkId,
        productCount: g.productCount,
        priceMin: g.priceMin,
        priceMax: g.priceMax,
        maxRatePct: g.maxRatePct,
        maxCommissionUsd: g.maxCommissionUsd,
        ge80Count: g.ge80Count,
        adCount: g.adCount,
        adCountSelf: g.adCountSelf,
        adCountOthers: g.adCountOthers,
        adCountHome: g.adCountHome,
        adCountProduct: g.adCountProduct,
        adCountLongtail: g.adCountLongtail,
        adPolicyRisk: g.adPolicyRisk,
        adProbeDetail: g.adProbeDetail,
        tcAdvertisersCount: g.tcAdvertisersCount,
        tcTopAdvertisers: g.tcTopAdvertisers,
        tcCheckedAt:
          (g.tcCheckedAt as Date)?.toISOString?.() ??
          (typeof g.tcCheckedAt === "string" ? g.tcCheckedAt : null),
        lastAdCount: g.lastAdCount,
        adTrend,
        adBand,
        brandScore,
        // landingUrl 存 "" = 无链接（只有 promoMode 标注的行）→ 对外归 null。
        landingUrl: profile?.landingUrl ? profile.landingUrl : null,
        promoMode: profile?.promoMode ?? null,
        topProducts,
      };
    });
    brands.sort(
      (a, b) =>
        b.brandScore - a.brandScore ||
        b.productCount - a.productCount ||
        a.brandKey.localeCompare(b.brandKey)
    );
    return { brands: brands.slice(0, 200), total: brands.length };
  });

  /* ── 品牌档案写入（PUT）：落地页链接 + 投放方式标注，部分更新 ──
   * landingUrl 省略 = 不改；"" = 清除链接；非空须 http(s) 且 ≤2000。
   * promoMode 省略 = 不改；null = 清回未标注；"brand"/"product" = 设置；其余 400。
   * 两者至少给一个。链接与标注都清空的行直接删除（无行 = 未标注 + 无链接）。 */
  app.put<{ Body: Record<string, unknown> }>(
    "/api/v1/catalog/brands/landing-url",
    async (request) => {
      const info = await requireSession(deps, request);
      const body = request.body ?? {};
      const networkId = assertId(body.networkId, "networkId");
      const brandKey =
        typeof body.brandKey === "string"
          ? normalizeBrandKey(body.brandKey)
          : "";
      if (!brandKey) throw new ValidationError("brandKey 不能为空");
      const countryCode =
        typeof body.countryCode === "string"
          ? body.countryCode.trim().toUpperCase()
          : "";
      const hasLanding = body.landingUrl !== undefined;
      const hasMode = body.promoMode !== undefined;
      if (!hasLanding && !hasMode)
        throw new ValidationError("landingUrl 与 promoMode 至少提供一个");
      let landingPatch: string | undefined;
      if (hasLanding) {
        if (typeof body.landingUrl !== "string")
          throw new ValidationError("landingUrl 必须是字符串");
        const v = body.landingUrl.trim();
        if (v !== "") {
          if (v.length > 2000)
            throw new ValidationError("landingUrl 过长（上限 2000 字符）");
          let parsed: URL;
          try {
            parsed = new URL(v);
          } catch {
            throw new ValidationError("landingUrl 不是合法 URL");
          }
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
            throw new ValidationError("landingUrl 必须是 http(s) URL");
        }
        landingPatch = v;
      }
      let modePatch: string | null | undefined;
      if (hasMode) {
        if (
          body.promoMode !== null &&
          body.promoMode !== "brand" &&
          body.promoMode !== "product"
        )
          throw new ValidationError(
            "promoMode 只能是 \"brand\" / \"product\" / null"
          );
        modePatch = body.promoMode as string | null;
      }
      const existing = (await prisma.brandProfile.findFirst({
        where: {
          tenantId: info.tenantId,
          networkId,
          brandKey,
          countryCode,
        },
        select: { id: true, landingUrl: true, promoMode: true },
      })) as {
        id: string;
        landingUrl: string;
        promoMode: string | null;
      } | null;
      const nextLanding = hasLanding
        ? (landingPatch as string)
        : (existing?.landingUrl ?? "");
      const nextMode = hasMode
        ? modePatch
        : (existing?.promoMode ?? null);
      if (!existing && nextLanding === "" && nextMode === null) {
        // 无行且无任何可存内容（只做了清除动作）→ 不建空行。
        return { ok: true, landingUrl: null, promoMode: null };
      }
      if (existing && nextLanding === "" && nextMode === null) {
        // 链接与标注都清空 → 删行（回到「无品牌档案」状态）。
        await prisma.brandProfile.delete({ where: { id: existing.id } });
        return { ok: true, landingUrl: null, promoMode: null };
      }
      if (existing) {
        await prisma.brandProfile.update({
          where: { id: existing.id },
          data: { landingUrl: nextLanding, promoMode: nextMode },
        });
      } else {
        await prisma.brandProfile.create({
          data: {
            tenantId: info.tenantId,
            networkId,
            brandKey,
            countryCode,
            landingUrl: nextLanding,
            promoMode: nextMode,
          },
        });
      }
      return {
        ok: true,
        landingUrl: nextLanding === "" ? null : nextLanding,
        promoMode: nextMode,
      };
    }
  );

  /* ── 可投流漏斗计数 ──
   * 口径（用现有字段能算的最合理近似，逐项注明）：
   * - total：范围内 NetworkProduct 总数（status 不限）。
   * - passedGate：status='active' 的数量。入库时单次佣金明确 <$8 的商品
   *   根本不落库（catalog-sync 第 5 步门槛），存量里只有手动下线会变
   *   inactive，故"active 在库数"近似"过门槛且未下线"的量。
   * - recommended：recommended=true 且未命中黑名单（商品/商家，判定口径
   *   与商品列表的 blacklisted 标记一致：status='active' 的黑名单行）。
   * - launchable：recommended 基础上 promoUrl 非空且 status='active'。
   * - withAds：范围内「有广告在投」的商品数——多探针口径：裸品牌词
   *   adCount >= 1 或长尾探针 adCountLongtail >= 1（未计算=null 的不
   *   计入；品牌级信号，一个品牌有广告在投时该品牌 0 佣金商品也可能被
   *   计入，见筛选预设口径说明）。
   * - offersCreated：launchable 中已建过 Offer 的商品数；Offer 关联方式 =
   *   idempotencyKey `catalog:{networkId}:{externalId}`（与 launch-counts 同口径）。
   */
  app.get("/api/v1/catalog/funnel", async (request) => {
    const info = await requireSession(deps, request);
    const query = request.query as Record<string, unknown>;
    const networkId = query.networkId
      ? assertId(query.networkId, "networkId")
      : null;
    const base: Record<string, unknown> = { tenantId: info.tenantId };
    if (networkId) base.networkId = networkId;
    const [total, passedGate, withAds] = await Promise.all([
      prisma.networkProduct.count({ where: base }),
      prisma.networkProduct.count({ where: { ...base, status: "active" } }),
      prisma.networkProduct.count({
        where: {
          ...base,
          OR: [
            { adCount: { gte: 1 } },
            { adCountLongtail: { gte: 1 } },
            // 两个广告数都是 null = 该网络不提供这个字段（YP 的 Get Products
            // 就没有 adCount）。「没数据」不等于「没人在投」，不能当 0 判死。
            { AND: [{ adCount: null }, { adCountLongtail: null }] },
          ],
        },
      }),
    ]);
    const candidates = (await prisma.networkProduct.findMany({
      where: { ...base, recommended: true },
      select: {
        id: true,
        networkId: true,
        externalId: true,
        merchantId: true,
        promoUrl: true,
        status: true,
      },
    })) as Array<{
      id: string;
      networkId: string;
      externalId: string;
      merchantId: string | null;
      promoUrl: string | null;
      status: string;
    }>;
    const candIds = candidates.map((c) => c.id);
    const { productIds: blackProductIds, merchantIds: blackMerchantIds } =
      await getBlacklistExclusion(prisma, info.tenantId, candIds);
    const blackProductSet = new Set(blackProductIds);
    const blackMerchantSet = new Set(blackMerchantIds);
    const clean = candidates.filter(
      (c) =>
        !blackProductSet.has(c.id) &&
        !(c.merchantId && blackMerchantSet.has(c.merchantId))
    );
    const recommended = clean.length;
    const launchableRows = clean.filter(
      (c) =>
        c.status === "active" &&
        typeof c.promoUrl === "string" &&
        c.promoUrl.trim() !== ""
    );
    const launchable = launchableRows.length;
    let offersCreated = 0;
    if (launchableRows.length > 0) {
      const offers = (await prisma.offer.findMany({
        where: {
          tenantId: info.tenantId,
          idempotencyKey: {
            in: launchableRows.map(
              (c) => `catalog:${c.networkId}:${c.externalId}`
            ),
          },
        },
        select: { idempotencyKey: true },
      })) as Array<{ idempotencyKey: string | null }>;
      const hitKeys = new Set(
        offers.map((o) => o.idempotencyKey).filter(Boolean)
      );
      offersCreated = launchableRows.filter((c) =>
        hitKeys.has(`catalog:${c.networkId}:${c.externalId}`)
      ).length;
    }
    return { total, passedGate, recommended, launchable, withAds, offersCreated };
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
            countryCode: true,
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
          countryCode: string | null;
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
          if (r.countryCode == null) {
            // YP 商品的国家在 rawData.market_place（如 amazon.ca → CA）；
            // 其他来源可能有 country_code/country 原值。只补空，不覆盖。
            const rawCc =
              typeof raw.country_code === "string" && raw.country_code.trim()
                ? raw.country_code.trim().toUpperCase()
                : typeof raw.countryCode === "string" && raw.countryCode.trim()
                  ? raw.countryCode.trim().toUpperCase()
                  : null;
            const cc =
              rawCc ??
              countryCodeFromMarketPlace(raw.market_place ?? raw.marketPlace);
            if (cc && /^[A-Z]{2}$/.test(cc)) data.countryCode = cc;
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
      // 统一评分入口 evaluateProduct：score = 质量分（固定权重，缺数据中性），
      // recommended = 租户预设阈值判定。与同步评分、/screen 同一口径，
      // 同一商品三条路径结果一致（消除历史上两套公式互相覆盖）。
      const preset = await resolveScreeningPreset(prisma, info.tenantId);
      let updated = 0;
      const scored: Array<{ productId: string; score: number; recommended: boolean }> = [];
      // 补强 #1：商家结算率按 merchantId 懒加载缓存（同商家只查一次）；查不到 → null（未验证，评分中性）。
      const settlementByMerchant = new Map<string, number | null>();
      const settlementFor = async (
        merchantId: unknown
      ): Promise<number | null> => {
        if (typeof merchantId !== "string" || !merchantId) return null;
        const cached = settlementByMerchant.get(merchantId);
        if (cached !== undefined) return cached;
        const m = (await prisma.merchant.findFirst({
          where: { id: merchantId, tenantId: info.tenantId },
          select: { settlementRatePct: true },
        })) as { settlementRatePct: unknown } | null;
        const v = m ? numOrNull(m.settlementRatePct) : null;
        settlementByMerchant.set(merchantId, v);
        return v;
      };
      for (const id of ids) {
        const p = (await prisma.networkProduct.findFirst({
          where: { id, tenantId: info.tenantId },
        })) as Record<string, unknown> | null;
        if (!p) continue;
        const r = evaluateProduct(
          {
            price: numOrNull(p.price),
            commissionAmount: numOrNull(p.commissionAmount),
            commissionRate: numOrNull(p.commissionRate),
            reviewCount:
              typeof p.reviewCount === "number" && Number.isFinite(p.reviewCount)
                ? p.reviewCount
                : null,
            settlementRatePct: await settlementFor(p.merchantId),
            payoutCycleDays:
              typeof p.payoutCycleDays === "number" &&
              Number.isFinite(p.payoutCycleDays)
                ? p.payoutCycleDays
                : null,
          },
          preset
        );
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

  /* ── 备选池阶段移动（补强 #3）──
   * B6 门禁（与 session/screen 同风格）：按商品所属网络的 kind 逐个
   * requireActiveGrant（owner/admin 豁免返回 null，审计标 exempt）；
   * 成功后 writeCatalogAudit + incrementGrantUsage。逐条 update
   * （与 calc-score 同风格），已在目标阶段的商品不重复写。
   */
  async function moveProductsToPoolStage(
    info: { tenantId: string; id: string; role: string },
    products: Array<{ id: string; poolStage?: string | null; networkId: string }>,
    poolStage: PoolStage
  ): Promise<number> {
    const networkIds = [
      ...new Set(products.map((pr) => pr.networkId).filter(Boolean)),
    ];
    const grants: Array<{ id: string } | null> = [];
    for (const nid of networkIds) {
      const network = await findNetwork(prisma, info.tenantId, nid);
      const grant = await requireActiveGrant(prisma, {
        tenantId: info.tenantId,
        userId: info.id,
        userRole: info.role,
        capability: "catalog-sync",
        whitelistValue: network.kind,
      });
      grants.push(grant as { id: string } | null);
    }
    let updated = 0;
    for (const pr of products) {
      if ((pr.poolStage ?? "inbox") === poolStage) continue;
      await prisma.networkProduct.update({
        where: { id: pr.id },
        data: { poolStage },
      });
      updated += 1;
    }
    const firstGrant = grants.find((g) => g !== null) ?? null;
    await writeCatalogAudit(prisma, {
      tenantId: info.tenantId,
      grantId: firstGrant?.id ?? null,
      actorId: info.id,
      action: "CATALOG_PRODUCT_POOL_STAGE_MOVED",
      detail: {
        poolStage,
        requested: products.length,
        updated,
        productIds: products.map((pr) => pr.id),
        ...(firstGrant ? {} : { exempt: "owner-admin" }),
      },
    });
    for (const g of grants) {
      if (g) await incrementGrantUsage(prisma, g as never);
    }
    return updated;
  }

  app.patch<{
    Params: { id: string };
    Body: { poolStage?: unknown };
  }>("/api/v1/catalog/products/:id/pool-stage", async (request) => {
    const info = await requireSession(deps, request);
    const id = assertId(request.params.id, "productId");
    if (!isPoolStage(request.body?.poolStage)) {
      throw new ValidationError("poolStage 非法（inbox/pool/testing/live）");
    }
    const poolStage = request.body.poolStage;
    const product = (await prisma.networkProduct.findFirst({
      where: { id, tenantId: info.tenantId },
    })) as { id: string; poolStage?: string | null; networkId: string } | null;
    if (!product) throw new NotFoundError("Product not found");
    const updated = await moveProductsToPoolStage(info, [product], poolStage);
    return { updated, productId: id, poolStage };
  });

  app.post<{ Body: { ids?: unknown; poolStage?: unknown } }>(
    "/api/v1/catalog/products/pool-stage",
    async (request) => {
      const info = await requireSession(deps, request);
      const ids = asIdArray(request.body?.ids, "ids");
      if (!isPoolStage(request.body?.poolStage)) {
        throw new ValidationError("poolStage 非法（inbox/pool/testing/live）");
      }
      const poolStage = request.body.poolStage;
      const products = (await prisma.networkProduct.findMany({
        where: { id: { in: ids }, tenantId: info.tenantId },
      })) as Array<{ id: string; poolStage?: string | null; networkId: string }>;
      const updated = await moveProductsToPoolStage(info, products, poolStage);
      return { updated, requested: ids.length, poolStage };
    }
  );

  // 广告数计算范围：all = 全部品牌组；alive = 只算活口径组（整组判死的跳过）。
  // 缺省 all；非法值 400（calc 与 preview 共用同一校验口径）。
  function parseCalcScope(raw: unknown): "all" | "alive" {
    if (raw === undefined || raw === null || raw === "") return "all";
    if (raw === "all" || raw === "alive") return raw;
    throw new ValidationError("scope 非法（all/alive）");
  }

  // 广告数计算深度（每组总查询数，含裸词）：仅 4 / 8 / 12 三档。
  // 缺省不传 → 服务层默认 12（历史行为）；非法值 400（与 scope 同口径，
  // 不静默回落——付费深度必须让用户明确知道自己签的是哪一档）。
  function parseCalcDepth(raw: unknown): number | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (raw === 4 || raw === 8 || raw === 12) return raw;
    throw new ValidationError("depth 非法（每组查询深度仅支持 4/8/12）");
  }

  // 广告投放数量计算（按品牌+国家查 DataForSEO SERP，14 天缓存增量）。
  // ids 缺省/空 = 该 tenant 全部商品增量；凭证未配置 → 明确报错不静默。
  // force=true 忽略缓存强制重算（前端须先走 preview 确认）；scope=alive
  // 跳过整组判死的品牌组。两者默认关，口径与历史行为一致。
  // depth=每组查询深度 4/8/12（缺省 12），由用户在确认框按费用预估选定。
  app.post<{
    Body: { ids?: unknown; force?: unknown; scope?: unknown; depth?: unknown };
  }>(
    "/api/v1/catalog/products/calc-ad-count",
    async (request) => {
      const info = await requireSession(deps, request);
      let productIds: string[] | undefined;
      const rawIds = request.body?.ids;
      if (Array.isArray(rawIds) && rawIds.length > 0) {
        productIds = asIdArray(rawIds, "ids");
      }
      const force = request.body?.force === true;
      const scope = parseCalcScope(request.body?.scope);
      const depth = parseCalcDepth(request.body?.depth);
      // 付费数据网关：广告数计算是 DataForSEO 计费调用，统一走网关
      // （站长直通 / 租户自备 key / 平台 key + paid-data 授权）。
      const access = await requirePaidDataAccess(prisma, {
        tenantId: info.tenantId,
        userId: info.id,
        userRole: info.role,
        feature: "catalog-ad-count",
      });
      let result;
      try {
        result = await calcBrandAdCounts(prisma, info.tenantId, productIds, {
          credentials: access.credentials ?? undefined,
          force,
          aliveOnly: scope === "alive",
          depth,
        });
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
      // 记账门槛：SERP 或 TC 任一实际发出查询都记账（TC 单独补查时
      // groupsQueried 可能为 0，不能漏记）；calls = SERP 实际查询数
      // + TC task_post 数（合并计数，拆分看审计 detail 的两字段）。
      const totalCalls =
        (result.serpQueries ?? result.groupsQueried) +
        (result.tcQueries ?? 0);
      if (totalCalls > 0) {
        await recordPaidDataUsage(prisma, {
          tenantId: info.tenantId,
          actorId: info.id,
          feature: "catalog-ad-count",
          keySource: access.keySource,
          // 一组最多 depth 次 SERP 查询（深度可选 4/8/12）：按实际
          // 查询次数记账，不能再按组数记（会把真实消耗大幅低估）。
          calls: totalCalls,
          grantId: access.grantId,
        });
      }
      await writeCatalogAudit(prisma, {
        tenantId: info.tenantId,
        actorId: info.id,
        action: "catalog.calc_ad_count",
        detail: {
          requested: productIds?.length ?? null,
          force,
          scope,
          depth: depth ?? 12,
          groupsQueried: result.groupsQueried,
          serpQueries: result.serpQueries ?? result.groupsQueried,
          // TC 旁证与 SERP 并列记账拆分（单价不同，混算会失真）。
          tcQueries: result.tcQueries ?? 0,
          tcChecked: result.tcChecked ?? 0,
          tcFailed: result.tcFailed ?? 0,
          tcRescued: result.tcRescued ?? 0,
          groupsSkippedCache: result.groupsSkippedCache,
          skippedDeadGroups: result.skippedDeadGroups ?? 0,
          productsUpdated: result.productsUpdated,
          errors: result.errors.length,
        },
      });
      return {
        ...result,
        billing: {
          keySource: access.keySource,
          remainingCalls: access.remainingCalls,
        },
      };
    }
  );

  // 广告数计算的只读预估（提交付费计算前的确认数字）：只读本地库，
  // 不调 DataForSEO、不记用量；附带网关判定（只判不记）供确认框展示
  // 计费路径与可用性。allowed=false 时前端禁用确认按钮。
  // depth/force 与 calc 同口径传入：预估的查询数/费用必须对应用户在
  // 确认框里实际选定的模式与深度（切换深度 → 重新预估刷新数字）。
  app.post<{ Body: { scope?: unknown; depth?: unknown; force?: unknown } }>(
    "/api/v1/catalog/products/calc-ad-count/preview",
    async (request) => {
      const info = await requireSession(deps, request);
      const scope = parseCalcScope(request.body?.scope);
      const depth = parseCalcDepth(request.body?.depth);
      const force = request.body?.force === true;
      const resolution = await resolvePaidDataAccess(prisma, {
        tenantId: info.tenantId,
        userId: info.id,
        userRole: info.role,
        feature: "catalog-ad-count",
      });
      const preview = await previewBrandAdCounts(prisma, info.tenantId, {
        aliveOnly: scope === "alive",
        force,
        depth,
      });
      return {
        allowed: resolution.allowed,
        keySource: resolution.allowed ? resolution.keySource : null,
        ...preview,
      };
    }
  );

  // 按新增（入库）日期取商品 id（纯选择辅助，不触发任何计算/筛选）：
  // 前端按本地时区把某天换算成 [from, to) 的 UTC ISO 区间传来，服务端
  // 不做时区换算，只按 createdAt ∈ [from, to) 查本租户商品 id。
  app.post<{ Body: { from?: unknown; to?: unknown; networkId?: unknown } }>(
    "/api/v1/catalog/products/added-ids",
    async (request) => {
      const info = await requireSession(deps, request);
      const fromRaw = request.body?.from;
      const toRaw = request.body?.to;
      const from =
        typeof fromRaw === "string" ? new Date(fromRaw) : new Date(NaN);
      const to = typeof toRaw === "string" ? new Date(toRaw) : new Date(NaN);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new ValidationError("from/to 必须是可解析的 ISO 时间戳");
      }
      if (!(from.getTime() < to.getTime())) {
        throw new ValidationError("from 必须早于 to");
      }
      if (to.getTime() - from.getTime() > 366 * 24 * 3600 * 1000) {
        throw new ValidationError("日期范围跨度不能超过 366 天");
      }
      const where: Record<string, unknown> = {
        tenantId: info.tenantId,
        createdAt: { gte: from, lt: to },
      };
      if (typeof request.body?.networkId === "string" && request.body.networkId) {
        where.networkId = assertId(request.body.networkId, "networkId");
      }
      const ADDED_IDS_CAP = 1000;
      const total = await prisma.networkProduct.count({ where });
      const rows = (await prisma.networkProduct.findMany({
        where,
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: ADDED_IDS_CAP,
      })) as Array<{ id: string }>;
      const ids = rows.map((r) => r.id);
      return { ids, total, truncated: total > ids.length };
    }
  );

  // 一键筛选：黑名单 → $8 门槛 → 已保存预设 → 广告数（付费层经网关，
  // 拒绝自动跳过）→ 流量门免费档。全过自动建 Offer，被杀留备选池带原因，
  // 数据不足转人工复核。报告全数字（services/one-click-screen）。
  app.post<{
    Body: { scope?: unknown; ids?: unknown; filter?: unknown };
  }>(
    "/api/v1/catalog/products/one-click-screen",
    async (request) => {
      const info = await requireSession(deps, request);
      const scope =
        typeof request.body?.scope === "string" ? request.body.scope : "";
      const where: Record<string, unknown> = { tenantId: info.tenantId };
      if (scope === "selected") {
        const ids = asIdArray(request.body?.ids, "ids");
        if (ids.length === 0) throw new ValidationError("ids 不能为空");
        where.id = { in: ids };
      } else if (scope === "current") {
        // 与列表同一套 where 构造器（筛选条件口径一致；预设自动过滤不用——
        // 预设关在流水线里跑，报告里有独立计数）。
        const filter =
          request.body?.filter && typeof request.body.filter === "object"
            ? (request.body.filter as Record<string, unknown>)
            : {};
        if (
          typeof filter.networkId === "string" &&
          filter.networkId.trim()
        ) {
          where.networkId = assertId(filter.networkId, "networkId");
        }
        if (filter.recommended === "true" || filter.recommended === true)
          where.recommended = true;
        else if (filter.recommended === "false" || filter.recommended === false)
          where.recommended = false;
        Object.assign(where, buildPoolStageWhere(filter));
        const q = asTrimmed(filter.q);
        if (q) {
          // 与列表查询同一口径：分词 AND，每词可命中任一字段
          const tokens = q.split(/\s+/).filter(Boolean).slice(0, 6);
          const groups = tokens.map((t) => ({
            OR: [
              { name: { contains: t, mode: "insensitive" } },
              { brand: { contains: t, mode: "insensitive" } },
              { asin: { contains: t, mode: "insensitive" } },
            ],
          }));
          where.AND = [...((where.AND as unknown[]) ?? []), ...groups];
        }
        Object.assign(where, buildAdCountWhere(filter));
        Object.assign(where, buildCountryWhere(filter));
      } else if (scope === "unscreened") {
        where.screenedAt = null;
      } else {
        throw new ValidationError(
          "scope 必须为 selected / current / unscreened"
        );
      }
      const rows = await prisma.networkProduct.findMany({
        where,
        orderBy: { createdAt: "asc" },
        take: ONE_CLICK_SCREEN_MAX_PRODUCTS + 1,
      });
      const truncated = rows.length > ONE_CLICK_SCREEN_MAX_PRODUCTS;
      const products = rows.slice(0, ONE_CLICK_SCREEN_MAX_PRODUCTS);
      const report = await runOneClickScreen(
        {
          prisma,
          createOfferImpl: (input) => deps.offers.create(input),
        },
        {
          tenantId: info.tenantId,
          actorId: info.id,
          userRole: info.role,
          products: products as unknown as OneClickProductRow[],
        }
      );
      return { ...report, scope, truncated };
    }
  );

  // 人工强制入选：被一键筛选判杀的商品可强制建 Offer（黑名单不可强制），
  // 每次强制写审计（services/one-click-screen.forceSelectProducts）。
  app.post<{ Body: { ids?: unknown } }>(
    "/api/v1/catalog/products/force-select",
    async (request) => {
      const info = await requireSession(deps, request);
      const ids = asIdArray(request.body?.ids, "ids");
      if (ids.length === 0) throw new ValidationError("ids 不能为空");
      if (ids.length > 50)
        throw new ValidationError("ids 最多 50 个");
      const products = await prisma.networkProduct.findMany({
        where: { tenantId: info.tenantId, id: { in: ids } },
      });
      const result = await forceSelectProducts(
        {
          prisma,
          createOfferImpl: (input) => deps.offers.create(input),
        },
        {
          tenantId: info.tenantId,
          actorId: info.id,
          products: products as unknown as OneClickProductRow[],
        }
      );
      return { ...result, notFound: ids.length - products.length };
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
        preset: {
          ...DEFAULT_PRESET,
          mode: "regular",
          autoCreateOffer: false,
          autoCreateTopN: 20,
        },
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
        mode: normalizePresetMode(r.mode),
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
        // 口径（2026-10-20 巡检定案，与 MEMORY 一致）：
        // - 字段未提供/空串 → 跳过（保持旧值）；
        // - 显式 null → 写 NULL，读取时 `?? DEFAULT_PRESET` 回落默认值
        //   （"留空=默认"，如 maxPrice 留空=150 而非无上限）；
        // - 0 → 生效时禁用该项检查；
        // - 非数字 → 400 明错，不再静默跳过。
        const v = body[k];
        if (v === undefined || v === "") continue;
        if (v === null) {
          patch[k] = null;
          continue;
        }
        const n = asNumber(v);
        if (n === undefined) throw new ValidationError(`${k} 必须是数字`);
        if (n < 0) throw new ValidationError(`${k} 不能为负数`);
        patch[k] = n;
      }
      if (body.autoCreateOffer !== undefined) {
        patch.autoCreateOffer = body.autoCreateOffer === true;
      }
      // mode：字段省略/空串 → 保持旧值（与数字字段同口径）；
      // 显式 null → 视为 regular（列 NOT NULL，不写 NULL）；
      // 非法值 → 400 明错，不静默回落。
      if (body.mode !== undefined && body.mode !== "") {
        if (body.mode === null) {
          patch.mode = "regular";
        } else if (body.mode === "regular" || body.mode === "loose") {
          patch.mode = body.mode;
        } else {
          throw new ValidationError("mode 必须是 regular 或 loose");
        }
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
      const preset = await resolveScreeningPreset(prisma, info.tenantId);
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
      // 补强 #1：本批商品涉及商家的结算率一次批量查（查不到 → null，未验证中性）。
      const screenMerchantIds = [
        ...new Set(
          products
            .map((p) => p.merchantId)
            .filter((x): x is string => typeof x === "string" && !!x)
        ),
      ];
      const settlementByMerchant = new Map<string, number | null>();
      if (screenMerchantIds.length > 0) {
        const merchants = (await prisma.merchant.findMany({
          where: { id: { in: screenMerchantIds }, tenantId: info.tenantId },
          select: { id: true, settlementRatePct: true },
        })) as Array<{ id: string; settlementRatePct: unknown }>;
        for (const m of merchants) {
          settlementByMerchant.set(m.id, numOrNull(m.settlementRatePct));
        }
      }
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
        const r = evaluateProduct(
          {
            price: numOrNull(p.price),
            commissionAmount: numOrNull(p.commissionAmount),
            commissionRate: numOrNull(p.commissionRate),
            reviewCount: (p.reviewCount as number) ?? null,
            settlementRatePct: mid
              ? (settlementByMerchant.get(mid) ?? null)
              : null,
            payoutCycleDays:
              typeof p.payoutCycleDays === "number" &&
              Number.isFinite(p.payoutCycleDays)
                ? p.payoutCycleDays
                : null,
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
      /** 幂等命中：Offer 早已建过（同步自动建/一键筛选/此前手动建），未重复创建。 */
      const skippedExisting: Array<{ offerId: string; productId: string }> = [];
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
          const res = await createOfferFromProduct(
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
          // created=false = 幂等回放（Offer 已存在）：单列 skippedExisting，
          // 不许混进 created 计数误导前端报「成功创建」。
          if (res.created) {
            created.push({ offerId: res.offerId, productId: pid });
          } else {
            skippedExisting.push({ offerId: res.offerId, productId: pid });
          }
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
          skippedExisting: skippedExisting.length,
          failed: failed.length,
          skippedBlacklist: skippedBlacklist.length,
        },
      });
      return { created, skippedExisting, failed, skippedBlacklist };
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
