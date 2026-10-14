/**
 * Offer 一键推演报告 — new-offer blueprint orchestrator.
 *
 * Input: offer basics (+ optional terms text pasted by the user).
 * Output: a 7-section report mirroring the manual walkthrough docs:
 *   0. offer 档案 (echo + payout, computed in code)
 *   1. 条款解析 (prompts.ts buildTermsPrompt, LLM; skipped when no terms text)
 *   2. 盈利测算 (deterministic break-even CPC table — never invented by LLM)
 *   3. 关键词计划 (recommend-keywords prompt; no fake volumes/scores by contract)
 *   4. 广告文案 (ad-generator.ts, affiliate-safe voice, synthetic page text)
 *   5. 投流决策 (traffic-planner.ts combo → markdown report)
 *   6. 监控规则 (deterministic from payout)
 *   7. 综合决策 (deterministic rules over terms verdict + payout tier)
 *
 * LLM sections are fail-soft: a failed section is recorded with its error
 * message and the remaining sections still render, so one flaky call does
 * not nuke the whole report.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import { AiError, chatJson } from "./llm.js";
import {
  buildTermsPrompt,
  validateTermsShape,
  type AnalysisLanguage,
  type TermsShape,
} from "./prompts.js";
import {
  buildAdPlanPrompt,
  finalizeAdPlan,
  validateAdPlanUrlDraft,
  type AdPlan,
} from "./ad-generator.js";
import {
  buildTrafficPlanPrompt,
  getComboProfile,
  type BrandPolicy,
  type TrafficMode,
} from "./traffic-planner.js";

export interface BlueprintInput {
  offerName: string;
  productDescription: string;
  avgPrice: number | null;
  commissionType: "percentage" | "fixed";
  /** 40 = 40% when percentage; currency amount when fixed. */
  commissionValue: number;
  currency: string;
  targetMarket: string;
  termsText?: string | null;
  offerUrl?: string | null;
  /** 抓取到的页面正文（offer-fetch）：提供则广告生成直接用它，不再拼合成 */
  pageText?: string | null;
  landingMode: TrafficMode;
  brandPolicy: BrandPolicy;
  language: AnalysisLanguage;
  keywordCount?: number;
  /** 用户已选的关键词（来自关键词页/手动输入）：推演优先评估它们，再补充。 */
  seedKeywords?: string[];
}

export interface BlueprintDeps {
  prisma: PrismaClient;
  tenantId: string;
  userId: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Injectable for tests. */
  chatJsonImpl?: typeof chatJson;
}

export interface BlueprintKeyword {
  keyword: string;
  reason: string;
  matchType: "exact" | "phrase";
  /** user = 用户已选（关键词页/手动），ai = AI 补充。 */
  source?: "user" | "ai";
}

export interface BlueprintProfit {
  payout: number | null;
  payoutCurrency: string;
  /** Break-even CPC = payout × CVR, computed in code. */
  breakEven: Array<{ cvrPct: number; breakEvenCpc: number | null }>;
  note: string;
}

export interface BlueprintMonitor {
  currency: string;
  /** 单个关键词花费到此且 0 转化 → 暂停该词 */
  stopLossPerKeyword: number | null;
  /** 系列累计花费到此且 ROAS<1 → 暂停重做 */
  campaignKillSpend: number | null;
  /** 连续 3 天 CPA ≤ 此值 → 加预算 */
  scaleCpa: number | null;
  /** 测试期建议日预算 */
  testDailyBudget: string;
}

export type BlueprintVerdictLevel = "go" | "caution" | "stop";

export interface OfferBlueprint {
  offer: {
    name: string;
    productDescription: string;
    avgPrice: number | null;
    commissionType: "percentage" | "fixed";
    commissionValue: number;
    currency: string;
    targetMarket: string;
    landingMode: TrafficMode;
    brandPolicy: BrandPolicy;
  };
  payout: number | null;
  payoutCurrency: string;
  terms: { skipped: boolean; result: TermsShape | null; error: string | null };
  profit: BlueprintProfit;
  keywords: { items: BlueprintKeyword[]; error: string | null };
  adPlan: { plan: AdPlan | null; error: string | null };
  traffic: { report: string | null; combo: string | null; error: string | null };
  monitor: BlueprintMonitor;
  verdict: { level: BlueprintVerdictLevel; reasons: string[] };
  generatedAt: string;
}

/** payout: percentage → avgPrice × pct/100; fixed → value. Null when not computable. */
export function computeBlueprintPayout(input: BlueprintInput): number | null {
  if (input.commissionType === "fixed") {
    return Number.isFinite(input.commissionValue) && input.commissionValue > 0
      ? round2(input.commissionValue)
      : null;
  }
  if (
    input.avgPrice == null ||
    !Number.isFinite(input.avgPrice) ||
    input.avgPrice <= 0 ||
    !Number.isFinite(input.commissionValue) ||
    input.commissionValue <= 0
  ) {
    return null;
  }
  return round2((input.avgPrice * input.commissionValue) / 100);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildKeywordPrompt(
  product: string,
  count: number,
  language: AnalysisLanguage,
  seeds: string[] = []
): { system: string; user: string } {
  const system =
    language === "en"
      ? "You are a 20-year affiliate paid-traffic expert specializing in Google Ads keyword strategy. Return JSON only. Important: you have no live volume/CPC data; never invent numeric scores, only give keyword ideas."
      : "You are a 20-year affiliate paid-traffic expert specializing in Google Ads keyword strategy. Return JSON only. Important: you have no live volume/CPC data; never invent numeric scores, only give keyword ideas.";
  const seedLine =
    seeds.length === 0
      ? ""
      : language === "en"
        ? ` The user already selected these keywords: ${seeds.map((x) => `"${x}"`).join(", ")}. Evaluate each one (one-line reason: worth bidding and why / watch-outs), list them FIRST with source "user", then add supplements to reach ${count} total keywords (never repeat the user's keywords; supplements get source "ai").`
        : ` 用户已经选了这些关键词：${seeds.map((x) => `"${x}"`).join("、")}。逐个评估（给一句话理由：是否值得投、注意什么），在返回列表里先放这些词（source 标 "user"），再补充到共 ${count} 个词（补充的不许和已有的重复，source 标 "ai"）。`;
  const user =
    language === "en"
      ? `Suggest ${count} English keyword ideas worth checking in SEMRUSH/Keyword Planner for product/niche "${product}". Cover high-intent patterns (best/review/vs/discount/buy modifiers) and long-tail. Avoid informational-only terms. One-line reason per keyword (why this pattern is worth checking; never invent volume or scores).${seedLine} Return JSON only: {"keywords":[{"keyword":"...","reason":"...","source":"user|ai"}]}`
      : `为产品/品类"${product}"推荐 ${count} 个值得去 SEMRUSH/关键词规划师查数据的英文关键词思路。要求：覆盖高购买意图词型（best/review/vs/discount/buy 修饰）、长尾词；避开纯信息类词。每个词给一句话选词理由（说明这个词型为什么值得查，不要编造搜索量或评分）。${seedLine} 只返回 JSON：{"keywords":[{"keyword":"...","reason":"...","source":"user|ai"}]}`;
  return { system, user };
}

/**
 * 合并关键词：用户种子全部保留在前（AI 若评估过则用 AI 的理由，否则用默认理由），
 * AI 补充去重后补足到 count 个。绝不丢用户已选的词。
 */
export function mergeKeywordItems(
  seeds: string[],
  aiItems: Array<{ keyword?: unknown; reason?: unknown; source?: unknown }>,
  count: number,
  language: AnalysisLanguage
): BlueprintKeyword[] {
  const seen = new Set<string>();
  const out: BlueprintKeyword[] = [];
  const fallbackReason =
    language === "en" ? "Your selected keyword" : "你已选的关键词";
  const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  for (const s of seeds) {
    const kw = clean(s);
    if (!kw) continue;
    const key = kw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const ai = aiItems.find((a) => clean(a.keyword).toLowerCase() === key);
    out.push({
      keyword: kw,
      reason: clean(ai?.reason) || fallbackReason,
      matchType: suggestMatchType(kw),
      source: "user",
    });
  }
  for (const a of aiItems) {
    if (out.length >= count) break;
    const kw = clean(a.keyword);
    if (!kw) continue;
    const key = kw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      keyword: kw,
      reason: clean(a.reason),
      matchType: suggestMatchType(kw),
      source: "ai",
    });
  }
  return out;
}

/** 词越短越核心 → exact；长尾 → phrase. */
export function suggestMatchType(keyword: string): "exact" | "phrase" {
  const words = keyword.trim().split(/\s+/).length;
  return words <= 3 ? "exact" : "phrase";
}

function llmErrorMessage(e: unknown): string {
  if (e instanceof AiError) return e.message;
  return e instanceof Error ? e.message : "LLM request failed";
}

export async function generateBlueprint(
  deps: BlueprintDeps,
  input: BlueprintInput
): Promise<OfferBlueprint> {
  const chat = deps.chatJsonImpl ?? chatJson;
  const llmArgs = {
    baseUrl: deps.baseUrl,
    model: deps.model,
    apiKey: deps.apiKey,
  };
  const payout = computeBlueprintPayout(input);
  const language = input.language;

  // 1. 条款解析（可选）
  const terms: OfferBlueprint["terms"] = { skipped: true, result: null, error: null };
  const termsText = (input.termsText ?? "").trim();
  if (termsText.length >= 50) {
    terms.skipped = false;
    try {
      const { system, user } = buildTermsPrompt(termsText.slice(0, 12_000), language);
      terms.result = await chatJsonValidatedShim(
        chat,
        { ...llmArgs, system, user },
        validateTermsShape
      );
    } catch (e) {
      terms.error = llmErrorMessage(e);
    }
  }

  // 2. 盈利测算（纯代码）
  const cvrGrid = [2, 5];
  const profit: BlueprintProfit = {
    payout,
    payoutCurrency: input.currency,
    breakEven: cvrGrid.map((cvrPct) => ({
      cvrPct,
      breakEvenCpc: payout == null ? null : round2(payout * (cvrPct / 100)),
    })),
    note:
      language === "en"
        ? "Break-even CPC = payout × assumed CVR. CVRs are assumptions, not measured data — verify with Keyword Planner + landing page tests."
        : "保本 CPC = payout × 假设转化率。转化率为假设区间、非实测数据，请以关键词规划师真实 CPC 和落地页实测为准。",
  };

  // 3. 关键词计划：用户已选的种子优先，AI 评估+补充
  const keywords: OfferBlueprint["keywords"] = { items: [], error: null };
  try {
    const count = Math.min(Math.max(input.keywordCount ?? 12, 5), 20);
    const seeds = (input.seedKeywords ?? [])
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean)
      .slice(0, 50);
    const { system, user } = buildKeywordPrompt(input.offerName, count, language, seeds);
    const raw = (await chat({
      ...llmArgs,
      system:
        system +
        '\nReturn JSON: {"keywords":[{"keyword":"...","reason":"...","source":"user|ai"}]}',
      user,
    })) as {
      keywords?: Array<{ keyword?: unknown; reason?: unknown; source?: unknown }>;
    };
    keywords.items = mergeKeywordItems(seeds, raw.keywords ?? [], count, language);
  } catch (e) {
    keywords.error = llmErrorMessage(e);
  }

  // 4. 广告文案（affiliate-safe；有抓取正文就用它，否则用合成页面文字跳过抓取）
  const adPlan: OfferBlueprint["adPlan"] = { plan: null, error: null };
  try {
    const fetchedText = (input.pageText ?? "").trim();
    const pageText = fetchedText
      ? fetchedText.slice(0, 12_000)
      : [
          `Product: ${input.offerName}`,
          input.productDescription.trim(),
          input.avgPrice != null ? `Price: ${input.avgPrice} ${input.currency}` : "",
          `Target market: ${input.targetMarket}`,
        ]
          .filter(Boolean)
          .join("\n")
          .slice(0, 12_000);
    const url = (input.offerUrl ?? "").trim() || "https://blueprint.local/offer";
    const draft = await chatJsonValidatedShim(
      chat,
      { ...llmArgs, ...buildAdPlanPrompt({ url, pageText, language, copyStyle: "affiliate" }) },
      validateAdPlanUrlDraft
    );
    adPlan.plan = finalizeAdPlan([draft], {
      planId: randomUUID(),
      tenantId: deps.tenantId,
      language,
      offerId: null,
      googleAccountId: null,
      copyStyle: "affiliate",
      finalUrls: [url],
    });
  } catch (e) {
    adPlan.error = llmErrorMessage(e);
  }

  // 5. 投流决策
  const traffic: OfferBlueprint["traffic"] = { report: null, combo: null, error: null };
  try {
    const profile = getComboProfile(input.landingMode, input.brandPolicy);
    const { system, user } = buildTrafficPlanPrompt({
      mode: input.landingMode,
      brandPolicy: input.brandPolicy,
      language,
      offerName: input.offerName,
      payout: payout ?? undefined,
      // 第 3 步的关键词思路透传：无 CPC 数据时每行判"数据不足"，不编造
      keywords: keywords.items.map((k) => ({ keyword: k.keyword })),
      negativeKeywords: [],
    });
    const raw = (await chat({
      ...llmArgs,
      system: system + '\nReturn JSON: {"report": "<markdown report>"}',
      user,
    })) as { report?: unknown };
    traffic.report =
      typeof raw?.report === "string" ? raw.report : JSON.stringify(raw);
    traffic.combo = profile.key;
  } catch (e) {
    traffic.error = llmErrorMessage(e);
  }

  // 6. 监控规则（纯代码）
  const monitor: BlueprintMonitor = {
    currency: input.currency,
    stopLossPerKeyword: payout == null ? null : round2(payout * 2),
    campaignKillSpend: payout == null ? null : round2(Math.max(150, payout * 6)),
    scaleCpa: payout == null ? null : round2(payout * 0.7),
    testDailyBudget:
      language === "en"
        ? payout != null && payout >= 20
          ? "$20–30/day to start (higher-payout offer)"
          : "$10–15/day to start (thin-payout offer, keep it small)"
        : payout != null && payout >= 20
          ? "测试期 $20–30/天（高 payout offer）"
          : "测试期 $10–15/天（payout 薄，预算从小）",
  };

  // 7. 综合决策（确定性规则）
  const reasons: string[] = [];
  let level: BlueprintVerdictLevel = "caution";
  const termsVerdict = terms.result?.overallVerdict ?? null;
  if (termsVerdict === "stop") {
    level = "stop";
    reasons.push(
      language === "en"
        ? "Offer terms verdict is STOP — do not run paid traffic to this offer."
        : "条款解析结论为 STOP——不要给这个 offer 投付费流量。"
    );
  } else {
    if (!termsText) {
      reasons.push(
        language === "en"
          ? "No terms text provided — verdict capped at CAUTION until terms are reviewed."
          : "未提供条款文本——在人工核对条款前结论最高为 CAUTION。"
      );
    } else if (termsVerdict === "caution") {
      reasons.push(
        language === "en"
          ? "Offer terms verdict is CAUTION — respect the flagged restrictions."
          : "条款解析结论为 CAUTION——遵守标出的限制条款。"
      );
    }
    if (payout == null) {
      reasons.push(
        language === "en"
          ? "Payout could not be computed — fill in price/commission."
          : "payout 算不出来——请补全价格/佣金。"
      );
    } else if (payout < 5) {
      reasons.push(
        language === "en"
          ? `Payout ${input.currency} ${payout} is thin — break-even CPC leaves almost no room; prefer content/SEO or a higher-payout offer.`
          : `payout 仅 ${input.currency} ${payout}——保本 CPC 几乎没有操作空间，优先考虑内容/SEO 或更高 payout 的 offer。`
      );
    }
    const llmFailed = [terms.error, keywords.error, adPlan.error, traffic.error].filter(Boolean);
    if (llmFailed.length > 0) {
      reasons.push(
        language === "en"
          ? `${llmFailed.length} AI section(s) failed to generate — review before spending.`
          : `有 ${llmFailed.length} 个 AI 板块生成失败——投放前请人工补齐。`
      );
    }
    if (
      termsVerdict === "go" &&
      payout != null &&
      payout >= 20 &&
      llmFailed.length === 0
    ) {
      level = "go";
      reasons.push(
        language === "en"
          ? "Terms allow paid traffic and payout supports a workable break-even CPC — proceed with the monitoring rules."
          : "条款允许投放且 payout 撑得起保本 CPC——按监控规则小预算起量。"
      );
    }
    if (reasons.length === 0) {
      reasons.push(
        language === "en"
          ? "No hard blockers found — start small and let the monitoring rules decide."
          : "未发现硬性阻碍——小预算起步，让监控规则做决定。"
      );
    }
  }

  const blueprint: OfferBlueprint = {
    offer: {
      name: input.offerName,
      productDescription: input.productDescription,
      avgPrice: input.avgPrice,
      commissionType: input.commissionType,
      commissionValue: input.commissionValue,
      currency: input.currency,
      targetMarket: input.targetMarket,
      landingMode: input.landingMode,
      brandPolicy: input.brandPolicy,
    },
    payout,
    payoutCurrency: input.currency,
    terms,
    profit,
    keywords,
    adPlan,
    traffic,
    monitor,
    verdict: { level, reasons },
    generatedAt: new Date().toISOString(),
  };

  // 持久化：复用 ai_analyses 历史（inputKind="blueprint"）
  await deps.prisma.aiAnalysis.create({
    data: {
      id: randomUUID(),
      tenantId: deps.tenantId,
      userId: deps.userId,
      inputKind: "blueprint",
      inputRef: input.offerName.slice(0, 64),
      merchant: input.offerName.slice(0, 128),
      network: null,
      payout,
      payoutCurrency: input.currency,
      estimatedCpc: null,
      result: JSON.parse(JSON.stringify(blueprint)) as never,
    },
  });

  return blueprint;
}

/** chatJsonValidated 的轻量本地封装（保持与 routes/ai.ts 一致的错误语义）。 */
async function chatJsonValidatedShim<T>(
  chat: typeof chatJson,
  args: Parameters<typeof chatJson>[0],
  validate: (obj: unknown) => T
): Promise<T> {
  let raw: unknown;
  try {
    raw = await chat(args);
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw new AiError("LLM request failed");
  }
  try {
    return validate(raw);
  } catch (e) {
    throw new AiError(
      e instanceof Error ? `LLM response validation failed: ${e.message}` : "LLM response validation failed"
    );
  }
}

export interface OfferMeta {
  title: string | null;
  description: string | null;
  price: number | null;
  currency: string | null;
}

function metaContent(html: string, attr: "name" | "property", key: string): string | null {
  const re = new RegExp(
    `<meta[^>]+${attr}=["']${key}["'][^>]*>`,
    "i"
  );
  const tag = html.match(re)?.[0];
  if (!tag) return null;
  const content = tag.match(/content=["']([^"']{1,500})["']/i)?.[1];
  return content?.trim() || null;
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/\s*[|\-–—]\s*[^-|–—]{1,60}$/, "")
    .trim()
    .slice(0, 120);
}

/**
 * 从抓取的 HTML/正文里提取 offer 元信息（best-effort：用户在前端确认后才用）。
 * 价格只认 $ / USD / € / £ 数字格式，抓不到就返回 null，不编造。
 */
export function extractOfferMeta(html: string, text: string): OfferMeta {
  const rawTitle =
    html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim() ||
    metaContent(html, "property", "og:title");
  const description =
    metaContent(html, "name", "description") ||
    metaContent(html, "property", "og:description");

  let price: number | null = null;
  let currency: string | null = null;
  const priceRe =
    /(USD|US\$|\$|€|£)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/;
  const m = text.match(priceRe);
  if (m) {
    const symbol = m[1];
    const num = Number(m[2].replace(/,/g, ""));
    if (Number.isFinite(num) && num > 0 && num < 1_000_000) {
      price = Math.round(num * 100) / 100;
      currency = symbol === "€" ? "EUR" : symbol === "£" ? "GBP" : "USD";
    }
  }

  return {
    title: rawTitle ? cleanTitle(rawTitle) : null,
    description: description?.slice(0, 300) ?? null,
    price,
    currency,
  };
}
