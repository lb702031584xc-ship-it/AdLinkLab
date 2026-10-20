/**
 * YeahPromos — 商品库适配器（官方 API + 登录态 session 双模式）。
 *
 * ── 官方 API 模式（api，2026-10-20 经用户在 YP 后台文档页证实）──
 * Amazon Api → Get Products / Get Adverts：
 *   GET https://yeahpromos.com/index/apioffer/products  （商品）
 *   GET https://yeahpromos.com/index/apioffer/brands    （广告主 + advert links）
 *   Header: token = 网站 token（Your website token）
 *   GET 参数：site_id（必填，必须等于该 token 对应的 Channel ID）、
 *             page（默认 1）、page_size（默认 100，上限 200，本适配器用 200）、
 *             relationship（默认 0）；products 可选 advert_ids/asins/product_ids，
 *             brands 可选 advert_ids、market_place（amazon.com/.co.uk/.de/.fr/.ca）。
 *   结果码：code = 100000 成功 / 100001 失败（失败带出原始 msg 明错）。
 *   同步流程：先拉 brands 建 advert_id → 广告主名称映射，再拉 products；
 *   商品带 advert_id 时用映射回填 brand（比商品自带品牌名更准）。
 *   限流：每分钟 10 次，两条拉取共享同一预算 → 串行节流，任意相邻请求间隔
 *   ≥8s（滑动窗口算账：6.5s 间隔时 t=0,6.5,…,58.5 在任意 60s 窗口内能塞
 *   下 10 个请求、正好顶穿上限——2026-10-20 真实同步 brands 拉到第 8–10 页
 *   被服务端以 "Request too fast, please request later!" 切断；8s 间隔时
 *   任意 60s 窗口内最多 8 个请求，留 2 个余量）。若仍被限流（HTTP 429 或
 *   body 解包后是含 too fast/rate/limit 的字符串），分页层等 60s 后重试
 *   同一页，每页最多重试 3 次，仍失败才整体抛 RATE_LIMITED 明错。
 *   凭证：token + site_id 合并为一段 JSON 存入网络设置的 apiKeyRef
 *   （AES-256-GCM 加密、只写不读，跟随 PB 现有凭证模式；绝不明文、绝不经聊天）。
 *   信封结构已于 2026-10-20 经真实响应验证：body 为**双重编码** JSON
 *   （整个负载又被包成一层 JSON 字符串返回、引号带反斜杠转义，一次
 *   JSON.parse 只得到 string——本适配器逐层解包，最多 3 层）；解包后
 *   {code:"100000"（**字符串**，比较前统一 Number()）, status:"SUCCESS",
 *   msg, data:{…}}；列表在 **data.data**（Laravel 分页器信封：
 *   per_page/current_page/last_page/total/data[]）；brands 记录字段
 *   advert_id / advert_name / image。products 的字段级映射（价格/佣金等）
 *   仍沿用 session mapper 的防御式 pickField 候选名；解包后仍非 object、
 *   或候选路径找不到列表时抛 YP_API_STRUCTURE_UNVERIFIED 明错，由同步
 *   服务统一降级（FAILED + 审计），绝不伪造数据。products 路径默认值为
 *   上方已验证地址，仍可在网络设置用 apiProductsPath 覆盖（仿
 *   sessionListPath 机制）。
 *
 * ── 登录态(session)模式（备用）──
 * ═══════════════════════════════════════════════════════════════════════
 * ToS 风险提示：使用登录态（Cookie）自动采集商品数据，可能违反 YeahPromos
 * 服务条款中关于自动化访问的条款，存在账号被警告、限流或封禁的风险。请仅
 * 采集您自己账号可见的商品数据，不要高频抓取。官方 API 已确认可用，请优先
 * 使用 api 模式。继续即代表您已了解并自行承担该风险。
 * ═══════════════════════════════════════════════════════════════════════
 * session 商品列表路径默认为 "/api/products"，仅为占位模板（TODO）：
 * 以用户 YeahPromos 后台实际商品列表接口为准，用户可在网络设置里覆盖
 * apiBaseUrl + sessionListPath。解析为防御式（JSON data.list/data.items…
 * 候选路径 + HTML 表格最小回退）；结构对不上时抛 SESSION_TEMPLATE_UNVERIFIED
 * 明错，由同步服务统一降级（FAILED + 审计），不死循环、不伪造数据。
 */
import { lookup } from "node:dns/promises";
import { isBlockedIp } from "../ai/fetch-page.js";
import {
  deriveLandingPageType,
  NetworkAdapterError,
} from "./partnerboost-adapter.js";
import {
  pickField,
  sessionAsNumber,
  sessionAsString,
  TemplateSessionAdapter,
  type SessionListTemplate,
  type SessionProduct,
} from "./session-adapter.js";
import type {
  AdapterContext,
  NetworkAdapter,
  NetworkOffer,
  SyncMode,
} from "./types.js";

export const YP_DEFAULT_SESSION_BASE_URL = "https://yeahpromos.com";
/**
 * TODO(需真实账号验证)：默认商品列表路径为占位模板。
 * 请用真实 YeahPromos 账号登录后台 → F12 Network 找到商品列表请求，
 * 把真实路径填到网络设置的 sessionListPath（PATCH /api/v1/networks/:id）。
 */
export const YP_DEFAULT_SESSION_LIST_PATH = "/api/products";

/** 官方 API 商品接口路径（2026-10-20 经 YP 后台文档 Amazon Api → Get Products 页证实）。 */
export const YP_DEFAULT_API_PRODUCTS_PATH = "/index/apioffer/products";
/** 官方 API 广告主接口路径（2026-10-20 经 YP 后台文档 Amazon Api → Get Adverts 页证实）。 */
export const YP_DEFAULT_API_BRANDS_PATH = "/index/apioffer/brands";
/** page_size 上限 200（文档明示），用满以减少请求数（限流 10 次/分钟）。 */
export const YP_API_PAGE_SIZE = 200;
/**
 * 分页上限：20 → 50（2026-10-20）。真实同步 brands 至少 10 页（≥2000 个
 * 广告主），20 页上限离实测值太近；50 页 × 200 条 = 10000 条，配合
 * last_page 终止判定，正常情况靠信封终止、不会多打请求。同步服务侧的
 * opts.maxPages 钳制上限也是 50，与之对齐。
 */
export const YP_API_MAX_PAGES = 50;
/**
 * 单请求超时：15s → 45s（2026-10-20）。YP 是慢 ThinkPHP 接口，真实拉取实测
 * 一页 200 条的响应（尤其响应体传输）超过 15s 被 AbortSignal 掐断，故放宽到 45s。
 */
export const YP_API_DEFAULT_TIMEOUT_MS = 45_000;
/**
 * 官方限流 10 次/分钟 → 任意相邻请求最小间隔 8s。
 * 为什么不是 6.5s（旧值）：固定间隔是滑动窗口计数——6.5s 间隔下
 * t=0, 6.5, …, 58.5 共 10 个请求全部落在同一个 60s 窗口内，正好顶穿
 * 10 次/分钟上限（2026-10-20 真实同步实测 brands 第 8–10 页被切断，
 * 服务端回 "Request too fast, please request later!"）。8s 间隔下任意
 * 60s 窗口内最多 8 个请求（t=0,8,…,56），留 2 个余量给时钟误差/重试。
 */
export const YP_API_MIN_REQUEST_INTERVAL_MS = 8_000;
/** 被限流后重试同一页前的等待：等满一个限流窗口（60s）。 */
export const YP_API_RATE_LIMIT_WAIT_MS = 60_000;
/** 每页限流重试上限：等 60s 重试同一页，最多 3 次，仍失败才整体失败。 */
export const YP_API_RATE_LIMIT_MAX_RETRIES = 3;
/** YP 结果码：成功。 */
export const YP_API_CODE_SUCCESS = 100000;
/** YP 结果码：失败。 */
export const YP_API_CODE_ERROR = 100001;
/**
 * api 模式请求附带的浏览器风格 User-Agent：服务端/WAF 可能按 UA 把无 UA 的
 * 程序客户端拦成 HTML 挑战页（2026-10-20 真实拉取遇到 200+HTML 非 JSON）。
 * 固定为常见 Chrome 桌面 UA，排除这一变量。
 */
export const YP_API_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface YeahPromosPullOpts {
  maxPages?: number;
  /** 任意相邻请求的最小间隔 ms（默认 YP_API_MIN_REQUEST_INTERVAL_MS；测试可调小）。 */
  pageDelayMs?: number;
  /**
   * 被限流后重试同一页前的等待 ms（默认 YP_API_RATE_LIMIT_WAIT_MS=60s；
   * 测试可注入小数值，免去真等一分钟）。
   */
  rateLimitWaitMs?: number;
  pageSize?: number;
  /** brands 拉取的 market_place 过滤（如 amazon.com）；缺省不发送。 */
  marketPlace?: string;
}

interface YpApiCredentials {
  token: string;
  siteId: string;
}

/**
 * 解析 apiKeyRef 解密后的凭证串。
 * 规范格式：JSON `{"token":"...","siteId":"..."}`（前端 YP 专用输入框组装，
 * 整体经现有 apiKey 加密通道存储）。兼容纯 token 字符串（site_id 缺失 → 明错，
 * 提示去网络设置补填，绝不猜 Channel ID）。
 */
export function parseYpApiCredentials(
  apiKey: string
): YpApiCredentials {
  const raw = (apiKey ?? "").trim();
  let token = "";
  let siteId = "";
  if (raw.startsWith("{")) {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      token =
        sessionAsString(
          pickField(obj, "token", "apiToken", "websiteToken")
        ) ?? "";
      siteId =
        sessionAsString(
          pickField(obj, "siteId", "site_id", "siteID", "channelId", "channel_id")
        ) ?? "";
    } catch {
      throw new NetworkAdapterError(
        "BAD_CREDENTIALS",
        "YeahPromos API 凭证格式损坏（应为 token + site_id）：请在网络设置中重新保存"
      );
    }
  } else {
    token = raw;
  }
  if (!token) {
    throw new NetworkAdapterError(
      "BAD_CREDENTIALS",
      "YeahPromos API token 未配置：请在网络设置中填写网站 token"
    );
  }
  if (!siteId) {
    throw new NetworkAdapterError(
      "BAD_CREDENTIALS",
      "YeahPromos API 缺少 site_id（必须等于该 token 对应的 Channel ID）：" +
        "请在网络设置中补填站点 ID 后重试"
    );
  }
  return { token, siteId };
}

/** SSRF 守卫：官方 API base 必须是公网 https（与 session 守卫同规则）。 */
export async function assertYpApiUrlSafe(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new NetworkAdapterError(
      "INVALID_URL",
      "YeahPromos API base URL 不是合法的 URL"
    );
  }
  if (parsed.protocol !== "https:") {
    throw new NetworkAdapterError(
      "INVALID_URL",
      "YeahPromos API base URL 必须是 https"
    );
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(parsed.hostname, { all: true });
  } catch {
    throw new NetworkAdapterError("DNS_FAILED", "DNS 解析失败");
  }
  for (const a of addresses) {
    if (isBlockedIp(a.address)) {
      throw new NetworkAdapterError(
        "BLOCKED_TARGET",
        "目标 IP 被禁止（内网/回环）"
      );
    }
  }
}

/* ── 防御式 JSON 读取（信封已验证：双重编码 + data.data；字段级仍候选路径兜底） ── */

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function firstArrayAtPaths(obj: unknown, paths: string[]): unknown[] | null {
  for (const p of paths) {
    const v = getPath(obj, p);
    if (Array.isArray(v)) return v;
  }
  return null;
}

function firstNumberAtPaths(obj: unknown, paths: string[]): number | null {
  for (const p of paths) {
    const n = sessionAsNumber(getPath(obj, p));
    if (n != null) return n;
  }
  return null;
}

/**
 * 列表候选路径：真实结构为 data.data（Laravel 分页器，2026-10-20 验证），
 * 放最前；其余为防御式兜底。
 */
const YP_API_LIST_PATHS = [
  "data.data",
  "data.list",
  "data.items",
  "data.products",
  "data.brands",
  "data.adverts",
  "data.rows",
  "list",
  "items",
  "products",
  "brands",
  "data",
] as const;

/** Laravel 分页器当前页/末页候选路径（2026-10-20 真实响应证实）。 */
const YP_API_CURRENT_PAGE_PATHS = ["data.current_page", "current_page"] as const;
const YP_API_LAST_PAGE_PATHS = ["data.last_page", "last_page"] as const;
const YP_API_NEXT_PAGE_URL_PATHS = ["data.next_page_url", "next_page_url"] as const;

/** 总页数候选路径（Transaction API 文档为 PageTotal/PageNow 风格）。 */
const YP_API_PAGE_TOTAL_PATHS = [
  "data.PageTotal",
  "PageTotal",
  "data.pageTotal",
  "data.totalPage",
  "data.total_pages",
  "totalPage",
] as const;

const YP_API_HAS_MORE_PATHS = [
  "data.has_more",
  "data.hasMore",
  "has_more",
  "hasMore",
] as const;

/** 商品/广告主记录里的 advert_id 候选键。 */
const YP_ADVERT_ID_KEYS = ["advert_id", "advertId", "brand_id", "advert"] as const;
/** 广告主名称候选键。 */
const YP_ADVERT_NAME_KEYS = [
  "advert_name",
  "advertName",
  "brand_name",
  "brandName",
  "name",
  "title",
  "store_name",
] as const;

interface YpApiRequestDeps {
  baseUrl: string;
  token: string;
  siteId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  pageSize: number;
  maxPages: number;
  /** 共享节流：任意相邻请求之间等待（products 与 brands 共用同一限流预算）。 */
  throttle: () => Promise<void>;
  /** 被限流后重试同一页前的等待 ms（等满一个限流窗口）。 */
  rateLimitWaitMs: number;
}

/** 安全取错误 message：DOMException（超时 abort 的实际类型）不是 Error 子类，优先读 .message。 */
function ypErrorMessage(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  return String(error);
}

/**
 * 超时类错误识别：AbortSignal.timeout 触发的是 name="TimeoutError" 的
 * DOMException（message "The operation was aborted due to timeout"）；
 * 本适配器唯一的 abort 信号就是该超时信号，AbortError 同按超时处理。
 */
function isYpTimeoutError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  if (name === "TimeoutError" || name === "AbortError") return true;
  return /aborted due to timeout|operation was aborted|timed?\s*out/i.test(
    ypErrorMessage(error)
  );
}

/**
 * 限流文案识别：YP 被限流时不回信封 JSON，而是回限流文案——两种形态都见过：
 * 再包一层 JSON 编码的字符串，以及**未经编码的纯文本**（整段 body 就是
 * "Request too fast, please request later!"）。前者在解包后是 string 时
 * 识别；后者 JSON.parse 直接失败，由非对象分支对响应原文识别。含
 * too fast / rate / limit（不分大小写）即归类限流，由分页层等 60s 重试，
 * 不误判成"响应不是 JSON"。
 */
function isYpRateLimitText(text: string): boolean {
  return /too\s*fast|rate|limit/i.test(text);
}

/**
 * Amazon 站点域名 → 国家代码（2026-10-20 商品真实响应证实）：YP 商品的国家
 * 不在 country_code 字段里，而在 market_place（如 "amazon.ca"）。投放国家
 * 列、广告数按国家分组、国家筛选都依赖它。表外站点一律 null（不猜）。
 */
const MARKET_PLACE_COUNTRY: Record<string, string> = {
  "amazon.com": "US",
  "amazon.ca": "CA",
  "amazon.co.uk": "GB",
  "amazon.de": "DE",
  "amazon.fr": "FR",
  "amazon.it": "IT",
  "amazon.es": "ES",
  "amazon.com.au": "AU",
  "amazon.co.jp": "JP",
  "amazon.com.mx": "MX",
  "amazon.com.br": "BR",
  "amazon.in": "IN",
  "amazon.nl": "NL",
  "amazon.se": "SE",
  "amazon.pl": "PL",
  "amazon.sg": "SG",
  "amazon.ae": "AE",
  "amazon.sa": "SA",
  "amazon.com.tr": "TR",
  "amazon.ie": "IE",
  "amazon.at": "AT",
  "amazon.ch": "CH",
  "amazon.com.be": "BE",
  "amazon.eg": "EG",
  "amazon.co.za": "ZA",
  "amazon.cn": "CN",
};

export function countryCodeFromMarketPlace(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const key = v.trim().toLowerCase().replace(/^www\./, "");
  return MARKET_PLACE_COUNTRY[key] ?? null;
}

/**
 * ID 取值（2026-10-20 商品真实响应证实）：YP 的 product_id / advert_id 是
 * **数字**（如 3208738），sessionAsString 只认字符串会把数字 ID 读成 null
 * → externalId 变空、整批商品在入库前被静默丢弃（同步"成功"但 0 入库的
 * 真凶）。这里字符串/数字都接受，统一转字符串。
 */
function ypIdToString(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t ? t : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * 价格取值（同日真实响应证实）：YP 的 price 是带币种前缀的字符串
 * （如 "CAD 15.99"），sessionAsNumber 只剥 $ 与逗号、parseFloat("CAD15.99")
 * 为 NaN → 价格全空。先走 sessionAsNumber，失败再提取首个数字段解析。
 */
function ypPriceToNumber(v: unknown): number | null {
  const n = sessionAsNumber(v);
  if (n != null) return n;
  if (typeof v === "string") {
    const m = v.match(/\d[\d,]*(?:\.\d+)?/);
    if (m) {
      const parsed = parseFloat(m[0].replace(/,/g, ""));
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

export class YeahPromosAdapter
  extends TemplateSessionAdapter
  implements NetworkAdapter
{
  readonly kind = "yeahpromos";
  readonly displayName = "YeahPromos";
  /** 官方 API base（api 模式与 session 模式共用同一域名）。 */
  readonly defaultBaseUrl = YP_DEFAULT_SESSION_BASE_URL;
  readonly supportsModes: readonly SyncMode[] = ["api", "session"] as const;

  // ── BaseSessionAdapter ──
  readonly sessionKind = "yeahpromos";
  readonly sessionDisplayName = "YeahPromos";
  readonly defaultSessionBaseUrl = YP_DEFAULT_SESSION_BASE_URL;

  // ── TemplateSessionAdapter ──
  protected readonly defaultSessionListPath = YP_DEFAULT_SESSION_LIST_PATH;
  protected readonly listTemplate: SessionListTemplate = {
    verified: false,
    jsonListPaths: ["data.list", "data.items", "data.products", "list", "items"],
    jsonHasMorePaths: ["data.has_more", "data.hasMore", "has_more", "hasMore"],
    description:
      "YeahPromos 后台商品列表接口（未验证）：期望返回 JSON {data:{list:[], has_more}} " +
      "或 {data:{items:[]}}；字段名按常见变体防御式映射。",
  };

  protected mapSessionItem(item: Record<string, unknown>): SessionProduct {
    const externalId =
      ypIdToString(
        pickField(item, "product_id", "productId", "id", "asin", "sku")
      ) ?? "";
    const name =
      sessionAsString(
        pickField(item, "product_name", "productName", "name", "title")
      ) ?? "Unknown product";
    const commissionAmount = sessionAsNumber(
      pickField(item, "commission_amount", "commissionAmount", "payout", "commission")
    );
    // "12%" / "12" 两种都可能是佣金率；纯数字且无金额上下文时按金额优先，见注释。
    const commissionRate = sessionAsNumber(
      pickField(item, "commission_rate", "commissionRate", "commission_pct")
    );
    return {
      externalId,
      name,
      payout: commissionAmount,
      currency:
        sessionAsString(pickField(item, "currency")) ?? "USD",
      termsText:
        sessionAsString(pickField(item, "terms", "terms_text", "description")) ??
        null,
      url:
        sessionAsString(
          pickField(item, "promo_url", "promoUrl", "promotion_url", "track_link", "amazon_track_link", "url", "link")
        ) ?? null,
      brand: sessionAsString(pickField(item, "brand", "brand_name", "brandName")),
      asin: sessionAsString(pickField(item, "asin")),
      price: ypPriceToNumber(
        pickField(item, "price", "sale_price", "salePrice", "original_price")
      ),
      commissionAmount,
      commissionRate,
      reviewCount: sessionAsNumber(
        pickField(item, "review_count", "reviewCount", "reviews", "total_reviews", "totalReviews")
      ),
      promoUrl:
        sessionAsString(
          pickField(item, "promo_url", "promoUrl", "promotion_url", "track_link", "amazon_track_link", "url", "link")
        ) ?? null,
      rawData: item,
    };
  }

  /**
   * api 模式商品 → NetworkOffer。
   * 字段映射复用 mapSessionItem（与 session 同款候选名，保证两条线路入库一致）；
   * payout 口径与 PB 对齐：有固定佣金金额 → payout=金额、currency=币种；
   * 只有佣金率 → payout=率、currency="%"（同步服务据此拆 commissionAmount/Rate）。
   * brand：商品自带品牌名优先；缺失时用 brands 映射（advert_id → 广告主名称）
   * 回填，命中的广告主原始记录存入 rawData.__yp_brand 备查。
   */
  protected mapApiItem(
    item: Record<string, unknown>,
    brandByAdvertId?: ReadonlyMap<string, Record<string, unknown>>
  ): NetworkOffer {
    const sp = this.mapSessionItem(item);
    const amount = sp.commissionAmount ?? null;
    const rate = sp.commissionRate ?? null;
    const payout = amount ?? rate;
    const currency =
      amount != null
        ? (sp.currency ?? "USD")
        : rate != null
          ? "%"
          : (sp.currency ?? "USD");
    const url = sp.promoUrl ?? sp.url ?? null;

    let brand = sp.brand ?? null;
    let rawData: Record<string, unknown> = item;
    if (!brand && brandByAdvertId) {
      const advertId = ypIdToString(pickField(item, ...YP_ADVERT_ID_KEYS));
      const brandRecord = advertId ? brandByAdvertId.get(advertId) : undefined;
      if (brandRecord) {
        brand =
          sessionAsString(pickField(brandRecord, ...YP_ADVERT_NAME_KEYS)) ??
          null;
        if (brand) {
          rawData = { ...item, __yp_brand: brandRecord };
        }
      }
    }

    return {
      externalId: sp.externalId,
      name: sp.name,
      payout,
      currency,
      termsText: sp.termsText ?? null,
      url,
      landingPageType: deriveLandingPageType(url),
      countryCode:
        sessionAsString(
          pickField(item, "country_code", "countryCode", "country")
        ) ??
        countryCodeFromMarketPlace(pickField(item, "market_place", "marketPlace")) ??
        null,
      brand,
      asin: sp.asin ?? null,
      price: sp.price ?? null,
      priceCurrency: sp.currency ?? null,
      reviewCount: sp.reviewCount ?? null,
      rawData,
    };
  }

  /**
   * 单页 GET（products/brands 共用）：拼参数 → 节流 → 请求 → 状态/结果码判定 →
   * 防御式找列表。错误一律明错（NetworkAdapterError），不伪造；其中限流
   * （HTTP 429 或限流文案字符串）抛 RATE_LIMITED，由分页层
   * （pullAllYpPages）等满一个窗口后重试同一页，本函数本身不重试。
   * label 用于错误信息定位是哪个接口出的问题。
   */
  private async fetchYpApiPage(
    deps: YpApiRequestDeps,
    path: string,
    label: string,
    page: number,
    extraParams: Record<string, string> = {}
  ): Promise<{ list: unknown[]; root: Record<string, unknown> }> {
    await deps.throttle();
    const params = new URLSearchParams({
      site_id: deps.siteId,
      page: String(page),
      page_size: String(deps.pageSize),
      relationship: "0",
      ...extraParams,
    });
    const url = `${deps.baseUrl}${path}?${params.toString()}`;
    let res: Response;
    let text: string;
    try {
      res = await deps.fetchImpl(url, {
        method: "GET",
        headers: {
          // token 只放请求头；绝不打日志、绝不进 URL。
          token: deps.token,
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          // 浏览器风格 UA：排除服务端/WAF 按 UA 给程序客户端返回 HTML 页。
          "User-Agent": YP_API_USER_AGENT,
        },
        signal: AbortSignal.timeout(deps.timeoutMs),
      });
      // 响应体读取必须在同一个 try 里：AbortSignal 在 body 传输期间同样会
      // 触发超时（YP 先回响应头、再慢吐 200 条数据时实测发生过）。此前
      // res.text() 在 try 外，超时抛出的原始 DOMException 未经本适配器包装
      // 直接落库，前端只看到英文原文 "The operation was aborted due to
      // timeout"，没有接口/页码定位信息。
      text = await res.text();
    } catch (error) {
      const original = ypErrorMessage(error);
      if (isYpTimeoutError(error)) {
        const secs = deps.timeoutMs / 1000;
        const secsLabel = Number.isInteger(secs)
          ? String(secs)
          : secs.toFixed(1);
        throw new NetworkAdapterError(
          "NETWORK_ERROR",
          `YeahPromos API（${label} 第 ${page} 页）请求超时（>${secsLabel}s）：${original}`
        );
      }
      throw new NetworkAdapterError(
        "NETWORK_ERROR",
        `YeahPromos API（${label}）请求失败：${original}`
      );
    }
    if (res.status === 401) {
      throw new NetworkAdapterError(
        "BAD_CREDENTIALS",
        "YeahPromos API token 无效或已过期（HTTP 401），请在网络设置中重新保存 token",
        401
      );
    }
    if (res.status === 429) {
      // 官方限流 10 次/分钟 → 抛 RATE_LIMITED 信号，分页层等 60s 重试同一页。
      throw new NetworkAdapterError(
        "RATE_LIMITED",
        "YeahPromos API 触发限流（HTTP 429，官方上限 10 次/分钟）",
        429
      );
    }
    if (!res.ok) {
      throw new NetworkAdapterError(
        "HTTP_ERROR",
        `YeahPromos API（${label}）返回 HTTP ${res.status}（${path}），请检查网络设置的 API 地址/接口路径`,
        res.status
      );
    }

    // text 已在上方与 fetch 同一 try 中读完（超时包装覆盖 body 传输阶段）。
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    // 双重编码解包（2026-10-20 真实响应证实）：YP 把整个 JSON 负载又包了
    // 一层 JSON 字符串返回（引号带反斜杠转义），一次 parse 只得到 string，
    // 不是 object——此前正是这里误判"响应不是 JSON"。结果是 string 就再
    // parse，循环逐层解包，最多 3 层防无限套娃。再 parse 失败时保留上一层
    // 的 string（不置 null）：限流响应正是这种裸字符串（如整段 body 就是
    // "Request too fast, please request later!" 再包一层编码），需要拿它
    // 做下面的限流识别；非限流的 string 最终仍走结构未验证明错（诊断片段
    // 逻辑不变）。
    for (let depth = 0; depth < 3 && typeof json === "string"; depth += 1) {
      try {
        json = JSON.parse(json);
      } catch {
        break;
      }
    }
    // 限流识别：解包后仍是 string 且是限流文案 → RATE_LIMITED（带原文），
    // 分页层会等 60s 重试同一页，不当成结构错误整体失败。
    if (typeof json === "string" && isYpRateLimitText(json)) {
      throw new NetworkAdapterError(
        "RATE_LIMITED",
        `YeahPromos API（${label}）触发限流：服务端返回 "${json.trim()}"` +
          "（官方上限 10 次/分钟）",
        429
      );
    }
    if (json === null || typeof json !== "object") {
      // 限流原文兜底（2026-10-20 二次实测）：YP 限流响应有时是**未经 JSON
      // 编码的纯文本**（整段 body 就是 Request too fast, please request
      // later!，不带引号）——JSON.parse 直接抛错、json=null，上面的字符串
      // 限流识别够不着，曾被误判成"响应不是 JSON"整单失败（实测死在
      // brands 第 8 页 / 第 17 页）。这里对响应原文再查一次限流文案，命中
      // 就抛 RATE_LIMITED，让分页层等 60s 重试同一页。此分支只处理非对象
      // 响应（正常商品 JSON 解析成 object 永远到不了这里），原文宽松正则
      // 不会误伤真实数据。
      if (isYpRateLimitText(text)) {
        const snippet = text.replace(/\s+/g, " ").trim().slice(0, 200);
        throw new NetworkAdapterError(
          "RATE_LIMITED",
          `YeahPromos API（${label}）触发限流：服务端返回 "${snippet}"` +
            "（官方上限 10 次/分钟）",
          429
        );
      }
      // 诊断信息（不含任何凭证：token 只在请求头里，从不写入错误；
      // 请求 URL 只有 site_id/page 等公开参数，最终 URL 与 body 片段可安全带回）：
      // - 最终 URL：fetch 跟随重定向后的 res.url，能看出是否被跳到登录页；
      // - HTTP 状态与 body 前 200 字符（空白折叠后的净化片段）便于区分
      //   登录页 / WAF 挑战页 / 路径 404 页。
      const finalUrl =
        typeof res.url === "string" && res.url.length > 0 ? res.url : url;
      const redirected = finalUrl !== url || /\/login/i.test(finalUrl);
      const bodySnippet = text.replace(/\s+/g, " ").trim().slice(0, 200);
      throw new NetworkAdapterError(
        "YP_API_STRUCTURE_UNVERIFIED",
        `YeahPromos API（${label}）响应不是 JSON：HTTP ${res.status}，` +
          `最终 URL：${finalUrl}` +
          (redirected ? `（请求被重定向到：${finalUrl}）` : "") +
          `；响应内容片段："${bodySnippet}"。` +
          "常见原因：被重定向到登录页（token/site_id 不匹配或失效）、" +
          `接口路径不对（当前路径 ${path}）或服务端返回了验证/挑战页；请核对后重试`
      );
    }
    const root = json as Record<string, unknown>;

    // 结果码判定（文档：100000 成功 / 100001 失败；code 可能在顶层或 data/status 下）。
    // 真实响应中 code 是字符串 "100000"，故统一 Number() 后再与成功码比较
    // （字符串/数字都兼容）；失败带 root.msg 明错。
    const codeRaw =
      pickField(root, "code") ??
      getPath(root, "data.code") ??
      getPath(root, "status.code");
    const codeNum =
      typeof codeRaw === "number"
        ? codeRaw
        : typeof codeRaw === "string"
          ? Number(codeRaw)
          : NaN;
    if (!Number.isFinite(codeNum)) {
      throw new NetworkAdapterError(
        "YP_API_STRUCTURE_UNVERIFIED",
        `YeahPromos API（${label}）响应缺少结果码 code（文档约定 100000=成功）：` +
          "响应结构与文档不符，未做任何导入；请把真实响应样例反馈给管理员核对"
      );
    }
    if (codeNum !== YP_API_CODE_SUCCESS) {
      const msg =
        sessionAsString(pickField(root, "msg", "message", "info", "error")) ??
        "unknown";
      throw new NetworkAdapterError(
        "API_ERROR",
        `YeahPromos API（${label}）返回错误（code ${codeNum}）：${msg}`
      );
    }

    const list = firstArrayAtPaths(root, [...YP_API_LIST_PATHS]);
    if (!list) {
      throw new NetworkAdapterError(
        "YP_API_STRUCTURE_UNVERIFIED",
        `YeahPromos API（${label}）响应结构与文档不符：未在候选路径（` +
          YP_API_LIST_PATHS.join(" / ") +
          "）找到列表。信封结构已验证但列表位置对不上，已停止导入（未写入任何数据）；" +
          "请把真实响应样例反馈给管理员核对字段结构"
      );
    }
    return { list, root };
  }

  /**
   * 单页拉取 + 限流等待重试：fetchYpApiPage 抛 RATE_LIMITED（HTTP 429 或
   * 限流文案字符串）时，等满一个限流窗口（deps.rateLimitWaitMs，默认
   * 60s）后重试同一页，每页最多重试 YP_API_RATE_LIMIT_MAX_RETRIES 次；
   * 仍被限流才整体抛 RATE_LIMITED（写明卡的页码与已等待次数）。非限流
   * 错误原样透传，不重试。每次尝试内部仍走 fetchYpApiPage 的共享节流，
   * brands/products 共用同一限流预算的现状不变。
   */
  private async fetchYpApiPageWithRateLimitRetry(
    deps: YpApiRequestDeps,
    path: string,
    label: string,
    page: number,
    extraParams: Record<string, string> = {}
  ): Promise<{ list: unknown[]; root: Record<string, unknown> }> {
    let waits = 0;
    for (;;) {
      try {
        return await this.fetchYpApiPage(deps, path, label, page, extraParams);
      } catch (error) {
        const rateLimited =
          error instanceof NetworkAdapterError && error.code === "RATE_LIMITED";
        if (!rateLimited) throw error;
        if (waits >= YP_API_RATE_LIMIT_MAX_RETRIES) {
          const waitSecs = deps.rateLimitWaitMs / 1000;
          const waitLabel = Number.isInteger(waitSecs)
            ? String(waitSecs)
            : waitSecs.toFixed(1);
          throw new NetworkAdapterError(
            "RATE_LIMITED",
            `YeahPromos API（${label}）第 ${page} 页持续触发限流：已等待重试 ` +
              `${waits} 次（每次 ${waitLabel}s）仍失败。最后一次响应：${error.message}`,
            429
          );
        }
        waits += 1;
        if (deps.rateLimitWaitMs > 0) {
          await new Promise((r) => setTimeout(r, deps.rateLimitWaitMs));
        }
      }
    }
  }

  /** 分页拉全量（products/brands 共用同一节流预算，串行执行）。 */
  private async pullAllYpPages(
    deps: YpApiRequestDeps,
    path: string,
    label: string,
    extraParams: Record<string, string> = {}
  ): Promise<Array<Record<string, unknown>>> {
    const items: Array<Record<string, unknown>> = [];
    let page = 1;
    let hasMore = true;
    while (hasMore && page <= deps.maxPages) {
      const { list, root } = await this.fetchYpApiPageWithRateLimitRetry(
        deps,
        path,
        label,
        page,
        extraParams
      );
      for (const it of list) {
        items.push(
          (it !== null && typeof it === "object" ? it : {}) as Record<
            string,
            unknown
          >
        );
      }
      // Laravel 分页器口径优先（2026-10-20 真实响应证实）：current_page 与
      // last_page 都是数字时以之为准；next_page_url 非 null 也算有下一页。
      const currentPage = firstNumberAtPaths(root, [
        ...YP_API_CURRENT_PAGE_PATHS,
      ]);
      const lastPage = firstNumberAtPaths(root, [...YP_API_LAST_PAGE_PATHS]);
      if (currentPage != null && lastPage != null) {
        hasMore = currentPage < lastPage && list.length > 0;
      } else if (
        YP_API_NEXT_PAGE_URL_PATHS.some((p) => getPath(root, p) != null)
      ) {
        hasMore = list.length > 0;
      } else {
        const pageTotal = firstNumberAtPaths(root, [
          ...YP_API_PAGE_TOTAL_PATHS,
        ]);
        if (pageTotal != null) {
          hasMore = page < pageTotal && list.length > 0;
        } else if (
          YP_API_HAS_MORE_PATHS.some((p) => getPath(root, p) === true)
        ) {
          hasMore = list.length > 0;
        } else {
          // 无分页元数据：满页则试探下一页，不满页即结束。
          hasMore = list.length >= deps.pageSize;
        }
      }
      page += 1;
    }
    return items;
  }

  /**
   * api 模式：官方 API 一键导入。
   * 1) GET brands 建 advert_id → 广告主原始记录映射（回填商品 brand 用）；
   * 2) GET products 拉商品并映射。两步串行、共享 10 次/分钟节流预算。
   */
  async pullOffers(
    ctx: AdapterContext,
    opts: YeahPromosPullOpts = {}
  ): Promise<NetworkOffer[]> {
    const { token, siteId } = parseYpApiCredentials(ctx.apiKey);
    const baseUrl = (ctx.apiBaseUrl || YP_DEFAULT_SESSION_BASE_URL).replace(
      /\/+$/,
      ""
    );
    const rawPath = (ctx.apiProductsPath ?? "").trim();
    const productsPath = rawPath
      ? rawPath.startsWith("/")
        ? rawPath
        : `/${rawPath}`
      : YP_DEFAULT_API_PRODUCTS_PATH;
    const ssrfCheck = ctx.ssrfCheck ?? assertYpApiUrlSafe;
    await ssrfCheck(`${baseUrl}${productsPath}`);
    await ssrfCheck(`${baseUrl}${YP_DEFAULT_API_BRANDS_PATH}`);

    const pageDelayMs = Math.max(
      0,
      opts.pageDelayMs ?? YP_API_MIN_REQUEST_INTERVAL_MS
    );
    // 共享节流：记录上次请求时刻，任意相邻请求（跨 products/brands）间隔 ≥ pageDelayMs。
    let lastRequestAt = 0;
    const throttle = async (): Promise<void> => {
      if (pageDelayMs > 0 && lastRequestAt > 0) {
        const wait = pageDelayMs - (Date.now() - lastRequestAt);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      lastRequestAt = Date.now();
    };

    const deps: YpApiRequestDeps = {
      baseUrl,
      token,
      siteId,
      fetchImpl: ctx.fetchImpl ?? fetch,
      timeoutMs: ctx.timeoutMs ?? YP_API_DEFAULT_TIMEOUT_MS,
      pageSize: Math.max(
        1,
        Math.min(YP_API_PAGE_SIZE, opts.pageSize ?? YP_API_PAGE_SIZE)
      ),
      maxPages: Math.max(1, Math.min(50, opts.maxPages ?? YP_API_MAX_PAGES)),
      throttle,
      rateLimitWaitMs: Math.max(
        0,
        opts.rateLimitWaitMs ?? YP_API_RATE_LIMIT_WAIT_MS
      ),
    };

    // 1. 广告主映射：advert_id → 原始记录（名称在 mapApiItem 时防御式提取）。
    const brandItems = await this.pullAllYpPages(
      deps,
      YP_DEFAULT_API_BRANDS_PATH,
      "Get Adverts",
      opts.marketPlace ? { market_place: opts.marketPlace } : {}
    );
    const brandByAdvertId = new Map<string, Record<string, unknown>>();
    for (const b of brandItems) {
      const advertId = ypIdToString(pickField(b, "advert_id", "advertId", "id", "brand_id"));
      if (advertId) brandByAdvertId.set(advertId, b);
    }

    // 2. 商品拉取 + 映射（含 advert_id 回填 brand）。
    const productItems = await this.pullAllYpPages(
      deps,
      productsPath,
      "Get Products"
    );
    const offers: NetworkOffer[] = [];
    for (const item of productItems) {
      const offer = this.mapApiItem(item, brandByAdvertId);
      if (offer.externalId) offers.push(offer);
    }
    return offers;
  }
}
