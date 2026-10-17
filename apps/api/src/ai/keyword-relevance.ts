/**
 * 关键词相关性 AI 判断：SEMrush 给出的关键词里很多是“沾边但不相关”的
 * （比如给 GREENVINES 椅子品牌返回 "greenvine baptist church"）。
 * 付费投流只能收割相关搜索需求，不相关的量再大也不能算进需求门槛。
 * 这个函数逐个判断：只认与该 offer 产品/品类/品牌相关、且带购买或
 * 对比意图的词；纯信息类、其他品牌导航、离题词一律判不相关。
 */
import { chatJson } from "./llm.js";

export interface RelevanceInputKeyword {
  keyword: string;
  volume?: number | null;
  competition?: string | null;
  intent?: string | null;
}

export interface KeywordJudgment {
  keyword: string;
  relevant: boolean;
  reason: string;
}

export function buildRelevancePrompt(
  offerName: string,
  offerDescription: string,
  keywords: RelevanceInputKeyword[],
  language: "zh" | "en"
): { system: string; user: string } {
  const lines = keywords
    .slice(0, 50)
    .map((k, i) => {
      const parts = [`${i + 1}. ${k.keyword}`];
      if (k.volume != null) parts.push(`搜索量 ${k.volume}/月`);
      if (k.competition) parts.push(`竞争 ${k.competition}`);
      if (k.intent) parts.push(`意图 ${k.intent}`);
      return parts.join("，");
    })
    .join("\n");
  if (language === "en") {
    return {
      system:
        "You are a paid-search relevance judge. Return JSON only. Never invent: judge only the keywords given, against this exact offer.",
      user: `Offer: ${offerName}${offerDescription ? ` — ${offerDescription}` : ""}\n\nJudge each keyword: RELEVANT only if it is about this offer's product/category/brand AND carries buying or comparison intent (buy, best, review, price, coupon, vs, alternatives, deal, near me). IRRELEVANT if: purely informational (how to, what is), navigational to another brand, off-topic (church, jobs, free, adult, piracy), or about a different product.\n\nReturn JSON only: {"judgments":[{"keyword":"...","relevant":true,"reason":"≤20 words"}]}\n\nKeywords:\n${lines}`,
    };
  }
  return {
    system:
      "你是一个付费搜索相关性判断专家。只返回 JSON。绝不编造：只判断给出的关键词，针对这一个 offer。",
    user: `Offer：${offerName}${offerDescription ? ` — ${offerDescription}` : ""}\n\n逐个判断关键词：相关（relevant=true）当且仅当——词与该 offer 的产品/品类/品牌相关，且带购买或对比意图（买、最好、评测、价格、优惠券、vs、替代、deal、附近）。不相关（relevant=false）如果：纯信息类（怎么、是什么）、导航到其他品牌、离题（教堂、招聘、免费、成人、盗版）、其他产品。\n\n只返回 JSON：{"judgments":[{"keyword":"...","relevant":true,"reason":"不超过20字"}]}\n\n关键词：\n${lines}`,
  };
}

/** 校验 + 清洗：只认请求里发过的词，reason 截短，relevant 强制布尔。 */
export function normalizeJudgments(
  raw: unknown,
  sent: RelevanceInputKeyword[]
): KeywordJudgment[] {
  const sentSet = new Set(sent.map((k) => k.keyword.trim().toLowerCase()));
  const list = (raw as { judgments?: unknown })?.judgments;
  if (!Array.isArray(list)) return [];
  const out: KeywordJudgment[] = [];
  for (const item of list) {
    const kw = (item as { keyword?: unknown })?.keyword;
    if (typeof kw !== "string") continue;
    if (!sentSet.has(kw.trim().toLowerCase())) continue;
    if (out.some((o) => o.keyword.trim().toLowerCase() === kw.trim().toLowerCase())) continue;
    const relevant = (item as { relevant?: unknown })?.relevant === true;
    const reason = (item as { reason?: unknown })?.reason;
    out.push({
      keyword: kw,
      relevant,
      reason: typeof reason === "string" ? reason.slice(0, 100) : "",
    });
  }
  return out;
}

export async function judgeKeywordRelevance(
  deps: {
    baseUrl: string;
    model: string;
    apiKey: string;
    chatJsonImpl?: typeof chatJson;
    language?: "zh" | "en";
  },
  offerName: string,
  offerDescription: string,
  keywords: RelevanceInputKeyword[]
): Promise<KeywordJudgment[]> {
  const language = deps.language ?? "zh";
  const { system, user } = buildRelevancePrompt(
    offerName,
    offerDescription,
    keywords,
    language
  );
  const chat = deps.chatJsonImpl ?? chatJson;
  const raw = await chat({
    baseUrl: deps.baseUrl,
    model: deps.model,
    apiKey: deps.apiKey,
    system: system + '\nReturn JSON: {"judgments":[{"keyword":"...","relevant":true,"reason":"..."}]}',
    user,
  });
  return normalizeJudgments(raw, keywords);
}
