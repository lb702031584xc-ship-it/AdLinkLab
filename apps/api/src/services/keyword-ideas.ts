/**
 * P1-10：规则生成关键词 ideas（纯函数；与 web/lib/keywords/rule-score.ts 同一口径）。
 *
 * 生成方式（无 LLM，无搜索量）：
 * - brand-suffix：品牌词 + 意图后缀（70 分起）
 * - seed-combo：两个种子词组合（55 分起）
 * - token-suffix：种子词 + 意图后缀（45 分起）
 * 规则分 = 基础分 + 30 × Jaccard(域名 token, 关键词 token)，上限 100。
 * 品牌覆盖：别名精确匹配 = 1.0，否则 bigram Jaccard；<0.6 → 警告（非门禁）。
 * avgMonthlySearches / competition 永远 null（未连接 Keyword Planner 时不编造）。
 */

export type KeywordRuleKind = "brand-suffix" | "seed-combo" | "token-suffix";

export const RULE_BASE_SCORES: Record<KeywordRuleKind, number> = {
  "brand-suffix": 70,
  "seed-combo": 55,
  "token-suffix": 45,
};

export const INTENT_SUFFIXES = [
  "review", "price", "best", "vs", "discount", "coupon", "buy", "for sale",
  "价格", "评测", "推荐", "怎么样", "哪款好", "优惠", "折扣", "购买", "官网", "测评",
] as const;

export interface RuleKeywordIdea {
  keyword: string;
  kind: KeywordRuleKind;
  ruleScore: number;
  /** 来源固定为“规则生成”（与 AI 扩展 / Keyword Planner / 商品标题描述 / 下拉框区分）。 */
  source: "rule-generated";
  /** 品牌覆盖度 0–1（无品牌词时 null）。 */
  brandCoverage: number | null;
  /** 覆盖 <0.6 → true（黄色警告，非门禁）。 */
  brandCoverageWarn: boolean;
  /** 未连接 Keyword Planner → 永远 null，不编造。 */
  avgMonthlySearches: null;
  competition: null;
}

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
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

function domainTokens(domainOrUrl: string): string[] {
  let host = domainOrUrl.trim().toLowerCase();
  try {
    host = new URL(host.includes("://") ? host : `https://${host}`).hostname;
  } catch {
    /* 不是 URL，按原始字符串处理 */
  }
  return host.replace(/^www\./, "").split(/[^a-z0-9]+/).filter(Boolean);
}

export function ruleScoreFor(keyword: string, kind: KeywordRuleKind, domain: string): number {
  const bonus = 30 * jaccard(domainTokens(domain), tokenize(keyword));
  return Math.min(100, Math.round((RULE_BASE_SCORES[kind] + bonus) * 10) / 10);
}

export function brandCoverageFor(keyword: string, aliases: string[]): number | null {
  if (aliases.length === 0) return null;
  const kw = keyword.trim().toLowerCase();
  let best = 0;
  for (const alias of aliases) {
    const a = alias.trim().toLowerCase();
    if (!a) continue;
    if (kw === a || kw.includes(a) || a.includes(kw)) return 1;
    best = Math.max(best, bigramJaccard(kw, a));
  }
  return Math.round(best * 100) / 100;
}

export interface GenerateRuleIdeasInput {
  seeds: string[];
  brandTerms?: string[];
  domain?: string;
  /** 每种生成方式最多产出数（默认各 20，上限 50）。 */
  limitPerKind?: number;
}

export function generateRuleIdeas(input: GenerateRuleIdeasInput): RuleKeywordIdea[] {
  const seeds = [...new Set(input.seeds.map((s) => s.trim()).filter(Boolean))].slice(0, 30);
  const brands = [...new Set((input.brandTerms ?? []).map((s) => s.trim()).filter(Boolean))].slice(0, 10);
  const domain = (input.domain ?? "").trim();
  const limit = Math.min(Math.max(input.limitPerKind ?? 20, 1), 50);
  const seen = new Set<string>();
  const out: RuleKeywordIdea[] = [];
  const push = (keyword: string, kind: KeywordRuleKind) => {
    const key = keyword.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const coverage = brandCoverageFor(keyword, brands);
    out.push({
      keyword,
      kind,
      ruleScore: ruleScoreFor(keyword, kind, domain),
      source: "rule-generated",
      brandCoverage: coverage,
      brandCoverageWarn: coverage != null && coverage < 0.6,
      avgMonthlySearches: null,
      competition: null,
    });
  };
  // brand-suffix
  for (const b of brands) {
    for (const suf of INTENT_SUFFIXES) {
      if (out.filter((i) => i.kind === "brand-suffix").length >= limit) break;
      push(`${b} ${suf}`, "brand-suffix");
    }
  }
  // seed-combo（两两组合，去重）
  for (let i = 0; i < seeds.length; i++) {
    for (let j = 0; j < seeds.length; j++) {
      if (i === j) continue;
      if (out.filter((i2) => i2.kind === "seed-combo").length >= limit) break;
      push(`${seeds[i]} ${seeds[j]}`, "seed-combo");
    }
  }
  // token-suffix
  for (const s of seeds) {
    for (const suf of INTENT_SUFFIXES) {
      if (out.filter((i) => i.kind === "token-suffix").length >= limit) break;
      push(`${s} ${suf}`, "token-suffix");
    }
  }
  return out.sort((a, b) => b.ruleScore - a.ruleScore || a.keyword.localeCompare(b.keyword));
}
