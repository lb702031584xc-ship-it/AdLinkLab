/**
 * 商品库同步引擎（2026-10-18）：官方 API / 登录态双模式 + 黑白名单。
 *
 * 流程：
 *  1. B6 授权强制执行：requireActiveGrant(catalog-sync, whitelist=network.kind)，无授权 403。
 *  2. 黑名单账号检查：命中 network_account 黑名单 → 直接返回 {skipped:true}，
 *     审计 CATALOG_SYNC_SKIPPED_BLACKLIST，不再浪费请求。
 *  3. mode = network.syncMode（非法值 → 按 "api" 处理 + 审计）。
 *  4. 拉取（api / session）→ 统一为 SessionProduct 列表。
 *     PB api 模式双数据源：FBA get_fba_products（亚马逊）+ Datafeed 通用
 *     list（DTC/Walmart）合并；抓取数按来源进 summary.sourceBreakdown；
 *     datafeed 腿失败降级继续（summary.datafeedError 记明，403 除外）。
 *  5. upsert NetworkProduct（@@unique tenantId+networkId+externalId），syncStreak 累计；
 *     brand+networkId 匹配 Merchant → merchantId。
 *  6. 消失商品（syncedAt < 本次开始）→ 自动黑名单（product, reason=sync_disappeared）+ 审计。
 *     守卫：按商家（brandId）同步整步跳过；全量同步熔断（upsert=0 或消失占比 >50%）跳过
 *     并在 summary.disappearedSkipped 记警告；第 5 步被 $8 门槛跳过的商品不算消失。
 *     商品重新出现（被 upsert）时，其 sync_disappeared 自动黑名单自动解除（第 5.5 步）。
 *  7. 评分：排除黑名单商品/黑名单商家的商品后跑 evaluateProduct（统一评分入口），写回 recommended/score。
 *  8. 白名单建议：syncStreak 达到 3 → suggested（只建议，不自动加入）。
 *  9. 自动建 Offer（preset.autoCreateOffer）：白名单优先（观察期商家不置顶），
 *     跳过黑名单，Top-N（1–50），idempotencyKey 幂等，逐个审计。
 * 10. 成功 → network.lastPullAt/pullStatus=SUCCESS + CATALOG_SYNC_SUCCESS + incrementGrantUsage；
 *     失败 → pullStatus=FAILED + CATALOG_SYNC_FAILED。
 *
 * session 错误语义：
 * - SessionExpiredError(restricted=true, 即 HTTP 403 账号受限) → 立即黑名单 + 409。
 * - SessionExpiredError(普通过期) → strike+1；连续 3 次 → 自动黑名单 + 409。
 * - SessionRateLimitedError → FAILED + 审计，429（不重试）。
 * - SessionTemplateError（脚手架未验证）→ FAILED + 审计，400 明错。
 *
 * 全程绝不记日志输出明文凭证/session。
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
  belowMinCommission,
  estimateCommissionFigure,
} from "@adlinklab/shared";
import { getMinCommissionUsd } from "../ai/commission-gate.js";
import {
  incrementGrantUsage,
  requireActiveGrant,
} from "./admin-grants.js";
import {
  decryptApiKey,
  assertNetworkApiPepperConfigured,
} from "../networks/network-crypto.js";
import { getAdapter, getSessionAdapter } from "../networks/index.js";
import {
  BaseSessionAdapter,
  SessionExpiredError,
  SessionParseError,
  SessionRateLimitedError,
  SessionTemplateError,
  type SessionProduct,
} from "../networks/session-adapter.js";
// 全站同步会连续打几十个商家，必须限速 + 429 退避，否则一次限流整批作废
import { withThrottle } from "./net-throttle.js";
import { NetworkAdapterError } from "../networks/partnerboost-adapter.js";
import { PartnerBoostAdapter } from "../networks/partnerboost-adapter.js";
import type {
  AdapterContext,
  NetworkAdapter,
  NetworkOffer,
  SyncMode,
} from "../networks/types.js";
import { isSyncMode } from "../networks/types.js";
import {
  DEFAULT_PRESET,
  evaluateProduct,
  type ScreeningPreset,
} from "./catalog-screening.js";
import {
  addToBlacklist,
  isBlacklisted,
  isMerchantObserved,
  networkKindToChannel,
  removeFromBlacklist,
  suggestWhitelistEntry,
  writeCatalogAudit,
  type CatalogChannel,
} from "./catalog-blacklist.js";

export interface CreateOfferInput {
  tenantId: string;
  name: string;
  network: string;
  source?: string;
  destinationUrl: string;
  commissionValue?: number;
  commissionType?: string;
  avgPrice?: number;
  brandName?: string;
  brandNameSource?: string;
  idempotencyKey?: string;
}

export interface CatalogSyncDeps {
  prisma: PrismaClient;
  getAdapterImpl?: (kind: string) => NetworkAdapter;
  getSessionAdapterImpl?: (kind: string) => BaseSessionAdapter;
  createOfferImpl?: (
    input: CreateOfferInput
  ) => Promise<{ offer: { id: string }; created: boolean; replayed: boolean }>;
  /**
   * 进度回调（可选，后台任务模式用）：在拉取后/入库后/评分后/建 Offer 后
   * 各阶段边界调用。缺省 → 无副作用，既有同步调用与测试行为不变。
   * 回调抛错不中断同步（内部吞掉，进度只是观测信号）。
   */
  onProgress?: (
    stage: string,
    partial?: Record<string, unknown>
  ) => Promise<void> | void;
}

export interface CatalogSyncInput {
  tenantId: string;
  userId: string;
  /** 调用方角色：owner 豁免 B6 授权。 */
  userRole: string;
  networkId: string;
  /** 按商家同步：PB brand_id（仅 API 模式有效；session 模式忽略）。 */
  brandId?: string;
  fetchImpl?: typeof fetch;
}

export interface CatalogSyncSummary {
  synced: number;
  created: number;
  updated: number;
  recommended: number;
  autoCreatedOffers: number;
  /**
   * $8 佣金门槛（第一道）跳过的商品数：单次转化佣金明确低于门槛 → 不入库，
   * 只计数不记明细（避免垃圾数据进库）；总数进审计日志。
   */
  skippedLowCommission: number;
  skipped?: boolean;
  skipReason?: string;
  /** 同步范围：full（全量）/ brand（按商家）。跳过时无值。 */
  scope?: "full" | "brand";
  /** 按商家同步时的 brand_id（scope=brand 时有值）。 */
  brandId?: string;
  /**
   * 第 6 步消失判定被守卫跳过的原因（不静默，明确记警告）：
   * "brand_scope" = 按商家同步不做全网消失判定；
   * "circuit_breaker" = 全量同步熔断（upsert=0 或消失占比 >50%，疑似上游异常）。
   */
  disappearedSkipped?: string;
  /**
   * PB api 模式双数据源「抓取」计数（入库前：$8 门槛/去重都还没过）：
   * amazon = FBA get_fba_products；dtc / walmart = Datafeed 通用 list 两类。
   * 仅 PB api 模式有值，其他网络/模式为 undefined。
   */
  sourceBreakdown?: { amazon: number; dtc: number; walmart: number };
  /**
   * PB datafeed 第二数据源的异常信息：整腿失败（FBA 主腿不受影响、已降级
   * 继续）或单个 brand_type 失败的警告文案。不静默，同步结果里可见。
   */
  datafeedError?: string;
}

const SESSION_EXPIRE_STRIKE_LIMIT = 3;
const AUTO_CREATE_TOP_N_MIN = 1;
const AUTO_CREATE_TOP_N_MAX = 50;

interface NetworkRow {
  id: string;
  tenantId: string;
  kind: string;
  name: string;
  apiKeyRef: string | null;
  apiBaseUrl: string | null;
  /** 官方 API 商品接口路径覆盖（YeahPromos Get Products；null → 适配器默认路径）。 */
  apiProductsPath: string | null;
  syncMode: string;
  sessionRef: string | null;
  sessionListPath: string | null;
  sessionExpireStrikes: number | null;
  /** 登录态用户名（明文可显示）。 */
  sessionUsername: string | null;
  /** 登录态有效期天数（null → 默认 30）。 */
  sessionValidDays: number | null;
  /** 上次登录/刷新登录态的时间；sessionExpiresAt = lastLoginAt + validDays。 */
  lastLoginAt: Date | string | null;
}

interface ProductRow {
  id: string;
  externalId: string;
  name: string;
  brand: string | null;
  price: unknown;
  commissionAmount: unknown;
  commissionRate: unknown;
  reviewCount: number | null;
  promoUrl: string | null;
  url?: string | null;
  merchantId: string | null;
  syncStreak: number | null;
  recommended: boolean | null;
  recommendationScore: unknown;
  /** 补强 #4：返款周期天数（DB 行自带；适配器暂不提供时为 null = 未知）。 */
  payoutCycleDays?: number | null;
}

const toNum = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 默认登录态有效期（天）；sessionValidDays 为 null/非法时用它。 */
export const DEFAULT_SESSION_VALID_DAYS = 30;

/**
 * 登录态是否已过期：lastLoginAt + validDays <= now。
 * lastLoginAt 为空（老数据）→ 无法判定 → false，走原有的过期探测逻辑。
 */
export function isSessionLoginExpired(
  lastLoginAt: Date | string | null | undefined,
  validDays: number | null | undefined
): boolean {
  if (!lastLoginAt) return false;
  const days =
    typeof validDays === "number" && Number.isFinite(validDays) && validDays > 0
      ? validDays
      : DEFAULT_SESSION_VALID_DAYS;
  const at =
    lastLoginAt instanceof Date ? lastLoginAt.getTime() : new Date(lastLoginAt).getTime();
  if (!Number.isFinite(at)) return false;
  return at + days * 86400000 <= Date.now();
}

/** 登录态到期时间（展示用）；算不出 → null。 */
export function sessionExpiresAt(
  lastLoginAt: Date | string | null | undefined,
  validDays: number | null | undefined
): Date | null {
  if (!lastLoginAt) return null;
  const days =
    typeof validDays === "number" && Number.isFinite(validDays) && validDays > 0
      ? validDays
      : DEFAULT_SESSION_VALID_DAYS;
  const at =
    lastLoginAt instanceof Date ? lastLoginAt.getTime() : new Date(lastLoginAt).getTime();
  if (!Number.isFinite(at)) return null;
  return new Date(at + days * 86400000);
}

/** 官方 API 的 NetworkOffer → SessionProduct（字段缺失 → null，不虚构）。 */
function offerToSessionProduct(o: NetworkOffer): SessionProduct {
  const isPct = (o.currency ?? "").trim() === "%";
  return {
    externalId: o.externalId,
    name: o.name,
    payout: o.payout ?? null,
    // 商品价格的货币优先（PB 的 currency="%" 是佣金口径，不能写进商品货币）。
    currency: o.priceCurrency ?? (isPct ? null : (o.currency ?? null)),
    termsText: o.termsText ?? null,
    url: o.url ?? null,
    rawData: o.rawData,
    brand: o.brand ?? null,
    asin: o.asin ?? null,
    price: o.price ?? null,
    commissionAmount: !isPct ? (o.payout ?? null) : null,
    commissionRate: isPct ? (o.payout ?? null) : null,
    reviewCount: o.reviewCount ?? null,
    promoUrl: o.url ?? null,
    // 国家/落地页类型此前在这里被丢掉（NetworkOffer 有、转换时没透传）：
    // 投放国家列恒为「—」、广告数按国家分组全落空。补透传（PB/YP 同受益）。
    countryCode: o.countryCode ?? null,
    landingPageType: o.landingPageType ?? null,
  };
}

/**
 * 商品 → Offer（复用点：syncCatalog 自动建 Offer 与 POST /catalog/offers/batch 共用）。
 * 幂等：idempotencyKey = catalog:{networkId}:{externalId}，同商品重复调 → replayed。
 */
export async function createOfferFromProduct(
  deps: CatalogSyncDeps,
  network: { id: string; kind: string },
  product: {
    tenantId: string;
    externalId: string;
    name: string;
    brand?: string | null;
    price?: number | null;
    commissionAmount?: number | null;
    commissionRate?: number | null;
    promoUrl?: string | null;
    url?: string | null;
  }
): Promise<{ offerId: string; created: boolean }> {
  if (!deps.createOfferImpl) {
    throw new ValidationError("Offer 创建未接线（createOfferImpl 缺失）");
  }
  const destinationUrl = (product.promoUrl || product.url || "").trim();
  if (!destinationUrl) {
    throw new ValidationError(`商品「${product.name}」缺少推广链接，无法创建 Offer`);
  }
  // 佣金金额优先；只有佣金率+价格时换算（金额 = 价格 × 佣金率 ÷ 100）。
  const commissionValue =
    product.commissionAmount ??
    (product.commissionRate != null && product.price != null
      ? Math.round(product.price * product.commissionRate) / 100
      : null);
  const res = await deps.createOfferImpl({
    tenantId: product.tenantId,
    name: product.name,
    network: network.kind,
    source: "affiliate",
    destinationUrl,
    commissionValue: commissionValue ?? undefined,
    commissionType:
      product.commissionAmount != null
        ? "FIXED"
        : product.commissionRate != null
          ? "PERCENT"
          : undefined,
    avgPrice: product.price ?? undefined,
    brandName: product.brand ?? undefined,
    // 品牌名来自网络目录自动提取——必须是 OfferService 认的合法来源值
    // （BRAND_NAME_SOURCES: manual | auto_extracted | domain_fallback）；
    // 曾误写 "catalog-sync"，被 create 校验全数打回（目录建 Offer 全灭）。
    brandNameSource: product.brand ? "auto_extracted" : undefined,
    idempotencyKey: `catalog:${network.id}:${product.externalId}`,
  });
  return { offerId: res.offer.id, created: res.created };
}

async function loadPreset(
  prisma: PrismaClient,
  tenantId: string
): Promise<ScreeningPreset & { autoCreateOffer: boolean; autoCreateTopN: number }> {
  const row = (await prisma.catalogScreeningPreset.findUnique({
    where: { tenantId },
  })) as null | {
    minReviews: number | null;
    minCommissionAmount: unknown;
    minCommissionRate: unknown;
    minPrice: unknown;
    maxPrice: unknown;
    minScore: number | null;
    autoCreateOffer: boolean;
    autoCreateTopN: number;
  };
  if (!row) {
    return { ...DEFAULT_PRESET, autoCreateOffer: false, autoCreateTopN: 20 };
  }
  return {
    minReviews: row.minReviews,
    minCommissionAmount: toNum(row.minCommissionAmount),
    minCommissionRate: toNum(row.minCommissionRate),
    minPrice: toNum(row.minPrice),
    maxPrice: toNum(row.maxPrice),
    minScore: row.minScore,
    autoCreateOffer: row.autoCreateOffer,
    autoCreateTopN: row.autoCreateTopN,
  };
}

/** brand + networkId 匹配 Merchant（大小写不敏感精确匹配），匹配不上 → null。 */
async function matchMerchantId(
  prisma: PrismaClient,
  tenantId: string,
  networkId: string,
  brand: string | null | undefined
): Promise<string | null> {
  const b = brand?.trim();
  if (!b) return null;
  const merchants = (await prisma.merchant.findMany({
    where: { tenantId, networkId, deletedAt: null },
    select: { id: true, name: true },
  })) as Array<{ id: string; name: string }>;
  const lower = b.toLowerCase();
  const hit = merchants.find((m) => m.name.toLowerCase() === lower);
  return hit ? hit.id : null;
}

export async function syncCatalog(
  deps: CatalogSyncDeps,
  input: CatalogSyncInput
): Promise<CatalogSyncSummary> {
  const { prisma } = deps;
  const { tenantId, userId, userRole, networkId } = input;
  const getAdapterImpl = deps.getAdapterImpl ?? getAdapter;
  const getSessionAdapterImpl = deps.getSessionAdapterImpl ?? getSessionAdapter;
  // 进度回调：仅观测，抛错吞掉，绝不影响同步主流程。
  const reportProgress = async (
    stage: string,
    partial?: Record<string, unknown>
  ): Promise<void> => {
    if (!deps.onProgress) return;
    try {
      await deps.onProgress(stage, partial);
    } catch {
      /* 进度上报失败不中断同步 */
    }
  };

  const network = (await prisma.affiliateNetwork.findFirst({
    where: { id: networkId, tenantId, deletedAt: null },
  })) as NetworkRow | null;
  if (!network) throw new NotFoundError("Network not found");
  // 闭包内 TS  narrowing 会丢失，用 net 捕获非空。
  const net = network;

  // 1. B6 授权强制执行（无授权 403；owner 豁免）。
  const grant = await requireActiveGrant(prisma, {
    tenantId,
    userId,
    userRole,
    capability: "catalog-sync",
    whitelistValue: net.kind,
  });
  // owner 豁免时 grant 为 null：审计 grantId 记 null（非 owner 不可能走到这里，null 即豁免）。
  const channel: CatalogChannel = networkKindToChannel(net.kind);

  // 2. 黑名单账号 → 直接跳过，不再浪费请求。
  if (await isBlacklisted(prisma, tenantId, channel, "network_account", net.id)) {
    const entry = (await prisma.catalogBlacklist.findUnique({
      where: {
        tenantId_channel_entityType_entityId: {
          tenantId,
          channel,
          entityType: "network_account",
          entityId: net.id,
        },
      },
    })) as { reason?: string } | null;
    const reason = `账号在黑名单中（${entry?.reason ?? "unknown"}），已自动跳过同步`;
    await writeCatalogAudit(prisma, {
      tenantId,
      grantId: grant?.id ?? null,
      actorId: userId,
      action: "CATALOG_SYNC_SKIPPED_BLACKLIST",
      detail: { kind: net.kind, channel, networkId: net.id, reason },
    });
    return {
      synced: 0,
      created: 0,
      updated: 0,
      recommended: 0,
      autoCreatedOffers: 0,
      skippedLowCommission: 0,
      skipped: true,
      skipReason: reason,
    };
  }

  // 3. 模式（非法值 → 按 "api" 处理 + 审计）。
  let mode: SyncMode = "api";
  if (isSyncMode(net.syncMode)) {
    mode = net.syncMode;
  } else {
    await writeCatalogAudit(prisma, {
      tenantId,
      grantId: grant?.id ?? null,
      actorId: userId,
      action: "CATALOG_SYNC_INVALID_MODE",
      detail: { kind: net.kind, syncMode: net.syncMode },
    });
  }

  // 3b. session 模式登录态有效期预检：过期 → 直接跳过，
  // 不用过期 session 去撞对方服务器（红色提示 + 审计）。
  if (mode === "session" && isSessionLoginExpired(net.lastLoginAt, net.sessionValidDays)) {
    const reason = "登录态已过期，请重新登录刷新";
    await prisma.affiliateNetwork.update({
      where: { id: net.id },
      data: {
        sessionStatus: "EXPIRED",
        sessionError: reason,
        sessionUpdatedAt: new Date(),
      },
    });
    await writeCatalogAudit(prisma, {
      tenantId,
      grantId: grant?.id ?? null,
      actorId: userId,
      action: "CATALOG_SYNC_SKIPPED_EXPIRED",
      detail: {
        kind: net.kind,
        channel,
        networkId: net.id,
        lastLoginAt:
          net.lastLoginAt instanceof Date
            ? net.lastLoginAt.toISOString()
            : net.lastLoginAt,
        sessionValidDays: net.sessionValidDays ?? DEFAULT_SESSION_VALID_DAYS,
      },
    });
    return {
      synced: 0,
      created: 0,
      updated: 0,
      recommended: 0,
      autoCreatedOffers: 0,
      skippedLowCommission: 0,
      skipped: true,
      skipReason: reason,
    };
  }

  const syncStartedAt = new Date();
  await writeCatalogAudit(prisma, {
    tenantId,
    grantId: grant?.id ?? null,
    actorId: userId,
    action: "CATALOG_SYNC_START",
    detail: { kind: net.kind, channel, mode, networkId: net.id },
  });

  const fail = async (message: string): Promise<never> => {
    await prisma.affiliateNetwork.update({
      where: { id: net.id },
      data: { pullStatus: "FAILED", pullError: message.slice(0, 2000) },
    });
    await writeCatalogAudit(prisma, {
      tenantId,
      grantId: grant?.id ?? null,
      actorId: userId,
      action: "CATALOG_SYNC_FAILED",
      detail: { kind: net.kind, channel, mode, error: message.slice(0, 500) },
    });
    throw new AppError(message, { code: "CATALOG_SYNC_FAILED", statusCode: 500 });
  };

  /* ── 4. 拉取 ── */
  // PB 双数据源抓取计数 / datafeed 腿异常（doPull 闭包回填，收尾进 summary）。
  let sourceBreakdown: { amazon: number; dtc: number; walmart: number } | undefined;
  let datafeedError: string | undefined;
  const doPull = async (): Promise<SessionProduct[]> => {
    if (mode === "api") {
      const adapter = getAdapterImpl(net.kind);
      if (adapter.supportsModes && !adapter.supportsModes.includes("api")) {
        throw new ValidationError(
          `${adapter.displayName} 官方商品 API 尚未确认，当前仅支持登录态(session)模式`
        );
      }
      if (!net.apiKeyRef) {
        throw new ValidationError(
          "该网络尚未配置官方 API 凭证：请先在网络设置中填写 API Key，或切换为 session 模式"
        );
      }
      const pepper = assertNetworkApiPepperConfigured();
      const apiKey = decryptApiKey(net.apiKeyRef, pepper);
      const ctx: AdapterContext = {
        apiKey,
        apiBaseUrl: net.apiBaseUrl ?? "",
        tenantId,
        fetchImpl: input.fetchImpl,
        apiProductsPath: net.apiProductsPath ?? null,
      };
      try {
        // PB 按商家同步：brandId 只传给 PartnerBoostAdapter，其他网络忽略。
        // session 模式不支持按商家过滤（网页端抓取无 brand_id 参数），忽略。
        if (adapter instanceof PartnerBoostAdapter) {
          const pbOpts = input.brandId?.trim()
            ? { brandId: input.brandId.trim() }
            : {};
          const fbaOffers = await withThrottle(() => adapter.pullOffers(ctx, pbOpts));
          // 第二数据源：Datafeed 通用 list（DTC + Walmart 商品，FBA 口没有）。
          // 该腿失败不拖垮 FBA 主腿：错误记入 datafeedError（summary/审计可见，
          // 不静默）并降级继续；403 账号受限除外——与主腿同口径走黑名单路径。
          let dfOffers: NetworkOffer[] = [];
          const dfTypeErrors: string[] = [];
          try {
            dfOffers = await adapter.pullDatafeedOffers(ctx, {
              ...pbOpts,
              onBrandTypeError: (brandType, message) => {
                dfTypeErrors.push(`${brandType}: ${message}`);
              },
            });
          } catch (error) {
            if (
              error instanceof NetworkAdapterError &&
              error.status === 403
            ) {
              throw error;
            }
            datafeedError =
              error instanceof Error ? error.message : String(error);
          }
          if (dfTypeErrors.length > 0) {
            datafeedError = [datafeedError, ...dfTypeErrors]
              .filter(Boolean)
              .join("; ");
          }
          const dfCount = (bt: string) =>
            dfOffers.filter(
              (o) =>
                (o.rawData as Record<string, unknown>)?.brand_type === bt
            ).length;
          sourceBreakdown = {
            amazon: fbaOffers.length,
            dtc: dfCount("DTC"),
            walmart: dfCount("Walmart"),
          };
          return [...fbaOffers, ...dfOffers].map(offerToSessionProduct);
        }
        const offers = await withThrottle(() => adapter.pullOffers(ctx));
        return offers.map(offerToSessionProduct);
      } catch (error) {
        // API 明确 403 = 账号受限/权限回收 → 自动黑名单。
        if (error instanceof NetworkAdapterError && error.status === 403) {
          await addToBlacklist(prisma, {
            tenantId,
            channel,
            entityType: "network_account",
            entityId: net.id,
            networkKind: net.kind,
            reason: "api_account_restricted",
            source: "auto",
            grantId: grant?.id ?? null,
            evidence: { httpStatus: 403, mode: "api" },
          });
        }
        throw error;
      }
    }
    // session 模式
    if (!net.sessionRef) {
      throw new ValidationError(
        "该网络尚未保存登录态：请先在商品库设置页保存该网络的登录态 Cookie"
      );
    }
    const sessionAdapter = getSessionAdapterImpl(net.kind);
    if (!(sessionAdapter instanceof BaseSessionAdapter)) {
      throw new ValidationError(`该网络（${net.kind}）暂不支持 session 模式`);
    }
    const pepper = assertNetworkApiPepperConfigured();
    const cookie = decryptApiKey(net.sessionRef, pepper);
    const sessProducts = await sessionAdapter.pullViaSession({
      cookie,
      baseUrl: net.apiBaseUrl || undefined,
      fetchImpl: input.fetchImpl,
      sessionListPath: net.sessionListPath || undefined,
    });
    // session 成功 → strikes 清零。
    await prisma.affiliateNetwork.update({
      where: { id: net.id },
      data: {
        sessionStatus: "OK",
        sessionError: null,
        sessionUpdatedAt: new Date(),
        sessionExpireStrikes: 0,
      },
    });
    return sessProducts;
  };

  // 拉取错误 → 状态/审计/黑名单映射（返回 never，调用方直接 await）。
  const handlePullError = async (error: unknown): Promise<never> => {
    if (error instanceof SessionExpiredError) {
      const strikes = (net.sessionExpireStrikes ?? 0) + 1;
      const now = new Date();
      if (error.restricted) {
        // HTTP 403 明确账号受限 → 立即黑名单。
        await addToBlacklist(prisma, {
          tenantId,
          channel,
          entityType: "network_account",
          entityId: net.id,
          networkKind: net.kind,
          reason: "session_account_restricted",
          source: "auto",
          grantId: grant?.id ?? null,
          evidence: { httpStatus: 403, mode: "session" },
        });
        await prisma.affiliateNetwork.update({
          where: { id: net.id },
          data: {
            sessionStatus: "FAILED",
            sessionError: error.message.slice(0, 500),
            sessionUpdatedAt: now,
          },
        });
        await writeCatalogAudit(prisma, {
          tenantId,
          grantId: grant?.id ?? null,
          actorId: userId,
          action: "CATALOG_SESSION_EXPIRED",
          detail: { kind: net.kind, restricted: true },
        });
      } else {
        await prisma.affiliateNetwork.update({
          where: { id: net.id },
          data: {
            sessionStatus: "EXPIRED",
            sessionError: error.message.slice(0, 500),
            sessionUpdatedAt: now,
            sessionExpireStrikes: strikes,
          },
        });
        await writeCatalogAudit(prisma, {
          tenantId,
          grantId: grant?.id ?? null,
          actorId: userId,
          action: "CATALOG_SESSION_EXPIRED",
          detail: { kind: net.kind, strikes },
        });
        if (strikes >= SESSION_EXPIRE_STRIKE_LIMIT) {
          await addToBlacklist(prisma, {
            tenantId,
            channel,
            entityType: "network_account",
            entityId: net.id,
            networkKind: net.kind,
            reason: "session_expired_x3",
            source: "auto",
            grantId: grant?.id ?? null,
            evidence: { strikes, mode: "session" },
          });
        }
      }
      await prisma.affiliateNetwork.update({
        where: { id: net.id },
        data: { pullStatus: "FAILED", pullError: error.message.slice(0, 2000) },
      });
      throw new ConflictError("登录态过期，请在设置页重新保存");
    }
    if (error instanceof SessionRateLimitedError) {
      await prisma.affiliateNetwork.update({
        where: { id: net.id },
        data: {
          sessionStatus: "FAILED",
          sessionError: error.message.slice(0, 500),
          sessionUpdatedAt: new Date(),
          pullStatus: "FAILED",
          pullError: error.message.slice(0, 2000),
        },
      });
      await writeCatalogAudit(prisma, {
        tenantId,
        grantId: grant?.id ?? null,
        actorId: userId,
        action: "CATALOG_SESSION_RATE_LIMITED",
        detail: { kind: net.kind },
      });
      // 429：不重试，直接降级。
      throw new AppError(error.message, {
        code: "SESSION_RATE_LIMITED",
        statusCode: 429,
      });
    }
    if (error instanceof SessionTemplateError) {
      await prisma.affiliateNetwork.update({
        where: { id: net.id },
        data: {
          sessionStatus: "FAILED",
          sessionError: error.message.slice(0, 500),
          sessionUpdatedAt: new Date(),
        },
      });
      await writeCatalogAudit(prisma, {
        tenantId,
        grantId: grant?.id ?? null,
        actorId: userId,
        action: "CATALOG_SESSION_TEMPLATE_UNVERIFIED",
        detail: { kind: net.kind },
      });
      await fail(error.message);
    }
    if (error instanceof SessionParseError) {
      await prisma.affiliateNetwork.update({
        where: { id: net.id },
        data: {
          sessionStatus: "FAILED",
          sessionError: error.message.slice(0, 500),
          sessionUpdatedAt: new Date(),
        },
      });
    }
    if (error instanceof ValidationError) {
      // 输入/配置类错误（无凭证、不支持的模式等）→ 记 FAILED 后原样抛回（400）。
      await prisma.affiliateNetwork.update({
        where: { id: net.id },
        data: { pullStatus: "FAILED", pullError: error.message.slice(0, 2000) },
      });
      await writeCatalogAudit(prisma, {
        tenantId,
        grantId: grant?.id ?? null,
        actorId: userId,
        action: "CATALOG_SYNC_FAILED",
        detail: { kind: net.kind, channel, mode, error: error.message.slice(0, 500) },
      });
      throw error;
    }
    if (error instanceof ConflictError) {
      await fail(error.message);
    }
    if (error instanceof AppError) throw error;
    // fail() 永不返回（内部 throw）；return 仅为满足 never 类型。
    return fail(error instanceof Error ? error.message : String(error));
  };

  let products: SessionProduct[];
  try {
    products = await doPull();
  } catch (error) {
    await handlePullError(error);
    // unreachable（handlePullError 永不返回）：仅为满足 TS 明确赋值分析。
    throw error;
  }
  await reportProgress("pulled", {
    fetched: products.length,
    ...(sourceBreakdown ? { sourceBreakdown } : {}),
    ...(datafeedError ? { datafeedError } : {}),
  });

  /* ── 5. upsert ── */
  // $8 佣金门槛（第一道，与推演/工作表共用同一常量 + 同一 AI 设置覆盖项）：
  // 单次转化佣金明确低于门槛 → 不入库，只计数。未知（算不出金额）不拦。
  const minCommission = await getMinCommissionUsd(prisma);
  let created = 0;
  let updated = 0;
  let skippedLowCommission = 0;
  const skippedLowCommissionBySource = { reported: 0, estimated: 0 };
  // 本轮"见过但被 $8 门槛跳过"的 externalId：第 6 步消失判定必须排除它们
  // （它们没消失，只是没过门槛；其 syncedAt 不会刷新，不能误判消失拉黑）。
  const gateSkippedExternalIds = new Set<string>();
  const upserted: ProductRow[] = [];
  for (const p of products) {
    const externalId = (p.externalId ?? "").trim();
    if (!externalId) continue;
    const { figure, source } = estimateCommissionFigure({
      amount: toNum(p.commissionAmount),
      ratePct: toNum(p.commissionRate),
      price: toNum(p.price),
    });
    if (figure != null && belowMinCommission(figure, minCommission)) {
      skippedLowCommission += 1;
      gateSkippedExternalIds.add(externalId);
      if (source === "reported") skippedLowCommissionBySource.reported += 1;
      else skippedLowCommissionBySource.estimated += 1;
      continue;
    }
    const merchantId = await matchMerchantId(prisma, tenantId, net.id, p.brand);
    const data = {
      name: p.name,
      brand: p.brand ?? null,
      asin: p.asin ?? null,
      price: toNum(p.price),
      commissionAmount: toNum(p.commissionAmount),
      commissionRate: toNum(p.commissionRate),
      currency: p.currency ?? "USD",
      reviewCount: p.reviewCount ?? null,
      promoUrl: p.promoUrl ?? p.url ?? null,
      landingPageType: p.landingPageType ?? null,
      countryCode: p.countryCode ?? null,
      rawData: p.rawData as never,
      syncedAt: new Date(),
      merchantId,
    };
    const existing = (await prisma.networkProduct.findUnique({
      where: {
        tenantId_networkId_externalId: { tenantId, networkId: net.id, externalId },
      },
      select: { id: true },
    })) as { id: string } | null;
    let row: ProductRow;
    if (existing) {
      row = (await prisma.networkProduct.update({
        where: { id: existing.id },
        data: { ...data, syncStreak: { increment: 1 } },
      })) as ProductRow;
      updated += 1;
    } else {
      row = (await prisma.networkProduct.create({
        data: {
          id: randomUUID(),
          tenantId,
          networkId: net.id,
          externalId,
          ...data,
          syncStreak: 1,
        },
      })) as ProductRow;
      created += 1;
    }
    upserted.push(row);
  }

  /* ── 5.5 消失商品重现 → 自动解除 sync_disappeared 黑名单 ── */
  // 本轮被 upsert 的商品若有一条 source=auto + reason=sync_disappeared 的 active
  // 黑名单记录，说明它只是之前某轮没出现，现已回来 → 自动解除（走现有的
  // removeFromBlacklist 软删除 + 审计）。手动拉黑（source=manual）或其他原因的
  // 记录绝不自动解除。
  let restoredDisappeared = 0;
  if (upserted.length > 0) {
    const reappearedEntries = (await prisma.catalogBlacklist.findMany({
      where: {
        tenantId,
        channel,
        entityType: "product",
        entityId: { in: upserted.map((r) => r.id) },
        reason: "sync_disappeared",
        source: "auto",
        status: "active",
      },
      select: { id: true },
    })) as Array<{ id: string }>;
    for (const entry of reappearedEntries) {
      await removeFromBlacklist(prisma, {
        tenantId,
        id: entry.id,
        actorId: userId,
        reason: "sync_reappeared",
        observationDays: 0,
      });
      restoredDisappeared += 1;
    }
  }

  /* ── 6. 消失商品 → 自动黑名单（带守卫） ── */
  // 守卫 1（范围）：按商家同步只拉了部分商品，其他商品 syncedAt 必然过期，
  //   整步跳过消失判定，否则会把其他品牌/商家的商品全误判消失拉黑。
  // 守卫 2（熔断）：全量同步若 upsert=0（上游返回空/全被拦）或消失占比 >50%
  //   （疑似上游 feed 异常/截断），跳过拉黑并记 disappearedSkipped 警告，不静默。
  // 守卫 3（门槛）：第 5 步被 $8 门槛跳过的商品本轮"见过"，排除出消失集合。
  let disappeared: Array<{
    id: string;
    externalId: string;
    name: string;
    syncedAt: Date;
  }> = [];
  let disappearedSkipped: string | undefined;
  if (input.brandId?.trim()) {
    disappearedSkipped = "brand_scope";
  } else {
    const rawDisappeared = (await prisma.networkProduct.findMany({
      where: { tenantId, networkId: net.id, syncedAt: { lt: syncStartedAt } },
      select: { id: true, externalId: true, name: true, syncedAt: true },
    })) as Array<{
      id: string;
      externalId: string;
      name: string;
      syncedAt: Date;
    }>;
    disappeared = rawDisappeared.filter(
      (d) => !gateSkippedExternalIds.has(d.externalId)
    );
    const totalInNetwork = upserted.length + rawDisappeared.length;
    if (
      upserted.length === 0 ||
      (totalInNetwork > 0 && disappeared.length / totalInNetwork > 0.5)
    ) {
      disappearedSkipped = "circuit_breaker";
      disappeared = [];
    }
  }
  for (const d of disappeared) {
    await addToBlacklist(prisma, {
      tenantId,
      channel,
      entityType: "product",
      entityId: d.id,
      networkKind: net.kind,
      reason: "sync_disappeared",
      source: "auto",
      grantId: grant?.id ?? null,
      evidence: {
        externalId: d.externalId,
        lastSyncedAt: new Date(d.syncedAt).toISOString(),
      },
    });
  }
  await reportProgress("upserted", {
    created,
    updated,
    skippedLowCommission,
    disappearedBlacklisted: disappeared.length,
  });

  /* ── 黑名单集合（商品 + 商家），用于评分/建 Offer 过滤 ── */
  const blackRows = (await prisma.catalogBlacklist.findMany({
    where: { tenantId, channel, status: "active" },
    select: { entityType: true, entityId: true },
  })) as Array<{ entityType: string; entityId: string }>;
  const blacklistedProducts = new Set(
    blackRows.filter((r) => r.entityType === "product").map((r) => r.entityId)
  );
  const blacklistedMerchants = new Set(
    blackRows.filter((r) => r.entityType === "merchant").map((r) => r.entityId)
  );

  /* ── 7. 评分（排除黑名单；全局暂停时跳过） ── */
  let scoreCalcPaused = false;
  try {
    const aiSetting = (prisma as unknown as Record<string, unknown>)
      .aiSetting as
      | { findUnique: (args: unknown) => Promise<{ value: string } | null> }
      | undefined;
    const pauseRow = await aiSetting?.findUnique({
      where: { key: "catalogScoreCalcPaused" },
    });
    scoreCalcPaused = pauseRow?.value === "1";
  } catch {
    scoreCalcPaused = false;
  }
  const preset = await loadPreset(prisma, tenantId);
  let recommended = 0;
  const scored: Array<ProductRow & { score: number; isRecommended: boolean }> = [];
  if (!scoreCalcPaused) {
    // 补强 #1：本批商品涉及商家的结算率一次批量查（查不到 → null，未验证中性）。
    const syncMerchantIds = [
      ...new Set(
        upserted
          .map((r) => r.merchantId)
          .filter((x): x is string => typeof x === "string" && !!x)
      ),
    ];
    const settlementByMerchant = new Map<string, number | null>();
    if (syncMerchantIds.length > 0) {
      const merchants = (await prisma.merchant.findMany({
        where: { id: { in: syncMerchantIds }, tenantId },
        select: { id: true, settlementRatePct: true },
      })) as Array<{ id: string; settlementRatePct: unknown }>;
      for (const m of merchants) {
        settlementByMerchant.set(m.id, toNum(m.settlementRatePct));
      }
    }
    for (const row of upserted) {
      if (blacklistedProducts.has(row.id)) continue;
      if (row.merchantId && blacklistedMerchants.has(row.merchantId)) continue;
      const r = evaluateProduct(
        {
          price: toNum(row.price),
          commissionAmount: toNum(row.commissionAmount),
          commissionRate: toNum(row.commissionRate),
          reviewCount: row.reviewCount,
          settlementRatePct: row.merchantId
            ? (settlementByMerchant.get(row.merchantId) ?? null)
            : null,
          payoutCycleDays:
            typeof row.payoutCycleDays === "number" &&
            Number.isFinite(row.payoutCycleDays)
              ? row.payoutCycleDays
              : null,
        },
        preset
      );
      await prisma.networkProduct.update({
        where: { id: row.id },
        data: { recommended: r.recommended, recommendationScore: r.score },
      });
      if (r.recommended) recommended += 1;
      scored.push({ ...row, score: r.score, isRecommended: r.recommended });
    }
  }
  await reportProgress("scored", { recommended, scoreCalcPaused });

  /* ── 8. 白名单建议：syncStreak 达到 3 → suggested（只建议，不自动加入） ── */
  for (const row of upserted) {
    if ((row.syncStreak ?? 0) >= 3) {
      await suggestWhitelistEntry(prisma, {
        tenantId,
        channel,
        entityType: "product",
        entityId: row.id,
        note: `连续 ${row.syncStreak} 期同步正常出现（${net.kind}）`,
      });
    }
  }

  /* ── 9. 自动建 Offer ── */
  let autoCreatedOffers = 0;
  if (preset.autoCreateOffer) {
    const whiteRows = (await prisma.catalogWhitelist.findMany({
      where: { tenantId, channel, entityType: "product", source: "manual" },
      select: { entityId: true },
    })) as Array<{ entityId: string }>;
    const whitelisted = new Set(whiteRows.map((r) => r.entityId));
    // 观察期商家：不置顶（中性对待）。
    const observedMerchants = new Set<string>();
    for (const s of scored) {
      if (
        s.merchantId &&
        !observedMerchants.has(s.merchantId) &&
        (await isMerchantObserved(prisma, tenantId, channel, "merchant", s.merchantId))
      ) {
        observedMerchants.add(s.merchantId);
      }
    }
    const topN = Math.max(
      AUTO_CREATE_TOP_N_MIN,
      Math.min(AUTO_CREATE_TOP_N_MAX, preset.autoCreateTopN)
    );
    // 候选 = 本次同步且评分推荐（recommended）的商品；
    // 排序：手动白名单优先（观察期商家商品不置顶），其余按 score 倒序。
    const ordered = scored
      .filter((s) => {
        if (!s.isRecommended) return false;
        if (blacklistedProducts.has(s.id)) return false;
        if (s.merchantId && blacklistedMerchants.has(s.merchantId)) return false;
        return true;
      })
      .sort((a, b) => {
        const aPin =
          whitelisted.has(a.id) &&
          !(a.merchantId && observedMerchants.has(a.merchantId));
        const bPin =
          whitelisted.has(b.id) &&
          !(b.merchantId && observedMerchants.has(b.merchantId));
        if (aPin !== bPin) return aPin ? -1 : 1;
        return b.score - a.score;
      })
      .slice(0, topN);
    for (const s of ordered) {
      try {
        const { offerId, created: wasCreated } = await createOfferFromProduct(
          deps,
          net,
          {
            tenantId,
            externalId: s.externalId,
            name: s.name,
            brand: s.brand,
            price: toNum(s.price),
            commissionAmount: toNum(s.commissionAmount),
            commissionRate: toNum(s.commissionRate),
            promoUrl: s.promoUrl,
            url: s.url,
          }
        );
        if (wasCreated) {
          autoCreatedOffers += 1;
          await writeCatalogAudit(prisma, {
            tenantId,
            grantId: grant?.id ?? null,
            actorId: userId,
            action: "CATALOG_AUTO_OFFER_CREATED",
            detail: {
              productId: s.id,
              offerId,
              externalId: s.externalId,
              kind: net.kind,
            },
          });
        }
      } catch (error) {
        // 单个失败不中断整批（缺链接等），记审计继续。
        await writeCatalogAudit(prisma, {
          tenantId,
          grantId: grant?.id ?? null,
          actorId: userId,
          action: "CATALOG_AUTO_OFFER_FAILED",
          detail: {
            productId: s.id,
            externalId: s.externalId,
            error: (error instanceof Error ? error.message : String(error)).slice(0, 300),
          },
        });
      }
    }
  }

  await reportProgress("offers", { autoCreatedOffers });

  /* ── 10. 成功收尾 ── */
  const now = new Date();
  await prisma.affiliateNetwork.update({
    where: { id: net.id },
    data: { lastPullAt: now, pullStatus: "SUCCESS", pullError: null },
  });
  await writeCatalogAudit(prisma, {
    tenantId,
    grantId: grant?.id ?? null,
    actorId: userId,
    action: "CATALOG_SYNC_SUCCESS",
    detail: {
      kind: net.kind,
      channel,
      mode,
      synced: upserted.length,
      created,
      updated,
      skippedLowCommission,
      skippedLowCommissionBySource,
      minCommissionUsd: minCommission,
      recommended,
      autoCreatedOffers,
      disappearedBlacklisted: disappeared.length,
      disappearedSkipped: disappearedSkipped ?? null,
      restoredDisappeared,
      ...(sourceBreakdown ? { sourceBreakdown } : {}),
      ...(datafeedError ? { datafeedError } : {}),
    },
  });
  if (grant) await incrementGrantUsage(prisma, grant);

  return {
    synced: upserted.length,
    created,
    updated,
    recommended,
    autoCreatedOffers,
    skippedLowCommission,
    scope: input.brandId?.trim() ? ("brand" as const) : ("full" as const),
    ...(input.brandId?.trim() ? { brandId: input.brandId.trim() } : {}),
    ...(disappearedSkipped ? { disappearedSkipped } : {}),
    ...(sourceBreakdown ? { sourceBreakdown } : {}),
    ...(datafeedError ? { datafeedError } : {}),
  };
}
