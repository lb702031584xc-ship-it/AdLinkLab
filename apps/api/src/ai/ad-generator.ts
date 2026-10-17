/**
* 功能2 — 自动化广告：AI 广告计划生成器。
*
* 输入 offer 终链 URL（可多个）→ 输出结构化广告计划：
* campaign（名称/预算/geo/出价）+ ad groups（每组关键词 + 否词）+
* RSA（15 标题 / 4 描述）。
*
* 约定：
* - 跟随现有 `chatJsonValidated` strict JSON 校验模式（见 prompts.ts）。
* - 否词生成复用 brand-check.ts 的 `checkBrandConflicts` /
* `buildNegativeKeywords`（服务端确定性逻辑，不依赖 LLM）。
* - 所有 AI 生成的数字/文案标注 dataQuality = "PREDICTED"。
*/
import { AiError} from "./llm.js";
import {
buildNegativeKeywords,
checkBrandConflicts,
normalizeKeyword,
} from "./brand-check.js";
import type { AnalysisLanguage} from "./prompts.js";

/** Data-quality vocabulary shared with the web DataQualityBadge. */
export type AdPlanDataQuality = "OBSERVED" | "PREDICTED" | "UNKNOWN";

/** Every AI-generated number/copy in a plan is marked PREDICTED. */
export const AI_GENERATED_QUALITY: AdPlanDataQuality = "PREDICTED";

/** Safety clamp: the Script must never receive an absurd daily budget. */
export const MIN_DAILY_BUDGET = 5;
/** Safety clamp: the Script must never receive an absurd daily budget. */
export const MAX_DAILY_BUDGET = 500;

export const MAX_URLS_PER_PLAN = 5;
export const PAGE_TEXT_LIMIT = 12_000;

export type KeywordMatchType = "EXACT" | "PHRASE" | "BROAD";
export type BiddingStrategy = "MANUAL_CPC" | "MAXIMIZE_CLICKS";
/** 文案口吻：official=官方口吻，affiliate=联盟安全口吻，expert=专家营销口吻 */
export type AdCopyStyle = "official" | "affiliate" | "expert";

/** 专家模式参考的成功广告（DataForSEO SERP 结构化结果）。 */
export interface SerpReferenceAd {
  title: string;
  description: string;
  displayUrl?: string;
}

export interface AdPlanMoney {
amount: number;
currency: string;
dataQuality: AdPlanDataQuality;
}

export interface AdPlanKeyword {
text: string;
matchType: KeywordMatchType;
dataQuality: AdPlanDataQuality;
}

export interface AdPlanAdGroup {
name: string;
finalUrl: string;
keywords: AdPlanKeyword[];
/** Exact/phrase negatives; EXACT renders as [kw], PHRASE as "kw". */
negativeKeywords: AdPlanKeyword[];
maxCpc: AdPlanMoney | null;
dataQuality: AdPlanDataQuality;
/** 关键词来源：user=用户在投放选词里定的词，ai=AI 生成的 */
keywordsSource: "user" | "ai";
}

export interface AdPlanRsa {
/** Exactly 15 headlines, each ≤ 30 chars. */
headlines: string[];
/** Exactly 4 descriptions, each ≤ 90 chars. */
descriptions: string[];
finalUrl: string;
path1: string | null;
path2: string | null;
dataQuality: AdPlanDataQuality;
}

export interface AdPlanCampaign {
name: string;
dailyBudget: AdPlanMoney;
/** ISO-3166 alpha-2 country codes, e.g. ["US"]. */
geoTargets: string[];
bidding: {
strategy: BiddingStrategy;
maxCpc: AdPlanMoney | null;
};
/** New campaigns are always created PAUSED — the advertiser enables them. */
status: "PAUSED";
dataQuality: AdPlanDataQuality;
}

export interface AdPlanAdGroupBlock {
group: AdPlanAdGroup;
rsa: AdPlanRsa;
}

/** P1-25：广告排期（campaign-level ad schedule，Google Ads adSchedule）。 */
export interface AdPlanAdSchedule {
  dayOfWeek: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

export const AD_SCHEDULE_DAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;

/**
 * P1-25：校验并规范化排期输入。非法条目直接抛错（排期错误必须显性失败，
 * 绝不静默丢弃——否则用户以为排期生效而实际全天投放）。
 */
export function parseAdSchedules(input: unknown): AdPlanAdSchedule[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) {
    throw new Error("adSchedules must be an array");
  }
  if (input.length > 7 * 4) {
    throw new Error("adSchedules must contain at most 28 entries");
  }
  const out: AdPlanAdSchedule[] = [];
  for (const [i, raw] of input.entries()) {
    const s = raw as Record<string, unknown> | null;
    if (!s || typeof s !== "object") {
      throw new Error(`adSchedules[${i}] must be an object`);
    }
    const dayOfWeek = String(s.dayOfWeek ?? "").toUpperCase();
    if (!(AD_SCHEDULE_DAYS as readonly string[]).includes(dayOfWeek)) {
      throw new Error(`adSchedules[${i}].dayOfWeek must be MONDAY..SUNDAY`);
    }
    const hours = (k: string): number => {
      const n = Number(s[k]);
      if (!Number.isInteger(n) || n < 0 || n > 23) {
        throw new Error(`adSchedules[${i}].${k} must be an integer 0-23`);
      }
      return n;
    };
    const minutes = (k: string): number => {
      const n = Number(s[k]);
      if (!Number.isInteger(n) || n < 0 || n > 59) {
        throw new Error(`adSchedules[${i}].${k} must be an integer 0-59`);
      }
      return n;
    };
    const startHour = hours("startHour");
    const startMinute = minutes("startMinute");
    const endHour = hours("endHour");
    const endMinute = minutes("endMinute");
    if (endHour * 60 + endMinute <= startHour * 60 + startMinute) {
      throw new Error(`adSchedules[${i}] end must be after start`);
    }
    out.push({ dayOfWeek: dayOfWeek as AdPlanAdSchedule["dayOfWeek"], startHour, startMinute, endHour, endMinute });
  }
  return out;
}

/**
 * P1-25：解析用户否词输入（字符串数组或含 {text, matchType} 的对象数组）。
 * 文本用 Google Ads 惯用记号：[x] = EXACT，"x" = PHRASE，裸词 = PHRASE。
 * 去重 + 上限 1000（按组再截断）。
 */
export function parseNegativeKeywords(input: unknown): AdPlanKeyword[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) {
    throw new Error("negativeKeywords must be an array");
  }
  if (input.length > 1000) {
    throw new Error("negativeKeywords must contain at most 1000 entries");
  }
  const seen = new Set<string>();
  const out: AdPlanKeyword[] = [];
  for (const [i, raw] of input.entries()) {
    let text = "";
    let matchType: AdPlanKeyword["matchType"] = "PHRASE";
    if (typeof raw === "string") {
      text = raw.trim();
      if (text.startsWith("[") && text.endsWith("]")) {
        matchType = "EXACT";
        text = text.slice(1, -1).trim();
      } else if (text.startsWith('"') && text.endsWith('"')) {
        matchType = "PHRASE";
        text = text.slice(1, -1).trim();
      }
    } else if (raw && typeof raw === "object") {
      const o = raw as Record<string, unknown>;
      text = String(o.text ?? "").trim();
      const mt = String(o.matchType ?? "PHRASE").toUpperCase();
      if (mt === "EXACT" || mt === "PHRASE" || mt === "BROAD") matchType = mt as AdPlanKeyword["matchType"];
      else throw new Error(`negativeKeywords[${i}].matchType must be EXACT, PHRASE or BROAD`);
    } else {
      throw new Error(`negativeKeywords[${i}] must be a string or {text, matchType}`);
    }
    if (!text) continue;
    const key = `${matchType}:${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // 用户手动输入的否词 = 已观测输入（OBSERVED），非 AI 生成（PREDICTED）。
    out.push({ text, matchType, dataQuality: "OBSERVED" });
  }
  return out;
}

/**
 * P1-25：把用户否词合并进每个广告组（排期是 campaign 级，否词是 ad-group 级；
 * 用户否词是“全组通用”的补充，追加到各组 AI 否词之后，去重）。
 */
export function mergeUserNegatives(plan: AdPlan, negatives: AdPlanKeyword[]): void {
  if (negatives.length === 0) return;
  for (const block of plan.adGroups) {
    const seen = new Set(
      block.group.negativeKeywords.map((k) => `${k.matchType}:${k.text.toLowerCase()}`)
    );
    for (const neg of negatives) {
      const key = `${neg.matchType}:${neg.text.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      block.group.negativeKeywords.push({ ...neg });
    }
    if (block.group.negativeKeywords.length > 100) {
      block.group.negativeKeywords = block.group.negativeKeywords.slice(0, 100);
    }
  }
}

export interface AdPlan {
version: 1;
planId: string;
tenantId: string;
language: AnalysisLanguage;
sourceUrls: string[];
offerId: string | null;
googleAccountId: string | null;
/** 货币换算记录（生成时按广告账户货币换算后写入）：fxRate = 1 USD = X to 货币。 */
currencyConversion?: { from: string; to: string; fxRate: number };
/** 文案口吻：official=官方口吻（Official Site 结构），affiliate=联盟安全口吻，expert=专家营销口吻 */
copyStyle: AdCopyStyle;
campaign: AdPlanCampaign;
/** P1-25：广告排期（campaign 级；空 = 全天投放）。 */
adSchedules?: AdPlanAdSchedule[];
/** One ad group (+ its own RSA) per input URL. */
adGroups: AdPlanAdGroupBlock[];
createdAt: string;
dataQuality: AdPlanDataQuality;
}

// ---------------------------------------------------------------------------
// LLM draft (per URL) — strict JSON shape
// ---------------------------------------------------------------------------

/** Raw per-URL draft returned by the LLM, before server-side finalization. */
export interface AdPlanUrlDraft {
campaignName: string;
dailyBudget: { amount: number; currency: string};
geoTargets: string[];
bidding: { strategy: BiddingStrategy; maxCpc?: number | null};
/** Merchant brand terms/variants → fed into brand-check negative builder. */
brandTerms: string[];
adGroupName: string;
keywords: Array<{ text: string; matchType: KeywordMatchType}>;
/** Set when the caller overrides keywords (from 投放选词）. */
keywordsSource?: "user" | "ai";
suggestedNegatives: string[];
headlines: string[];
descriptions: string[];
path1?: string | null;
path2?: string | null;
}

const DRAFT_JSON_SPEC = `{
"campaignName": "<search campaign name, <= 80 chars, no emoji>",
"dailyBudget": { "amount": <starting daily budget, e.g. 30>, "currency": "<3-letter code, e.g. USD>"},
"geoTargets": ["<ISO-3166 alpha-2 country codes most likely to convert, e.g. US>"],
"bidding": { "strategy": "MANUAL_CPC" | "MAXIMIZE_CLICKS", "maxCpc": <max CPC for MANUAL_CPC, or null>},
"brandTerms": ["<merchant brand names / variants, 3-10 terms>"],
"adGroupName": "<ad group name, <= 80 chars>",
"keywords": [
{ "text": "<keyword>", "matchType": "EXACT" | "PHRASE" | "BROAD"}
],
"suggestedNegatives": ["<negative keyword ideas>"],
"headlines": ["<exactly 15 headlines, each <= 30 characters>"],
"descriptions": ["<exactly 4 descriptions, each <= 90 characters>"],
"path1": "<display path segment or null>",
"path2": "<display path segment or null>"
}`;

/** P1-15：节日主题 slug → 展示名（prompt 用）。只影响文案，不改变判定。 */
export const FESTIVAL_THEME_LABELS: Record<string, string> = {
  valentines: "Valentine's Day",
  easter: "Easter",
  "mothers-day": "Mother's Day",
  "fathers-day": "Father's Day",
  "independence-day": "Independence Day",
  "back-to-school": "Back to School",
  "labor-day": "Labor Day",
  halloween: "Halloween",
  thanksgiving: "Thanksgiving",
  "black-friday": "Black Friday",
  "cyber-monday": "Cyber Monday",
  "prime-day": "Amazon Prime Day",
  "prime-big-deal-days": "Prime Big Deal Days",
  christmas: "Christmas",
  "new-year": "New Year",
};

/** 规范化节日主题输入：未知值 → undefined（不渲染节日段落）。 */
export function normalizeFestivalThemeInput(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const v = input.trim().toLowerCase();
  if (!v || v === "none") return undefined;
  return FESTIVAL_THEME_LABELS[v] ? v : undefined;
}

export interface AdPlanPromptInput {
url: string;
pageText: string;
language: AnalysisLanguage;
/** 文案口吻：official=官方口吻（Official Site 结构），affiliate=联盟安全口吻，expert=专家营销口吻 */
copyStyle: AdCopyStyle;
/** 专家模式：DataForSEO SERP 搜到的成功广告（结构化）。 */
referenceAds?: SerpReferenceAd[];
/** 专家模式：插件抓取的 Google SERP 原文（路由侧已截断到 8000 字符内）。 */
serpPageText?: string;
/** 用户提供的当前优惠（如 "Up to 30% Off"）——真实来源，写进 RSA；没有就不编造。 */
promotion?: string;
/** P1-15：节日主题 slug（如 black-friday）。只影响文案，不改变判定。 */
festivalTheme?: string;
/**
 * P1-15：用户填写的真实最大折扣百分比（如 81 = 81% off）。提供时 RSA
 * 必须体现该折扣；未提供时绝不编造折扣数字。
 */
discountPct?: number;
}

/** 规范化 copyStyle 输入，非法值回退到 affiliate（安全口吻）。 */
export function normalizeCopyStyle(input: unknown): AdCopyStyle {
if (input === "official") return "official";
if (input === "expert") return "expert";
return "affiliate";
}

export function buildAdPlanPrompt(input: AdPlanPromptInput): {
system: string;
user: string;
} {
const langName =
input.language === "en"? "English": "Simplified Chinese";
// 大品牌 RSA 打法（Nike/Adidas/Macy's/SKIMS）：标题1=品牌+Official Site+品类/促销，
// 显示路径对齐品类，描述=品类卖点+固定品牌话术+CTA。联盟客用安全版改写。
const styleRules =
input.copyStyle === "official"
? [
"Copy style: OFFICIAL brand voice (authorized to present as the brand). Follow the proven big-brand RSA structure:",
"- Headline 1 pattern: '<Brand> Official Site | <promotion or category>' — when a promotion is provided or found on the page, lead with it (e.g. 'Max & Lily Official Site | Up to 30% Off'); otherwise use the category (e.g. 'Nike Official Site | Shop Running Shoes'). Big-brand ads put the sale in the headline, not just the category.",
"- You may append the ® / ™ symbol directly after the brand name (single Unicode character — it renders as a small superscript automatically), but ONLY when the landing page text itself already uses ® / ™ for that brand. Otherwise use the plain brand name.",
"- Display paths (path1/path2, <= 15 chars each) mirror the landing page category, e.g. shop / running-shoes.",
"- Descriptions: category benefit + one consistent brand tagline repeated across the ad + clear CTA (free shipping threshold, promo code, sale %).",
"- Every headline/description stays specific to the page's category — one ad group, one category.",
"- Official-brand RSA must carry at least one promotional hook (discount / coupon / free shipping / warranty / rating) in the headlines when the page or the user provides one; a plain category-only ad is not acceptable when a real offer exists.",
]
: input.copyStyle === "expert"
? [
// 专家营销口吻：以联盟营销专家身份，学成功广告的打法写营销广告；
// 但仍是联盟身份，绝不自称官方/品牌所有权。
"Copy style: EXPERT affiliate-marketing voice. You are a 20-year affiliate marketing expert. Study the successful ads in the reference material below and write RSA copy using the same winning playbook: strong hooks, concrete benefits, social proof, urgency/scarcity where the landing page supports it, and a clear CTA.",
"- NEVER claim to be the official site/store or the brand owner, and NEVER use 'Official Site' phrasing. You are an affiliate marketer, not the brand.",
"- You may append the ® / ™ symbol directly after the brand name ONLY when the landing page text itself already uses ® / ™ for that brand. Otherwise use the plain brand name.",
"- Headline 1 pattern: '<Category> | <strong benefit or offer>' (e.g. 'Running Shoes | Save 40% Today'). Lead with the strongest hook from the reference ads.",
"- Display paths (path1/path2, <= 15 chars each) mirror the landing page category.",
"- Descriptions: benefit + proof/trust line + urgency + CTA. Every claim must be supported by the landing page or the reference ads; imply no brand ownership, invent no prices/discounts the page does not state.",
"- Do NOT copy any reference ad verbatim — learn the pattern, write original copy for this offer.",
]
: [
"Copy style: AFFILIATE-safe voice. NEVER claim to be the official site/store and NEVER use 'Official Site' phrasing or the ® / ™ symbol after the brand name.",
"- Use reviewer/deal angles instead: Top Rated, Best Deals, Expert Tested, Compare Prices, <Category> Buying Guide.",
"- Headline 1 pattern: '<Category> | <benefit or offer>' (e.g. 'Running Shoes | Best Deals Compared').",
"- Display paths (path1/path2, <= 15 chars each) mirror the landing page category.",
"- Descriptions: category benefit + trust line (tested, compared, updated regularly) + CTA. Keep every claim supported by the landing page; imply no brand ownership.",
];
// 用户提供的当前优惠：最可靠的促销来源。提供时必须写进 RSA（≥2 标题 + ≥1 描述），
// 数字/条款原样照抄不改；没提供时不渲染本段。
const promotionSection: string[] = [];
const promotion = (input.promotion ?? "").trim();
if (promotion) {
promotionSection.push(
"Current promotion (provided by the user — it is real, use it):",
`"${promotion}"`,
"- Use this promotion in at least 2 headlines and 1 description (within the char limits). Do NOT change its numbers or terms; use it as given. If it does not fit a headline, shorten its wording but keep the numbers/terms identical.",
""
);
}
// P1-15：节日主题文案（补充，不替换现有生成）。
// 节日只影响文案：用节日 urgency 话术 + 促销钩子；折扣必须来自用户
// 填写的真实值（discountPct），没有就不编造折扣数字。
const festivalSection: string[] = [];
const festivalTheme = normalizeFestivalThemeInput(input.festivalTheme);
const festivalLabel = festivalTheme
? FESTIVAL_THEME_LABELS[festivalTheme]
: undefined;
const discountPct =
typeof input.discountPct === "number" &&
Number.isFinite(input.discountPct) &&
input.discountPct > 0 &&
input.discountPct < 100
? Math.round(input.discountPct)
: undefined;
if (festivalLabel) {
festivalSection.push(
`Festival theme (chosen by the user): ${festivalLabel}.`,
"- Use festival urgency wording in headlines/descriptions (e.g. limited-time festival sale, ends soon) — but ONLY festival wording, never fake deadlines or countdowns the offer does not state.",
...(discountPct !== undefined
? [
`- The user provided a REAL maximum discount of ${discountPct}% off for this festival. It MUST appear in at least 2 headlines and 1 description (e.g. "Up to ${discountPct}% Off"). Do NOT change the number; do NOT invent any other discount.`,
]
: [
"- No discount was provided for this festival: do NOT invent a discount percentage. Use festival urgency wording only.",
]),
""
);
}
// 专家模式参考材料：结构化成功广告列表，和/或插件抓取的 SERP 原文。
// 两者都没有时不渲染参考段落（专家规则仍生效）。
const referenceSection: string[] = [];
const referenceAds = (input.referenceAds ?? []).filter(
(a) => a && a.title.trim() && a.description.trim()
);
if (referenceAds.length > 0) {
referenceSection.push(
"Reference — successful ads for the same niche (learn their playbook; do NOT copy verbatim):",
...referenceAds.slice(0, 5).map(
(a, i) =>
`${i + 1}. Title: ${a.title.trim()}` +
` | Description: ${a.description.trim()}` +
(a.displayUrl ? ` | Display URL: ${a.displayUrl.trim()}` : "")
),
""
);
}
const serpText = (input.serpPageText ?? "").trim();
if (serpText) {
referenceSection.push(
"Reference — Google search results page captured by the user (raw text). First identify the PAID ads in it, then learn their playbook (hooks, benefits, proof, urgency, CTA) for the RSA below:",
serpText,
""
);
}
const system = [
"You are a Google Ads search campaign builder for an affiliate marketer. Given an offer landing page, produce a complete, policy-safe Search campaign draft.",
`Write ALL JSON string values (campaign/ad group names, headlines, descriptions, keywords) in ${langName}.`,
"Return STRICT JSON only — no markdown fences, no commentary, no trailing text. It must parse with JSON.parse and match this exact shape:",
DRAFT_JSON_SPEC,
"",
"Rules:",
"- headlines: EXACTLY 15 items, each 30 characters or fewer. descriptions: EXACTLY 4 items, each 90 characters or fewer. Never pad with filler; every line must be usable ad copy.",
"- Google Ads policy: no misleading or unrealistic claims (income, health, 'guaranteed'), no excessive capitalization, no repeated punctuation. Keep claims the landing page actually supports.",
"- keywords: 8-20 items with a mix of EXACT, PHRASE and BROAD. Prefer intent-rich phrases a buyer would search. Do NOT include the merchant's brand name in keywords — brand terms are added as negatives automatically.",
"- brandTerms: 3-10 merchant brand names, product-line names and common misspellings/variants. These become negative keywords via exact and phrase match.",
"- suggestedNegatives: additional negative ideas (free, jobs, careers, DIY, torrent, login, etc.) relevant to this offer.",
"- dailyBudget: a realistic starting daily budget for testing this offer (a normal test budget, not an aggressive one).",
"- geoTargets: 1-5 ISO country codes where this offer is most likely to convert.",
"- bidding: MANUAL_CPC with a sensible maxCpc for a new test campaign, or MAXIMIZE_CLICKS with maxCpc null.",
"- campaignName / adGroupName: descriptive, professional, 80 characters or fewer.",
"- path1 / path2: short display-path segments (<= 15 chars each) or null.",
"- finalUrl is the offer URL below — use it verbatim for the ad group and RSA; do not invent URLs.",
"- Promotional hooks: scan the page text for REAL promotional signals (discount %, sale price vs list price, coupon code, free-shipping threshold, warranty, star rating / review count) and use the strongest 1-2 in headlines/descriptions. NEVER invent a discount, price, or percentage the page does not state and the user did not provide. If the page states both a sale price and a list price, you may compute the discount % from those two real numbers.",
...styleRules,
...promotionSection,
...festivalSection,
...referenceSection,
].join("\n");

const user = [
`Offer URL: ${input.url}`,
"",
"Offer page text (may be truncated):",
input.pageText || "(empty)",
].join("\n");

return { system, user};
}

// ---------------------------------------------------------------------------
// Lenient validation (same style as prompts.ts)
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
return typeof v === "object" && v!== null &&!Array.isArray(v);
}

function normEnum<T extends string>(
v: unknown,
allowed: readonly T[],
field: string
): T {
const lv = typeof v === "string"? v.trim().toUpperCase(): "";
if ((allowed as readonly string[]).includes(lv)) return lv as T;
throw new AiError(`LLM returned an unexpected response shape (${field})`);
}

function normNum(
v: unknown,
min: number,
max: number,
field: string
): number {
const n = typeof v === "string" && v.trim()!== ""? Number(v.trim()): v;
if (typeof n === "number" && Number.isFinite(n) && n >= min && n <= max) {
return n;
}
throw new AiError(`LLM returned an unexpected response shape (${field})`);
}

function normStr(v: unknown, field: string, allowEmpty: boolean): string {
if (typeof v!== "string") {
throw new AiError(`LLM returned an unexpected response shape (${field})`);
}
const t = v.trim();
if (!allowEmpty &&!t) {
throw new AiError(`LLM returned an unexpected response shape (${field})`);
}
return t;
}

function normStrArray(
v: unknown,
min: number,
max: number,
field: string
): string[] {
if (!Array.isArray(v)) {
throw new AiError(`LLM returned an unexpected response shape (${field})`);
}
const arr = (v as unknown[])
.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
.map((s) => s.trim());
if (arr.length < min || arr.length > max) {
throw new AiError(`LLM returned an unexpected response shape (${field})`);
}
return arr;
}

/**
 * RSA 文案超长时截断而非扔掉整单：LLM 数不准字符数，重试一次也常超，
 * 但 Google Ads 本来就要求标题 ≤30 / 描述 ≤90，截断后计划直接可用，
 * 用户还能在预览里改。按词边界截断（不断词）；无空格的长词硬截。
 */
export function truncateToLimit(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > 0) return cut.slice(0, lastSpace).trim();
  return cut.trim();
}

const MATCH_TYPES = ["EXACT", "PHRASE", "BROAD"] as const;

/**
* Validate the LLM's per-URL draft. Strict on RSA counts (15 headlines /
* 4 descriptions) and ad-copy length limits — `chatJsonValidated` retries
* once with targeted feedback when the model gets it wrong.
*/
/**
 * Normalize caller-supplied keywords (from 投放选词） into draft shape.
 * Accepts plain strings or { text, matchType } objects; matchType defaults to PHRASE.
 * Returns [] when nothing usable was provided.
 */
export function normalizeUserKeywords(input: unknown): Array<{ text: string; matchType: KeywordMatchType }> {
if (!Array.isArray(input)) return [];
const out: Array<{ text: string; matchType: KeywordMatchType }> = [];
const seen = new Set<string>();
for (const item of input.slice(0, 100)) {
let text = "";
let mt: string = "PHRASE";
if (typeof item === "string") {
text = item.trim();
} else if (item && typeof item === "object") {
const r = item as Record<string, unknown>;
if (typeof r.text === "string") text = r.text.trim();
if (typeof r.matchType === "string") mt = r.matchType.trim().toUpperCase();
}
if (!text || text.length > 80) continue;
const key = text.toLowerCase();
if (seen.has(key)) continue;
seen.add(key);
const matchType = (MATCH_TYPES as readonly string[]).includes(mt)
? (mt as KeywordMatchType)
: "PHRASE";
out.push({ text, matchType });
}
return out;
}

export function validateAdPlanUrlDraft(obj: unknown): AdPlanUrlDraft {if (!isRecord(obj)) {
throw new AiError("LLM returned an unexpected response shape (root)");
}
const o = obj as Record<string, unknown>;
const campaignName = normStr(o.campaignName, "campaignName", false);
if (campaignName.length > 80) {
throw new AiError(
"LLM returned an unexpected response shape (campaignName too long)"
);
}
if (!isRecord(o.dailyBudget)) {
throw new AiError("LLM returned an unexpected response shape (dailyBudget)");
}
const budget = o.dailyBudget as Record<string, unknown>;
const amount = normNum(budget.amount, 0.01, 1_000_000, "dailyBudget.amount");
const currencyRaw = normStr(budget.currency, "dailyBudget.currency", false);
const currency = currencyRaw.toUpperCase();
if (!/^[A-Z]{3}$/.test(currency)) {
throw new AiError(
"LLM returned an unexpected response shape (dailyBudget.currency)"
);
}
const geoTargets = normStrArray(o.geoTargets, 1, 5, "geoTargets").map((g) =>
g.toUpperCase()
);
for (const g of geoTargets) {
if (!/^[A-Z]{2}$/.test(g)) {
throw new AiError(
"LLM returned an unexpected response shape (geoTargets must be ISO alpha-2)"
);
}
}
if (!isRecord(o.bidding)) {
throw new AiError("LLM returned an unexpected response shape (bidding)");
}
const bidding = o.bidding as Record<string, unknown>;
const strategy = normEnum(
bidding.strategy,
["MANUAL_CPC", "MAXIMIZE_CLICKS"] as const,
"bidding.strategy"
);
const maxCpc =
bidding.maxCpc === null || bidding.maxCpc === undefined
? null
: normNum(bidding.maxCpc, 0.01, 10_000, "bidding.maxCpc");

const brandTerms = normStrArray(o.brandTerms, 0, 30, "brandTerms");
const adGroupName = normStr(o.adGroupName, "adGroupName", false);
if (adGroupName.length > 80) {
throw new AiError(
"LLM returned an unexpected response shape (adGroupName too long)"
);
}
if (!Array.isArray(o.keywords)) {
throw new AiError("LLM returned an unexpected response shape (keywords)");
}
const keywords = (o.keywords as unknown[]).map((k, i) => {
if (!isRecord(k)) {
throw new AiError(
`LLM returned an unexpected response shape (keywords[${i}])`
);
}
const text = normStr(
(k as Record<string, unknown>).text,
`keywords[${i}].text`,
false
);
if (text.length > 80) {
throw new AiError(
`LLM returned an unexpected response shape (keywords[${i}].text too long)`
);
}
return {
text,
matchType: normEnum(
(k as Record<string, unknown>).matchType,
MATCH_TYPES,
`keywords[${i}].matchType`
),
};
});
if (keywords.length < 1 || keywords.length > 30) {
throw new AiError("LLM returned an unexpected response shape (keywords)");
}
const suggestedNegatives = normStrArray(
o.suggestedNegatives,
0,
100,
"suggestedNegatives"
);
const headlines = normStrArray(o.headlines, 15, 15, "headlines").map((h) =>
  truncateToLimit(h, 30)
);
const descriptions = normStrArray(o.descriptions, 4, 4, "descriptions").map((d) =>
  truncateToLimit(d, 90)
);
const path1 =
o.path1 === null || o.path1 === undefined
? null
: normStr(o.path1, "path1", true) || null;
const path2 =
o.path2 === null || o.path2 === undefined
? null
: normStr(o.path2, "path2", true) || null;

return {
campaignName,
dailyBudget: { amount, currency},
geoTargets,
bidding: { strategy, maxCpc},
brandTerms,
adGroupName,
keywords,
suggestedNegatives,
headlines,
descriptions,
path1,
path2,
};
}

// ---------------------------------------------------------------------------
// Finalization — deterministic server-side assembly
// ---------------------------------------------------------------------------

export interface FinalizeContext {
planId: string;
tenantId: string;
language: AnalysisLanguage;
offerId: string | null;
googleAccountId: string | null;
copyStyle: AdCopyStyle;
/** Final (post-redirect) URL per draft, in input order. */
finalUrls: string[];
}

function clampBudget(amount: number): number {
return Math.min(MAX_DAILY_BUDGET, Math.max(MIN_DAILY_BUDGET, amount));
}

function assertHttpUrl(raw: string, field: string): string {
let parsed: URL;
try {
parsed = new URL(raw);
} catch {
throw new AiError(`Invalid URL (${field})`);
}
if (parsed.protocol!== "http:" && parsed.protocol!== "https:") {
throw new AiError(`Only http(s) URLs are allowed (${field})`);
}
return parsed.toString();
}

/**
* Assemble the final AdPlan from per-URL drafts. Campaign-level fields come
* from the first draft; each URL becomes one ad group with its own RSA.
* Negative keywords are built deterministically with the brand-check
* helpers (never trusted from the LLM alone).
*/
export function finalizeAdPlan(
drafts: AdPlanUrlDraft[],
ctx: FinalizeContext
): AdPlan {
if (drafts.length === 0) {
throw new AiError("No ad plan drafts to finalize");
}
if (drafts.length!== ctx.finalUrls.length) {
throw new AiError("Draft/URL count mismatch");
}
const first = drafts[0]!;
const budgetAmount = clampBudget(first.dailyBudget.amount);
const campaign: AdPlanCampaign = {
name: first.campaignName.slice(0, 255),
dailyBudget: {
amount: Math.round(budgetAmount * 100) / 100,
currency: first.dailyBudget.currency,
dataQuality: AI_GENERATED_QUALITY,
},
geoTargets: [...new Set(first.geoTargets)].slice(0, 5),
bidding: {
strategy: first.bidding.strategy,
maxCpc:
first.bidding.strategy === "MANUAL_CPC" && first.bidding.maxCpc
? {
amount: first.bidding.maxCpc,
currency: first.dailyBudget.currency,
dataQuality: AI_GENERATED_QUALITY,
}
: null,
},
status: "PAUSED",
dataQuality: AI_GENERATED_QUALITY,
};

const adGroups: AdPlanAdGroupBlock[] = drafts.map((draft, i) => {
const finalUrl = assertHttpUrl(ctx.finalUrls[i]!, `finalUrls[${i}]`);
const keywordTexts = draft.keywords.map((k) => k.text);
// 复用 brand-check 否词逻辑：品牌词 → exact/phrase 否词。
// 联盟安全口吻 / 专家营销口吻：与品牌词冲突的关键词不能出价，从正向移除，转否词。
// 官方口吻：用户已确认条款允许品牌词投放，保留品牌关键词，不转否词
// （否则官方口吻 + 品牌词的计划会被清成 0 关键词，还反转为否词）。
const brandResults = checkBrandConflicts(keywordTexts, draft.brandTerms);
const isOfficial = ctx.copyStyle === "official";
const conflicting = isOfficial
  ? new Set<string>()
  : new Set(brandResults.filter((r) => r.conflict).map((r) => r.keyword));
const positiveKeywords = draft.keywords.filter(
  (k) => !conflicting.has(normalizeKeyword(k.text))
);
const brandNegatives = isOfficial
  ? { exact: [] as string[], phrase: [] as string[] }
  : buildNegativeKeywords(brandResults);
const negatives: AdPlanKeyword[] = [];
const seen = new Set<string>();
const positiveSet = new Set(positiveKeywords.map((k) => normalizeKeyword(k.text)));
const pushNegative = (text: string, matchType: "EXACT" | "PHRASE") => {
const t = normalizeKeyword(text);
if (!t || positiveSet.has(t)) return;
const key = `${matchType}:${t}`;
if (seen.has(key)) return;
seen.add(key);
negatives.push({ text: t, matchType, dataQuality: AI_GENERATED_QUALITY});
};
for (const n of brandNegatives.exact) {
pushNegative(n.replace(/^\[|\]$/g, ""), "EXACT");
}
for (const n of brandNegatives.phrase) {
pushNegative(n.replace(/^"|"$/g, ""), "PHRASE");
}
for (const n of draft.suggestedNegatives) {
pushNegative(n, "PHRASE");
}

return {
group: {
name: draft.adGroupName.slice(0, 255),
finalUrl,
keywords: positiveKeywords.map((k) => ({
text: k.text,
matchType: k.matchType,
dataQuality: AI_GENERATED_QUALITY,
})),
keywordsSource: draft.keywordsSource ?? "ai",
negativeKeywords: negatives.slice(0, 100),
maxCpc:
draft.bidding.strategy === "MANUAL_CPC" && draft.bidding.maxCpc
? {
amount: draft.bidding.maxCpc,
currency: first.dailyBudget.currency,
dataQuality: AI_GENERATED_QUALITY,
}
: null,
dataQuality: AI_GENERATED_QUALITY,
},
rsa: {
headlines: [...draft.headlines],
descriptions: [...draft.descriptions],
finalUrl,
path1: draft.path1?? null,
path2: draft.path2?? null,
dataQuality: AI_GENERATED_QUALITY,
},
};
});

return {
version: 1,
planId: ctx.planId,
tenantId: ctx.tenantId,
language: ctx.language,
sourceUrls: ctx.finalUrls,
offerId: ctx.offerId,
googleAccountId: ctx.googleAccountId,
copyStyle: ctx.copyStyle,
campaign,
adGroups,
createdAt: new Date().toISOString(),
dataQuality: AI_GENERATED_QUALITY,
};
}

// ---------------------------------------------------------------------------
// Copy pack — plain-text asset list for Amazon / manual placement
// ---------------------------------------------------------------------------

function keywordDisplay(k: AdPlanKeyword): string {
if (k.matchType === "EXACT") return `[${k.text}]`;
if (k.matchType === "PHRASE") return `"${k.text}"`;
return k.text;
}

/**
* Build the copy-pack text. Explicitly marked for Amazon / manual placement —
* Amazon has no Script mechanism, so this pack must be created manually.
*/
export function buildCopyPack(plan: AdPlan): string {
const lines: string[] = [];
lines.push("AdLinkLab 广告文案包 (Ad Copy Pack)");
lines.push("=".repeat(46));
lines.push(
"Amazon/手动投放用，需手动创建 —— Amazon 没有 Script 自动建广告机制，"
);
lines.push("请复制以下文案到相应广告平台手动创建广告。");
lines.push(`计划 ID: ${plan.planId}`);
lines.push(`生成时间: ${plan.createdAt}`);
lines.push(
`数据质量: ${plan.dataQuality}（AI 生成，需人工复核后再投放）`
);
lines.push("");
lines.push(`广告系列: ${plan.campaign.name}`);
lines.push(
`预算: ${plan.campaign.dailyBudget.amount} ${plan.campaign.dailyBudget.currency}/天（AI 建议，需人工确认）`
);
lines.push(`地域: ${plan.campaign.geoTargets.join(", ") || "-"}`);
lines.push(`出价: ${plan.campaign.bidding.strategy}`);
lines.push(`状态: ${plan.campaign.status}（新建为暂停，人工审核后开启）`);
lines.push("");

plan.adGroups.forEach((block, gi) => {
const g = block.group;
const rsa = block.rsa;
lines.push(`--- 广告组 ${gi + 1}: ${g.name} ---`);
lines.push(`终链 URL: ${g.finalUrl}`);
lines.push("");
lines.push("[关键词]");
for (const k of g.keywords) {
lines.push(` ${keywordDisplay(k)}`);
}
lines.push("");
lines.push("[否词]");
if (g.negativeKeywords.length === 0) {
lines.push(" （无）");
} else {
for (const k of g.negativeKeywords) {
lines.push(` ${keywordDisplay(k)}`);
}
}
lines.push("");
lines.push("[RSA 标题 × 15]");
rsa.headlines.forEach((h, i) => lines.push(` ${i + 1}. ${h}`));
lines.push("");
lines.push("[RSA 描述 × 4]");
rsa.descriptions.forEach((d, i) => lines.push(` ${i + 1}. ${d}`));
if (rsa.path1 || rsa.path2) {
lines.push("");
lines.push(
`[展示路径] ${rsa.path1?? ""}${rsa.path2? ` / ${rsa.path2}`: ""}`
);
}
lines.push("");
});

lines.push("=".repeat(46));
lines.push("由 AdLinkLab 自动化广告生成；投放前请人工复核文案与预算。");
return lines.join("\n");
}

// ---------------------------------------------------------------------------
// In-memory plan store (preview → confirm)
// ---------------------------------------------------------------------------

export interface StoredPlan {
plan: AdPlan;
expiresAt: number;
}

export const PLAN_STORE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const PLAN_STORE_MAX_SIZE = 500;

/** Create an isolated plan store (injectable for tests). */
export function createPlanStore(
ttlMs: number = PLAN_STORE_TTL_MS,
maxSize: number = PLAN_STORE_MAX_SIZE
) {
const map = new Map<string, StoredPlan>();
return {
put(plan: AdPlan): string {
if (map.size >= maxSize) {
const oldest = map.keys().next();
if (!oldest.done) map.delete(oldest.value);
}
map.set(plan.planId, { plan, expiresAt: Date.now() + ttlMs});
return plan.planId;
},
get(planId: string): StoredPlan | null {
const stored = map.get(planId);
if (!stored) return null;
if (stored.expiresAt <= Date.now()) {
map.delete(planId);
return null;
}
return stored;
},
size(): number {
return map.size;
},
};
}

export type PlanStore = ReturnType<typeof createPlanStore>;

/** Process-wide singleton used by the routes when no store is injected. */
export const adPlanStore: PlanStore = createPlanStore();
