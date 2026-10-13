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
  landingMode: TrafficMode;
  brandPolicy: BrandPolicy;
  language: AnalysisLanguage;
  keywordCount?: number;
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
  language: AnalysisLanguage
): { system: string; user: string } {
  const system =
    language === "en"
      ? "You are a 20-year affiliate paid-traffic expert specializing in Google Ads keyword strategy. Return JSON only. Important: you have no live volume/CPC data; never invent numeric scores, only give keyword ideas."
      : "You are a 20-year affiliate paid-traffic expert specializing in Google Ads keyword strategy. Return JSON only. Important: you have no live volume/CPC data; never invent numeric scores, only give keyword ideas.";
  const user =
    language === "en"
      ? `Suggest ${count} English keyword ideas worth checking in SEMRUSH/Keyword Planner for product/niche "${product}". Cover high-intent patterns (best/review/vs/discount/buy modifiers) and long-tail. Avoid informational-only terms. One-line reason per keyword (why this pattern is worth checking; never invent volume or scores). Return JSON only: {"keywords":[{"keyword":"...","reason":"..."}]}`
      : `为产品/品类"${product}"推荐 ${count} 个值得去 SEMRUSH/关键词规划师查数据的英文关键词思路。要求：覆盖高购买意图词型（best/review/vs/discount/buy 修饰）、长尾词；避开纯信息类词。每个词给一句话选词理由（说明这个词型为什么值得查，不要编造搜索量或评分）。只返回 JSON：{"keywords":[{"keyword":"...","reason":"..."}]}`;
  return { system, user };
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

  // 3. 关键词计划
  const keywords: OfferBlueprint["keywords"] = { items: [], error: null };
  try {
    const count = Math.min(Math.max(input.keywordCount ?? 12, 5), 20);
    const { system, user } = buildKeywordPrompt(input.offerName, count, language);
    const raw = (await chat({
      ...llmArgs,
      system: system + '\nReturn JSON: {"keywords":[{"keyword":"...","reason":"..."}]}',
      user,
    })) as { keywords?: Array<{ keyword?: unknown; reason?: unknown }> };
    keywords.items = (raw.keywords ?? [])
      .filter((k) => typeof k.keyword === "string" && (k.keyword as string).trim())
      .slice(0, count)
      .map((k) => {
        const kw = (k.keyword as string).trim();
        return {
          keyword: kw,
          reason: typeof k.reason === "string" ? k.reason.trim() : "",
          matchType: suggestMatchType(kw),
        };
      });
  } catch (e) {
    keywords.error = llmErrorMessage(e);
  }

  // 4. 广告文案（affiliate-safe；用合成页面文字跳过抓取）
  const adPlan: OfferBlueprint["adPlan"] = { plan: null, error: null };
  try {
    const pageText = [
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
