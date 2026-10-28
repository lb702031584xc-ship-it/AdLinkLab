/**
 * 关键词推荐（2026-10-28，纯函数，不碰 Prisma、不调外部 API）。
 *
 * 设计前提：**不知道搜索量，也不假装知道。**
 * 本模块只产出三件确定的东西：
 *   1. 候选词（由 Offer 名称/品牌按意图模板生成，规则可读可审）；
 *   2. 每个词的搜索意图分类（成交型 / 比价型 / 信息型）；
 *   3. **保本 CPC 上限** —— 这个词最多能出多少钱，超过就是亏。
 *
 * 为什么不做「推荐分数」：搜索量、竞争度、真实 CPC 都要付费数据或历史
 * 投放才有，缺数据时打分只会制造虚假确定性（与全站 unknown 口径一致）。
 * 保本 CPC 是唯一可以只用 Offer 自身数据算出来的、且直接决定能不能投的量。
 *
 * 保本 CPC = 净 payout × 目标 CVR
 *   净 payout = 单笔佣金 × (1 − 拒单率) × (1 − 退款率)
 * 拒单/退款缺省取保守值，可在输入里覆盖。
 *
 * 意图与处置：
 *   - transactional（buy / price / cheap / coupon / near me）→ test
 *   - commercial（best / reviews / top）→ test，但注明比价意图 CVR 偏低
 *   - informational（how to / what is）→ skip，冷搜索几乎不成交
 *
 * 品牌词：brandBiddingForbidden 为真时不生成，并记入 skipped 说明原因。
 */
import { assessKeyword } from "./keyword-gate.js";

export type KeywordIntent = "transactional" | "commercial" | "informational";
export type KeywordVerdict = "test" | "skip" | "blocked";
export type KeywordMatchType = "exact" | "phrase";

export const DEFAULT_TARGET_CVR_PCT = 2.5;
export const DEFAULT_REJECTION_RATE = 0.15;
export const DEFAULT_REFUND_RATE = 0.05;
export const DEFAULT_MAX_KEYWORDS = 20;

export interface KeywordRecommendInput {
  offerName: string;
  brandName?: string | null;
  /** 单笔佣金（美元）；null/<=0 时无法算保本线，全部 blocked。 */
  payoutUsd: number | null;
  /** 目标转化率（百分数，2.5 表示 2.5%）。缺省 2.5。 */
  targetCvrPct?: number | null;
  rejectionRate?: number | null;
  refundRate?: number | null;
  /** 合同禁止品牌词竞价时为真。 */
  brandBiddingForbidden?: boolean;
  /** 返回条数上限，缺省 20。 */
  maxKeywords?: number;
}

export interface KeywordSuggestion {
  keyword: string;
  intent: KeywordIntent;
  matchType: KeywordMatchType;
  /** 这个词的保本 CPC 上限（美元）；算不出为 null。 */
  maxCpcUsd: number | null;
  verdict: KeywordVerdict;
  note: string;
}

/** 长尾候选：从产品名的规格词重组出来的更具体组合。 */
/** 未过闸门的原始长尾（只有字符串与来源）。 */
export interface RawLongTail {
  keyword: string;
  /** 来自哪一类：规格 / 品牌+规格。 */
  basis: "spec" | "brand_spec";
  note: string;
}

/** 过闸门后的长尾：带判定与原因。 */
export interface LongTailSuggestion extends RawLongTail {
  /** 闸门判定：verify = 待实测；bid = 有搜索量且达标（本模块不产生 bid）。 */
  verdict: "verify" | "bid";
  /** 闸门给的一句话。 */
  gateReason: string;
}

export interface KeywordRecommendSkipped {
  keyword: string;
  reason: string;
}

export interface KeywordRecommendResult {
  /** 从 Offer 名称里剥掉品牌后的核心词。 */
  core: string;
  /** 该 Offer 整体保本 CPC 上限（所有词同值，词级差异需要真实 CPC 才能算）。 */
  maxCpcUsd: number | null;
  breakeven: {
    netPayoutUsd: number;
    targetCvrPct: number;
    rejectionRate: number;
    refundRate: number;
  } | null;
  suggestions: KeywordSuggestion[];
  /**
   * 长尾候选（规格词重组）。**不含搜索量**——要用 /api/v1/keywords/expand
   * 跑一遍才知道有没有人搜、CPC 多少。这里只负责给出可测的字符串。
   */
  longTail: LongTailSuggestion[];
  skipped: KeywordRecommendSkipped[];
  notes: string[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round4 = (n: number) => Math.round(n * 10000) / 10000;

function num(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/** 从名称里剥掉品牌词，得到可复用的核心词。 */
export function extractCore(name: string, brand: string | null | undefined): string {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  const full = clean(name ?? "");
  const b = clean(brand ?? "");
  if (!b) return full;
  const stripped = clean(full.split(b).join(" "));
  return stripped || full;
}

/** 规格片段：数字 + 单位（8kw / 260w / 10.2 inch / 12v …）。 */
const SPEC_RE =
  /(\d+(?:\.\d+)?)\s?(kw|w|kg|l|liter|litre|inch|in|v|volt|psi|gal|gallon|qt|oz|lb|mm|cm)\b/gi;

/**
 * 把核心词拆成「基础词 + 规格词」。
 * 例："chamber vacuum sealer 260w 10.2 inch" → base "chamber vacuum sealer",
 *     specs ["260w", "10.2 inch"]
 * 规格词是从产品名里**原样摘出来的**，不是编的。
 */
export function splitCoreAndSpecs(core: string): { base: string; specs: string[] } {
  const specs: string[] = [];
  const base = (core ?? "")
    .replace(SPEC_RE, (m) => {
      specs.push(m.trim().toLowerCase().replace(/\s+/g, " "));
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { base, specs: [...new Set(specs)] };
}

/**
 * 长尾候选：base + 单个规格，或 品牌 + base + 规格。
 * 参数越具体，竞争越小、CPC 通常越低——但搜索量也越小，
 * 所以必须用关键词扩展验证，不能直接投。
 */
export function buildLongTailCandidates(input: {
  core: string;
  brandName?: string | null;
  limit?: number;
}): RawLongTail[] {
  const { base, specs } = splitCoreAndSpecs(input.core);
  if (!base || specs.length === 0) return [];
  const brand = (input.brandName ?? "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(30, input.limit ?? 12));

  const out: RawLongTail[] = [];
  const seen = new Set<string>();
  const push = (keyword: string, basis: LongTailSuggestion["basis"]) => {
    const kw = keyword.trim().replace(/\s+/g, " ");
    if (!kw || seen.has(kw)) return;
    seen.add(kw);
    out.push({
      keyword: kw,
      basis,
      note:
        basis === "brand_spec"
          ? "品牌+基础词+规格：更精准，但注意品牌词条款"
          : "基础词+规格：比大词具体，竞争通常更小",
    });
  };

  for (const spec of specs) {
    push(`${base} ${spec}`, "spec");
    if (brand && brand !== base) push(`${brand} ${base} ${spec}`, "brand_spec");
  }

  return out.slice(0, limit);
}

const TRANSACTIONAL: Array<(c: string) => string> = [
  (c) => `buy ${c}`,
  (c) => `${c} price`,
  (c) => `cheap ${c}`,
  (c) => `${c} for sale`,
  (c) => `${c} near me`,
  (c) => `${c} coupon`,
];
const COMMERCIAL: Array<(c: string) => string> = [
  (c) => `best ${c}`,
  (c) => `${c} reviews`,
  (c) => `top ${c}`,
];
const INFORMATIONAL: Array<(c: string) => string> = [
  (c) => `how to use ${c}`,
  (c) => `what is ${c}`,
];

const INTENT_RANK: Record<KeywordIntent, number> = {
  transactional: 0,
  commercial: 1,
  informational: 2,
};

export function recommendKeywords(
  input: KeywordRecommendInput
): KeywordRecommendResult {
  const notes: string[] = [];
  const skipped: KeywordRecommendSkipped[] = [];

  const core = extractCore(input.offerName ?? "", input.brandName);
  const brand = (input.brandName ?? "").trim().toLowerCase();

  const cvr = clamp(num(input.targetCvrPct, DEFAULT_TARGET_CVR_PCT), 0.1, 100);
  const rejection = clamp(num(input.rejectionRate, DEFAULT_REJECTION_RATE), 0, 1);
  const refund = clamp(num(input.refundRate, DEFAULT_REFUND_RATE), 0, 1);
  const payout = input.payoutUsd == null ? NaN : Number(input.payoutUsd);

  let maxCpcUsd: number | null = null;
  let breakeven: KeywordRecommendResult["breakeven"] = null;
  if (Number.isFinite(payout) && payout > 0) {
    const netPayoutUsd = round4(payout * (1 - rejection) * (1 - refund));
    maxCpcUsd = Math.round(netPayoutUsd * (cvr / 100) * 10000) / 10000;
    breakeven = {
      netPayoutUsd,
      targetCvrPct: cvr,
      rejectionRate: rejection,
      refundRate: refund,
    };
  }

  if (!core) {
    return {
      core: "",
      maxCpcUsd: null,
      breakeven: null,
      suggestions: [],
      longTail: [],
      skipped,
      notes: ["Offer 名称无法提取核心词（为空或只有符号），无法生成候选"],
    };
  }

  if (maxCpcUsd == null) {
    notes.push(
      "单笔佣金未知或为 0，算不出保本 CPC —— 保本线缺失时不做推荐，先补佣金"
    );
  }

  const drafts: Array<{ keyword: string; intent: KeywordIntent }> = [];
  for (const f of TRANSACTIONAL) drafts.push({ keyword: f(core), intent: "transactional" });
  for (const f of COMMERCIAL) drafts.push({ keyword: f(core), intent: "commercial" });
  for (const f of INFORMATIONAL) drafts.push({ keyword: f(core), intent: "informational" });

  if (brand && brand !== core) {
    const brandKw = `${brand} ${core}`;
    if (input.brandBiddingForbidden) {
      skipped.push({
        keyword: brandKw,
        reason: "合同禁止品牌词竞价，未生成",
      });
    } else {
      drafts.push({ keyword: brandKw, intent: "transactional" });
    }
  }

  const seen = new Set<string>();
  const suggestions: KeywordSuggestion[] = [];
  for (const d of drafts) {
    const kw = d.keyword.trim().replace(/\s+/g, " ");
    if (!kw || seen.has(kw)) continue;
    seen.add(kw);

    let verdict: KeywordVerdict;
    let note: string;
    if (maxCpcUsd == null) {
      verdict = "blocked";
      note = "缺少保本 CPC，无法判断";
    } else if (d.intent === "informational") {
      verdict = "skip";
      note = "信息型意图，冷搜索几乎不成交";
    } else if (d.intent === "commercial") {
      verdict = "test";
      note = "比价意图，CVR 通常低于成交词，优先测成交词";
    } else {
      verdict = "test";
      note = `最多出 $${maxCpcUsd.toFixed(2)}/点击，超过即亏`;
    }

    suggestions.push({
      keyword: kw,
      intent: d.intent,
      // 长尾精确匹配起步：短语匹配放到第二轮扩量。
      matchType: "exact",
      maxCpcUsd,
      verdict,
      note,
    });
  }

  // 排序：可测的在前；同类内成交型优先；同意图下更长的词更具体（启发式）。
  suggestions.sort((a, b) => {
    const va = a.verdict === "test" ? 0 : 1;
    const vb = b.verdict === "test" ? 0 : 1;
    if (va !== vb) return va - vb;
    if (INTENT_RANK[a.intent] !== INTENT_RANK[b.intent])
      return INTENT_RANK[a.intent] - INTENT_RANK[b.intent];
    if (b.keyword.length !== a.keyword.length)
      return b.keyword.length - a.keyword.length;
    return a.keyword.localeCompare(b.keyword);
  });

  const limit = Math.max(1, Math.min(50, Math.round(num(input.maxKeywords, DEFAULT_MAX_KEYWORDS))));
  const trimmed = suggestions.slice(0, limit);
  for (const rest of suggestions.slice(limit)) {
    skipped.push({ keyword: rest.keyword, reason: `超出上限 ${limit} 条，未返回` });
  }

  notes.push(
    "候选词按意图模板规则生成，不含搜索量与竞争度（需付费数据）；保本 CPC 由 Offer 佣金与目标 CVR 算出，是唯一可确定的经济性门槛"
  );

  // 长尾候选必须过闸门：结构上不可能的（含后台代码 / 对比 / 折扣 / 品牌禁令）
  // 直接扔进 skipped，不展示给用户，避免"生成一堆没用的长尾"。
  const rawLongTail = buildLongTailCandidates({
    core,
    brandName: input.brandName,
  });
  const gated = rawLongTail.map((c) => {
    const g = assessKeyword(c.keyword, {
      brandName: input.brandName ?? null,
      brandBiddingForbidden: input.brandBiddingForbidden === true,
    });
    return { ...c, verdict: g.verdict, gateReason: g.reason, codes: g.codes };
  });
  const longTail: LongTailSuggestion[] = gated
    .filter((x) => x.verdict !== "reject")
    .map(({ codes: _codes, ...rest }) => ({
      ...rest,
      verdict: rest.verdict as "verify" | "bid",
    }));
  for (const d of gated.filter((x) => x.verdict === "reject")) {
    skipped.push({ keyword: d.keyword, reason: `闸门淘汰：${d.gateReason}` });
  }
  if (longTail.length > 0) {
    notes.push(
      `长尾候选 ${longTail.length} 条（已过闸门）：不含搜索量，先用 /api/v1/keywords/expand 验证再投`
    );
  }
  const droppedCount = gated.length - longTail.length;
  if (droppedCount > 0) {
    notes.push(`另有 ${droppedCount} 条被闸门淘汰，未展示（原因见 skipped）`);
  }

  return {
    core,
    maxCpcUsd,
    breakeven,
    suggestions: trimmed,
    longTail,
    skipped,
    notes,
  };
}
