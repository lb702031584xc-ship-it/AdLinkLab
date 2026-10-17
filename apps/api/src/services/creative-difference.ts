/**
 * P1-12：创意差异度（API 侧，与 web/lib/creative-difference.ts 同一口径）。
 * difference = 1 − Jaccard(tokensA, tokensB)；≥0.5 足够做 A/B；<0.5 警告（非拦截）。
 */

export const MIN_CREATIVE_DIFFERENCE = 0.5;

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
