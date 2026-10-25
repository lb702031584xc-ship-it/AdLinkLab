/**
 * 可能热销推荐（hot picks）：原有选品流程（默认一键初筛）的附加输出。
 *
 * 本模块是纯函数（不碰 Prisma、不写回 Offer、不改变初筛 verdict）：
 * 调用方把 Offer 行、关联商品库数据与本轮显式证据拼成行传进来，
 * 返回跨品类的热销推荐榜。原有筛选逻辑、默认行为一律不受影响，
 * 推荐榜与通过/排除结论并存、不互相覆盖。
 *
 * 不管品类：推荐不按品类过滤、不做品类排除，跨品类按热销潜力
 * 排序。唯一生效的排除是用户显式排除清单（品牌、品类），那是
 * 用户的决定，不是品类过滤。
 *
 * 入选（缺一项即不推荐，只计入 counts，不逐条列出）：
 * 1. 用户排除清单（品牌、品类）原样执行；
 * 2. 佣金率为零不推荐（Offer 费率或商品库费率任一为 0）；
 * 3. 单均佣金算不出不推荐（推荐理由必须有具体数值）；
 * 4. 无依据不推荐：评论数、月销、评分、当季热销依据任一大于
 *    零/非空才算有依据；模型里没有的信号走调用方显式输入，
 *    无输入标 unknown，绝不编造。
 *
 * 条款禁令（SEM / 品牌词 / 直链）只进 riskCost 栏展示：调用方把
 * OfferPolicy 快照里的 FORBIDDEN 项拼进 row.riskCost，本模块原样
 * 透传，不参与推荐、不降权（与基线松绑一致）。
 *
 * 排序（热销潜力，需求与热销证据在前、其次佣金）：
 * 月销降序 → 评论数降序 → 评分降序 → 单均佣金降序，
 * 每键未知排后；全等时保持输入顺序。
 *
 * 同一品牌只推荐一款（用户追加规则，与宽松型一品牌一条同向）：
 * 按上述排序取每品牌首位，其余同品牌款进 droppedByBrand 并写明
 * 本品牌保留了哪款；品牌名为空的不参与去重。
 *
 * 原初筛结论打标：每条推荐附 prescreenVerdict 与 verdictNote。
 * 未通过原筛选但进榜的写明原因——推荐仅供人工复核，绝不改变
 * 原判停/待复核结论。
 *
 * 零条推荐是合法输出，不硬凑。
 */
import { deriveCommissionPerSaleUsd } from "./offer-priority.js";
import {
  commissionRatePct,
  type LooseScreenRow,
} from "./loose-screen.js";

export interface HotPickRow extends LooseScreenRow {
  /** 原一键初筛结论（调用方从 outcomes 传入；缺失时 verdictNote 为空）。 */
  prescreenVerdict?: "go" | "unknown" | "stop";
  /** 原一键初筛原因（用于 verdictNote）。 */
  prescreenReason?: string;
}

export interface HotPickOptions {
  /** 用户排除清单：品牌名（归一化后比对）。 */
  excludedBrands?: string[];
  /** 用户排除清单：品类（归一化后比对）。 */
  excludedCategories?: string[];
}

export interface HotPick {
  offerId: string;
  name: string;
  brandName: string | null;
  category: string | null;
  asin: string | null;
  productId: string | null;
  price: number | null;
  commissionRate: number | null;
  commissionUsd: number;
  rating: number | null;
  reviewCount: number | null;
  monthlySales: number | null;
  /** 当季热销依据（调用方提供的原文；无则为空串）。 */
  seasonalEvidence: string;
  promoUrl: string;
  riskCost: string[];
  /** 推荐理由：全部由具体数值/原文构成，无依据的条不会出现在这里。 */
  reasons: string[];
  /** 原一键初筛结论（调用方传入；缺失为 null）。 */
  prescreenVerdict: "go" | "unknown" | "stop" | null;
  /** 原结论打标：通过/待复核/判停的说明；判停进榜时写明推荐不改变结论。 */
  verdictNote: string;
}

export interface HotPickDroppedByBrand {
  offerId: string;
  name: string;
  brandName: string | null;
  reasons: string[];
}

export interface HotPickResult {
  picks: HotPick[];
  droppedByBrand: HotPickDroppedByBrand[];
  counts: { picks: number; droppedByBrand: number; notRecommended: number };
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

function verdictNoteOf(
  verdict: "go" | "unknown" | "stop" | null,
  reason: string
): string {
  if (verdict === "go") return "原初筛通过";
  if (verdict === "unknown")
    return reason ? `原初筛待复核：${reason}` : "原初筛待复核";
  if (verdict === "stop")
    return reason
      ? `原初筛判停（${reason}），推荐仅供人工复核，不改变判停结论`
      : "原初筛判停，推荐仅供人工复核，不改变判停结论";
  return "";
}

export function rankHotPicks(
  rows: HotPickRow[],
  options: HotPickOptions = {}
): HotPickResult {
  const excludedBrands = new Set(
    (options.excludedBrands ?? []).map((b) => norm(b)).filter(Boolean)
  );
  const excludedCategories = new Set(
    (options.excludedCategories ?? []).map((c) => norm(c)).filter(Boolean)
  );

  const candidates: HotPick[] = [];
  let notRecommended = 0;

  for (const row of rows) {
    const brand = norm(row.brandName);
    const category = norm(row.category);
    if (brand && excludedBrands.has(brand)) {
      notRecommended += 1;
      continue;
    }
    if (category && excludedCategories.has(category)) {
      notRecommended += 1;
      continue;
    }

    const rate = commissionRatePct(row);
    const productRate = num(row.productCommissionRate);
    if (rate === 0 || productRate === 0) {
      notRecommended += 1;
      continue;
    }

    const amount = deriveCommissionPerSaleUsd({
      commissionValue: row.commissionValue,
      commissionType: row.commissionType,
      avgPrice: row.avgPrice,
    });
    if (amount == null) {
      notRecommended += 1;
      continue;
    }

    const reviewCount = row.reviewCount ?? row.productReviewCount;
    const seasonal = (row.seasonalEvidence ?? "").trim();
    const reasons: string[] = [];
    if (row.monthlySales != null && row.monthlySales > 0)
      reasons.push(`月销 ${row.monthlySales}+`);
    if (reviewCount != null && reviewCount > 0)
      reasons.push(`${reviewCount} 评论`);
    if (row.rating != null && row.rating > 0)
      reasons.push(`评分 ${row.rating}`);
    if (seasonal) reasons.push(`当季热销依据：${seasonal}`);
    reasons.push(`单均佣金 ${money(amount)}`);
    // 除佣金外没有任何依据 → 不推荐（佣金本身不是热销证据）。
    if (reasons.length <= 1) {
      notRecommended += 1;
      continue;
    }

    const verdict = row.prescreenVerdict ?? null;
    candidates.push({
      offerId: row.id,
      name: row.name,
      brandName: row.brandName,
      category: row.category,
      asin: row.asin,
      productId: row.productId,
      price: num(row.avgPrice) ?? num(row.productPrice),
      commissionRate: rate,
      commissionUsd: amount,
      rating: row.rating,
      reviewCount,
      monthlySales: row.monthlySales,
      seasonalEvidence: seasonal,
      promoUrl: row.affiliateUrl ?? row.destinationUrl,
      riskCost: [...row.riskCost],
      reasons,
      prescreenVerdict: verdict,
      verdictNote: verdictNoteOf(verdict, (row.prescreenReason ?? "").trim()),
    });
  }

  /* ── 排序：月销 → 评论数 → 评分 → 单均佣金，全部降序、未知排后 ── */
  const descNullsLast = (a: number | null, b: number | null): number => {
    if (a !== null && b !== null && a !== b) return b - a;
    if (a !== null && b === null) return -1;
    if (a === null && b !== null) return 1;
    return 0;
  };
  candidates.sort(
    (a, b) =>
      descNullsLast(a.monthlySales, b.monthlySales) ||
      descNullsLast(a.reviewCount, b.reviewCount) ||
      descNullsLast(a.rating, b.rating) ||
      descNullsLast(a.commissionUsd, b.commissionUsd)
  );

  /* ── 同一品牌只推荐一款：排序后每品牌首位胜出 ── */
  const picks: HotPick[] = [];
  const droppedByBrand: HotPickDroppedByBrand[] = [];
  const seenBrands = new Set<string>();
  for (const item of candidates) {
    const key = norm(item.brandName);
    if (!key) {
      picks.push(item);
      continue;
    }
    if (seenBrands.has(key)) {
      const kept = picks.find((p) => norm(p.brandName) === key);
      droppedByBrand.push({
        offerId: item.offerId,
        name: item.name,
        brandName: item.brandName,
        reasons: [
          kept
            ? `同品牌只推荐一款（本品牌保留「${kept.name}」）`
            : "同品牌只推荐一款",
        ],
      });
      continue;
    }
    seenBrands.add(key);
    picks.push(item);
  }

  return {
    picks,
    droppedByBrand,
    counts: {
      picks: picks.length,
      droppedByBrand: droppedByBrand.length,
      notRecommended,
    },
  };
}
