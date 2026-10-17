/**
 * P1-12：创意差异度（纯函数；token-Jaccard）。
 *
 * difference = 1 − Jaccard(tokensA, tokensB)，0–1。
 * - ≥ 0.5：差异足够（可用于 A/B）。
 * - < 0.5：差异不足，建议重新生成（非拦截警告）。
 * 边界：一组 ADS 内同一广告反复投 = 滥用（禁止）；同一 ADS 内 3 个创意做 A/B
 * 允许，前提差异度 ≥ 50%。
 */

export function tokenizeCreative(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function creativeDifference(a: string, b: string): number {
  const sa = new Set(tokenizeCreative(a));
  const sb = new Set(tokenizeCreative(b));
  if (sa.size === 0 && sb.size === 0) return 0;
  if (sa.size === 0 || sb.size === 0) return 1;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const jaccard = inter / (sa.size + sb.size - inter);
  return Math.round((1 - jaccard) * 1000) / 1000;
}

/** A/B 创意差异度最低要求（0.5 = 50%）。 */
export const MIN_CREATIVE_DIFFERENCE = 0.5;

export function creativeDifferenceSufficient(diff: number): boolean {
  return diff >= MIN_CREATIVE_DIFFERENCE;
}

/**
 * 同一 ADS 内创意数量合规检查：
 * - 同一广告（差异度 ≈ 0）反复投 → abuse（禁止）。
 * - 3 个创意做 A/B：每对差异度 ≥ 0.5 才合规。
 */
export function checkAdGroupCreatives(
  creatives: string[]
): { ok: boolean; reason: string } {
  for (let i = 0; i < creatives.length; i++) {
    for (let j = i + 1; j < creatives.length; j++) {
      const diff = creativeDifference(creatives[i]!, creatives[j]!);
      if (diff < 0.01) {
        return { ok: false, reason: "同一广告反复投放同一 ADS 属于滥用（禁止）" };
      }
    }
  }
  if (creatives.length >= 3) {
    for (let i = 0; i < creatives.length; i++) {
      for (let j = i + 1; j < creatives.length; j++) {
        if (creativeDifference(creatives[i]!, creatives[j]!) < MIN_CREATIVE_DIFFERENCE) {
          return {
            ok: false,
            reason: "3 创意 A/B 要求每对差异度 ≥ 50%，请重新生成差异更大的创意",
          };
        }
      }
    }
  }
  return { ok: true, reason: "合规" };
}
