/**
 * 官网检测（全自动、免费、无需 key）。
 *
 * 流程：品牌名 → DuckDuckGo HTML 搜索 `"brand" official website`
 * → 解析 `<a class="result__a">` 跳转链接的 uddg 参数得真实域名
 * → registrableDomain + 平台/社媒黑名单过滤
 * → 品牌名匹配（high/medium/low）
 * → high/medium 时用 SSRF-safe 的 fetchPageHtml 验证首页文本含品牌词。
 *
 * 任何异常 → { found:false, confidence:'low' }，绝不抛错。
 */
import { registrableDomain } from "../ai/compliance.js";
import { fetchPageTextWithFallback } from "../ai/page-shot.js";
import type { OfficialSiteInfo } from "./types.js";

const DDG_HTML_SEARCH = "https://html.duckduckgo.com/html/?q=";
/** DuckDuckGo HTML 端用普通浏览器 UA，避免被当成爬虫。 */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * 平台/社媒域名黑名单（作用于搜索结果域名）。
 * 电商平台部分已抽成 MARKETPLACE_DOMAINS + isMarketplaceDomain() 共享；
 * 这里保留社媒/百科类（它们不是"品牌官网"，但也不算电商平台）。
 */
const SOCIAL_RE =
  /^(facebook|instagram|youtube|tiktok|twitter|x\.com|linkedin|pinterest|reddit|quora|wikipedia)(\.|$)/i;

/**
 * 电商平台域名库（eTLD+1 首标签，小写）。
 * 这些是多商家平台，永远不能视为某个品牌的官网。
 * 注意：只收真正的平台，不收品牌直营站（nike.com/adidas.com 是品牌官网，不是平台）。
 */
export const MARKETPLACE_DOMAINS: ReadonlySet<string> = new Set([
  "amazon",
  "ebay",
  "walmart",
  "aliexpress",
  "alibaba",
  "1688",
  "etsy",
  "target",
  "bestbuy",
  "costco",
  "rakuten",
  "shein",
  "temu",
  "wish",
  "newegg",
  "overstock",
  "wayfair",
  "kohls",
  "macys",
  "homedepot",
  "lowes",
  "jd",
  "tmall",
  "taobao",
  "pinduoduo",
  "dhgate",
  "banggood",
  "gearbest",
  "lightinthebox",
  "mercadolibre",
  "otto",
  "zalando",
  "bol",
  "flipkart",
  "lazada",
  "shopee",
  "coupang",
  "gmarket",
  "qoo10",
  "allegro",
  "cdiscount",
  "fnac",
  "argos",
  "currys",
  "mediamarkt",
  "elcorteingles",
  "mercari",
  "vinted",
  "depop",
  "poshmark",
  "stockx",
  "goat",
  "farfetch",
  "ssense",
  "netaporter",
  "mytheresa",
  "asos",
]);

/**
 * 判断域名是否为电商平台（子域名/各国后缀归一化后判断）。
 * 例：www.amazon.co.uk → amazon → true；myamazonstore.com → false；
 * anker.com → false；可直接传完整 URL（自动去协议/路径）。
 */
export function isMarketplaceDomain(domain: string): boolean {
  const cleaned = (domain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    ?.trim();
  if (!cleaned) return false;
  const first = registrableDomain(cleaned).split(".")[0] ?? "";
  return MARKETPLACE_DOMAINS.has(first);
}

/** 搜索结果过滤：平台域名 + 社媒/百科域名都不是品牌官网。 */
function isExcludedResultDomain(domain: string): boolean {
  return isMarketplaceDomain(domain) || SOCIAL_RE.test(domain);
}

/** 品牌名归一化：小写、去空格/连字符/下划线/间隔号/点号。 */
function normalizeBrand(brand: string): string {
  return brand.toLowerCase().replace(/[\s\-_·.]+/g, "");
}

/** 域名核心词：eTLD+1 的首标签去连字符，如 www.anker.com → anker。 */
function domainCore(domain: string): string {
  const first = registrableDomain(domain).split(".")[0] ?? "";
  return first.replace(/[\-_]+/g, "");
}

/**
 * 从 DDG 结果链接 href 提取真实目标域名（eTLD+1）。
 * DDG 的 href 形如 `//duckduckgo.com/l/?uddg=<urlencoded>&rut=...`（& 会被
 * 转义为 &amp;），uddg 可能被双重编码；直链（http 开头）直接解析。
 * 失败返回 null。
 */
export function extractDdgTargetDomain(href: string): string | null {
  try {
    const cleaned = href.replace(/&amp;/gi, "&").trim();
    if (/^https?:\/\//i.test(cleaned)) {
      const direct = new URL(cleaned);
      if (direct.protocol !== "http:" && direct.protocol !== "https:") {
        return null;
      }
      return registrableDomain(direct.hostname);
    }
    const url = new URL(
      cleaned.startsWith("//") ? "https:" + cleaned : cleaned,
      "https://duckduckgo.com"
    );
    const raw = url.searchParams.get("uddg");
    if (!raw) return null;
    // searchParams.get 已做一次解码；DDG 有时会双重编码，再试一次。
    const candidates = [raw];
    try {
      const decoded = decodeURIComponent(raw);
      if (decoded !== raw) candidates.push(decoded);
    } catch {
      // 忽略解码异常，用原始值继续
    }
    for (const c of candidates) {
      try {
        const target = new URL(c);
        if (target.protocol === "http:" || target.protocol === "https:") {
          return registrableDomain(target.hostname);
        }
      } catch {
        // 换下一个候选
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** 解析 DDG HTML 中的 result__a 链接，去重后返回域名列表（保持搜索排序）。 */
function parseResultDomains(html: string): string[] {
  const domains: string[] = [];
  const tagRe = /<a\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[0];
    if (!/\bresult__a\b/.test(tag)) continue;
    const hrefMatch = /href="([^"]+)"/i.exec(tag);
    if (!hrefMatch) continue;
    const domain = extractDdgTargetDomain(hrefMatch[1] ?? "");
    if (domain && !domains.includes(domain)) domains.push(domain);
  }
  return domains;
}

/** 首页验证：SSRF-safe 抓取官网首页，标题/正文含品牌词（大小写不敏感）即确认。
 * 直抓失败（反爬/JS 渲染）自动降级无头截图 + OCR，仍失败返回 false。 */
async function verifyBrandMention(
  domain: string,
  brand: string
): Promise<boolean> {
  try {
    const page = await fetchPageTextWithFallback("https://" + domain);
    return page.text.toLowerCase().includes(brand.trim().toLowerCase());
  } catch {
    return false;
  }
}

const NOT_FOUND: OfficialSiteInfo = {
  found: false,
  domain: null,
  confidence: "low",
};

/**
 * 检测品牌官网。fetchImpl 可注入以便测试（默认全局 fetch）。
 *
 * 降级规则（已在测试中固化）：
 * - high 匹配但首页验证未含品牌词 → 降级为 medium，found 仍为 true
 *   （域名与品牌强匹配，首页可能是 JS 渲染导致文本缺失）；
 * - medium 匹配但首页验证未含品牌词 → 保守判定 found=false、confidence=low。
 */
export async function detectOfficialSite(
  brand: string,
  fetchImpl: typeof fetch = fetch
): Promise<OfficialSiteInfo> {
  if (!brand || !brand.trim()) return { ...NOT_FOUND };
  const brandNorm = normalizeBrand(brand);
  if (!brandNorm) return { ...NOT_FOUND };
  try {
    const query = `"${brand.trim()}" official website`;
    const res = await fetchImpl(DDG_HTML_SEARCH + encodeURIComponent(query), {
      headers: { "User-Agent": BROWSER_UA },
    });
    if (!res.ok) return { ...NOT_FOUND };
    const html = await res.text();
    const domains = parseResultDomains(html).filter(
      (d) => !isExcludedResultDomain(d)
    );
    if (domains.length === 0) return { ...NOT_FOUND };

    const highMatch = domains.find((d) => {
      const core = domainCore(d);
      if (!core) return false;
      return core.includes(brandNorm) || brandNorm.includes(core);
    });

    const candidate = highMatch ?? domains[0] ?? "";
    const confidence: "high" | "medium" = highMatch ? "high" : "medium";

    const verified = await verifyBrandMention(candidate, brand);
    if (verified) return { found: true, domain: candidate, confidence };
    if (confidence === "high") {
      return { found: true, domain: candidate, confidence: "medium" };
    }
    // medium 匹配 + 首页无品牌词：保守处理为未找到（保留候选域名供排查）
    return { found: false, domain: candidate, confidence: "low" };
  } catch {
    return { ...NOT_FOUND };
  }
}
