/**
 * 关键词质量工具（2026-10-28，纯函数）。
 *
 * 两件互相独立、但都属于「关键词这一层」的事：
 *
 * 1. messageMatch：关键词 ↔ 落地页标题/H1 的一致性。
 *    这是质量分的核心输入，也是新手最常忽略的一环——
 *    投 "best air purifier for pet hair"，落地页写「空气净化器」，
 *    相关性低 → 质量分低 → 同样出价拿不到同样位置 → 只能加价。
 *
 * 2. suggestNegatives：从搜索词报告里挑出该加否定的词。
 *    判据只用一条：花了钱、有足够点击、零转化。不猜意图、不猜行业。
 *
 * 两个函数都不调外部服务、不写库。
 */

/* ───────────────────────── 1. message match ───────────────────────── */

export interface MessageMatchInput {
  keyword: string;
  pageTitle?: string | null;
  /** 页面 H1（比 title 更能反映真实主张）。 */
  pageH1?: string | null;
}

export type MessageMatchVerdict = "good" | "weak" | "poor" | "unknown";

export interface MessageMatchResult {
  /** 关键词核心词被页面覆盖的比例（0–1）。 */
  score: number | null;
  matched: string[];
  missing: string[];
  verdict: MessageMatchVerdict;
  advice: string;
}

/** 修饰词不进核心词表：它们决定意图，但落地页不需要逐字复现。 */
const STOPWORDS = new Set([
  "a", "an", "the", "for", "with", "and", "of", "to", "in", "on", "at", "by",
  "best", "top", "buy", "cheap", "price", "prices", "near", "me", "coupon",
  "coupons", "review", "reviews", "vs", "or", "is", "are", "how", "what",
]);

export function coreTokens(text: string): string[] {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

const uniq = (xs: string[]) => [...new Set(xs)];

export function checkMessageMatch(input: MessageMatchInput): MessageMatchResult {
  const page = `${input.pageTitle ?? ""} ${input.pageH1 ?? ""}`.trim();
  const tokens = uniq(coreTokens(input.keyword));

  if (!page) {
    return {
      score: null,
      matched: [],
      missing: tokens,
      verdict: "unknown",
      advice: "没有页面标题/H1，无法判断一致性——先补落地页信息",
    };
  }
  if (tokens.length === 0) {
    return {
      score: null,
      matched: [],
      missing: [],
      verdict: "unknown",
      advice: "关键词里没有可比较的核心词（全是修饰词），无法判断",
    };
  }

  const pageTokens = new Set(coreTokens(page));
  const matched = tokens.filter((t) => pageTokens.has(t));
  const missing = tokens.filter((t) => !pageTokens.has(t));
  const score = matched.length / tokens.length;

  const verdict: MessageMatchVerdict =
    score >= 0.8 ? "good" : score >= 0.5 ? "weak" : "poor";

  const advice =
    verdict === "good"
      ? "关键词与落地页一致，质量分不会因此被扣"
      : verdict === "weak"
        ? `落地页缺少：${missing.join("、")}——把这些词写进标题或 H1，同样的出价能拿到更好位置`
        : `落地页几乎不覆盖关键词（缺：${missing.join("、")}）——广告相关性会很低，必须先改页面再投`;

  return { score, matched, missing, verdict, advice };
}

/* ───────────────────────── 2. 否词建议 ───────────────────────── */

export interface SearchTermRow {
  term: string;
  clicks: number;
  conversions: number;
  spendUsd: number;
}

export interface NegativeSuggestion {
  term: string;
  /** 建议匹配类型：默认精确否定，避免误伤。 */
  matchType: "exact";
  reason: string;
  wastedUsd: number;
}

export interface NegativeSuggesterOptions {
  /** 参与判定的最小点击（默认 20）：样本太小不判。 */
  minClicks?: number;
  /** 可忽略的最小花费（默认 0）。 */
  minSpendUsd?: number;
  /** 返回上限（默认 50）。 */
  limit?: number;
}

export interface NegativeSuggesterResult {
  suggestions: NegativeSuggestion[];
  totalWastedUsd: number;
  notes: string[];
}

export const DEFAULT_NEGATIVE_MIN_CLICKS = 20;

export function suggestNegatives(
  rows: SearchTermRow[],
  opts: NegativeSuggesterOptions = {}
): NegativeSuggesterResult {
  const minClicks = opts.minClicks ?? DEFAULT_NEGATIVE_MIN_CLICKS;
  const minSpend = opts.minSpendUsd ?? 0;
  const limit = opts.limit ?? 50;
  const notes: string[] = [];

  const seen = new Set<string>();
  const suggestions: NegativeSuggestion[] = [];

  for (const r of rows) {
    const term = (r.term ?? "").trim().replace(/\s+/g, " ");
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    const clicks = Number(r.clicks) || 0;
    const conversions = Number(r.conversions) || 0;
    const spend = Number(r.spendUsd) || 0;

    if (conversions > 0) continue;
    if (clicks < minClicks) continue;
    if (spend < minSpend) continue;

    seen.add(key);
    suggestions.push({
      term,
      matchType: "exact",
      reason: `${clicks} 次点击、$${spend.toFixed(2)} 花费、0 转化`,
      wastedUsd: Math.round(spend * 100) / 100,
    });
  }

  suggestions.sort((a, b) => b.wastedUsd - a.wastedUsd);
  const totalWastedUsd =
    Math.round(suggestions.reduce((s, x) => s + x.wastedUsd, 0) * 100) / 100;

  if (suggestions.length === 0) {
    notes.push(
      `没有符合条件的词：需要「≥${minClicks} 次点击且 0 转化」才建议否定，样本不够的不判`
    );
  } else {
    notes.push(
      "建议用精确否定：避免误伤同义的长尾词。加上后需要 3–7 天观察，别一次加太多"
    );
  }
  if (suggestions.length > limit) {
    notes.push(`结果超过 ${limit} 条，只返回花费最高的 ${limit} 条`);
  }

  return {
    suggestions: suggestions.slice(0, limit),
    totalWastedUsd,
    notes,
  };
}
