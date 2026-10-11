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
 * Link generation: POST /api/datafeed/get_amazon_link_by_asin
 *   - asins (max 50, comma-separated), country_code, return_partnerboost_link
 */
import { lookup } from "node:dns/promises";
import { isBlockedIp } from "../ai/fetch-page.js";
import type {
  AdapterContext,
  NetworkAdapter,
  NetworkOffer,
} from "./types.js";

export const PARTNERBOOST_DEFAULT_BASE_URL = "https://app.partnerboost.com";
export const PARTNERBOOST_PAGE_SIZE = 50;
export const PARTNERBOOST_MAX_PAGES = 20;
export const PARTNERBOOST_DEFAULT_TIMEOUT_MS = 15_000;
export const PARTNERBOOST_DEFAULT_COUNTRY = "US";

/**
 * Endpoint candidates: docs list the `/api/datafeed/...` REST paths, but
 * some accounts only expose the legacy `api.php?mod=...&op=...` style
 * (same as the Transaction API). Try in order, fall through on 404.
 */
function endpointCandidates(baseUrl: string, restPath: string): string[] {
  // get_fba_products -> mod=datafeed&op=get_fba_products (legacy api.php style)
  const legacyOp = restPath.replace(/^\/api\/datafeed\//, "");
  return [
    `${baseUrl}${restPath}`,
    `${baseUrl}/api.php?mod=datafeed&op=${legacyOp}`,
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
  let last404: Response | null = null;
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
      last404 = res;
      continue; // try next candidate
    }
    if (!res.ok) {
      throw new NetworkAdapterError(
        "HTTP_ERROR",
        `PartnerBoost API returned HTTP ${res.status}`,
        res.status
      );
    }
    return { res, json: await res.json() };
  }
  throw new NetworkAdapterError(
    "HTTP_ERROR",
    "PartnerBoost API returned HTTP 404 (endpoint not found — check that the Datafeed/Amazon API is enabled for your account)",
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

export interface PartnerBoostPullOpts {
  countryCode?: string;
  /** 1 = best selling, 2 = most discount, 3 = best coupon */
  sort?: 1 | 2 | 3;
  /** 1 = only joined partnerships, 2 = all */
  relationship?: 1 | 2;
  returnLink?: boolean;
  returnPerformanceBonus?: boolean;
  maxPages?: number;
}

function parseCommission(raw: unknown): number | null {
  if (raw == null) return null;
  const m = String(raw).match(/([\d.]+)\s*%/);
  if (m) return parseFloat(m[1]);
  const n = parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

export class PartnerBoostAdapter implements NetworkAdapter {
  readonly kind = "partnerboost";
  readonly displayName = "PartnerBoost";

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
    const countryCode = opts.countryCode ?? PARTNERBOOST_DEFAULT_COUNTRY;

    const offers: NetworkOffer[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= maxPages) {
      const body = {
        token,
        page_size: PARTNERBOOST_PAGE_SIZE,
        page,
        country_code: countryCode,
        sort: opts.sort ?? 1,
        relationship: opts.relationship ?? 1,
        return_link: opts.returnLink ? 1 : 0,
        return_performance_bonus: opts.returnPerformanceBonus ? 1 : 0,
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
          url:
            p.partnerboost_link || p.link || p.url || null,
          rawData: p as unknown as Record<string, unknown>,
        });
      }

      hasMore = json.data?.has_more === true && list.length > 0;
      page += 1;
    }

    return offers;
  }

  /**
   * Generate attribution links for ASINs via get_amazon_link_by_asin.
   * Returns map of ASIN → link URL.
   */
  async generateLinks(
    ctx: AdapterContext,
    asins: string[],
    countryCode = PARTNERBOOST_DEFAULT_COUNTRY
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
        {
          token,
          asins: batch.join(","),
          country_code: countryCode,
          return_partnerboost_link: 1,
        },
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
