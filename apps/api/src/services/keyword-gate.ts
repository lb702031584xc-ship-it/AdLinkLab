/**
 * 关键词闸门（2026-10-28，纯函数）。
 *
 * 背景：AI / 规则生成的关键词，本质是按模板拼装，不理解三个约束——
 *   1. 产品约束（价格档位、型号、有没有折扣码）
 *   2. 落地页约束（有没有对比内容、有没有 coupon 页）
 *   3. 平台约束（品牌词禁令、后台代码混入、搜索量）
 * 于是产出一堆「看起来像关键词、实际投了就白烧钱」的串。
 *
 * 本模块只做一件事：把不能投的用硬规则挡掉，把能投的标成「待验证」，
 * 绝不在没有搜索量数据时给出「可投」。
 *
 * verdict：
 *   reject  结构性不可能（意图与落地页不匹配 / 人群与价格错配 / 被后台代码污染）
 *   verify  规则上没毛病，但缺搜索量数据，必须实测后才能投
 *   bid     只在调用方明确提供了搜索量且达标时才会出现
 */
export type KeywordGateVerdict = "bid" | "verify" | "reject";

export type KeywordRejectCode =
  | "ADMIN_CODE_CONTAMINATION"
  | "NO_COMPARISON_PAGE"
  | "NO_DISCOUNT"
  | "PRICE_MISMATCH"
  | "BRAND_FORBIDDEN"
  | "INFORMATIONAL"
  | "TOO_GENERIC"
  | "NEGATIVE_INTENT";

export interface KeywordGateContext {
  brandName?: string | null;
  /** 合同禁止品牌词竞价。 */
  brandBiddingForbidden?: boolean;
  /** 落地页是否有对比内容（vs / 对比表）。默认 false。 */
  hasComparisonPage?: boolean;
  /** 是否有折扣码 / coupon。默认 false。 */
  hasDiscountCode?: boolean;
  /** 产品价格（美元）：用于判断 affordable/cheap 类词是否错配。 */
  priceUsd?: number | null;
  /** 超过此价视为「高客单」，低价词一律不匹配。默认 150。 */
  premiumPriceUsd?: number;
  /** 联盟后台代码（pb / yp / adx…）：出现在词里说明是污染，不是产品型号。 */
  networkCodes?: string[];
  /** 该词的月搜索量（有才传）：有值且达标才可能判 bid。 */
  monthlySearches?: number | null;
  /** 判定为 bid 的最小月搜索量。默认 100。 */
  minMonthlySearches?: number;
}

export interface KeywordGateResult {
  keyword: string;
  verdict: KeywordGateVerdict;
  /** reject 时的原因代码。 */
  codes: KeywordRejectCode[];
  /** 给人看的一句话结论。 */
  reason: string;
}

const DEFAULT_PREMIUM_PRICE = 150;
const DEFAULT_MIN_SEARCHES = 100;

/** 对比意图：需要落地页有对比内容。 */
const COMPARISON_RE = /\b(vs|versus|compare|comparison|better than|or)\b/i;
/** 折扣意图：需要页面有优惠。 */
const DISCOUNT_RE = /\b(discount|coupon|promo|voucher|deal|sale|off)\b/i;
/** 低价意图：与高客单产品错配。 */
const CHEAP_RE = /\b(affordable|cheap|cheapest|budget|inexpensive|low cost|under \d+)\b/i;
/** 信息意图：冷搜索几乎不成交。 */
const INFO_RE = /\b(how to|what is|why|guide|diy|tutorial|instructions)\b/i;
/** 负面/维修意图：搜的人是修不是买。 */
const NEGATIVE_RE = /\b(repair|replacement|parts|troubleshoot|not working|broken|manual)\b/i;

const normalise = (s: string) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export function assessKeyword(
  keyword: string,
  ctx: KeywordGateContext = {}
): KeywordGateResult {
  const kw = normalise(keyword);
  const codes: KeywordRejectCode[] = [];
  const reject = (code: KeywordRejectCode) => codes.push(code);

  if (!kw) {
    return { keyword, verdict: "reject", codes: ["TOO_GENERIC"], reason: "空关键词" };
  }

  /* 1. 后台代码污染：pb / yp 这类不是产品型号 */
  const networkCodes = (ctx.networkCodes ?? ["pb", "yp", "adx", "cd"]).map((c) =>
    c.toLowerCase()
  );
  const tokens = kw.split(" ");
  if (tokens.some((t) => networkCodes.includes(t))) {
    reject("ADMIN_CODE_CONTAMINATION");
  }

  /* 2. 对比意图：没有对比页就是把人骗进来 */
  if (COMPARISON_RE.test(kw) && !ctx.hasComparisonPage) {
    reject("NO_COMPARISON_PAGE");
  }

  /* 3. 折扣意图：没有折扣码，用户到了页面会走 */
  if (DISCOUNT_RE.test(kw) && !ctx.hasDiscountCode) {
    reject("NO_DISCOUNT");
  }

  /* 4. 低价意图 vs 高客单产品 */
  const price = Number(ctx.priceUsd);
  const premium = ctx.premiumPriceUsd ?? DEFAULT_PREMIUM_PRICE;
  if (CHEAP_RE.test(kw) && Number.isFinite(price) && price >= premium) {
    reject("PRICE_MISMATCH");
  }

  /* 5. 品牌词禁令 */
  const brand = normalise(ctx.brandName ?? "");
  if (ctx.brandBiddingForbidden && brand && kw.includes(brand)) {
    reject("BRAND_FORBIDDEN");
  }

  /* 6. 信息意图 / 维修意图 */
  if (INFO_RE.test(kw)) reject("INFORMATIONAL");
  if (NEGATIVE_RE.test(kw)) reject("NEGATIVE_INTENT");

  /* 7. 只有一个词 = 太宽（例如 "sealer"） */
  if (tokens.length < 2) reject("TOO_GENERIC");

  if (codes.length > 0) {
    const map: Record<KeywordRejectCode, string> = {
      ADMIN_CODE_CONTAMINATION: "含后台代码（pb/yp），不是产品词",
      NO_COMPARISON_PAGE: "对比词，但落地页没有对比内容",
      NO_DISCOUNT: "折扣词，但页面没有优惠",
      PRICE_MISMATCH: "低价词，与高客单产品错配",
      BRAND_FORBIDDEN: "含品牌词，但合同禁止品牌竞价",
      INFORMATIONAL: "信息型意图，冷搜索几乎不成交",
      TOO_GENERIC: "太宽，会匹配到无关查询",
      NEGATIVE_INTENT: "维修/配件意图，不是购买",
    };
    return {
      keyword,
      verdict: "reject",
      codes,
      reason: codes.map((c) => map[c]).join("；"),
    };
  }

  /* 8. 没有搜索量 → 只能待验证，绝不判可投 */
  const searches = Number(ctx.monthlySearches);
  const minSearches = ctx.minMonthlySearches ?? DEFAULT_MIN_SEARCHES;
  if (!Number.isFinite(searches)) {
    return {
      keyword,
      verdict: "verify",
      codes: [],
      reason: "规则上没毛病，但没有搜索量数据——先用关键词扩展实测再决定",
    };
  }
  if (searches < minSearches) {
    return {
      keyword,
      verdict: "reject",
      codes: ["TOO_GENERIC"],
      reason: `月搜索量 ${searches} 低于门槛 ${minSearches}，投了也拿不到量`,
    };
  }
  return {
    keyword,
    verdict: "bid",
    codes: [],
    reason: `月搜索量 ${searches} 达标，且没有违反落地页/价格/品牌约束`,
  };
}

export interface KeywordGateSummary {
  bid: KeywordGateResult[];
  verify: KeywordGateResult[];
  rejected: KeywordGateResult[];
  counts: { total: number; bid: number; verify: number; reject: number };
}

/** 批量过闸门，按 verdict 分组。 */
export function filterKeywords(
  keywords: string[],
  ctx: KeywordGateContext = {}
): KeywordGateSummary {
  const all = keywords.map((k) => assessKeyword(k, ctx));
  const bid = all.filter((x) => x.verdict === "bid");
  const verify = all.filter((x) => x.verdict === "verify");
  const rejected = all.filter((x) => x.verdict === "reject");
  return {
    bid,
    verify,
    rejected,
    counts: {
      total: all.length,
      bid: bid.length,
      verify: verify.length,
      reject: rejected.length,
    },
  };
}
