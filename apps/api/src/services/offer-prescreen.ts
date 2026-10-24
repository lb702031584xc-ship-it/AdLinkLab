/**
 * Offer 一键初筛：对 Offer 跑与商品库一键筛选同一条阶梯，结论以徽标字段
 * 写回 Offer（prescreenVerdict / prescreenReason / prescreenedAt）。
 * 判停（stop）只标注、绝不删除 Offer（与工作表初筛同口径）。
 *
 * 阶梯（与 one-click-screen 同序、同规则实现口径）：
 * 1. 黑名单（merchant / offer 实体，channel 按 Offer.source 映射）
 * 2. $8 佣金门槛（口径以写入方为准：FIXED 与 catalog-sync 的 PERCENT
 *    其 commissionValue 都是已换算的美元金额；只有 offer-form 的
 *    percentage/% 才是费率、需 × 均价；未知 → 不判死，转 unknown 标记）
 * 3. 已保存预设（evaluateProduct；Offers 无评论数维度，reviewCount=null
 *    按预设既有口径参与；佣金未知时金额维度置 0 不判死）
 * 4. 广告数（品牌级，经付费数据网关）：以同租户同品牌商品的 adCount 为据；
 *    未知时经网关增量计算；网关拒绝 → 整层跳过（skippedPaidLayer）；
 *    已知全为 0 → stop；仍未知 → unknown 标记。
 *    多探针口径（2026-10-21）：「在投」= 裸品牌词 ≥1 或长尾探针
 *    （adCountLongtail，品牌+型号/品类词）≥1；仅长尾过关带 adLongtailOnly
 *    标记；品牌组命中政策风险（武器配件类）时判停原因用政策口径文案。
 *    透明中心旁证口径（2026-10-21 续）：SERP 快照只能证"有"不能证"无"，
 *    判停须三通道全 0 已知——裸词 = 0 且长尾 = 0 且透明中心广告主
 *    （tcAdvertisersCount）= 0；SERP 双 0 但 TC ≥ 1 → 旁证翻案过关
 *    （tcRescued 标记）；SERP 双 0 且 TC 未知（null）→ unknown 转复核，
 *    绝不判停（与 unknown-never-fail 同口径）。
 *    例外（投放方式分流）：品牌被显式标注 promoMode="product"（没有品牌级
 *    链接、只能走单品）时，品牌词广告数只作参考——全为 0 也不判 stop，
 *    结果加 adReferenceOnly 标记并计入 adWaivedCount；标注 "brand" 或
 *    未标注维持原口径。标注按 网络×品牌×国家 查 BrandProfile。
 * 5. 流量门免费档（evaluateTrafficGate）：false → stop；null → unknown 标记
 *
 * 合成：任一 stop → "stop"；无 stop 但有 unknown 标记 → "unknown"；
 * 全过 → "go"（caution 档保留给工作表四腿合成，本阶梯无 caution 来源）。
 *
 * 清单 #7（初筛松绑）：本阶梯本来就不读条款 SEM / 品牌词 / 直链
 * 限制（无此输入），故禁令从未参与本 verdict 合成；本次只加两处：
 * 1) 返回排序改为经济优先——单笔佣金（降序）第一，verdict 成本
 *    （go < unknown < stop，升序）第二；写回 DB 的顺序不变；
 * 2) 每条 outcome 附 riskCost（OfferPolicy 最新快照里 FORBIDDEN
 *    的 SEM / 品牌词 / 直链项）：只展示，不参与 verdict、不排除。
 */
import type { PrismaClient } from "@adlinklab/database";
import {
  belowMinCommission,
  estimateCommissionFigure,
  minCommissionStopReason,
} from "@adlinklab/shared";
import { getMinCommissionUsd } from "../ai/commission-gate.js";
import {
  evaluateTrafficGate,
  extractCoreKeywords,
  type EvaluateTrafficGateInput,
} from "../traffic/gate.js";
import { getTrafficThresholds } from "../traffic/thresholds.js";
import type { TrafficGateResult } from "../traffic/types.js";
import { writeCatalogAudit } from "./catalog-blacklist.js";
import {
  calcBrandAdCounts,
  deriveAdTrend,
  type BrandAdCountResult,
} from "./brand-ad-count.js";
import {
  DEFAULT_PRESET,
  evaluateProduct,
  type ScreeningPreset,
} from "./catalog-screening.js";
import {
  recordPaidDataUsage,
  resolvePaidDataAccess,
} from "./paid-data-gateway.js";
import { deriveCommissionPerSaleUsd } from "./offer-priority.js";

export type OfferPrescreenVerdict = "go" | "unknown" | "stop";

export interface OfferPrescreenOutcome {
  offerId: string;
  verdict: OfferPrescreenVerdict;
  reason: string;
  /** 单笔佣金（美元，deriveCommissionPerSaleUsd 口径；算不出为 null）。排序第一键。 */
  commissionUsd?: number | null;
  /**
   * 风险成本栏位（清单 #7）：OfferPolicy 最新快照里 FORBIDDEN 的
   * SEM / 品牌词 / 直链项。只展示，不参与 verdict 判定、不排除。
   */
  riskCost?: string[];
  /** 广告层被 promoMode="product" 分流豁免（广告数仅作参考，未参与判停）。 */
  adReferenceOnly?: boolean;
  /** 仅靠长尾探针广告数过关（裸品牌词无广告、品牌+型号/品类词有广告在投）。 */
  adLongtailOnly?: boolean;
  /** SERP 双 0 但透明中心有广告主在投，经旁证翻案过关（快照未捕获）。 */
  tcRescued?: boolean;
  /** 透明中心广告主数（tcRescued 时给出，= 已知最大值）。 */
  tcAdvertisersCount?: number;
}

export interface OfferPrescreenDeps {
  prisma: PrismaClient;
  fetchImpl?: typeof fetch;
  gateEvaluator?: (
    input: EvaluateTrafficGateInput
  ) => Promise<TrafficGateResult>;
  adCountCalc?: (
    prisma: PrismaClient,
    tenantId: string,
    productIds?: string[],
    deps?: {
      fetchImpl?: typeof fetch;
      credentials?: { login: string; password: string } | null;
    }
  ) => Promise<BrandAdCountResult>;
  gatewayResolve?: typeof resolvePaidDataAccess;
}

interface OfferRow {
  id: string;
  name: string;
  network: string;
  source: string;
  destinationUrl: string;
  merchantId: string | null;
  brandName: string | null;
  commissionValue: unknown;
  commissionType: string | null;
  avgPrice: unknown;
}

const num = (v: unknown): number | null =>
  v === null || v === undefined
    ? null
    : Number.isFinite(Number(v))
      ? Number(v)
      : null;

function offerChannel(source: string): string {
  const s = source.trim().toLowerCase();
  if (s === "amazon" || s === "cashback") return s;
  return "affiliate";
}

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

export async function prescreenOffers(
  deps: OfferPrescreenDeps,
  input: {
    tenantId: string;
    actorId: string;
    userRole: string;
    offers: OfferRow[];
  }
): Promise<{
  outcomes: OfferPrescreenOutcome[];
  skippedPaidLayer: boolean;
  counts: {
    go: number;
    unknown: number;
    stop: number;
    notFound: number;
    /** 本次评估涉及的商品中「疑似停投」（上次有广告、本次 0）的件数。 */
    adStoppedCount: number;
    /** 本次被 promoMode="product" 分流豁免广告层判停的 Offer 件数。 */
    adWaivedCount: number;
    /** 本次仅靠长尾探针过关的 Offer 件数（裸词 0、长尾 ≥1）。 */
    adLongtailOnlyCount: number;
    /** 本次 SERP 双 0 但透明中心有广告主、经旁证翻案过关的 Offer 件数。 */
    adTcRescuedCount: number;
  };
}> {
  const { prisma } = deps;
  const { tenantId, offers } = input;
  const gateEvaluator = deps.gateEvaluator ?? evaluateTrafficGate;
  const adCountCalc = deps.adCountCalc ?? calcBrandAdCounts;
  const gatewayResolve = deps.gatewayResolve ?? resolvePaidDataAccess;

  const [blacklistRows, preset, thresholdUsd, thresholds, policyRows] =
    await Promise.all([
      prisma.catalogBlacklist.findMany({
        where: { tenantId, status: "active" },
        select: { channel: true, entityType: true, entityId: true, reason: true },
      }) as Promise<
        Array<{ channel: string; entityType: string; entityId: string; reason: string }>
      >,
      loadPreset(prisma, tenantId),
      getMinCommissionUsd(prisma),
      getTrafficThresholds(prisma),
      // 清单 #7 风险成本来源：每 Offer 最新一条政策快照（createdAt 倒序，
      // 同 Offer 取首条）。测试 fake 无此委托时 ?. 退回空数组。
      (prisma.offerPolicy?.findMany({
        where: { tenantId, offerId: { in: offers.map((o) => o.id) } },
        select: { offerId: true, rules: true },
        orderBy: { createdAt: "desc" },
      }) as
        | Promise<Array<{ offerId: string; rules: unknown }>>
        | undefined) ?? [],
    ]);

  // OfferPolicy.rules: Record<规则名, ALLOWED|FORBIDDEN|REQUIRED|UNKNOWN>。
  // 风险成本只取 FORBIDDEN 的三项（SEM / 品牌词 / 直链），其余规则不进本栏位。
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

  interface Work {
    o: OfferRow;
    stopReason?: string;
    /** 单笔佣金（美元；黑名单等佣金计算前即判停的为 null）。 */
    commissionUsd?: number | null;
    flags: string[];
    needsAdData: boolean;
    adReferenceOnly?: boolean;
    /** 仅靠长尾探针过关（裸品牌词全 0/未知、长尾 ≥1）：可审计标记。 */
    adLongtailOnly?: boolean;
    /** SERP 双 0 但透明中心有广告主、旁证翻案过关：可审计标记 + 广告主数。 */
    tcRescued?: boolean;
    tcAdvertisersCount?: number;
  }
  const works: Work[] = offers.map((o) => ({ o, flags: [], needsAdData: false }));

  /* ── 1) 黑名单 → 2) $8 → 3) 预设 ── */
  for (const w of works) {
    const o = w.o;
    const channel = offerChannel(o.source);
    const bl = blacklistRows.find(
      (e) =>
        e.channel === channel &&
        ((e.entityType === "offer" && e.entityId === o.id) ||
          (e.entityType === "merchant" &&
            o.merchantId &&
            e.entityId === o.merchantId))
    );
    if (bl) {
      w.stopReason = `黑名单（${bl.entityType}）：${bl.reason}`;
      continue;
    }
    const commissionValue = num(o.commissionValue);
    const avgPrice = num(o.avgPrice);
    // 佣金口径以写入方为准（金额推导与 offer-priority 同源实现）：
    // catalog-sync 写入的 "PERCENT"，其 commissionValue 已是换算好的美元
    // 金额（如 899×13% 存 116.87），绝不能再当费率乘均价（会算出 $1050
    // 的假佣金）；offer-form 的 "percentage"/"%" 才是真费率；FIXED 值即金额。
    // 费率维度：percentage/% 取原值；PERCENT 由 金额÷均价 反推真实费率；
    // FIXED 无费率（null，维度不判死，与旧口径一致）。
    const amount = deriveCommissionPerSaleUsd({
      commissionValue: o.commissionValue,
      commissionType: o.commissionType,
      avgPrice: o.avgPrice,
    });
    w.commissionUsd = amount;
    const typeKey = (o.commissionType ?? "").trim().toLowerCase();
    const ratePct =
      typeKey === "percentage" || typeKey === "%"
        ? commissionValue
        : typeKey === "percent" &&
            amount != null &&
            avgPrice != null &&
            avgPrice > 0
          ? (amount / avgPrice) * 100
          : null;
    const fig = estimateCommissionFigure({
      amount,
      ratePct,
      price: avgPrice,
    });
    if (fig.figure !== null && belowMinCommission(fig.figure, thresholdUsd)) {
      w.stopReason = minCommissionStopReason(
        fig.figure,
        "USD",
        thresholdUsd,
        "zh"
      );
      continue;
    }
    if (fig.figure === null) w.flags.push("佣金未知，待人工复核");
    // 未知维度不判死：佣金算不出 → 金额维度置 0；无佣金率（FIXED 等）
    // → 比例维度置 0。其余维度照常判（与商品库一键筛选同口径）。
    const rateForEval = ratePct;
    const effectivePreset = {
      ...preset,
      ...(fig.figure === null ? { minCommissionAmount: 0 } : {}),
      ...(rateForEval === null ? { minCommissionRate: 0 } : {}),
    };
    const ev = evaluateProduct(
      {
        price: avgPrice,
        commissionAmount: amount,
        commissionRate: rateForEval,
        reviewCount: null,
      },
      effectivePreset
    );
    if (!ev.recommended) {
      w.stopReason = `未达筛选预设（质量分 ${ev.score}）`;
      continue;
    }
    w.needsAdData = true;
  }

  /* ── 4) 广告数（品牌级，付费层经网关） ── */
  let skippedPaidLayer = false;
  let adStoppedCount = 0;
  let adWaivedCount = 0;
  let adLongtailOnlyCount = 0;
  let adTcRescuedCount = 0;
  const adCandidates = works.filter((w) => !w.stopReason && w.needsAdData);
  if (adCandidates.length > 0) {
    const access = await gatewayResolve(prisma, {
      tenantId,
      userId: input.actorId,
      userRole: input.userRole,
      feature: "catalog-ad-count",
    });
    if (!access.allowed) {
      skippedPaidLayer = true;
    } else {
      // 品牌投放方式标注（BrandProfile）：按 网络×品牌键×国家 预加载成 map。
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
      for (const p of profileRows as Array<{
        networkId: string;
        brandKey: string;
        countryCode: string;
        promoMode: string | null;
      }>) {
        promoModeByKey.set(
          `${p.networkId}${p.brandKey}${p.countryCode}`,
          p.promoMode ?? null
        );
      }
      // 同品牌商品（品牌名归一化后精确匹配）的广告数即品牌级广告数。
      const allProducts = (await prisma.networkProduct.findMany({
        where: { tenantId },
        select: {
          id: true,
          brand: true,
          networkId: true,
          countryCode: true,
          adCount: true,
          adCountLongtail: true,
          tcAdvertisersCount: true,
          adPolicyRisk: true,
          lastAdCount: true,
        },
      })) as Array<{
        id: string;
        brand: string | null;
        networkId: string | null;
        countryCode: string | null;
        adCount: number | null;
        adCountLongtail: number | null;
        tcAdvertisersCount: number | null;
        adPolicyRisk: boolean;
        lastAdCount: number | null;
      }>;
      const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
      const byBrand = new Map<
        string,
        Array<{
          id: string;
          adCount: number | null;
          adCountLongtail: number | null;
          tcAdvertisersCount: number | null;
          adPolicyRisk: boolean;
          lastAdCount: number | null;
          promoMode: string | null;
        }>
      >();
      for (const p of allProducts) {
        const key = norm(p.brand);
        if (!key) continue;
        const arr = byBrand.get(key) ?? [];
        arr.push({
          id: p.id,
          adCount: p.adCount,
          adCountLongtail: p.adCountLongtail ?? null,
          tcAdvertisersCount: p.tcAdvertisersCount ?? null,
          adPolicyRisk: p.adPolicyRisk === true,
          lastAdCount: p.lastAdCount,
          promoMode:
            promoModeByKey.get(
              `${p.networkId ?? ""}${brandKeyOf(p.brand)}${(p.countryCode ?? "").trim().toUpperCase()}`
            ) ?? null,
        });
        byBrand.set(key, arr);
      }
      // 先给「需要重算」的品牌做一次增量计算：广告数全未知，或长尾口径
      // 未落地（adCountLongtail 为 null = 多探针上线前旧印记，calc 内部
      // 新鲜度规则会决定是否真的重探，派生不出探针的组不花钱），或
      // SERP 双 0 已知但透明中心从未查过（tcAdvertisersCount 全 null：
      // calc 内部会按 TC 触发条件补查旁证；TC 的 14 天过期重查由广告
      // 计算入口负责，本层只补"从未查过"，不为初筛反复烧 TC）。
      const calcIds: string[] = [];
      for (const w of adCandidates) {
        const rows = byBrand.get(norm(w.o.brandName)) ?? [];
        if (rows.length === 0) continue;
        const bareKnown = rows
          .map((r) => r.adCount)
          .filter((v): v is number => v !== null);
        const ltKnown = rows
          .map((r) => r.adCountLongtail)
          .filter((v): v is number => v !== null);
        const serpDoubleZeroKnown =
          bareKnown.length > 0 &&
          bareKnown.every((v) => v === 0) &&
          ltKnown.length > 0 &&
          ltKnown.every((v) => v === 0);
        if (
          rows.every((r) => r.adCount === null) ||
          rows.some((r) => r.adCountLongtail === null) ||
          (serpDoubleZeroKnown &&
            rows.every((r) => r.tcAdvertisersCount === null))
        ) {
          calcIds.push(...rows.map((r) => r.id));
        }
      }
      if (calcIds.length > 0) {
        const result = await adCountCalc(prisma, tenantId, [...new Set(calcIds)], {
          fetchImpl: deps.fetchImpl,
          credentials: access.credentials ?? undefined,
        });
        // 记账门槛：SERP 或 TC 任一实际发出查询都要记（TC 单独补查时
        // groupsQueried 可能为 0，不能漏记）；calls = SERP 实际查询数
        // + TC task_post 数（两种查询在网关用量里合并计数、审计可拆）。
        const totalCalls =
          (result.serpQueries ?? result.groupsQueried) +
          (result.tcQueries ?? 0);
        if (totalCalls > 0) {
          await recordPaidDataUsage(prisma, {
            tenantId,
            actorId: input.actorId,
            feature: "catalog-ad-count",
            keySource: access.keySource,
            // 深度 12 后一组最多 12 次 SERP：按实际查询次数记账（旧 fake 无此字段时退回组数）。
            calls: totalCalls,
            grantId: access.grantId,
          });
        }
        // 回读刷新（含 TC——TC 单独补查 groupsQueried=0 时也要刷回，
        // 故回读不再挂在记账门槛里，calc 跑过就刷）。
        const refreshed = (await prisma.networkProduct.findMany({
          where: { tenantId, id: { in: [...new Set(calcIds)] } },
          select: {
            id: true,
            brand: true,
            adCount: true,
            adCountLongtail: true,
            tcAdvertisersCount: true,
            adPolicyRisk: true,
            lastAdCount: true,
          },
        })) as Array<{
          id: string;
          brand: string | null;
          adCount: number | null;
          adCountLongtail: number | null;
          tcAdvertisersCount: number | null;
          adPolicyRisk: boolean;
          lastAdCount: number | null;
        }>;
        for (const p of refreshed) {
          const key = norm(p.brand);
          const arr = byBrand.get(key) ?? [];
          const hit = arr.find((r) => r.id === p.id);
          if (hit) {
            hit.adCount = p.adCount;
            hit.adCountLongtail = p.adCountLongtail ?? null;
            hit.tcAdvertisersCount = p.tcAdvertisersCount ?? null;
            hit.adPolicyRisk = p.adPolicyRisk === true;
            hit.lastAdCount = p.lastAdCount;
          }
        }
      }
      for (const w of adCandidates) {
        const rows = byBrand.get(norm(w.o.brandName)) ?? [];
        const bareKnown = rows
          .map((r) => r.adCount)
          .filter((v): v is number => v !== null);
        const ltKnown = rows
          .map((r) => r.adCountLongtail)
          .filter((v): v is number => v !== null);
        const tcKnown = rows
          .map((r) => r.tcAdvertisersCount)
          .filter((v): v is number => v !== null);
        if (
          bareKnown.length === 0 &&
          ltKnown.length === 0 &&
          tcKnown.length === 0
        ) {
          w.flags.push("品牌广告数无数据，待人工复核");
        } else if (bareKnown.some((v) => v >= 1)) {
          // 裸品牌词有广告在投 → 过关。
        } else if (ltKnown.some((v) => v >= 1)) {
          // 仅靠长尾过关：裸词全 0/未知、长尾（型号/品类词）有广告在投。
          w.adLongtailOnly = true;
          adLongtailOnlyCount += 1;
        } else if (tcKnown.some((v) => v >= 1)) {
          // SERP 双 0/未知但透明中心有广告主在投：快照未捕获（SERP
          // 只能证"有"不能证"无"），旁证翻案 → 过关并打标。
          w.tcRescued = true;
          w.tcAdvertisersCount = Math.max(...tcKnown);
          adTcRescuedCount += 1;
        } else if (
          bareKnown.length > 0 &&
          bareKnown.every((v) => v === 0) &&
          ltKnown.length > 0 &&
          ltKnown.every((v) => v === 0) &&
          tcKnown.length > 0 &&
          tcKnown.every((v) => v === 0)
        ) {
          // 判停（三通道全 0 已知）：裸词、长尾、透明中心都确认无人
          // 投放才判停——任一维度未知都不许判停（见下方复核分支）。
          // 投放方式分流：组内有 promoMode="product" 标注且无 "brand" 标注
          // → 该品牌只能走单品，品牌词广告数只作参考，全 0 不判停。
          const modes = new Set(rows.map((r) => r.promoMode));
          if (modes.has("product") && !modes.has("brand")) {
            w.adReferenceOnly = true;
            adWaivedCount += 1;
          } else if (rows.some((r) => r.adPolicyRisk)) {
            // 政策口径：武器配件类类目付费广告禁投，0 是政策墙不是市场空白。
            w.stopReason =
              "政策受限类目（武器配件）：付费广告禁投，广告数为 0 是政策限制而非无人投放";
          } else {
            w.stopReason =
              "广告数为 0（SERP 与透明中心双通道确认）：该品牌暂无人在投放";
          }
        } else {
          // 任一维度未知（含 SERP 双 0 但 TC 未查/查失败、长尾未探明、
          // 裸词无数据）→ "无"未证 → 不判死，转人工复核。
          w.flags.push(
            "品牌广告数未完全确认（SERP/长尾/透明中心任一待补查），待人工复核"
          );
        }
      }
      // 疑似停投计数：本次评估涉及的品牌商品里，上次有广告、本次归 0 的件数
      // （同一商品被多个 Offer 引用只计一次；趋势由 adCount/lastAdCount 现算）。
      const countedIds = new Set<string>();
      for (const w of adCandidates) {
        const rows = byBrand.get(norm(w.o.brandName)) ?? [];
        for (const r of rows) {
          if (countedIds.has(r.id)) continue;
          countedIds.add(r.id);
          if (deriveAdTrend(r.adCount, r.lastAdCount) === "stopped")
            adStoppedCount += 1;
        }
      }
    }
  }

  /* ── 5) 流量门免费档 + 落账 ── */
  const outcomes: OfferPrescreenOutcome[] = [];
  const counts = {
    go: 0,
    unknown: 0,
    stop: 0,
    notFound: 0,
    adStoppedCount,
    adWaivedCount,
    adLongtailOnlyCount,
    adTcRescuedCount,
  };
  const now = new Date();
  for (const w of works) {
    const o = w.o;
    if (!w.stopReason) {
      const gate = await gateEvaluator({
        brand: o.brandName,
        title: o.name,
        keywords: extractCoreKeywords(o.name, o.brandName ? [o.brandName] : []),
        thresholds,
        prisma,
        fetchImpl: deps.fetchImpl,
      });
      if (gate.passed === false) {
        w.stopReason = `流量门未通过：${gate.reason}`;
      } else if (gate.passed === null) {
        w.flags.push("流量门数据不足（unknown），待人工复核");
      }
    }
    const verdict: OfferPrescreenVerdict = w.stopReason
      ? "stop"
      : w.flags.length > 0
        ? "unknown"
        : "go";
    const reason =
      w.stopReason ??
      (w.flags.length > 0
        ? w.flags.join("；")
        : w.tcRescued
          ? `透明中心有 ${w.tcAdvertisersCount ?? 0} 家广告主在投（快照未捕获）：SERP 快照双 0 经透明中心旁证翻案过关`
          : "");
    counts[verdict] += 1;
    const riskCost = riskCostByOffer.get(o.id) ?? [];
    outcomes.push({
      offerId: o.id,
      verdict,
      reason,
      commissionUsd: w.commissionUsd ?? null,
      ...(riskCost.length > 0 ? { riskCost } : {}),
      ...(w.adReferenceOnly ? { adReferenceOnly: true } : {}),
      ...(w.adLongtailOnly ? { adLongtailOnly: true } : {}),
      ...(w.tcRescued
        ? { tcRescued: true, tcAdvertisersCount: w.tcAdvertisersCount }
        : {}),
    });
    await prisma.offer.update({
      where: { id: o.id },
      data: {
        prescreenVerdict: verdict,
        prescreenReason: reason || null,
        prescreenedAt: now,
      },
    });
  }

  // 清单 #7 — 返回排序：第一键单笔佣金降序（未知排后），
  // 第二键 verdict 成本升序（go < unknown < stop）。仅排返回数组；
  // 上方写回 DB 的顺序与 counts 均不受影响。Array.sort 稳定，
  // 两键全等时保持输入顺序。
  const verdictCost: Record<OfferPrescreenVerdict, number> = {
    go: 0,
    unknown: 1,
    stop: 2,
  };
  outcomes.sort((a, b) => {
    const ac = a.commissionUsd ?? null;
    const bc = b.commissionUsd ?? null;
    if (ac !== null && bc !== null && ac !== bc) return bc - ac;
    if (ac !== null && bc === null) return -1;
    if (ac === null && bc !== null) return 1;
    return verdictCost[a.verdict] - verdictCost[b.verdict];
  });

  await writeCatalogAudit(prisma, {
    tenantId,
    actorId: input.actorId,
    action: "OFFER_PRESCREEN_BATCH",
    detail: {
      requested: offers.length,
      go: counts.go,
      unknown: counts.unknown,
      stop: counts.stop,
      adStoppedCount: counts.adStoppedCount,
      adWaivedCount: counts.adWaivedCount,
      adLongtailOnlyCount: counts.adLongtailOnlyCount,
      adTcRescuedCount: counts.adTcRescuedCount,
      skippedPaidLayer,
    },
  });

  return { outcomes, skippedPaidLayer, counts };
}
