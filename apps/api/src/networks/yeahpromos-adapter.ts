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
 *   ≥6.5s；429 直接降级，不重试、不死循环。
 *   凭证：token + site_id 合并为一段 JSON 存入网络设置的 apiKeyRef
 *   （AES-256-GCM 加密、只写不读，跟随 PB 现有凭证模式；绝不明文、绝不经聊天）。
 *   ⚠️ 返回字段清单未经真实响应验证：字段映射沿用 session mapper 的防御式
 *   pickField 候选名；响应结构对不上（无 code / 候选路径找不到列表）时抛
 *   YP_API_STRUCTURE_UNVERIFIED 明错，由同步服务统一降级（FAILED + 审计），
 *   绝不伪造数据。products 路径默认值为上方已验证地址，仍可在网络设置用
 *   apiProductsPath 覆盖（仿 sessionListPath 机制）。
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
export const YP_API_MAX_PAGES = 20;
export const YP_API_DEFAULT_TIMEOUT_MS = 15_000;
/** 官方限流 10 次/分钟 → 任意相邻请求最小间隔 6.5s（留 0.5s 余量）。 */
export const YP_API_MIN_REQUEST_INTERVAL_MS = 6_500;
/** YP 结果码：成功。 */
export const YP_API_CODE_SUCCESS = 100000;
/** YP 结果码：失败。 */
export const YP_API_CODE_ERROR = 100001;

export interface YeahPromosPullOpts {
  maxPages?: number;
  /** 任意相邻请求的最小间隔 ms（默认 YP_API_MIN_REQUEST_INTERVAL_MS；测试可调小）。 */
  pageDelayMs?: number;
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

/* ── 防御式 JSON 读取（响应结构未经真实响应验证，候选路径兜底） ── */

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

/** 列表候选路径（products/brands 返回字段均未经真实响应验证，按常见结构防御式排列）。 */
const YP_API_LIST_PATHS = [
  "data.list",
  "data.items",
  "data.products",
  "data.brands",
  "data.adverts",
  "data.rows",
  "data.data",
  "list",
  "items",
  "products",
  "brands",
  "data",
] as const;

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
      sessionAsString(
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
          pickField(item, "promo_url", "promoUrl", "promotion_url", "url", "link")
        ) ?? null,
      brand: sessionAsString(pickField(item, "brand", "brand_name", "brandName")),
      asin: sessionAsString(pickField(item, "asin")),
      price: sessionAsNumber(
        pickField(item, "price", "sale_price", "salePrice", "original_price")
      ),
      commissionAmount,
      commissionRate,
      reviewCount: sessionAsNumber(
        pickField(item, "review_count", "reviewCount", "reviews")
      ),
      promoUrl:
        sessionAsString(
          pickField(item, "promo_url", "promoUrl", "promotion_url", "url", "link")
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
      const advertId = sessionAsString(pickField(item, ...YP_ADVERT_ID_KEYS));
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
        ) ?? null,
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
   * 防御式找列表。错误一律明错（NetworkAdapterError），不重试、不伪造。
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
    try {
      res = await deps.fetchImpl(url, {
        method: "GET",
        headers: {
          // token 只放请求头；绝不打日志、绝不进 URL。
          token: deps.token,
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        signal: AbortSignal.timeout(deps.timeoutMs),
      });
    } catch (error) {
      throw new NetworkAdapterError(
        "NETWORK_ERROR",
        `YeahPromos API（${label}）请求失败：${error instanceof Error ? error.message : String(error)}`
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
      // 官方限流 10 次/分钟 → 直接降级，不重试、不退避重试。
      throw new NetworkAdapterError(
        "RATE_LIMITED",
        "YeahPromos API 触发限流（HTTP 429，官方上限 10 次/分钟）：已降级停止，未做任何重试",
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

    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    if (json === null || typeof json !== "object") {
      throw new NetworkAdapterError(
        "YP_API_STRUCTURE_UNVERIFIED",
        `YeahPromos API（${label}）响应不是 JSON（可能被重定向到登录页或接口路径不对）：` +
          `请核对接口路径（${path}）后重试`
      );
    }
    const root = json as Record<string, unknown>;

    // 结果码判定（文档：100000 成功 / 100001 失败；code 可能在顶层或 data/status 下）。
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
          "）找到列表。返回字段未经真实响应验证，已停止导入（未写入任何数据）；" +
          "请把真实响应样例反馈给管理员核对字段结构"
      );
    }
    return { list, root };
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
      const { list, root } = await this.fetchYpApiPage(
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
      const pageTotal = firstNumberAtPaths(root, [...YP_API_PAGE_TOTAL_PATHS]);
      if (pageTotal != null) {
        hasMore = page < pageTotal && list.length > 0;
      } else if (YP_API_HAS_MORE_PATHS.some((p) => getPath(root, p) === true)) {
        hasMore = list.length > 0;
      } else {
        // 无分页元数据：满页则试探下一页，不满页即结束。
        hasMore = list.length >= deps.pageSize;
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
      const advertId = sessionAsString(pickField(b, "advert_id", "advertId", "id", "brand_id"));
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
