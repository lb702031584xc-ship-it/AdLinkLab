/**
 * 广告数分档（品牌 + 国家观测口径，前后端共用唯一来源）。
 *
 * 口径声明：这里的广告数是按品牌+国家在 Google SERP 数到的付费广告条数，
 * 不是 Google 拍卖里的竞价者数量。分档只是经验判断标签，不构成硬性规则：
 * 一键筛选的广告数层 pass 逻辑仍是 >= 1，分档不新增任何硬杀。
 *
 * - 0      → none      无人投放
 * - 1–5    → small     小规模在投
 * - 6–20   → sweet     稳定投放·甜蜜点
 * - 21–50  → hot       竞争较热
 * - 51+    → red_ocean 红海
 */

export type AdCountTierKey = "none" | "small" | "sweet" | "hot" | "red_ocean";

export interface AdCountTier {
  key: AdCountTierKey;
  /** 含下限。 */
  min: number;
  /** 含上限；null = 无上限。 */
  max: number | null;
}

export const AD_COUNT_TIERS: readonly AdCountTier[] = [
  { key: "none", min: 0, max: 0 },
  { key: "small", min: 1, max: 5 },
  { key: "sweet", min: 6, max: 20 },
  { key: "hot", min: 21, max: 50 },
  { key: "red_ocean", min: 51, max: null },
] as const;

/** 甜蜜点快捷筛选区间（与分档 sweet 的上界对齐，下界 = 有人投）。 */
export const AD_COUNT_SWEET_SPOT = { min: 1, max: 20 } as const;

/**
 * 广告数 → 分档。null/undefined/负数/非有限数 → null（未计算/未知，不冒充分档）。
 */
export function adCountTier(
  adCount: number | null | undefined
): AdCountTier | null {
  if (typeof adCount !== "number" || !Number.isFinite(adCount)) return null;
  const n = Math.floor(adCount);
  if (n < 0) return null;
  for (const tier of AD_COUNT_TIERS) {
    if (n >= tier.min && (tier.max === null || n <= tier.max)) return tier;
  }
  return null;
}

/** 分档分布计数（一键筛选报告用）：未知（null）不计入任何档。 */
export type AdCountTierDistribution = Record<AdCountTierKey, number>;

export function adCountTierDistribution(
  counts: Array<number | null | undefined>
): AdCountTierDistribution {
  const dist: AdCountTierDistribution = {
    none: 0,
    small: 0,
    sweet: 0,
    hot: 0,
    red_ocean: 0,
  };
  for (const c of counts) {
    const tier = adCountTier(c);
    if (tier) dist[tier.key] += 1;
  }
  return dist;
}
