/**
 * 抓取页面 AI 提取关键词：启发式正则对付 SEMrush / Planner 这种排版多变的
 * 页面总会漏/错（标题当关键词、表格行认不出），改成把抓取正文交给 LLM：
 * AI 认出关键词表格、逐行提取数据、判断购买意图，返回严格 JSON。
 *
 * 绝不编造：prompt 要求页面没有的字段填 null；normalize 再做一次校验。
 */
import { chatJson } from "./llm.js";

export interface AiKeywordRow {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  plannerLow: number | null;
  plannerHigh: number | null;
  competition: "Low" | "Medium" | "High" | null;
  /** 购买意图：交易 / 商业调查 / 信息 / 导航。 */
  intent: string | null;
}

export type AnalysisLanguage = "zh" | "en";

const INTENT_ZH = new Set(["交易", "商业调查", "信息", "导航"]);
const INTENT_EN = new Set(["Transactional", "Commercial", "Informational", "Navigational"]);
const COMPETITION = new Set(["Low", "Medium", "High"]);

export function buildKeywordExtractPrompt(
  pageText: string,
  language: AnalysisLanguage
): { system: string; user: string } {
  const text = (pageText ?? "").slice(0, 10000);
  if (language === "en") {
    return {
      system:
        "You are a keyword data extraction expert. Return JSON only. Never invent numbers: any field not present in the page text must be null.",
      user: `A browser extension captured the text of a keyword-tool page (SEMrush / Google Keyword Planner / Keyword Magic / SpyFu keyword tool). Extract the keyword table.

Tasks:
1. Find the keyword list/table in the text (if several tables, pick the one that looks most like keyword data).
2. Extract each row: keyword, monthly search volume, SEMrush CPC, Planner low bid, Planner high bid, competition.
3. Judge each keyword's purchase intent:
   - Transactional: contains buy/discount/coupon/price/cheap/deal/order, or clearly wants to buy;
   - Commercial: contains best/review/vs/top, comparing before buying;
   - Informational: contains how/what/why/guide, just researching;
   - Navigational: only the brand/product name itself, looking for the official site.
4. Return JSON only: {"rows":[{"keyword":"...","volume":14800,"cpc":1.5,"plannerLow":0.8,"plannerHigh":2.5,"competition":"Medium","intent":"Transactional"}]}

Strict rules:
- Numbers must come from the page text. Never invent, estimate, or fill in.
- Volume units: 14.8K -> 14800, 5.4K -> 5400, 1.2M -> 1200000.
- Competition: use the Competition column when present (Low/Medium/High). If only KD (0-100) is present, convert: 0-29 Low / 30-69 Medium / 70+ High. Otherwise null.
- Do NOT treat page titles, navigation, buttons, or ad copy as keywords. Do NOT list the page's main query as a row unless it appears in the table with data.
- At most 30 rows. If the page has no keyword table, return {"rows":[]}.

Captured page text:
---
${text}
---`,
    };
  }
  return {
    system:
      "你是一个关键词数据提取专家。只返回 JSON。绝不编造数字：页面里没有的字段填 null。",
    user: `浏览器插件抓下了一个关键词工具页面（SEMrush / Google 关键词规划师 / Keyword Magic / SpyFu 关键词工具）的正文。提取里面的关键词表格。

任务：
1. 找出页面里的关键词列表/表格（有多张表就取最像关键词数据的那张）。
2. 逐行提取：关键词、月搜索量、SEMrush CPC、Planner 低位出价、Planner 高位出价、竞争度。
3. 判断每个词的购买意图：
   - 交易：含 buy/discount/coupon/price/cheap/deal/order/购买/优惠/折扣等，或明确表示要买；
   - 商业调查：含 best/review/vs/top/推荐/对比/评测等，正在比较选购；
   - 信息：含 how/what/why/guide/教程/怎么/什么等，纯查资料；
   - 导航：只有品牌/产品名本身，想找官网。
4. 只返回 JSON：{"rows":[{"keyword":"...","volume":14800,"cpc":1.5,"plannerLow":0.8,"plannerHigh":2.5,"competition":"Medium","intent":"交易"}]}

严格规则：
- 数字必须来自页面原文，不许编造、估算、补全。页面没有的字段填 null。
- 搜索量单位：14.8K → 14800，5.4K → 5400，1.2M → 1200000。
- 竞争度：页面有 Competition 列就用它（Low/Medium/High）；只有 KD（0-100）时按 0-29 Low / 30-69 Medium / 70+ High 换算；都没有就 null。
- 不要把页面标题、导航、按钮、广告文案当成关键词。不要把查询主词本身当成一行，除非它在表格里带数据出现。
- 最多 30 行。页面没有关键词表格就返回 {"rows":[]}。

抓取到的页面正文：
---
${text}
---`,
  };
}

/** 校验 + 清洗 AI 返回的行（防 AI 编造/格式跑偏）。 */
export function normalizeAiKeywordRows(raw: unknown): AiKeywordRow[] {
  const arr = Array.isArray((raw as { rows?: unknown })?.rows)
    ? ((raw as { rows: unknown[] }).rows ?? [])
    : [];
  const seen = new Set<string>();
  const out: AiKeywordRow[] = [];
  const num = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/,/g, "")) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  for (const item of arr) {
    if (out.length >= 30) break;
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const keyword = typeof r.keyword === "string" ? r.keyword.trim() : "";
    if (!keyword || keyword.length > 100) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const competition =
      typeof r.competition === "string" && COMPETITION.has(r.competition)
        ? (r.competition as AiKeywordRow["competition"])
        : null;
    const intentRaw = typeof r.intent === "string" ? r.intent.trim() : "";
    const intent = INTENT_ZH.has(intentRaw) || INTENT_EN.has(intentRaw) ? intentRaw : null;
    out.push({
      keyword,
      volume: num(r.volume),
      cpc: num(r.cpc),
      plannerLow: num(r.plannerLow),
      plannerHigh: num(r.plannerHigh),
      competition,
      intent,
    });
  }
  return out;
}

export async function extractKeywordsWithAi(
  deps: {
    baseUrl: string;
    model: string;
    apiKey: string;
    chatJsonImpl?: typeof chatJson;
    language?: AnalysisLanguage;
  },
  pageText: string
): Promise<AiKeywordRow[]> {
  const language = deps.language ?? "zh";
  const { system, user } = buildKeywordExtractPrompt(pageText, language);
  const chat = deps.chatJsonImpl ?? chatJson;
  const raw = await chat({
    baseUrl: deps.baseUrl,
    model: deps.model,
    apiKey: deps.apiKey,
    system: system + '\nReturn JSON: {"rows":[{"keyword":"...","volume":0,"cpc":0,"plannerLow":0,"plannerHigh":0,"competition":"Low|Medium|High","intent":"..."}]}',
    user,
  });
  return normalizeAiKeywordRows(raw);
}
