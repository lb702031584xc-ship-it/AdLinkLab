/**
 * 商品库挑选器（2026-10-28，纯函数）。
 *
 * 把「商品库（几百个候选）」筛成「Offer 列表（几个到十几个）」。
 *
 * 顺序（每条都不可省的硬规则）：
 *   1. 单笔佣金低于门槛           → 砍（付不起任何点击）
 *   2. 保本 CPC 低于类目 CPC      → 砍（数学上不可能赚）
 *   3. 缺货                        → 砍
 *   4. 同品牌按 payout 只留最高   → 其余砍（预算集中 + 归属清晰）
 *
 * 为什么品牌去重放在这里而不是初筛：
 *   初筛时 Offer 已经建好、占位、算过一遍；此时再去重等于白算。
 *   而且 PB / Amazon 的品牌 ID 是共享的（VEVOR = 136533），
 *   同品牌多个 Offer 会互相抢预算、把 Brand Halo 的归属搅混。
 *
 * 关键纪律：**按 payout 留最优，不是随便留一个。**
 *   同一品牌下 Chamber Sealer（$26）和 Diesel Heater（$9.53）差 2.7 倍，
 *   随机留一个有一半概率留错。
 */
export interface CatalogCandidate {
  productId: string;
  name: string;
  brand: string | null;
  /** 商品价（美元）。 */
  priceUsd: number | null;
  /** 单笔佣金（美元）；null = 未知。 */
  payoutUsd: number | null;
  /** 库存：false = 缺货，null = 未知（不据此砍）。 */
  inStock?: boolean | null;
  /** 投放国家（US / DE …）；选品时和佣金一起看。 */
  countryCode?: string | null;
}

export interface PickOptions {
  /** 单笔佣金下限（美元）。默认 12：低于此只能打极便宜的品牌词。 */
  minPayoutUsd?: number;
  /** 类目 CPC 中位数（美元）；给了才做保本可行性判断。 */
  categoryCpcUsd?: number | null;
  targetCvrPct?: number;
  rejectionRate?: number;
  refundRate?: number;
  /** 每个品牌保留几个。默认 1。 */
  perBrand?: number;
  /** 最终上限。默认 50。 */
  limit?: number;
}

export type PickDropCode =
  | "PAYOUT_UNKNOWN"
  | "BELOW_MIN_PAYOUT"
  | "CANNOT_COVER_CPC"
  | "OUT_OF_STOCK"
  | "BRAND_DEDUP"
  | "OVER_LIMIT";

export interface PickedItem {
  productId: string;
  name: string;
  brand: string | null;
  /** 页面上的佣金（最高款）。 */
  payoutUsd: number;
  /** 预期每单佣金 = 页面佣金 × 折损系数；保本 CPC 用它算。 */
  expectedPayoutUsd: number;
  /** 按目标 CVR 与「预期佣金」算出的保本 CPC（美元/点击）。 */
  breakevenCpcUsd: number;
  countryCode: string | null;
  note: string;
}

export interface DroppedItem {
  productId: string;
  name: string;
  brand: string | null;
  code: PickDropCode;
  reason: string;
}

export interface PickResult {
  picked: PickedItem[];
  dropped: DroppedItem[];
  counts: { total: number; picked: number; dropped: number };
  summary: {
    /** 砍掉最多的原因，用于告诉用户"这批货为什么进不来"。 */
    topDropCode: PickDropCode | null;
    topDropCount: number;
  };
  notes: string[];
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round4 = (n: number) => Math.round(n * 10000) / 10000;

export const DEFAULT_MIN_PAYOUT_USD = 12;
/**
 * 预期佣金折损系数。
 * 推的是佣金最高的款，但顾客常买便宜变体，或走 Brand Halo 买别的款。
 * 实测：推 $26 的封口机，两单平均 $17.77（68%），用推广款佣金算保本线
 * 会系统性偏乐观。0.6 是保守值。
 */
export const EXPECTED_PAYOUT_FACTOR = 0.6;
export const DEFAULT_TARGET_CVR_PCT = 2.5;
export const DEFAULT_REJECTION = 0.15;
export const DEFAULT_REFUND = 0.05;

export function pickFromCatalog(
  candidates: CatalogCandidate[],
  opts: PickOptions = {}
): PickResult {
  const minPayout = opts.minPayoutUsd ?? DEFAULT_MIN_PAYOUT_USD;
  const cvr = clamp(opts.targetCvrPct ?? DEFAULT_TARGET_CVR_PCT, 0.1, 100);
  const rejection = clamp(opts.rejectionRate ?? DEFAULT_REJECTION, 0, 1);
  const refund = clamp(opts.refundRate ?? DEFAULT_REFUND, 0, 1);
  const categoryCpc = num(opts.categoryCpcUsd);
  const perBrand = Math.max(1, Math.floor(opts.perBrand ?? 1));
  const limit = Math.max(1, Math.floor(opts.limit ?? 50));

  const dropped: DroppedItem[] = [];
  const survivors: PickedItem[] = [];

  const drop = (
    c: CatalogCandidate,
    code: PickDropCode,
    reason: string
  ) => {
    dropped.push({
      productId: c.productId,
      name: c.name,
      brand: c.brand,
      code,
      reason,
    });
  };

  for (const c of candidates) {
    const payout = num(c.payoutUsd);
    if (payout == null) {
      drop(c, "PAYOUT_UNKNOWN", "单笔佣金未知，无法判断能不能赚");
      continue;
    }
    if (payout < minPayout) {
      drop(
        c,
        "BELOW_MIN_PAYOUT",
        `单笔佣金 $${payout.toFixed(2)} 低于门槛 $${minPayout}：付不起目标类目的点击成本`
      );
      continue;
    }
    if (c.inStock === false) {
      drop(c, "OUT_OF_STOCK", "缺货");
      continue;
    }

    const expectedPayout = payout * EXPECTED_PAYOUT_FACTOR;
    const breakeven = round4(
      expectedPayout * (1 - rejection) * (1 - refund) * (cvr / 100)
    );
    if (categoryCpc != null && categoryCpc > 0 && breakeven < categoryCpc) {
      drop(
        c,
        "CANNOT_COVER_CPC",
        `保本 CPC $${breakeven.toFixed(2)} 低于类目 CPC $${categoryCpc.toFixed(2)}：按 ${cvr}% 转化率无法覆盖点击成本`
      );
      continue;
    }

    survivors.push({
      productId: c.productId,
      name: c.name,
      brand: c.brand,
      payoutUsd: payout,
      expectedPayoutUsd: Math.round(expectedPayout * 100) / 100,
      breakevenCpcUsd: breakeven,
      countryCode: c.countryCode ?? null,
      note: `保本 CPC ${breakeven.toFixed(2)}`,
    });
  }

  // 品牌去重：同品牌按 payout 降序只留前 N 个。
  // 品牌为空的各自独立，不参与去重（与全站口径一致）。
  survivors.sort((a, b) => b.payoutUsd - a.payoutUsd);
  const brandCount = new Map<string, number>();
  const picked: PickedItem[] = [];
  for (const s of survivors) {
    const key = (s.brand ?? "").trim().toLowerCase();
    if (!key) {
      picked.push(s);
      continue;
    }
    const used = brandCount.get(key) ?? 0;
    if (used >= perBrand) {
      dropped.push({
        productId: s.productId,
        name: s.name,
        brand: s.brand,
        code: "BRAND_DEDUP",
        reason: `同品牌已保留更高 payout 的款（本品牌限 ${perBrand} 个）`,
      });
      continue;
    }
    brandCount.set(key, used + 1);
    picked.push(s);
  }

  picked.sort((a, b) => b.payoutUsd - a.payoutUsd);
  const overLimit = picked.slice(limit);
  for (const o of overLimit) {
    dropped.push({
      productId: o.productId,
      name: o.name,
      brand: o.brand,
      code: "OVER_LIMIT",
      reason: `超出上限 ${limit} 条，未进入 Offer 列表`,
    });
  }
  const finalPicked = picked.slice(0, limit);

  // 统计砍掉最多的原因，直接告诉用户"这批货为什么进不来"。
  const byCode = new Map<PickDropCode, number>();
  for (const d of dropped) byCode.set(d.code, (byCode.get(d.code) ?? 0) + 1);
  let topDropCode: PickDropCode | null = null;
  let topDropCount = 0;
  for (const [code, n] of byCode) {
    if (n > topDropCount) {
      topDropCode = code;
      topDropCount = n;
    }
  }

  const notes: string[] = [];
  if (candidates.length === 0) {
    notes.push("商品库为空：先同步商品再挑");
  } else if (finalPicked.length === 0) {
    notes.push(
      topDropCode === "BELOW_MIN_PAYOUT"
        ? `全部被佣金门槛砍掉：这批商品的单笔佣金普遍低于 $${minPayout}，建议换更高客单的品类`
        : topDropCode === "CANNOT_COVER_CPC"
          ? "全部被保本可行性砍掉：佣金覆盖不了类目 CPC，换 offer 比调出价有用"
          : "没有符合条件的商品"
    );
  } else {
    notes.push(
      `从 ${candidates.length} 个商品里挑出 ${finalPicked.length} 个，砍掉 ${dropped.length} 个`
    );
    if (topDropCode) notes.push(`砍掉最多的原因：${topDropCode}（${topDropCount} 个）`);
  }

  return {
    picked: finalPicked,
    dropped,
    counts: {
      total: candidates.length,
      picked: finalPicked.length,
      dropped: dropped.length,
    },
    summary: { topDropCode, topDropCount },
    notes,
  };
}
