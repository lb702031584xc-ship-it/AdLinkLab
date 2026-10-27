/**
 * 宽松型筛选项（loose mode）：与一键初筛阶梯并行的批量选款口径。
 *
 * 本模块是纯函数（不碰 Prisma、不写回 Offer）：调用方把 Offer 行、
 * 关联商品库数据与本轮显式证据拼成 LooseScreenRow 传进来，返回
 * 本轮筛查报告。默认一键初筛行为不受任何影响。
 *
 * 入选门（缺一项即排除并写明原因）：
 * 1. 用户排除清单（品牌、品类）原样执行；
 * 2. 佣金率为零直接排除；
 * 3. 单均佣金高于可配置下限（默认 $3；算不出 → 排除，理由写未知）；
 * 4. 当季热销潜力：必须有调用方提供的当季热销依据（显式输入，
 *    由用户定）；依据缺失 → 排除，绝不按品类自动编造季节性；
 * 5. 有货：调用方提供的库存状态为 in_stock 才过；缺货或未知 → 排除；
 * 6. 真实购买需求佐证：评分、评论数、月销任一大于 0；
 * 7. 低价流量可得性：有数据判可得/不可得（不可得 → 排除）；
 *    无数据 → 不排除，标 lowPriceTraffic: "unknown"，绝不编造。
 *
 * 条款禁令（SEM / 品牌词 / 直链）只进 riskCost 栏展示：调用方把
 * OfferPolicy 快照里的 FORBIDDEN 项拼进 row.riskCost，本模块原样
 * 透传，不参与排除、不降权。
 *
 * 同一品牌只留一条（按单均佣金最高留；品牌名为空的不参与去重），
 * 被拿掉的条进 dropped 并写明保留了哪条。
 *
 * 排序（松绑口径）：每点击期望利润降序 → EPC 降序 → 单均佣金降序 →
 * 转化率降序，每键未知排后；全等时保持输入顺序。
 * 期望利润只在给出 cpcExpected 时才有值；未给出时该键全为 null，
 * 排序自动退回到原来的 EPC → 佣金 → 转化率 口径（向后兼容）。
 *
 * ── 2026-10-27 回流闭环（清单 #6）─────────────────────────────
 * 1. 实测优先：row.measured 来自投放归档（LaunchArchive）聚合。样本量
 *    达到 minMeasuredClicks（默认 50 次点击）才采用实测值，否则退回
 *    人工证据；两者都没有 → unknown。绝不拿全广告主平均值冒充单品
 *    实测（红线 6）。每条结果标注 epcSource / conversionSource，让上层
 *    知道这个数是测出来的还是猜的。
 * 2. 每点击期望利润：profitPerClick = 净EPC − cpcExpected。拒单率只有
 *    实测来源，没有就保持 null（不做扣减、不估 0），净EPC 等于 EPC。
 * 3. 排序键改成期望利润优先；没有 cpcExpected 时行为与旧版完全一致。
 *
 * 零条合格是合法输出，不硬凑。
 */
import { deriveCommissionPerSaleUsd } from "./offer-priority.js";

export const DEFAULT_LOOSE_MIN_COMMISSION_USD = 3;

/** 实测值可被采信的最小点击样本（低于此视为噪声，退回人工证据）。 */
export const DEFAULT_MIN_MEASURED_CLICKS = 50;

export type LooseStock = "in_stock" | "out_of_stock";
export type LooseTraffic = "winnable" | "not_winnable";
/** 证据来源：measured（投放实测）/ assumed（人工假设）/ unknown（无数据）。 */
export type LooseEvidenceSource = "measured" | "assumed" | "unknown";

/** 投放归档聚合出的实测指标（LaunchArchive）；字段缺失即为无实测。 */
export interface LooseMeasured {
  /** 实测 EPC（美元/点击）= 联盟收入 ÷ 点击数。 */
  epcUsd?: number | null;
  /** 实测转化率（百分数，2.5 表示 2.5%）= 转化数 ÷ 点击数 × 100。 */
  conversionRate?: number | null;
  /** 实测拒单率（0–1）：没有真实拒单记录时保持 null，绝不估。 */
  rejectionRate?: number | null;
  /** 实测样本量（点击数）：低于门槛不采信。 */
  clicks?: number | null;
}

export interface LooseScreenRow {
  id: string;
  name: string;
  brandName: string | null;
  category: string | null;
  destinationUrl: string;
  affiliateUrl: string | null;
  commissionValue: unknown;
  commissionType: string | null;
  avgPrice: unknown;
  /** 关联商品库商品（经 idempotencyKey 解析，无关联时全为 null）。 */
  productId: string | null;
  asin: string | null;
  productPrice: unknown;
  productReviewCount: number | null;
  /** 商品库费率（单位与写入方未必一致：仅 0 值用于零佣金判定，绝不用于展示）。 */
  productCommissionRate: unknown;
  /** 本轮显式证据：当季热销依据（用户填的文本；空 = 缺失）。 */
  seasonalEvidence: string | null;
  /** 本轮显式证据：库存状态（null = 未知）。 */
  stock: LooseStock | null;
  /** 本轮显式证据：评分 / 评论数 / 月销（null = 未知）。 */
  rating: number | null;
  reviewCount: number | null;
  monthlySales: number | null;
  /** 本轮显式证据：EPC（美元）/ 转化率（百分比），仅用于排序，null = 未知。 */
  epcUsd: number | null;
  conversionRate: number | null;
  /**
   * 投放实测（LaunchArchive 聚合）。给了且样本达标时优先于上面两项
   * 人工证据；null/缺省 = 无实测（退回人工证据）。
   */
  measured?: LooseMeasured | null;
  /** 目标 CPC（美元）：给出后才计算每点击期望利润。null/缺省 = 不参与。 */
  cpcExpected?: number | null;
  /** 本轮显式证据：低价流量判断（null = 未知）。 */
  lowPriceTraffic: LooseTraffic | null;
  /** 风险成本栏位：OfferPolicy 最新快照里 FORBIDDEN 的条款项，只展示。 */
  riskCost: string[];
}

export interface LooseScreenOptions {
  /** 单均佣金下限（美元），默认 3。 */
  minCommissionUsd?: number;
  /** 用户排除清单：品牌名（归一化后比对）。 */
  excludedBrands?: string[];
  /** 用户排除清单：品类（归一化后比对）。 */
  excludedCategories?: string[];
  /** 实测值可被采信的最小点击样本，默认 DEFAULT_MIN_MEASURED_CLICKS。 */
  minMeasuredClicks?: number;
}

/** 单条证据解析结果（实测优先，其次人工假设，都没有则 unknown）。 */
export interface ResolvedEvidence {
  epcUsd: number | null;
  conversionRate: number | null;
  rejectionRate: number | null;
  epcSource: LooseEvidenceSource;
  conversionSource: LooseEvidenceSource;
  /** 该条实际可用的实测样本量（无实测为 0）。 */
  measuredClicks: number;
  /** 净 EPC：扣掉实测拒单率；无拒单率数据时不扣减（保持 null 语义）。 */
  netEpcUsd: number | null;
  /** 每点击期望利润 = 净EPC − cpcExpected；缺任一项则为 null。 */
  profitPerClick: number | null;
}

export interface LooseScreenItem {
  offerId: string;
  name: string;
  brandName: string | null;
  category: string | null;
  asin: string | null;
  productId: string | null;
  price: number | null;
  commissionRate: number | null;
  commissionUsd: number;
  stock: LooseStock;
  rating: number | null;
  reviewCount: number | null;
  monthlySales: number | null;
  /** 当季热销依据（调用方提供的原文）。 */
  seasonalEvidence: string;
  /** 低价流量判断：winnable（有数据判可得）| unknown（无数据）。 */
  lowPriceTraffic: "winnable" | "unknown";
  epcUsd: number | null;
  conversionRate: number | null;
  /** 排序生效的 EPC 来自实测还是人工假设。 */
  epcSource: LooseEvidenceSource;
  conversionSource: LooseEvidenceSource;
  /** 实测样本量（点击数）；0 = 无实测。 */
  measuredClicks: number;
  /** 实测拒单率（0–1）；null = 无数据，未做扣减。 */
  rejectionRate: number | null;
  /** 净 EPC（扣拒单率后）。 */
  netEpcUsd: number | null;
  /** 每点击期望利润；null = 缺 CPC 或 EPC。 */
  profitPerClick: number | null;
  promoUrl: string;
  riskCost: string[];
}

export interface LooseScreenDropped {
  offerId: string;
  name: string;
  brandName: string | null;
  reasons: string[];
}

export interface LooseScreenResult {
  qualified: LooseScreenItem[];
  dropped: LooseScreenDropped[];
  counts: { qualified: number; dropped: number };
}

const norm = (s: string | null | undefined): string =>
  (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const num = (v: unknown): number | null =>
  v === null || v === undefined
    ? null
    : Number.isFinite(Number(v))
      ? Number(v)
      : null;

const money = (v: number): string =>
  `$${Number.isInteger(v) ? v : v.toFixed(2)}`;

/**
 * 佣金率（百分比数）推导，与 offer-prescreen 同口径：
 * offer-form 的 percentage/% 取原值；catalog-sync 的 PERCENT 由
 * 金额÷均价反推；FIXED 无费率（null）。商品库费率不用于展示。
 * 由 hot-picks 复用（同一口径，避免两处推导漂移）。
 */
export function commissionRatePct(row: LooseScreenRow): number | null {
  const value = num(row.commissionValue);
  const t = (row.commissionType ?? "").trim().toLowerCase();
  if (t === "percentage" || t === "%") return value;
  if (t === "percent") {
    const amount = deriveCommissionPerSaleUsd({
      commissionValue: row.commissionValue,
      commissionType: row.commissionType,
      avgPrice: row.avgPrice,
    });
    const price = num(row.avgPrice);
    if (amount != null && price != null && price > 0)
      return (amount / price) * 100;
  }
  return null;
}

/**
 * 解析一条 Offer 的有效证据：实测（样本达标）优先 → 人工假设 → unknown。
 *
 * 实测样本量低于门槛时**不采信**，退回人工证据；这样冷启动阶段不会
 * 因为 3 次点击的偶然 EPC 把排序打乱。拒单率没有实测就保持 null，
 * 不做扣减、不补 0——宁可少算利润，不编造数字。
 */
export function resolveEvidence(
  row: LooseScreenRow,
  options: LooseScreenOptions = {}
): ResolvedEvidence {
  const floor =
    options.minMeasuredClicks != null &&
    Number.isFinite(options.minMeasuredClicks)
      ? options.minMeasuredClicks
      : DEFAULT_MIN_MEASURED_CLICKS;

  const measured = row.measured ?? null;
  const measuredClicks = num(measured?.clicks) ?? 0;
  const measuredTrusted = measured != null && measuredClicks >= floor;

  const epcMeasured = measuredTrusted ? num(measured?.epcUsd) : null;
  const cvrMeasured = measuredTrusted ? num(measured?.conversionRate) : null;
  // 拒单率只认实测；样本不足也算没有。
  const rejectionRate = measuredTrusted ? num(measured?.rejectionRate) : null;

  const epcAssumed = num(row.epcUsd);
  const cvrAssumed = num(row.conversionRate);

  const epcUsd = epcMeasured ?? epcAssumed;
  const conversionRate = cvrMeasured ?? cvrAssumed;

  const epcSource: LooseEvidenceSource =
    epcMeasured != null ? "measured" : epcAssumed != null ? "assumed" : "unknown";
  const conversionSource: LooseEvidenceSource =
    cvrMeasured != null
      ? "measured"
      : cvrAssumed != null
        ? "assumed"
        : "unknown";

  const netEpcUsd =
    epcUsd == null ? null : epcUsd * (1 - (rejectionRate ?? 0));
  const cpc = num(row.cpcExpected);
  const profitPerClick =
    netEpcUsd != null && cpc != null ? netEpcUsd - cpc : null;

  return {
    epcUsd,
    conversionRate,
    rejectionRate,
    epcSource,
    conversionSource,
    measuredClicks: measuredTrusted ? measuredClicks : 0,
    netEpcUsd,
    profitPerClick,
  };
}

export function screenLooseOffers(
  rows: LooseScreenRow[],
  options: LooseScreenOptions = {}
): LooseScreenResult {
  const floor =
    options.minCommissionUsd != null &&
    Number.isFinite(options.minCommissionUsd)
      ? options.minCommissionUsd
      : DEFAULT_LOOSE_MIN_COMMISSION_USD;
  const excludedBrands = new Set(
    (options.excludedBrands ?? []).map((b) => norm(b)).filter(Boolean)
  );
  const excludedCategories = new Set(
    (options.excludedCategories ?? []).map((c) => norm(c)).filter(Boolean)
  );

  const passed: LooseScreenItem[] = [];
  const dropped: LooseScreenDropped[] = [];

  for (const row of rows) {
    const reasons: string[] = [];
    const evidence = resolveEvidence(row, options);
    const brand = norm(row.brandName);
    const category = norm(row.category);
    if (brand && excludedBrands.has(brand))
      reasons.push(`品牌排除（${row.brandName}）`);
    if (category && excludedCategories.has(category))
      reasons.push(`品类排除（${row.category}）`);

    const rate = commissionRatePct(row);
    const productRate = num(row.productCommissionRate);
    if (rate === 0 || productRate === 0) reasons.push("佣金率为零，直接排除");

    const amount = deriveCommissionPerSaleUsd({
      commissionValue: row.commissionValue,
      commissionType: row.commissionType,
      avgPrice: row.avgPrice,
    });
    if (amount == null) {
      reasons.push(`单均佣金未知，无法验证高于下限 ${money(floor)}`);
    } else if (amount <= floor) {
      reasons.push(`单均佣金 ${money(amount)} 不高于下限 ${money(floor)}`);
    }

    const seasonal = (row.seasonalEvidence ?? "").trim();
    if (!seasonal) reasons.push("当季热销依据缺失");

    if (row.stock === "out_of_stock") reasons.push("缺货");
    else if (row.stock !== "in_stock") reasons.push("库存未知");

    const reviewCount = row.reviewCount ?? row.productReviewCount;
    const demandParts: string[] = [];
    if (row.rating != null && row.rating > 0)
      demandParts.push(`评分 ${row.rating}`);
    if (reviewCount != null && reviewCount > 0)
      demandParts.push(`${reviewCount} 评论`);
    if (row.monthlySales != null && row.monthlySales > 0)
      demandParts.push(`月销 ${row.monthlySales}+`);
    if (demandParts.length === 0)
      reasons.push("无购买需求佐证（无评分、无评论、无销量）");

    if (row.lowPriceTraffic === "not_winnable")
      reasons.push("低价流量不可得");

    if (reasons.length > 0) {
      dropped.push({
        offerId: row.id,
        name: row.name,
        brandName: row.brandName,
        reasons,
      });
      continue;
    }
    // 到这里 amount 一定非 null（未知已在上面排除）。
    passed.push({
      offerId: row.id,
      name: row.name,
      brandName: row.brandName,
      category: row.category,
      asin: row.asin,
      productId: row.productId,
      price: num(row.avgPrice) ?? num(row.productPrice),
      commissionRate: rate,
      commissionUsd: amount as number,
      stock: "in_stock",
      rating: row.rating,
      reviewCount,
      monthlySales: row.monthlySales,
      seasonalEvidence: seasonal,
      lowPriceTraffic: row.lowPriceTraffic === "winnable" ? "winnable" : "unknown",
      epcUsd: evidence.epcUsd,
      conversionRate: evidence.conversionRate,
      epcSource: evidence.epcSource,
      conversionSource: evidence.conversionSource,
      measuredClicks: evidence.measuredClicks,
      rejectionRate: evidence.rejectionRate,
      netEpcUsd: evidence.netEpcUsd,
      profitPerClick: evidence.profitPerClick,
      promoUrl: row.affiliateUrl ?? row.destinationUrl,
      riskCost: [...row.riskCost],
    });
  }

  /* ── 同品牌只留一条：按单均佣金最高留（并列取 EPC 高者，再并列取先者） ── */
  const keptByBrand = new Map<string, LooseScreenItem>();
  const kept: LooseScreenItem[] = [];
  for (const item of passed) {
    const key = norm(item.brandName);
    if (!key) {
      kept.push(item);
      continue;
    }
    const prev = keptByBrand.get(key);
    if (!prev) {
      keptByBrand.set(key, item);
      kept.push(item);
      continue;
    }
    const better =
      item.commissionUsd > prev.commissionUsd ||
      (item.commissionUsd === prev.commissionUsd &&
        (item.epcUsd ?? -1) > (prev.epcUsd ?? -1));
    if (better) {
      keptByBrand.set(key, item);
      const idx = kept.indexOf(prev);
      kept[idx] = item;
      dropped.push({
        offerId: prev.offerId,
        name: prev.name,
        brandName: prev.brandName,
        reasons: [
          `同品牌只留一条（本品牌保留「${item.name}」，单均佣金 ${money(item.commissionUsd)}）`,
        ],
      });
    } else {
      dropped.push({
        offerId: item.offerId,
        name: item.name,
        brandName: item.brandName,
        reasons: [
          `同品牌只留一条（本品牌保留「${prev.name}」，单均佣金 ${money(prev.commissionUsd)}）`,
        ],
      });
    }
  }

  /* ── 排序：期望利润 → EPC → 单均佣金 → 转化率，未知排后 ──
   * 未给 cpcExpected 时期望利润全为 null，此键不产生区分，
   * 排序与原口径（EPC → 佣金 → 转化率）完全一致。 */
  const descNullsLast = (a: number | null, b: number | null): number => {
    if (a !== null && b !== null && a !== b) return b - a;
    if (a !== null && b === null) return -1;
    if (a === null && b !== null) return 1;
    return 0;
  };
  kept.sort(
    (a, b) =>
      descNullsLast(a.profitPerClick, b.profitPerClick) ||
      descNullsLast(a.epcUsd, b.epcUsd) ||
      descNullsLast(a.commissionUsd, b.commissionUsd) ||
      descNullsLast(a.conversionRate, b.conversionRate)
  );

  return {
    qualified: kept,
    dropped,
    counts: { qualified: kept.length, dropped: dropped.length },
  };
}
