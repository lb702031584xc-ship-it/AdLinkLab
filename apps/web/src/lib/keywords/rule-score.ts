/**
 * P1-10：关键词规则分 + 来源（纯函数；规则分与 AI 无关，不含任何搜索量）。
 *
 * 规则分：
 * - brand+suffix（品牌词 + 后缀）= 70
 * - seed-combo（种子词组合）= 55
 * - synonym（同义词）= 50
 * - token+suffix（token + 后缀）= 45
 * - 域名相关性加成：+30 × Jaccard(域名 token, 关键词 token)
 * 品牌覆盖：别名精确匹配 = 1.0；否则 bigram Jaccard ≥ 0.6 = 已覆盖；
 * 覆盖 < 0.6 → 黄色警告（不是门禁，不拦截）。
 */

export type KeywordRuleKind = "brand-suffix" | "seed-combo" | "synonym" | "token-suffix";

export const RULE_BASE_SCORES: Record<KeywordRuleKind, number> = {
  "brand-suffix": 70,
  "seed-combo": 55,
  synonym: 50,
  "token-suffix": 45,
};

/** 中文常用购买意图后缀表（规则生成用，非搜索量）。 */
export const CHINESE_SUFFIXES = [
  "价格", "评测", "推荐", "怎么样", "哪款好", "优惠", "折扣", "购买", "官网", "测评",
] as const;

export const ENGLISH_SUFFIXES = [
  "review", "price", "best", "vs", "discount", "coupon", "buy", "near me", "for sale",
] as const;

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

function bigrams(s: string): Set<string> {
  const t = s.toLowerCase().replace(/\s+/g, "");
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

function bigramJaccard(a: string, b: string): number {
  const sa = bigrams(a);
  const sb = bigrams(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

export function domainTokens(domainOrUrl: string): string[] {
  let host = domainOrUrl.trim().toLowerCase();
  try {
    host = new URL(host.includes("://") ? host : `https://${host}`).hostname;
  } catch {
    /* 不是 URL，按原始字符串处理 */
  }
  return host.replace(/^www\./, "").split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * 规则分 = 基础分 + 30 × Jaccard(域名 token, 关键词 token)，上限 100。
 * 输入非法 → null。
 */
export function ruleScore(
  keyword: string,
  kind: KeywordRuleKind,
  domainOrUrl: string
): number | null {
  if (!keyword.trim()) return null;
  const base = RULE_BASE_SCORES[kind];
  if (base === undefined) return null;
  const bonus = 30 * jaccard(domainTokens(domainOrUrl), tokenize(keyword));
  return Math.min(100, Math.round((base + bonus) * 10) / 10);
}

/**
 * 品牌覆盖度：别名精确匹配 = 1.0；否则取与各别名 bigram Jaccard 的最大值。
 * 覆盖 < 0.6 → 应显示黄色警告（不是门禁）。
 */
export function brandCoverage(keyword: string, aliases: string[]): number {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return 0;
  let best = 0;
  for (const alias of aliases) {
    const a = alias.trim().toLowerCase();
    if (!a) continue;
    if (kw === a || kw.includes(a) || a.includes(kw)) return 1;
    best = Math.max(best, bigramJaccard(kw, a));
  }
  return Math.round(best * 100) / 100;
}

export const BRAND_COVERAGE_WARN_THRESHOLD = 0.6;

export function brandCoverageWarn(coverage: number): boolean {
  return coverage < BRAND_COVERAGE_WARN_THRESHOLD;
}
