/**
 * 一键筛选（商品库）：复用现成组件跑一条确定性阶梯，不新造第二套判定。
 *
 * 阶梯顺序（便宜的先杀，任一 kill 立即停）：
 * 1. 黑名单（catalog-blacklist，channel 逐项匹配 product / merchant /
 *    network_account）→ kill
 * 2. $8 佣金门槛（shared commission-gate；阈值走 ai_settings 覆盖）
 *    —— 明确低于 → kill；算不出（未知）→ 不杀，转「待人工复核」标记
 * 3. 已保存预设（catalog-screening.evaluateProduct，租户预设；无预设用
 *    DEFAULT_PRESET）→ 未过 kill。佣金未知时把预设的佣金金额/比例维度
 *    置 0 再判：不可判定的维度不判死，其余维度照常判。
 * 4. 广告数（付费层，经付费数据网关）：网关拒绝 → 整层跳过
 *    （skippedPaidLayer=true，不杀不标记）；允许 → 先对未计算/已过期的
 *    商品增量计算（calcBrandAdCounts，14 天缓存），再按 adCount >= 1
 *    判 pass、= 0 kill、仍未知转复核标记。分档只报告不拦截。
 *    例外：品牌在 BrandProfile 标了「单品投放」（promoMode="product"）
 *    的，= 0 不杀（单品打法主信号是单品需求，品牌词广告数仅作参考），
 *    标记 adReferenceOnly 并计入报告 adWaivedCount。报告另计
 *    adStoppedCount（上次 >0、本次 =0 的疑似停投件数，只报告）。
 * 5. 流量门免费档（traffic/gate.evaluateTrafficGate）：passed=false →
 *    kill；passed=null（unknown）→ 不杀，转复核标记（守 P0-1 口径）。
 *
 * 结局三路（每件商品恰好一路，报告数字自洽）：
 * - kill → screenVerdict="kill" + 原因（规则名+关键值）；阶段为 inbox 时
 *   移入备选池（pool），testing/live 不动。
 * - review（无 kill 但有未知标记）→ screenVerdict="review" + 标记原因。
 * - pass → screenVerdict="pass"，随即建 Offer（createOfferFromProduct，
 *   idempotencyKey 去重：已建 → skippedExisting 计数，不重复建）。
 */
import type { PrismaClient } from "@adlinklab/database";
import {
  adCountTierDistribution,
  belowMinCommission,
  estimateCommissionFigure,
  minCommissionStopReason,
  type AdCountTierDistribution,
} from "@adlinklab/shared";
import { getMinCommissionUsd } from "../ai/commission-gate.js";
import {
  evaluateTrafficGate,
  extractCoreKeywords,
  type EvaluateTrafficGateInput,
} from "../traffic/gate.js";
import { getTrafficThresholds } from "../traffic/thresholds.js";
import type { TrafficGateResult } from "../traffic/types.js";
import {
  networkKindToChannel,
  writeCatalogAudit,
} from "./catalog-blacklist.js";
import {
  calcBrandAdCounts,
  deriveAdTrend,
  AD_COUNT_CACHE_TTL_MS,
  type BrandAdCountResult,
} from "./brand-ad-count.js";
import {
  DEFAULT_PRESET,
  evaluateProduct,
  type ScreeningPreset,
} from "./catalog-screening.js";
import { createOfferFromProduct } from "./catalog-sync.js";
import {
  recordPaidDataUsage,
  resolvePaidDataAccess,
} from "./paid-data-gateway.js";

export const ONE_CLICK_SCREEN_MAX_PRODUCTS = 200;

export type OneClickKillRule =
  | "blacklist"
  | "commission"
  | "preset"
  | "ad_count"
  | "traffic_gate";

export interface OneClickProductOutcome {
  productId: string;
  outcome: "pass" | "kill" | "review";
  killedBy?: OneClickKillRule;
  reason?: string;
  /** 广告层因品牌标注「单品投放」被豁免（广告数仅作参考，未据此杀）。 */
  adReferenceOnly?: boolean;
}

export interface OneClickScreenReport {
  processed: number;
  killedBlacklist: number;
  killedCommission: number;
  killedPreset: number;
  killedAdCount: number;
  killedTrafficGate: number;
  review: number;
  passed: number;
  /** 广告数付费层被网关拒绝而整体跳过（报告标注，不杀不标记）。 */
  skippedPaidLayer: boolean;
  /** 广告数层实际计费路径（跳过时为 null）。 */
  paidKeySource: "owner" | "tenant-own" | "platform" | null;
  offersCreated: number;
  offersSkippedExisting: number;
  offersFailed: Array<{ productId: string; reason: string }>;
  /** 处理范围内广告数已知商品的分档分布（只报告，不拦截）。 */
  adTierDistribution: AdCountTierDistribution;
  /** 处理范围内「疑似停投」商品数（上次 >0、本次 =0；只报告，不拦截）。 */
  adStoppedCount: number;
  /** 广告层因品牌「单品投放」标注被豁免的件数（本应被广告数 0 杀）。 */
  adWaivedCount: number;
  outcomes: OneClickProductOutcome[];
}

export interface OneClickScreenDeps {
  prisma: PrismaClient;
  fetchImpl?: typeof fetch;
  createOfferImpl?: Parameters<typeof createOfferFromProduct>[0]["createOfferImpl"];
  /** 测试注入点（生产走真实实现）。 */
  gateEvaluator?: (
    input: EvaluateTrafficGateInput
  ) => Promise<TrafficGateResult>;
  adCountCalc?: (
    prisma: PrismaClient,
    tenantId: string,
    productIds?: string[],
    deps?: { fetchImpl?: typeof fetch; credentials?: { login: string; password: string } | null }
  ) => Promise<BrandAdCountResult>;
  gatewayResolve?: typeof resolvePaidDataAccess;
}

export interface OneClickProductRow {
  id: string;
  networkId: string;
  externalId: string;
  name: string;
  brand: string | null;
  price: unknown;
  commissionAmount: unknown;
  commissionRate: unknown;
  reviewCount: number | null;
  promoUrl: string | null;
  landingPageType: string | null;
  countryCode: string | null;
  merchantId: string | null;
  poolStage: string;
  adCount: number | null;
  adCountCheckedAt: Date | null;
  lastAdCount: number | null;
}

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null;

async function loadPreset(
  prisma: PrismaClient,
  tenantId: string
): Promise<ScreeningPreset> {
  const row = (await prisma.catalogScreeningPreset.findUnique({
    where: { tenantId },
  })) as {
    minReviews: number | null;
    minCommissionAmount: unknown;
    minCommissionRate: unknown;
    minPrice: unknown;
    maxPrice: unknown;
    minScore: number | null;
  } | null;
  if (!row) return { ...DEFAULT_PRESET };
  return {
    minReviews: row.minReviews,
    minCommissionAmount: num(row.minCommissionAmount),
    minCommissionRate: num(row.minCommissionRate),
    minPrice: num(row.minPrice),
    maxPrice: num(row.maxPrice),
    minScore: row.minScore,
  };
}

interface BlacklistEntryLite {
  channel: string;
  entityType: string;
  entityId: string;
  reason: string;
}

function matchBlacklist(
  entries: BlacklistEntryLite[],
  channel: string,
  p: OneClickProductRow
): BlacklistEntryLite | null {
  for (const e of entries) {
    if (e.channel !== channel) continue;
    if (e.entityType === "product" && e.entityId === p.id) return e;
    if (e.entityType === "merchant" && p.merchantId && e.entityId === p.merchantId)
      return e;
    if (e.entityType === "network_account" && e.entityId === p.networkId)
      return e;
  }
  return null;
}

export async function runOneClickScreen(
  deps: OneClickScreenDeps,
  input: {
    tenantId: string;
    actorId: string;
    userRole: string;
    products: OneClickProductRow[];
  }
): Promise<OneClickScreenReport> {
  const { prisma } = deps;
  const { tenantId, products } = input;
  const gateEvaluator = deps.gateEvaluator ?? evaluateTrafficGate;
  const adCountCalc = deps.adCountCalc ?? calcBrandAdCounts;
  const gatewayResolve = deps.gatewayResolve ?? resolvePaidDataAccess;

  const [networks, blacklistRows, preset, thresholdUsd, thresholds] =
    await Promise.all([
      prisma.affiliateNetwork.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, kind: true },
      }) as Promise<Array<{ id: string; kind: string }>>,
      prisma.catalogBlacklist.findMany({
        where: { tenantId, status: "active" },
        select: { channel: true, entityType: true, entityId: true, reason: true },
      }) as Promise<BlacklistEntryLite[]>,
      loadPreset(prisma, tenantId),
      getMinCommissionUsd(prisma),
      getTrafficThresholds(prisma),
    ]);
  const kindOf = new Map(networks.map((n) => [n.id, n.kind]));

  // 商家结算率（预设评分维度）：只查涉及到的商家。
  const merchantIds = [
    ...new Set(products.map((p) => p.merchantId).filter((v): v is string => !!v)),
  ];
  const settlementOf = new Map<string, number | null>();
  if (merchantIds.length > 0) {
    const merchants = (await prisma.merchant.findMany({
      where: { tenantId, id: { in: merchantIds } },
      select: { id: true, settlementRatePct: true },
    })) as Array<{ id: string; settlementRatePct: unknown }>;
    for (const m of merchants)
      settlementOf.set(m.id, num(m.settlementRatePct));
  }

  interface Work {
    p: OneClickProductRow;
    killedBy?: OneClickKillRule;
    reason?: string;
    reviewFlags: string[];
    adCount: number | null;
    lastAdCount: number | null;
    adReferenceOnly?: boolean;
  }
  const works: Work[] = products.map((p) => ({
    p,
    reviewFlags: [],
    adCount: p.adCount,
    lastAdCount: p.lastAdCount,
  }));

  /* ── 1) 黑名单 → 2) $8 → 3) 预设（逐个，kill 立即停） ── */
  for (const w of works) {
    const p = w.p;
    const kind = kindOf.get(p.networkId) ?? "unknown";
    const channel = networkKindToChannel(kind);
    const bl = matchBlacklist(blacklistRows, channel, p);
    if (bl) {
      w.killedBy = "blacklist";
      w.reason = `黑名单（${bl.entityType}）：${bl.reason}`;
      continue;
    }
    const price = num(p.price);
    const fig = estimateCommissionFigure({
      amount: num(p.commissionAmount),
      ratePct: num(p.commissionRate),
      price,
    });
    if (fig.figure !== null && belowMinCommission(fig.figure, thresholdUsd)) {
      w.killedBy = "commission";
      w.reason = minCommissionStopReason(fig.figure, "USD", thresholdUsd, "zh");
      continue;
    }
    if (fig.figure === null) {
      w.reviewFlags.push("佣金未知（算不出单次佣金），待人工复核");
    }
    // 未知维度不判死（守 unknown 永不判 fail）：佣金算不出 → 金额维度置 0；
    // 佣金率未知 → 比例维度置 0（只有金额的商品不得因缺比例被杀）。
    // 其余维度（价格/评论/分数）照常判。
    const effectivePreset = {
      ...preset,
      ...(fig.figure === null ? { minCommissionAmount: 0 } : {}),
      ...(num(p.commissionRate) === null ? { minCommissionRate: 0 } : {}),
    };
    const ev = evaluateProduct(
      {
        price,
        commissionAmount: num(p.commissionAmount),
        commissionRate: num(p.commissionRate),
        reviewCount: p.reviewCount,
        settlementRatePct: p.merchantId
          ? (settlementOf.get(p.merchantId) ?? null)
          : null,
        payoutCycleDays: null,
      },
      effectivePreset
    );
    if (!ev.recommended) {
      w.killedBy = "preset";
      w.reason = `未达筛选预设（质量分 ${ev.score}）`;
      continue;
    }
  }

  /* ── 4) 广告数（付费层，经网关；拒绝 → 整层跳过） ── */
  let skippedPaidLayer = false;
  let adWaivedCount = 0;
  let paidKeySource: OneClickScreenReport["paidKeySource"] = null;
  const survivors = works.filter((w) => !w.killedBy);
  if (survivors.length > 0) {
    const access = await gatewayResolve(prisma, {
      tenantId,
      userId: input.actorId,
      userRole: input.userRole,
      feature: "catalog-ad-count",
    });
    if (!access.allowed) {
      skippedPaidLayer = true;
    } else {
      paidKeySource = access.keySource;
      // 品牌投放方式标注（BrandProfile）：标了「单品投放」的品牌，
      // 广告层不杀（单品打法的主信号是单品需求，品牌词广告数仅作参考）。
      // brandKey 归一化与 routes/catalog.ts normalizeBrandKey 同口径
      // （trim + 小写 + 空白折叠）；商品 countryCode 为 null 时用 "" 查。
      const brandKeyOf = (s: string | null): string =>
        (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
      const profileRows =
        (await prisma.brandProfile?.findMany({
          where: { tenantId },
          select: {
            networkId: true,
            brandKey: true,
            countryCode: true,
            promoMode: true,
          },
        })) ?? [];
      const promoModeByKey = new Map<string, string | null>();
      for (const pr of profileRows as Array<{
        networkId: string;
        brandKey: string;
        countryCode: string;
        promoMode: string | null;
      }>) {
        promoModeByKey.set(
          `${pr.networkId}${pr.brandKey}${pr.countryCode}`,
          pr.promoMode ?? null
        );
      }
      const nowMs = Date.now();
      const staleIds = survivors
        .filter(
          (w) =>
            w.adCount === null ||
            !(w.p.adCountCheckedAt instanceof Date) ||
            nowMs - (w.p.adCountCheckedAt as Date).getTime() >=
              AD_COUNT_CACHE_TTL_MS
        )
        .map((w) => w.p.id);
      if (staleIds.length > 0) {
        const result = await adCountCalc(prisma, tenantId, staleIds, {
          fetchImpl: deps.fetchImpl,
          credentials: access.credentials ?? undefined,
        });
        if (result.groupsQueried > 0) {
          await recordPaidDataUsage(prisma, {
            tenantId,
            actorId: input.actorId,
            feature: "catalog-ad-count",
            keySource: access.keySource,
            calls: result.groupsQueried,
            grantId: access.grantId,
          });
        }
        // 计算已写回 DB：重读这批商品的广告数（连同上次快照，供趋势判定）。
        const refreshed = (await prisma.networkProduct.findMany({
          where: { tenantId, id: { in: staleIds } },
          select: { id: true, adCount: true, lastAdCount: true },
        })) as Array<{
          id: string;
          adCount: number | null;
          lastAdCount: number | null;
        }>;
        const byId = new Map(refreshed.map((r) => [r.id, r]));
        for (const w of survivors) {
          const r = byId.get(w.p.id);
          if (r) {
            w.adCount = r.adCount ?? null;
            w.lastAdCount = r.lastAdCount ?? null;
          }
        }
      }
      for (const w of survivors) {
        if (w.adCount === null) {
          w.reviewFlags.push("广告数未计算（品牌缺失或查询失败），待人工复核");
        } else if (w.adCount === 0) {
          const promoMode = promoModeByKey.get(
            `${w.p.networkId}${brandKeyOf(w.p.brand)}${w.p.countryCode ?? ""}`
          );
          if (promoMode === "product") {
            // 单品品牌豁免：不杀，标记广告数仅作参考（汇总计数）。
            w.adReferenceOnly = true;
            adWaivedCount += 1;
          } else {
            w.killedBy = "ad_count";
            w.reason = "广告数为 0：该品牌暂无人在投放";
          }
        }
      }
    }
  }

  /* ── 5) 流量门免费档（幸存者逐个；unknown 不杀） ── */
  for (const w of works) {
    if (w.killedBy) continue;
    const p = w.p;
    let domain: string | null = null;
    if (p.landingPageType === "dtc" && p.promoUrl) domain = p.promoUrl;
    const gate = await gateEvaluator({
      brand: p.brand,
      title: p.name,
      keywords: extractCoreKeywords(p.name, p.brand ? [p.brand] : []),
      thresholds,
      prisma,
      fetchImpl: deps.fetchImpl,
      domain,
    });
    if (gate.passed === false) {
      w.killedBy = "traffic_gate";
      w.reason = `流量门未通过：${gate.reason}`;
    } else if (gate.passed === null) {
      w.reviewFlags.push("流量门数据不足（unknown），待人工复核");
    }
  }

  /* ── 结局落账 + pass 建 Offer ── */
  const report: OneClickScreenReport = {
    processed: works.length,
    killedBlacklist: 0,
    killedCommission: 0,
    killedPreset: 0,
    killedAdCount: 0,
    killedTrafficGate: 0,
    review: 0,
    passed: 0,
    skippedPaidLayer,
    paidKeySource,
    offersCreated: 0,
    offersSkippedExisting: 0,
    offersFailed: [],
    adTierDistribution: adCountTierDistribution(works.map((w) => w.adCount)),
    adStoppedCount: works.filter(
      (w) => deriveAdTrend(w.adCount, w.lastAdCount) === "stopped"
    ).length,
    adWaivedCount,
    outcomes: [],
  };
  const now = new Date();
  for (const w of works) {
    const p = w.p;
    if (w.killedBy) {
      if (w.killedBy === "blacklist") report.killedBlacklist += 1;
      else if (w.killedBy === "commission") report.killedCommission += 1;
      else if (w.killedBy === "preset") report.killedPreset += 1;
      else if (w.killedBy === "ad_count") report.killedAdCount += 1;
      else report.killedTrafficGate += 1;
      report.outcomes.push({
        productId: p.id,
        outcome: "kill",
        killedBy: w.killedBy,
        reason: w.reason,
      });
      await prisma.networkProduct.update({
        where: { id: p.id },
        data: {
          screenVerdict: "kill",
          screenReason: w.reason ?? null,
          screenedAt: now,
          ...(p.poolStage === "inbox" ? { poolStage: "pool" } : {}),
        },
      });
      continue;
    }
    if (w.reviewFlags.length > 0) {
      report.review += 1;
      const reason = w.reviewFlags.join("；");
      report.outcomes.push({
        productId: p.id,
        outcome: "review",
        reason,
        ...(w.adReferenceOnly ? { adReferenceOnly: true } : {}),
      });
      await prisma.networkProduct.update({
        where: { id: p.id },
        data: { screenVerdict: "review", screenReason: reason, screenedAt: now },
      });
      continue;
    }
    report.passed += 1;
    report.outcomes.push({
      productId: p.id,
      outcome: "pass",
      ...(w.adReferenceOnly ? { adReferenceOnly: true } : {}),
    });
    await prisma.networkProduct.update({
      where: { id: p.id },
      data: { screenVerdict: "pass", screenReason: null, screenedAt: now },
    });
    const kind = kindOf.get(p.networkId) ?? "unknown";
    try {
      const { offerId, created } = await createOfferFromProduct(
        { prisma, createOfferImpl: deps.createOfferImpl },
        { id: p.networkId, kind },
        {
          tenantId,
          externalId: p.externalId,
          name: p.name,
          brand: p.brand,
          price: num(p.price),
          commissionAmount: num(p.commissionAmount),
          commissionRate: num(p.commissionRate),
          promoUrl: p.promoUrl,
        }
      );
      if (created) report.offersCreated += 1;
      else report.offersSkippedExisting += 1;
      // 来源徽标：把「一键筛选通过」写进 Offer 的初筛徽标字段，
      // Offer 列表据此显示来源（一键筛选），与 Offer 入口初筛同口径。
      await prisma.offer.update({
        where: { id: offerId },
        data: {
          prescreenVerdict: "go",
          prescreenReason: "一键筛选通过（商品库）",
          prescreenedAt: now,
        },
      });
    } catch (e) {
      report.offersFailed.push({
        productId: p.id,
        reason: (e instanceof Error ? e.message : String(e)).slice(0, 300),
      });
    }
  }

  await writeCatalogAudit(prisma, {
    tenantId,
    actorId: input.actorId,
    action: "CATALOG_ONE_CLICK_SCREEN",
    detail: {
      processed: report.processed,
      killedBlacklist: report.killedBlacklist,
      killedCommission: report.killedCommission,
      killedPreset: report.killedPreset,
      killedAdCount: report.killedAdCount,
      killedTrafficGate: report.killedTrafficGate,
      adStoppedCount: report.adStoppedCount,
      adWaivedCount: report.adWaivedCount,
      review: report.review,
      passed: report.passed,
      skippedPaidLayer: report.skippedPaidLayer,
      paidKeySource: report.paidKeySource,
      offersCreated: report.offersCreated,
      offersSkippedExisting: report.offersSkippedExisting,
      offersFailed: report.offersFailed.length,
    },
  });

  return report;
}

/**
 * 人工强制入选：跳过筛选阶梯直接建 Offer，写审计。
 * 唯一例外：黑名单是用户自己的硬排除清单，强制也不越过（返回 refused）。
 */
export async function forceSelectProducts(
  deps: {
    prisma: PrismaClient;
    createOfferImpl?: OneClickScreenDeps["createOfferImpl"];
  },
  input: { tenantId: string; actorId: string; products: OneClickProductRow[] }
): Promise<{
  created: Array<{ productId: string; offerId: string }>;
  skippedExisting: Array<{ productId: string }>;
  refusedBlacklist: Array<{ productId: string; reason: string }>;
  failed: Array<{ productId: string; reason: string }>;
}> {
  const { prisma, tenantId } = { prisma: deps.prisma, tenantId: input.tenantId };
  const [networks, blacklistRows] = await Promise.all([
    prisma.affiliateNetwork.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, kind: true },
    }) as Promise<Array<{ id: string; kind: string }>>,
    prisma.catalogBlacklist.findMany({
      where: { tenantId, status: "active" },
      select: { channel: true, entityType: true, entityId: true, reason: true },
    }) as Promise<BlacklistEntryLite[]>,
  ]);
  const kindOf = new Map(networks.map((n) => [n.id, n.kind]));
  const out = {
    created: [] as Array<{ productId: string; offerId: string }>,
    skippedExisting: [] as Array<{ productId: string }>,
    refusedBlacklist: [] as Array<{ productId: string; reason: string }>,
    failed: [] as Array<{ productId: string; reason: string }>,
  };
  const now = new Date();
  for (const p of input.products) {
    const kind = kindOf.get(p.networkId) ?? "unknown";
    const bl = matchBlacklist(
      blacklistRows,
      networkKindToChannel(kind),
      p
    );
    if (bl) {
      out.refusedBlacklist.push({
        productId: p.id,
        reason: `黑名单（${bl.entityType}）：${bl.reason}——黑名单不可强制入选`,
      });
      continue;
    }
    try {
      const { offerId, created } = await createOfferFromProduct(
        { prisma, createOfferImpl: deps.createOfferImpl },
        { id: p.networkId, kind },
        {
          tenantId,
          externalId: p.externalId,
          name: p.name,
          brand: p.brand,
          price: num(p.price),
          commissionAmount: num(p.commissionAmount),
          commissionRate: num(p.commissionRate),
          promoUrl: p.promoUrl,
        }
      );
      if (created) out.created.push({ productId: p.id, offerId });
      else out.skippedExisting.push({ productId: p.id });
      await prisma.networkProduct.update({
        where: { id: p.id },
        data: {
          screenVerdict: "pass",
          screenReason: "人工强制入选（跳过筛选阶梯）",
          screenedAt: now,
        },
      });
      // Offer 侧徽标诚实标注：强制入选未经阶梯判定，verdict 记 unknown，
      // 原因写明人工强制（不冒充筛选通过）。
      await prisma.offer.update({
        where: { id: offerId },
        data: {
          prescreenVerdict: "unknown",
          prescreenReason: "人工强制入选（跳过筛选阶梯）",
          prescreenedAt: now,
        },
      });
    } catch (e) {
      out.failed.push({
        productId: p.id,
        reason: (e instanceof Error ? e.message : String(e)).slice(0, 300),
      });
    }
  }
  await writeCatalogAudit(prisma, {
    tenantId,
    actorId: input.actorId,
    action: "CATALOG_FORCE_SELECT",
    detail: {
      requested: input.products.length,
      created: out.created.length,
      skippedExisting: out.skippedExisting.length,
      refusedBlacklist: out.refusedBlacklist.length,
      failed: out.failed.length,
      productIds: input.products.map((p) => p.id),
    },
  });
  return out;
}
