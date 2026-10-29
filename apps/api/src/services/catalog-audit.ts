/**
 * 全站体检（2026-10-29，纯函数）。
 *
 * 把「整个联盟抓下来的所有商品」一次性判定成可投清单：
 *   推断类目 → 取该类目 CPC 基线 → 按保本可行性筛 → 同品牌去重 → 按佣金排序
 *
 * 为什么必须按类目取基线：全站跨十几个类目（宠物/GPS/补充剂/家电），
 * 用一个 CPC 判所有商品会把整类冤枉死。取不到极目样本时退到全站中位数，
 * 并把来源标出来——**不编造类目 CPC**。
 */
import { pickFromCatalog, type CatalogCandidate, type PickedItem } from "./catalog-pick.js";
import { resolveCpcBaseline, type CpcSample } from "./cpc-baseline.js";

export interface AuditProduct {
  productId: string;
  name: string;
  brand: string | null;
  priceUsd: number | null;
  payoutUsd: number | null;
  reviewCount?: number | null;
  inStock?: boolean | null;
  countryCode?: string | null;
}

/** 类目推断用的关键词表（顺序即优先级）。 */
const CATEGORY_RULES: Array<{ cat: string; words: string[] }> = [
  { cat: "pet", words: ["cat", "dog", "litter", "pet", "puppy", "kitten"] },
  { cat: "gps", words: ["gps", "tracker", "tracking", "geofence"] },
  {
    cat: "supplement",
    words: ["vitamin", "supplement", "capsule", "gummies", "protein", "collagen", "probiotic", "creatine", "omega"],
  },
  { cat: "appliance", words: ["purifier", "vacuum", "heater", "sealer", "fan", "humidifier", "dehumidifier"] },
  { cat: "outdoor", words: ["blanket", "tent", "chair", "table", "patio", "umbrella"] },
  { cat: "beauty", words: ["serum", "cream", "skincare", "shampoo", "lip", "massager"] },
  { cat: "fitness", words: ["treadmill", "dumbbell", "yoga", "resistance", "vibration plate"] },
];

export function inferCategory(name: string): string {
  const n = (name ?? "").toLowerCase();
  for (const r of CATEGORY_RULES) {
    if (r.words.some((w) => n.includes(w))) return r.cat;
  }
  return "other";
}

export interface AuditOptions {
  /** 每类目的 CPC 样本（来自历史投放）。 */
  cpcSamples?: CpcSample[];
  /** 类目样本不足时用的假定 CPC（美元）；不给则该类不判「覆盖不了」。 */
  assumedCpcUsd?: number | null;
  minPayoutUsd?: number;
  minReviews?: number;
  perBrand?: number;
}

export interface AuditedItem extends PickedItem {
  category: string;
  /** CPC 基线来源：exact / global / assumed。 */
  baselineSource: string;
  cpcUsd: number;
}

export interface AuditResult {
  picked: AuditedItem[];
  dropped: Array<{ productId: string; name: string; category: string; reason: string }>;
  counts: { total: number; picked: number; dropped: number; categories: number };
  notes: string[];
}

/**
 * 全站体检：按类目分组判定，最后合并成一张按佣金降序的清单。
 */
export function auditCatalog(
  products: AuditProduct[],
  opts: AuditOptions = {}
): AuditResult {
  const samples = opts.cpcSamples ?? [];
  const minPayout = opts.minPayoutUsd ?? 12;
  const minReviews = opts.minReviews ?? 0;
  const perBrand = opts.perBrand ?? 1;

  const groups = new Map<string, AuditProduct[]>();
  for (const p of products) {
    const cat = inferCategory(p.name);
    const arr = groups.get(cat) ?? [];
    arr.push(p);
    groups.set(cat, arr);
  }

  const picked: AuditedItem[] = [];
  const dropped: AuditResult["dropped"] = [];
  const notes: string[] = [];

  for (const [cat, items] of groups) {
    const baseline = resolveCpcBaseline(samples, {
      category: cat,
      assumedCpcUsd: opts.assumedCpcUsd ?? null,
    });

    const candidates: CatalogCandidate[] = items.map((p) => ({
      productId: p.productId,
      name: p.name,
      brand: p.brand,
      priceUsd: p.priceUsd,
      payoutUsd: p.payoutUsd,
      inStock: p.inStock ?? null,
      countryCode: p.countryCode ?? null,
    }));

    const r = pickFromCatalog(candidates, {
      minPayoutUsd: minPayout,
      perBrand,
      // 基线为 0（完全没数据）时不传，避免用 0 当门槛把所有商品判死
      categoryCpcUsd: baseline.cpcUsd > 0 ? baseline.cpcUsd : null,
    });

    for (const p of r.picked) {
      picked.push({
        ...p,
        category: cat,
        baselineSource: baseline.source,
        cpcUsd: baseline.cpcUsd,
      });
    }
    for (const d of r.dropped) {
      dropped.push({ productId: d.productId, name: d.name, category: cat, reason: d.reason });
    }

    if (baseline.source !== "exact") {
      notes.push(
        `${cat}：该类目没有足够历史 CPC 样本，用 ${baseline.source} 推算（置信度 ${baseline.confidence}）`
      );
    }
  }

  // 评论数低于门槛的单独剔除（pickFromCatalog 不管评论）
  const filtered = minReviews > 0
    ? picked.filter((p) => {
        const src = products.find((x) => x.productId === p.productId);
        const rc = src?.reviewCount ?? null;
        if (rc != null && rc < minReviews) {
          dropped.push({
            productId: p.productId,
            name: p.name,
            category: p.category,
            reason: `评论 ${rc} 低于门槛 ${minReviews}，转化大概率跑不动`,
          });
          return false;
        }
        return true;
      })
    : picked;

  filtered.sort((a, b) => b.payoutUsd - a.payoutUsd);

  return {
    picked: filtered,
    dropped,
    counts: {
      total: products.length,
      picked: filtered.length,
      dropped: dropped.length,
      categories: groups.size,
    },
    notes,
  };
}
