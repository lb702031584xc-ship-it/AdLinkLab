/**
 * P1-9：创意 7 维自检（启发式规则，非 AI 评分；结果标注“自检”）。
 *
 * 维度：相关性 / 质量 / 吸引力 / 多样性 / 清晰度 / 品牌 / 敏感词。
 * - 敏感词：命中敏感词表（GUN/DRUG 等违禁/受限类词）→ 该维 0 分且整体 fail。
 * - 品牌：标题/描述命中品牌词 → 1 分；否则 0 分但不 fail（品牌词可能在关键词层）。
 * - 品牌搜索量：自检无法获取搜索量 → 永远 unknown（不编造数字）。
 * 输出严格数值 + 布尔，不输出 "$1.20-$2.80" 这类金额字符串。
 */

export interface CreativeSelfCheckInput {
  headlines: string[];
  descriptions: string[];
  /** 目标关键词（用于相关性：标题/描述是否覆盖关键词 token）。 */
  keywords: string[];
  /** 品牌词（用于品牌维）。 */
  brandTerms: string[];
}

export interface CreativeDimensionScore {
  score: number;
  note: string;
}

export interface CreativeSelfCheckResult {
  /** 7 维得分（0–1）。 */
  dimensions: {
    relevance: CreativeDimensionScore;
    quality: CreativeDimensionScore;
    attractiveness: CreativeDimensionScore;
    diversity: CreativeDimensionScore;
    clarity: CreativeDimensionScore;
    brand: CreativeDimensionScore;
    sensitivity: CreativeDimensionScore;
  };
  /** 总分 = 7 维平均（0–1）。 */
  overall: number;
  /** 敏感词命中 → fail；其余 → pass。 */
  verdict: "pass" | "fail";
  /** 品牌搜索量：自检无数据源，永远 unknown。 */
  brandSearchVolume: "unknown";
  /** 命中敏感词列表（空 = 未命中）。 */
  sensitiveHits: string[];
  /** 标注：启发式自检，非 AI 评分。 */
  source: "heuristic-self-check";
}

/** 敏感词表：违禁/受限类（命中即 fail；仅作自检提醒，不替代 Google Ads 政策审核）。 */
export const SENSITIVE_WORDS = [
  "gun", "guns", "firearm", "rifle", "pistol", "ammo", "ammunition",
  "drug", "drugs", "cocaine", "heroin", "meth", "marijuana", "cannabis", "weed",
  "casino", "gambling", "betting", "porn", "sex", "escort",
  "counterfeit", "fake id", "hacking", "malware",
  "枪", "毒品", "赌博", "色情",
] as const;

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function containsTerm(text: string, term: string): boolean {
  return text.toLowerCase().includes(term.toLowerCase());
}

export function creativeSelfCheck(input: CreativeSelfCheckInput): CreativeSelfCheckResult {
  const allText = [...input.headlines, ...input.descriptions].join(" ");
  const allLower = allText.toLowerCase();
  const sensitiveHits = SENSITIVE_WORDS.filter((w) => allLower.includes(w.toLowerCase()));

  const kwTokens = new Set(input.keywords.flatMap(tokenize));
  const copyTokens = new Set(tokenize(allText));
  const covered = [...kwTokens].filter((t) => copyTokens.has(t)).length;
  const relevance =
    kwTokens.size === 0 ? 0.5 : Math.round((covered / kwTokens.size) * 100) / 100;

  const headlineLens = input.headlines.map((h) => h.length);
  const descLens = input.descriptions.map((d) => d.length);
  // 质量：标题 ≤30 字符、描述 ≤90 字符（RSA 上限）占比。
  const totalUnits = headlineLens.length + descLens.length;
  const withinLimits =
    headlineLens.filter((l) => l <= 30).length + descLens.filter((l) => l <= 90).length;
  const quality = totalUnits === 0 ? 0 : Math.round((withinLimits / totalUnits) * 100) / 100;

  // 吸引力：含数字/折扣/行动词/紧迫词（真实文案才算；自检不验证真实性，提示中说明）。
  const appealRe = /\d|%|off|save|free|shop|buy|now|today|deal|discount|优惠|折扣|免费|立即|限时/i;
  const appealHits = [...input.headlines, ...input.descriptions].filter((t) => appealRe.test(t)).length;
  const attractiveness =
    totalUnits === 0 ? 0 : Math.round((appealHits / totalUnits) * 100) / 100;

  // 多样性：去重后文案占比。
  const unique = new Set([...input.headlines, ...input.descriptions].map((t) => t.trim().toLowerCase()));
  const diversity = totalUnits === 0 ? 0 : Math.round((unique.size / totalUnits) * 100) / 100;

  // 清晰度：平均句长适中（标题平均 ≤15 词、描述平均 ≤25 词）+ 无 ALL CAPS 喊叫。
  const avgWords =
    totalUnits === 0
      ? 0
      : [...input.headlines, ...input.descriptions].reduce((s, t) => s + tokenize(t).length, 0) / totalUnits;
  const shouting = [...input.headlines, ...input.descriptions].filter(
    (t) => t.length >= 4 && t === t.toUpperCase()
  ).length;
  const clarity = totalUnits === 0 ? 0 : Math.round(Math.max(0, 1 - avgWords / 40 - shouting / totalUnits) * 100) / 100;

  // 品牌：标题/描述命中任一品牌词 → 1，否则 0（不 fail）。
  const brandHit = input.brandTerms.some((b) => b.trim() && containsTerm(allText, b.trim()));
  const brand = brandHit ? 1 : 0;

  // 敏感词：命中 → 0 且整体 fail；未命中 → 1。
  const sensitivity = sensitiveHits.length === 0 ? 1 : 0;

  const dimensions = {
    relevance: { score: relevance, note: kwTokens.size === 0 ? "未提供关键词，按 0.5 中性计" : `覆盖 ${covered}/${kwTokens.size} 个关键词 token` },
    quality: { score: quality, note: `标题≤30字符、描述≤90字符占比 ${withinLimits}/${totalUnits}` },
    attractiveness: { score: attractiveness, note: "含数字/折扣/行动词的文案占比（自检不验证真实性）" },
    diversity: { score: diversity, note: `去重后文案 ${unique.size}/${totalUnits}` },
    clarity: { score: clarity, note: `平均 ${avgWords.toFixed(1)} 词/条；全大写喊叫 ${shouting} 条` },
    brand: { score: brand, note: brandHit ? "文案命中品牌词" : "文案未命中品牌词（品牌词可能在关键词层，不判 fail）" },
    sensitivity: {
      score: sensitivity,
      note: sensitiveHits.length === 0 ? "未命中敏感词" : `命中敏感词：${sensitiveHits.join(", ")}（自检提醒，不替代 Google Ads 政策审核）`,
    },
  };
  const overall =
    Math.round(
      ((relevance + quality + attractiveness + diversity + clarity + brand + sensitivity) / 7) * 100
    ) / 100;
  return {
    dimensions,
    overall,
    verdict: sensitiveHits.length === 0 ? "pass" : "fail",
    brandSearchVolume: "unknown",
    sensitiveHits,
    source: "heuristic-self-check",
  };
}
