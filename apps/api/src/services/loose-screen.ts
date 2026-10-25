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
 * 排序（松绑口径）：EPC 降序 → 单均佣金降序 → 转化率降序，
 * 每键未知排后；全等时保持输入顺序。
 *
 * 零条合格是合法输出，不硬凑。
 */
import { deriveCommissionPerSaleUsd } from "./offer-priority.js";

export const DEFAULT_LOOSE_MIN_COMMISSION_USD = 3;

export type LooseStock = "in_stock" | "out_of_stock";
export type LooseTraffic = "winnable" | "not_winnable";

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
      epcUsd: row.epcUsd,
      conversionRate: row.conversionRate,
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

  /* ── 排序：EPC 降序 → 单均佣金降序 → 转化率降序，未知排后 ── */
  const descNullsLast = (a: number | null, b: number | null): number => {
    if (a !== null && b !== null && a !== b) return b - a;
    if (a !== null && b === null) return -1;
    if (a === null && b !== null) return 1;
    return 0;
  };
  kept.sort(
    (a, b) =>
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
