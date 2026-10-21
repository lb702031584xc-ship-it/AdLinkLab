/**
 * Network API framework — PartnerBoost adapter (publisher side).
 *
 * Credential format: Channel API token (the "All Channels" token works for
 * every channel). Stored encrypted; passed in the JSON body as `token`.
 *
 * Catalog endpoint: POST https://app.partnerboost.com/api/datafeed/get_fba_products
 *   - page_size (max 50), page, country_code (e.g. "US"),
 *   - sort: 1 = best selling, 2 = most discount, 3 = best coupon
 *   - relationship: 1 = only products with a partnership (default: joined brands)
 *   - return_link: 1 = include PartnerBoost attribution link
 *   - return_performance_bonus: 1 = include bonus tiers
 * Response: { status: { code: 0 }, data: { list: [...], has_more: bool } }
 *
 * Second catalog source (pullDatafeedOffers): Datafeed generic list
 *   POST {base}/api.php?mod=datafeed&op=list （文档口径；REST 风格同名路径作候选）
 *   - brand_type: DTC / Walmart（本批只取这两类）、limit（每页最大 100）、page
 *   - 返回 data 为商品数组（字段：name/brand/merchant_name/sku/price/
 *     tracking_url[_short|_smart]…），文档字段表无佣金字段 → 佣金未知（null）。
 *
 * Link generation: POST /api/datafeed/get_amazon_link_by_asin
 *   - asins (max 50, comma-separated), country_code, return_partnerboost_link
 */
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isBlockedIp } from "../ai/fetch-page.js";
import type {
  AdapterContext,
  NetworkAdapter,
  NetworkOffer,
  SyncMode,
} from "./types.js";

export const PARTNERBOOST_DEFAULT_BASE_URL = "https://app.partnerboost.com";
export const PARTNERBOOST_PAGE_SIZE = 50;
export const PARTNERBOOST_MAX_PAGES = 20;
export const PARTNERBOOST_DEFAULT_TIMEOUT_MS = 15_000;
export const PARTNERBOOST_DEFAULT_COUNTRY = "US";

/** Datafeed 通用 list：每页条数（文档上限 100）。 */
export const PARTNERBOOST_DATAFEED_PAGE_LIMIT = 100;
/** Datafeed 通用 list：单 brand_type 分页硬顶（100/页 × 200 页 = 2 万件/类）。 */
export const PARTNERBOOST_DATAFEED_MAX_PAGES = 200;
/**
 * 本批抓取的 brand_type：DTC（品牌独立站）+ Walmart。
 * TikTok 不取：短视频电商的落地/归因形态与现有商品模型不同，另行评估。
 */
export const PARTNERBOOST_DATAFEED_BRAND_TYPES = ["DTC", "Walmart"] as const;

/**
 * Endpoint candidates: docs list the `/api/datafeed/...` REST paths, but
 * some accounts only expose the legacy `api.php?mod=...&op=...` style
 * (same as the Transaction API). Try in order, fall through on 404.
 */
function endpointCandidates(baseUrl: string, restPath: string): string[] {
  // get_fba_products -> mod=datafeed&op=get_fba_products (legacy api.php style)
  const legacyOp = restPath.replace(/^\/api\/datafeed\//, "");
  const base = baseUrl.replace(/\/+$/, ""); // strip trailing slashes to avoid //
  return [
    `${base}${restPath}`,
    `${base}/api.php?mod=datafeed&op=${legacyOp}`,
  ];
}

/**
 * POST JSON to the first endpoint candidate that doesn't 404.
 * Returns { res, json } from the successful call.
 */
async function postWithFallback(
  candidates: string[],
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<{ res: Response; json: any }> {
  for (const url of candidates) {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new NetworkAdapterError(
        "NETWORK_ERROR",
        `PartnerBoost request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (res.status === 404) {
      continue; // try next candidate
    }
    if (!res.ok) {
      throw new NetworkAdapterError(
        "HTTP_ERROR",
        `PartnerBoost API returned HTTP ${res.status} for ${url}`,
        res.status
      );
    }
    return { res, json: await res.json() };
  }
  throw new NetworkAdapterError(
    "HTTP_ERROR",
    `PartnerBoost API returned HTTP 404 for all endpoints tried: ${candidates.join(" , ")} ` +
      `(token length ${(body.token as string)?.length ?? 0}; ` +
      `check the API Base URL in network settings and that the Datafeed/Amazon API is enabled)`,
    404
  );
}

export class NetworkAdapterError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "NetworkAdapterError";
    this.code = code;
    this.status = status;
  }
}

/** SSRF guard for outbound PartnerBoost API calls. */
export async function assertApiUrlSafe(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new NetworkAdapterError(
      "INVALID_URL",
      "PartnerBoost API base URL is not a valid URL"
    );
  }
  if (parsed.protocol !== "https:") {
    throw new NetworkAdapterError(
      "INVALID_URL",
      "PartnerBoost API base URL must be https"
    );
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(parsed.hostname, { all: true });
  } catch {
    throw new NetworkAdapterError("DNS_FAILED", "DNS lookup failed");
  }
  for (const a of addresses) {
    if (isBlockedIp(a.address)) {
      throw new NetworkAdapterError("BLOCKED_TARGET", "Blocked IP address");
    }
  }
}

interface PartnerBoostProduct {
  product_id?: string;
  product_name?: string;
  asin?: string;
  commission?: string;
  category?: string;
  subcategory?: string;
  brand_name?: string;
  brand_id?: number | string;
  url?: string;
  partnerboost_link?: string;
  link?: string;
  rating?: string;
  reviews?: string | number;
  discount?: string;
  coupon?: string;
  original_price?: string;
  discount_price?: string;
  currency?: string;
  country_code?: string;
  monthly_purchase_volume?: string;
  performance_bonus?: {
    enabled?: boolean;
    description?: string;
  };
}

interface PartnerBoostListResponse {
  status?: { code?: number; msg?: string };
  data?: {
    list?: PartnerBoostProduct[];
    has_more?: boolean;
  };
}

/**
 * Datafeed 通用 list（op=list）单品。字段以 PB 官方文档字段表为准；
 * commission / commission_rate 不在文档字段表内，仅作防御式可选键
 * （真实响应若带了就映射，没带 → 佣金未知 null，绝不编造）。
 */
interface PartnerBoostDatafeedProduct {
  name?: string;
  description?: string;
  brand_id?: number | string;
  mcid?: string;
  merchant_name?: string;
  url?: string;
  image?: string;
  sku?: string;
  category?: string;
  price?: string | number;
  currency?: string;
  old_price?: string | number;
  brand?: string;
  availability?: string;
  gtin?: string;
  mpn?: string;
  custom1?: string;
  custom2?: string;
  custom3?: string;
  creative_id?: number | string;
  tracking_url?: string;
  tracking_url_short?: string;
  tracking_url_smart?: string;
  updated_at?: number | string;
  commission?: unknown;
  commission_rate?: unknown;
}

interface PartnerBoostDatafeedListResponse {
  status?: { code?: number; msg?: string };
  /** 文档口径：data 直接是商品数组；个别账号可能包一层 { list }，防御式兼容。 */
  data?: PartnerBoostDatafeedProduct[] | { list?: PartnerBoostDatafeedProduct[] };
}

export interface PartnerBoostDatafeedPullOpts {
  /** 按品牌 ID 过滤（与 FBA 按商家同步同一 brandId；仅指定时发送）。 */
  brandId?: number | string;
  /** 抓取的 brand_type 列表（默认 DTC + Walmart）。 */
  brandTypes?: readonly string[];
  /** 每页条数（默认 100 = 文档上限）。 */
  limit?: number;
  /** 单 brand_type 分页硬顶（默认 200 页）。 */
  maxPages?: number;
  /**
   * 单个 brand_type 抓取失败时的回调（给定时不中断其他 brand_type；
   * 不给定时第一个失败直接抛错，与 pullOffers 口径一致）。
   */
  onBrandTypeError?: (brandType: string, message: string) => void;
}

const nonEmpty = (v: unknown): string =>
  typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();

/**
 * Datafeed 商品的稳定 externalId（跨同步不变、防与 FBA 的 ASIN/product_id 撞键）：
 * 1. `df:{brand_id}:{sku}`；2. sku 缺失 → `df:{brand_id}:{creative_id}`；
 * 3. 再缺 → `df:u:{sha256(url) 前 16 位}`（url 为原始商品链接）；
 * 4. 都没有 → null（无法形成稳定键，适配器跳过该条）。
 * 注意：同一 brand_id+sku 若同时出现在 DTC 与 Walmart 两类，会映射到同一
 * externalId（后写覆盖先写）——brand_id 是品牌级标识，此合并可接受。
 */
export function datafeedExternalId(p: PartnerBoostDatafeedProduct): string | null {
  const brandId = nonEmpty(p.brand_id);
  const sku = nonEmpty(p.sku);
  if (brandId && sku) return `df:${brandId}:${sku}`;
  const creativeId = nonEmpty(p.creative_id);
  if (brandId && creativeId) return `df:${brandId}:${creativeId}`;
  const url = nonEmpty(p.url);
  if (url) {
    const hash = createHash("sha256").update(url).digest("hex").slice(0, 16);
    return `df:u:${hash}`;
  }
  return null;
}

/** Datafeed 单品 → NetworkOffer；无法形成稳定 externalId → null（跳过）。 */
function mapDatafeedProduct(
  p: PartnerBoostDatafeedProduct,
  brandType: string
): NetworkOffer | null {
  const externalId = datafeedExternalId(p);
  if (!externalId) return null;
  const brand = nonEmpty(p.brand) || nonEmpty(p.merchant_name) || null;
  // 推广链接优先 smart（与 FBA 的 partnerboost_link 口径一致），其次
  // tracking_url、tracking_url_short，最后原始商品链接。
  const promoUrl =
    nonEmpty(p.tracking_url_smart) ||
    nonEmpty(p.tracking_url) ||
    nonEmpty(p.tracking_url_short) ||
    nonEmpty(p.url) ||
    null;
  // 落地页类型按原始商品链接判（DTC 品牌站/Walmart 商品页都非 Amazon 格式
  // → dtc）；原始链接缺失时退推广链接判。
  const landingSource = nonEmpty(p.url) || promoUrl;
  // 佣金：文档字段表没有佣金字段。防御式——真实响应若带 commission/
  // commission_rate 才按 FBA 同口径解析为百分比；没有 → null（未知）。
  const rawCommission = p.commission ?? p.commission_rate ?? null;
  const commissionPct =
    rawCommission == null ? null : parseCommission(rawCommission);
  return {
    externalId,
    name: nonEmpty(p.name) || nonEmpty(p.sku) || "Unknown product",
    payout: commissionPct,
    currency: commissionPct != null ? "%" : null,
    termsText: [
      brand ? `Brand: ${brand}` : null,
      p.merchant_name ? `Merchant: ${p.merchant_name}` : null,
      p.category ? `Category: ${p.category}` : null,
      p.availability ? `Availability: ${p.availability}` : null,
    ]
      .filter(Boolean)
      .join(" | "),
    url: promoUrl,
    // list 接口不给国家：置 null，下游有既有回填/未知口径，不猜。
    countryCode: null,
    landingPageType: deriveLandingPageType(landingSource),
    brand,
    // DTO 的 asin 字段口径为「ASIN / SKU」：datafeed 无 ASIN，用 sku。
    asin: nonEmpty(p.sku) || null,
    price: parsePrice(p.price),
    priceCurrency: nonEmpty(p.currency) || null,
    reviewCount: null,
    rawData: {
      ...(p as unknown as Record<string, unknown>),
      // brand_type 是请求参数（响应不带），注入 rawData 供分来源计数/溯源；
      // brand_id/mcid/merchant_name/gtin/mpn/availability 等随原始对象一并保留。
      brand_type: brandType,
      source_feed: "datafeed_list",
    },
  };
}

export interface PartnerBoostPullOpts {
  countryCode?: string;
  /** 1 = best selling, 2 = most discount, 3 = best coupon */
  sort?: 1 | 2 | 3;
  /** 1 = only joined partnerships, 2 = all */
  relationship?: 1 | 2;
  returnLink?: boolean;
  returnPerformanceBonus?: boolean;
  maxPages?: number;
  /** 按品牌 ID 过滤（单品牌，不支持多品牌批量）。只在指定时发送，默认不发送。 */
  brandId?: number | string;
}

function parseCommission(raw: unknown): number | null {
  if (raw == null) return null;
  const m = String(raw).match(/([\d.]+)\s*%/);
  if (m) return parseFloat(m[1]);
  const n = parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

/** 解析价格字符串（如 "$1,299.99" / "105.99"）→ 数字；解析不出 → null。 */
function parsePrice(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const cleaned = String(raw).replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** 解析评论数（"489" / 489）→ 整数；解析不出 → null。 */
function parseReviewCount(raw: unknown): number | null {
  if (raw == null) return null;
  const n =
    typeof raw === "number" ? raw : parseInt(String(raw).replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/**
 * 从落地页 URL 推导落地页类型。
 * - 含 /stores/ 或 amazon.com/s? → amazon_storefront（Amazon 店铺页）
 * - 含 /dp/ 或 /gp/product/ → amazon_product（Amazon 商品页）
 * - 有 URL 但非 Amazon 格式 → dtc（品牌独立站）
 * - 无 URL → unknown
 */
export function deriveLandingPageType(
  url: string | null | undefined
): string {
  if (!url || !url.trim()) return "unknown";
  const u = url.toLowerCase();
  if (u.includes("/stores/") || u.includes("amazon.com/s?")) {
    return "amazon_storefront";
  }
  if (u.includes("/dp/") || u.includes("/gp/product/")) {
    return "amazon_product";
  }
  return "dtc";
}

export class PartnerBoostAdapter implements NetworkAdapter {
  readonly kind = "partnerboost";
  readonly displayName = "PartnerBoost";
  readonly defaultBaseUrl = PARTNERBOOST_DEFAULT_BASE_URL;
  readonly supportsModes: readonly SyncMode[] = ["api", "session"] as const;

  async pullOffers(
    ctx: AdapterContext,
    opts: PartnerBoostPullOpts = {}
  ): Promise<NetworkOffer[]> {
    const token = ctx.apiKey.trim();
    if (!token) {
      throw new NetworkAdapterError(
        "BAD_CREDENTIALS",
        "PartnerBoost Channel API token is required"
      );
    }
    const baseUrl = (ctx.apiBaseUrl || PARTNERBOOST_DEFAULT_BASE_URL).replace(
      /\/$/,
      ""
    );
    const ssrfCheck = ctx.ssrfCheck ?? assertApiUrlSafe;
    await ssrfCheck(`${baseUrl}/api/datafeed/get_fba_products`);

    const fetchImpl = ctx.fetchImpl ?? fetch;
    const timeoutMs = ctx.timeoutMs ?? PARTNERBOOST_DEFAULT_TIMEOUT_MS;
    const maxPages = opts.maxPages ?? PARTNERBOOST_MAX_PAGES;
    // countryCode 保留给未来（当前 API 对额外字段敏感，暂不发送）

    const offers: NetworkOffer[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= maxPages) {
      // 注意：PartnerBoost datafeed API 对请求体做严格字段白名单校验，
      // 多加任何一个可选字段（如 country_code/sort/relationship）都会返回
      // code 1000 "user not exist"。只发最小必需字段。
      // brand_id 例外：文档标为有效参数，仅在用户明确指定按商家同步时发送。
      const body: Record<string, unknown> = {
        token,
        page_size: PARTNERBOOST_PAGE_SIZE,
        page,
        ...(opts.brandId != null && String(opts.brandId).trim() !== ""
          ? { brand_id: opts.brandId }
          : {}),
      };

      const { json } = await postWithFallback(
        endpointCandidates(baseUrl, "/api/datafeed/get_fba_products"),
        body,
        fetchImpl,
        timeoutMs
      );

      const listRes = json as PartnerBoostListResponse;
      if (listRes.status?.code !== 0) {
        throw new NetworkAdapterError(
          "API_ERROR",
          `PartnerBoost API error: ${listRes.status?.msg ?? "unknown"}`
        );
      }

      const list = listRes.data?.list ?? [];
      for (const p of list) {
        const commissionPct = parseCommission(p.commission);
        const bonusDesc = p.performance_bonus?.enabled
          ? p.performance_bonus.description
          : null;
        const landingUrl = p.partnerboost_link || p.link || p.url || null;
        offers.push({
          externalId: p.product_id ?? p.asin ?? "",
          name: p.product_name ?? p.asin ?? "Unknown product",
          payout: commissionPct,
          currency: "%",
          termsText: [
            p.brand_name ? `Brand: ${p.brand_name}` : null,
            p.category ? `Category: ${p.category}${p.subcategory ? ` / ${p.subcategory}` : ""}` : null,
            p.discount ? `Discount: ${p.discount}` : null,
            p.coupon ? `Coupon: ${p.coupon}` : null,
            bonusDesc ? `Bonus: ${bonusDesc}` : null,
            p.monthly_purchase_volume ? `Volume: ${p.monthly_purchase_volume}` : null,
          ]
            .filter(Boolean)
            .join(" | "),
          url: landingUrl,
          countryCode: p.country_code?.trim() || null,
          landingPageType: deriveLandingPageType(landingUrl),
          brand: p.brand_name?.trim() || null,
          asin: p.asin?.trim() || null,
          price: parsePrice(p.discount_price ?? p.original_price),
          priceCurrency: p.currency?.trim() || null,
          reviewCount: parseReviewCount(p.reviews),
          rawData: p as unknown as Record<string, unknown>,
        });
      }

      hasMore = json.data?.has_more === true && list.length > 0;
      page += 1;
    }

    return offers;
  }

  /**
   * Second catalog source: Datafeed 通用 list（op=list），按 brand_type 分别
   * 分页拉全（DTC + Walmart）。与 FBA 的 get_fba_products 互补：FBA 只有
   * 亚马逊商品，DTC 品牌独立站 / Walmart 商品只在这个口出。
   *
   * 文档要点：必填 token；limit 每页最大 100；返回 data 为商品数组；
   * 字段表无佣金 → payout 恒为 null（防御式映射见 mapDatafeedProduct）。
   * list 接口不给国家 → countryCode 恒 null（下游既有未知口径，不猜）。
   */
  async pullDatafeedOffers(
    ctx: AdapterContext,
    opts: PartnerBoostDatafeedPullOpts = {}
  ): Promise<NetworkOffer[]> {
    const token = ctx.apiKey.trim();
    if (!token) {
      throw new NetworkAdapterError(
        "BAD_CREDENTIALS",
        "PartnerBoost Channel API token is required"
      );
    }
    const baseUrl = (ctx.apiBaseUrl || PARTNERBOOST_DEFAULT_BASE_URL).replace(
      /\/$/,
      ""
    );
    const ssrfCheck = ctx.ssrfCheck ?? assertApiUrlSafe;
    await ssrfCheck(`${baseUrl}/api/datafeed/list`);

    const fetchImpl = ctx.fetchImpl ?? fetch;
    const timeoutMs = ctx.timeoutMs ?? PARTNERBOOST_DEFAULT_TIMEOUT_MS;
    const limit = opts.limit ?? PARTNERBOOST_DATAFEED_PAGE_LIMIT;
    const maxPages = opts.maxPages ?? PARTNERBOOST_DATAFEED_MAX_PAGES;
    const brandTypes = opts.brandTypes ?? PARTNERBOOST_DATAFEED_BRAND_TYPES;

    const offers: NetworkOffer[] = [];
    for (const brandType of brandTypes) {
      try {
        let page = 1;
        for (;;) {
          // 同 FBA：只发文档明确列出的参数（token/brand_type/limit/page，
          // brand_id 仅按商家同步时发），不多发可选字段。
          const body: Record<string, unknown> = {
            token,
            brand_type: brandType,
            limit,
            page,
            ...(opts.brandId != null && String(opts.brandId).trim() !== ""
              ? { brand_id: opts.brandId }
              : {}),
          };
          const { json } = await postWithFallback(
            endpointCandidates(baseUrl, "/api/datafeed/list"),
            body,
            fetchImpl,
            timeoutMs
          );
          const listRes = json as PartnerBoostDatafeedListResponse;
          if (listRes.status?.code !== 0) {
            throw new NetworkAdapterError(
              "API_ERROR",
              `PartnerBoost API error: ${listRes.status?.msg ?? "unknown"}`
            );
          }
          const list = Array.isArray(listRes.data)
            ? listRes.data
            : (listRes.data?.list ?? []);
          for (const p of list) {
            const mapped = mapDatafeedProduct(p, brandType);
            if (mapped) offers.push(mapped);
          }
          // 返回条数 < 每页上限 = 最后一页；硬顶防上游异常死循环。
          if (list.length < limit || page >= maxPages) break;
          page += 1;
        }
      } catch (error) {
        if (!opts.onBrandTypeError) throw error;
        opts.onBrandTypeError(
          brandType,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
    return offers;
  }

  /**
   * Generate attribution links for ASINs via get_amazon_link_by_asin.
   * Returns map of ASIN → link URL.
   */
  async generateLinks(
    ctx: AdapterContext,
    asins: string[]
  ): Promise<Record<string, string>> {
    const token = ctx.apiKey.trim();
    if (!token) {
      throw new NetworkAdapterError(
        "BAD_CREDENTIALS",
        "PartnerBoost Channel API token is required"
      );
    }
    const baseUrl = (ctx.apiBaseUrl || PARTNERBOOST_DEFAULT_BASE_URL).replace(
      /\/$/,
      ""
    );
    const ssrfCheck = ctx.ssrfCheck ?? assertApiUrlSafe;
    await ssrfCheck(`${baseUrl}/api/datafeed/get_amazon_link_by_asin`);

    const fetchImpl = ctx.fetchImpl ?? fetch;
    const timeoutMs = ctx.timeoutMs ?? PARTNERBOOST_DEFAULT_TIMEOUT_MS;
    const out: Record<string, string> = {};

    // API caps at 50 ASINs per call.
    for (let i = 0; i < asins.length; i += 50) {
      const batch = asins.slice(i, i + 50);
      const { json } = await postWithFallback(
        endpointCandidates(baseUrl, "/api/datafeed/get_amazon_link_by_asin"),
        // 最小字段：API 对额外字段敏感
        { token, asins: batch.join(",") },
        fetchImpl,
        timeoutMs
      );
      const linkRes = json as {
        status?: { code?: number; msg?: string };
        data?: { asin?: string; link?: string; partnerboost_link?: string }[];
      };
      if (linkRes.status?.code !== 0) {
        throw new NetworkAdapterError(
          "API_ERROR",
          `PartnerBoost API error: ${linkRes.status?.msg ?? "unknown"}`
        );
      }
      for (const item of linkRes.data ?? []) {
        if (item.asin && (item.partnerboost_link || item.link)) {
          out[item.asin] = item.partnerboost_link || item.link!;
        }
      }
    }
    return out;
  }
}
