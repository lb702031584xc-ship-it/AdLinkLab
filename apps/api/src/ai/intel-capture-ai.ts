/**
 * 情报页抓取 AI 提取：SpyFu / 广告透明度 / SimilarWeb / 否定词四个情报框
 * 以前是把抓取正文前 2000 字硬塞进输入框——页面前 2000 字往往是站内
 * 导航菜单（"What's New Blog API Search …"），根本不是情报。
 * 改成 AI 读全文、只提取该框要的内容，提不出就返回 null（不塞垃圾）。
 */
import { chatJson } from "./llm.js";

export type IntelKind = "spyfu" | "transparency" | "similarweb" | "negatives";
export type AnalysisLanguage = "zh" | "en";

const KINDS: IntelKind[] = ["spyfu", "transparency", "similarweb", "negatives"];
export function isIntelKind(v: unknown): v is IntelKind {
  return typeof v === "string" && (KINDS as string[]).includes(v);
}

function taskLine(kind: IntelKind, language: AnalysisLanguage): string {
  if (language === "en") {
    switch (kind) {
      case "spyfu":
        return "Extract from the captured SpyFu page the competitor keywords (up to 20, with CPC/search volume when shown). For a Domain Overview / PPC Research page: the keywords the domain bids on, the competitor domain, and budget/scale signals. For a Keyword Overview page: the target keyword with its monthly volume, the similar/related keywords list (with volumes), and question keywords.";
      case "transparency":
        return "Extract from the captured Google Ads Transparency page: the advertiser name, ad copy key points, how long the ads have been running / start dates, and ad count / regions covered.";
      case "similarweb":
        return "Extract from the captured SimilarWeb page: monthly visits, traffic mix shares (search/direct/social/referral/email), top countries, top referring domains, and bounce rate / time on site when shown.";
      case "negatives":
        return "Find keywords on the page that are irrelevant to buying (purely informational, clearly off-topic, free/jobs/piracy/adult, etc.) as negative-keyword candidates, up to 30. Output them one per line.";
    }
  }
  switch (kind) {
    case "spyfu":
      return "从抓取的 SpyFu 页面正文提取对手在投的关键词（最多 20 个，带 CPC/搜索量如果有）。域名概览 / PPC 研究页：提取该域名在投的关键词、对手域名、预算/投放规模信号；关键词概览页：提取目标关键词及其月搜索量、相似/相关关键词列表（带搜索量）、问题类关键词。";
    case "transparency":
      return "从抓取的 Google 广告透明度页面正文提取：广告主名称、广告文案要点、广告投放时长/开始时间、广告数量/覆盖地区。";
    case "similarweb":
      return "从抓取的 SimilarWeb 页面正文提取：月访问量、流量结构占比（搜索/直接/社媒/引荐/邮件）、主要国家/地区、主要流量来源域名、跳出率/停留时长（如果有）。";
    case "negatives":
      return "找出页面里与购买无关的关键词（纯信息类、明显不相关、免费/招聘/盗版/成人等），作为否定关键词候选，最多 30 个。";
  }
}

export function buildIntelExtractPrompt(
  pageText: string,
  kind: IntelKind,
  language: AnalysisLanguage
): { system: string; user: string } {
  const text = (pageText ?? "").slice(0, 10000);
  const outFmt =
    kind === "negatives"
      ? '{"summary":"kw1\\nkw2\\n..."}'
      : '{"summary":"..."}';
  if (language === "en") {
    return {
      system:
        "You are a competitor-intelligence extraction expert. Return JSON only. Never invent: only write what is on the page; never treat site navigation, menus, footers, or ad slots as content.",
      user: `A browser extension captured the text of a page. ${taskLine(kind, "en")}

Strict rules:
- Only write content that is actually on the page. If a field is missing, write "not provided" (for negatives: just omit that keyword).
- Do NOT treat site navigation, menus, footers, cookie banners, or ad slots as content.
- Summary max 500 words, key points separated by "; ". For negatives, output one keyword per line.
- If the page has no relevant intelligence, return {"summary":null}.
- Return JSON only: ${outFmt}

Captured page text:
---
${text}
---`,
    };
  }
  return {
    system:
      "你是一个竞争对手情报提取专家。只返回 JSON。绝不编造：只写页面里有的内容；不要把站内导航、菜单、页脚、广告位当成内容。",
    user: `浏览器插件抓下了一个页面正文。${taskLine(kind, "zh")}

严格规则：
- 只写页面里实际有的内容。某项没有就写"未提供"（否定词则直接不列该词）。
- 不要把站内导航、菜单、页脚、Cookie 横幅、广告位当成内容。
- 摘要不超过 500 字，要点用分号分隔。否定词每行一个。
- 页面没有相关情报就返回 {"summary":null}。
- 只返回 JSON：${outFmt}

抓取到的页面正文：
---
${text}
---`,
  };
}

/** 校验 + 清洗 AI 返回的摘要。 */
export function normalizeIntelResult(raw: unknown): { summary: string | null } {
  const s = (raw as { summary?: unknown })?.summary;
  if (typeof s !== "string") return { summary: null };
  const t = s.trim();
  if (!t || t === "null") return { summary: null };
  return { summary: t.slice(0, 2000) };
}

export async function extractIntelWithAi(
  deps: {
    baseUrl: string;
    model: string;
    apiKey: string;
    chatJsonImpl?: typeof chatJson;
    language?: AnalysisLanguage;
  },
  pageText: string,
  kind: IntelKind
): Promise<{ summary: string | null }> {
  const language = deps.language ?? "zh";
  const { system, user } = buildIntelExtractPrompt(pageText, kind, language);
  const chat = deps.chatJsonImpl ?? chatJson;
  const raw = await chat({
    baseUrl: deps.baseUrl,
    model: deps.model,
    apiKey: deps.apiKey,
    system: system + '\nReturn JSON: {"summary":"..."}',
    user,
  });
  return normalizeIntelResult(raw);
}
