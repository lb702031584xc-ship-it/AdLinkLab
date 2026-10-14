/**
 * 抓取页面 AI 提取商品信息：自动化广告页的 Amazon 等反爬页面抓不到时，
 * 以前只能手动粘贴页面文字。改成插件抓取 + AI 识别商品信息（标题/价格/
 * 卖点）自动填入手动粘贴框，用户检查后点生成。
 *
 * 绝不编造：prompt 要求页面没有的字段填 null；normalize 再做一次校验。
 */
import { chatJson } from "./llm.js";

export interface ProductCapture {
  title: string | null;
  brand: string | null;
  price: number | null;
  currency: string | null;
  /** 卖点（五点描述 / 核心卖点），页面里有的才列。 */
  bullets: string[];
  description: string | null;
}

export type AnalysisLanguage = "zh" | "en";

export function buildProductExtractPrompt(
  pageText: string,
  language: AnalysisLanguage
): { system: string; user: string } {
  const text = (pageText ?? "").slice(0, 10000);
  if (language === "en") {
    return {
      system:
        "You are a product-info extraction expert. Return JSON only. Never invent: any field not present in the page text must be null.",
      user: `A browser extension captured the text of a product page (Amazon / Shopify / DTC store). Extract the product info.

Tasks:
1. Title: the product's main title (not the page <title> with site suffix, not navigation).
2. Brand: the product's brand name when explicitly shown.
3. Price: the product's main selling price (number only, no currency symbol). Ignore list price / strikethrough price unless no sale price exists.
4. Bullets: the key selling points (About this item / highlights / feature list), at most 8, each one short line.
5. Description: one short paragraph describing what the product is, only if the page has one.
6. Return JSON only: {"title":"...","brand":"...","price":299.99,"currency":"USD","bullets":["..."],"description":"..."}

Strict rules:
- Everything must come from the page text. Never invent, estimate, or fill in. Missing field -> null (bullets -> []).
- Do NOT treat navigation, ads, related products, or reviews as the product itself.
- If the page is not a product page, return {"title":null,"brand":null,"price":null,"currency":null,"bullets":[],"description":null}.

Captured page text:
---
${text}
---`,
    };
  }
  return {
    system:
      "你是一个商品信息提取专家。只返回 JSON。绝不编造：页面里没有的字段填 null。",
    user: `浏览器插件抓下了一个商品页面（Amazon / Shopify / 独立站）的正文。提取商品信息。

任务：
1. 标题：商品主标题（不是带网站后缀的页面 <title>，不是导航）。
2. 品牌：页面明确给出的商品品牌名。
3. 价格：商品主售价（只写数字，不带货币符号）。划线价/原价只有在没有售价时才用。
4. 卖点：核心卖点（About this item / 五点描述 / 亮点列表），最多 8 条，每条一句话。
5. 描述：用一小段话说清这是什么商品，页面有才写。
6. 只返回 JSON：{"title":"...","brand":"...","price":299.99,"currency":"USD","bullets":["..."],"description":"..."}

严格规则：
- 所有内容必须来自页面原文，不许编造、估算、补全。缺失字段填 null（卖点填 []）。
- 不要把导航、广告、相关商品、评价当成商品本身。
- 页面不是商品页就返回 {"title":null,"brand":null,"price":null,"currency":null,"bullets":[],"description":null}。

抓取到的页面正文：
---
${text}
---`,
  };
}

/** 校验 + 清洗 AI 返回的商品信息（防 AI 编造/格式跑偏）。 */
export function normalizeProduct(raw: unknown): ProductCapture {
  const empty: ProductCapture = {
    title: null,
    brand: null,
    price: null,
    currency: null,
    bullets: [],
    description: null,
  };
  if (!raw || typeof raw !== "object") return empty;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t ? t.slice(0, max) : null;
  };
  const priceNum =
    typeof r.price === "number"
      ? r.price
      : typeof r.price === "string"
        ? Number(r.price.replace(/[^0-9.]/g, ""))
        : NaN;
  const bullets = Array.isArray(r.bullets)
    ? r.bullets
        .filter((b): b is string => typeof b === "string" && b.trim() !== "")
        .map((b) => b.trim().slice(0, 200))
        .slice(0, 8)
    : [];
  return {
    title: str(r.title, 300),
    brand: str(r.brand, 100),
    price: Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : null,
    currency: str(r.currency, 10),
    bullets,
    description: str(r.description, 1000),
  };
}

/** 把提取结果格式化成手动粘贴框的文本（标题/价格/卖点）。 */
export function buildProductSummaryText(p: ProductCapture, language: AnalysisLanguage): string {
  const lines: string[] = [];
  if (language === "en") {
    if (p.title) lines.push(`Title: ${p.title}`);
    if (p.brand) lines.push(`Brand: ${p.brand}`);
    if (p.price != null) lines.push(`Price: ${p.currency ?? ""} ${p.price}`.trim());
    if (p.bullets.length > 0) {
      lines.push("Highlights:");
      for (const b of p.bullets) lines.push(`- ${b}`);
    }
    if (p.description) lines.push(`Description: ${p.description}`);
  } else {
    if (p.title) lines.push(`商品：${p.title}`);
    if (p.brand) lines.push(`品牌：${p.brand}`);
    if (p.price != null) lines.push(`价格：${p.currency ?? ""} ${p.price}`.trim());
    if (p.bullets.length > 0) {
      lines.push("卖点：");
      for (const b of p.bullets) lines.push(`- ${b}`);
    }
    if (p.description) lines.push(`描述：${p.description}`);
  }
  return lines.join("\n");
}

export async function extractProductWithAi(
  deps: {
    baseUrl: string;
    model: string;
    apiKey: string;
    language?: AnalysisLanguage;
    chatJsonImpl?: typeof chatJson;
  },
  pageText: string
): Promise<{ product: ProductCapture; summaryText: string }> {
  const language = deps.language ?? "zh";
  const { system, user } = buildProductExtractPrompt(pageText, language);
  const run = deps.chatJsonImpl ?? chatJson;
  const parsed = await run({
    baseUrl: deps.baseUrl,
    model: deps.model,
    apiKey: deps.apiKey,
    system,
    user,
  });
  const product = normalizeProduct(parsed);
  return { product, summaryText: buildProductSummaryText(product, language) };
}
