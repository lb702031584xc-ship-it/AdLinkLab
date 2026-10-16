/**
 * 关键词 AI 检查：投流前逐词判定相关性与政策风险。
 *
 * 背景：AI 生成的关键词里可能混入与产品无关的词（如给家用健身器材
 * offer 生成"潜水刀"），一旦建进广告既浪费点击又有政策风险。
 * 本模块只做 prompt 构建 + 响应校验（跟随 ad-generator.ts 的
 * strict JSON / AiError 风格）；空关键词列表直接返回空结果，不调 LLM。
 */
import { AiError, chatJson, chatJsonValidated } from "./llm.js";
import type { AnalysisLanguage } from "./prompts.js";

export type KeywordVerdict = "relevant" | "irrelevant" | "risky";

export interface KeywordCheckResult {
  keyword: string;
  verdict: KeywordVerdict;
  reason: string;
}

export interface KeywordCheckInput {
  productDescription: string;
  offerName: string;
  offerUrl?: string;
  keywords: string[];
  language: AnalysisLanguage;
}

/** 服务端一次检查的关键词上限（路由层超了返回 400）。 */
export const KEYWORD_CHECK_MAX_KEYWORDS = 50;

const VERDICTS: readonly KeywordVerdict[] = ["relevant", "irrelevant", "risky"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 每词 trim 后去空；非数组输入按空列表处理。 */
export function normalizeCheckKeywords(keywords: unknown): string[] {
  if (!Array.isArray(keywords)) return [];
  const out: string[] = [];
  for (const k of keywords) {
    if (typeof k !== "string") continue;
    const t = k.trim();
    if (t) out.push(t);
  }
  return out;
}

export function buildKeywordCheckPrompt(input: KeywordCheckInput): {
  system: string;
  user: string;
} {
  const langName = input.language === "en" ? "English" : "Simplified Chinese";
  const system = [
    "You are a Google Ads keyword reviewer for an affiliate marketer. Given a product and a list of candidate keywords, judge each keyword's relevance and policy risk.",
    `Write ALL reason strings in ${langName}.`,
    "Return STRICT JSON only — no markdown fences, no commentary, no trailing text. It must parse with JSON.parse and match this exact shape:",
    '{"results": [{"keyword": "...", "verdict": "relevant|irrelevant|risky", "reason": "..."}]}',
    "",
    "Rules:",
    "- relevant: the keyword is directly related to the product / product category — a buyer searching it could plausibly want this product.",
    "- irrelevant: the keyword is unrelated to the product (e.g. 'dive knife' for home fitness equipment). Do NOT invent a connection; judge by what the searcher wants, not by shared words.",
    "- risky: the keyword is policy-sensitive — weapons, medical/health claims, adult content, gambling, counterfeit/replica goods, or trademark misuse. Risky beats relevant: a related but policy-sensitive keyword is risky.",
    "- reason: one sentence explaining the verdict, grounded in the product description.",
    "- Judge every keyword in the list; return one result per keyword, in the same order.",
  ].join("\n");

  const user = [
    `Offer: ${input.offerName}`,
    input.offerUrl ? `Offer URL: ${input.offerUrl}` : "",
    "",
    "Product description:",
    input.productDescription,
    "",
    "Keywords to check:",
    input.keywords.map((k, i) => `${i + 1}. ${k}`).join("\n"),
  ]
    .filter((line) => line !== "")
    .join("\n");

  return { system, user };
}

/** 校验 LLM 返回的 shape：results 数组，每项 keyword 非空、verdict 三者之一、reason 非空。 */
export function validateKeywordCheckShape(obj: unknown): {
  results: KeywordCheckResult[];
} {
  if (!isRecord(obj)) {
    throw new AiError("LLM returned an unexpected response shape (root)");
  }
  if (!Array.isArray(obj.results)) {
    throw new AiError("LLM returned an unexpected response shape (results)");
  }
  const results: KeywordCheckResult[] = obj.results.map((item, i) => {
    if (!isRecord(item)) {
      throw new AiError(`LLM returned an unexpected response shape (results[${i}])`);
    }
    const keyword = typeof item.keyword === "string" ? item.keyword.trim() : "";
    if (!keyword) {
      throw new AiError(`LLM returned an unexpected response shape (results[${i}].keyword)`);
    }
    if (
      typeof item.verdict !== "string" ||
      !(VERDICTS as readonly string[]).includes(item.verdict)
    ) {
      throw new AiError(`LLM returned an unexpected response shape (results[${i}].verdict)`);
    }
    const reason = typeof item.reason === "string" ? item.reason.trim() : "";
    if (!reason) {
      throw new AiError(`LLM returned an unexpected response shape (results[${i}].reason)`);
    }
    return { keyword, verdict: item.verdict as KeywordVerdict, reason };
  });
  return { results };
}

export interface KeywordCheckLlmSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
}

/**
 * 对一批关键词做 AI 检查。keywords 为空时直接返回空 results，不调 LLM。
 * LLM 调用走 chatJsonValidated（校验失败自动重试一次，带上拒绝原因）。
 */
export async function checkKeywords(
  input: KeywordCheckInput,
  settings: KeywordCheckLlmSettings,
  chatJsonImpl: typeof chatJson = chatJson
): Promise<{ results: KeywordCheckResult[] }> {
  const keywords = normalizeCheckKeywords(input.keywords);
  if (keywords.length === 0) {
    return { results: [] };
  }
  const { system, user } = buildKeywordCheckPrompt({ ...input, keywords });
  try {
    return await chatJsonValidated(
      {
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey: settings.apiKey,
        system,
        user,
      },
      validateKeywordCheckShape,
      chatJsonImpl
    );
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw new AiError(
      `LLM request failed: ${e instanceof Error ? e.message : "unknown error"}`
    );
  }
}
