/**
 * Amazon PA-API 5.0 adapter — 产品发现与选品。
 *
 * 需要用户在 Amazon Associates 后台申请 PA-API 凭证：
 * - Access Key / Secret Key
 * - Partner Tag（跟踪 ID，如 yourtag-20）
 *
 * 注意：PA-API 有严格的调用频率限制（按出单量分档），
 * 新账号每天限额很低，discovery 任务默认每天跑一次。
 *
 * 安全：凭证加密存储，不打日志，不返回前端。
 */
import { createHmac, createHash } from "node:crypto";
import type { NetworkAdapter, NetworkOffer, AdapterContext } from "./types.js";

// PA-API 5.0 各站点 endpoint
const PA_API_HOSTS: Record<string, string> = {
  US: "webservices.amazon.com",
  UK: "webservices.amazon.co.uk",
  DE: "webservices.amazon.de",
  FR: "webservices.amazon.fr",
  JP: "webservices.amazon.co.jp",
  CA: "webservices.amazon.ca",
  IT: "webservices.amazon.it",
  ES: "webservices.amazon.es",
  IN: "webservices.amazon.in",
  BR: "webservices.amazon.com.br",
  MX: "webservices.amazon.com.mx",
  AU: "webservices.amazon.com.au",
  AE: "webservices.amazon.ae",
  SA: "webservices.amazon.sa",
  SG: "webservices.amazon.sg",
  TR: "webservices.amazon.com.tr",
};

const PA_API_MARKETPLACES: Record<string, string> = {
  US: "www.amazon.com",
  UK: "www.amazon.co.uk",
  DE: "www.amazon.de",
  FR: "www.amazon.fr",
  JP: "www.amazon.co.jp",
  CA: "www.amazon.ca",
  IT: "www.amazon.it",
  ES: "www.amazon.es",
  IN: "www.amazon.in",
  BR: "www.amazon.com.br",
  MX: "www.amazon.com.mx",
  AU: "www.amazon.com.au",
  AE: "www.amazon.ae",
  SA: "www.amazon.sa",
  SG: "www.amazon.sg",
  TR: "www.amazon.com.tr",
};

export interface AmazonCredentials {
  accessKey: string;
  secretKey: string;
  partnerTag: string;
  region?: string; // US, UK, JP... 默认 US
}

/** 解析凭证格式：accessKey|secretKey|partnerTag|region(可选) */
export function parseAmazonCredentials(apiKey: string): AmazonCredentials {
  const parts = apiKey.split("|").map((s) => s.trim());
  if (parts.length < 3) {
    throw new Error(
      "Amazon 凭证格式错误，应为: AccessKey|SecretKey|PartnerTag|Region(可选)"
    );
  }
  const [accessKey, secretKey, partnerTag, region] = parts;
  if (!accessKey || !secretKey || !partnerTag) {
    throw new Error("Amazon 凭证不完整，需要 AccessKey、SecretKey、PartnerTag");
  }
  const r = (region || "US").toUpperCase();
  if (!PA_API_HOSTS[r]) {
    throw new Error(`不支持的 Region: ${r}`);
  }
  return { accessKey, secretKey, partnerTag, region: r };
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmacSha256Hex(key: Buffer | string, data: string): string {
  return createHmac("sha256", key).update(data, "utf8").digest("hex");
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/**
 * AWS Signature Version 4 签名（PA-API 5.0 要求）。
 */
export function signPaApiRequest(
  creds: AmazonCredentials,
  method: string,
  path: string,
  payload: string,
  amzDate: string, // YYYYMMDDTHHMMSSZ
  dateStamp: string // YYYYMMDD
): string {
  const region = "us-east-1"; // PA-API 统一用 us-east-1 签名
  const service = "ProductAdvertisingAPI";
  const host = PA_API_HOSTS[creds.region || "US"];

  const payloadHash = sha256Hex(payload);
  const canonicalHeaders =
    `content-encoding:amz-1.0\n` +
    `content-type:application/json; charset=utf-8\n` +
    `host:${host}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-target:com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems\n`;
  const signedHeaders =
    "content-encoding;content-type;host;x-amz-date;x-amz-target";
  const canonicalRequest = [
    method,
    path,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmacSha256("AWS4" + creds.secretKey, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, "aws4_request");
  const signature = hmacSha256Hex(kSigning, stringToSign);

  return (
    `AWS4-HMAC-SHA256 Credential=${creds.accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`
  );
}

export interface AmazonSearchParams {
  keywords: string;
  minPrice?: number; // 美元（按站点货币）
  maxPrice?: number;
  minRating?: number; // 1-5
  minReviews?: number;
  itemCount?: number; // 1-10
  browseNodeId?: string;
}

export interface AmazonProduct {
  asin: string;
  title: string;
  detailPageUrl: string;
  price: number | null;
  currency: string | null;
  rating: number | null;
  reviewCount: number | null;
  imageUrl: string | null;
  isPrime: boolean;
  availability: string | null;
  /** 品牌（ItemInfo.ByLineInfo.Brand.DisplayValue），无则 null */
  brand: string | null;
}

/** PA-API 单品映射（SearchItems / GetItems 共用；PA-API 无 BSR 字段） */
export function parsePaapiItem(it: unknown): AmazonProduct {
    const o = it as Record<string, unknown>;
    const offers = o.Offers as
      | { Listings?: Array<{ Price?: { Amount?: number; Currency?: string }; Availability?: { Message?: string }; DeliveryInfo?: { IsPrimeEligible?: boolean } }> }
      | undefined;
    const listing = offers?.Listings?.[0];
    const customerReviews = o.CustomerReviews as
      | { StarRating?: { Value?: number }; Count?: number }
      | undefined;
    const images = o.Images as
      | { Primary?: { Large?: { URL?: string } } }
      | undefined;
    const byLineInfo = (
      o.ItemInfo as
        | { ByLineInfo?: { Brand?: { DisplayValue?: unknown } } }
        | undefined
    )?.ByLineInfo;
    const brandRaw = byLineInfo?.Brand?.DisplayValue;
    return {
      asin: String(o.ASIN ?? ""),
      title: String((o.ItemInfo as { Title?: { DisplayValue?: string } })?.Title?.DisplayValue ?? ""),
      detailPageUrl: String(o.DetailPageURL ?? ""),
      price: listing?.Price?.Amount ?? null,
      currency: listing?.Price?.Currency ?? null,
      rating: customerReviews?.StarRating?.Value ?? null,
      reviewCount: customerReviews?.Count ?? null,
      imageUrl: images?.Primary?.Large?.URL ?? null,
      isPrime: listing?.DeliveryInfo?.IsPrimeEligible ?? false,
      availability: listing?.Availability?.Message ?? null,
      brand:
        typeof brandRaw === "string" && brandRaw.trim()
          ? brandRaw.trim()
          : null,
    };
}

/** 从 PA-API SearchItems 响应提取产品列表 */
export function parseSearchItemsResponse(data: unknown): AmazonProduct[] {
  const items = (data as { SearchResult?: { Items?: unknown[] } })?.SearchResult
    ?.Items;
  if (!Array.isArray(items)) return [];
  return items.map((it) => parsePaapiItem(it));
}

/** 从 PA-API GetItems 响应提取产品列表 */
export function parseGetItemsResponse(data: unknown): AmazonProduct[] {
  const items = (data as { ItemsResult?: { Items?: unknown[] } })?.ItemsResult
    ?.Items;
  if (!Array.isArray(items)) return [];
  return items.map((it) => parsePaapiItem(it));
}

/** 调用 PA-API GetItems（按 ASIN 批量查详情，最多 10 个/次） */
export async function getAmazonItems(
  creds: AmazonCredentials,
  asins: string[],
  fetchImpl: typeof fetch = fetch
): Promise<AmazonProduct[]> {
  const list = asins
    .map((a) => a.replace(/[^A-Za-z0-9]/g, "").toUpperCase())
    .filter(Boolean)
    .slice(0, 10);
  if (list.length === 0) return [];
  const host = PA_API_HOSTS[creds.region || "US"];
  const marketplace = PA_API_MARKETPLACES[creds.region || "US"];
  const path = "/paapi5/getitems";
  const url = `https://${host}${path}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const dateStamp = amzDate.slice(0, 8);

  const payload = JSON.stringify({
    ItemIds: list,
    PartnerTag: creds.partnerTag,
    PartnerType: "Associates",
    Marketplace: marketplace,
    Resources: [
      "ItemInfo.Title",
      "ItemInfo.ByLineInfo",
      "Offers.Listings.Price",
      "Offers.Listings.Availability",
      "CustomerReviews.StarRating",
      "CustomerReviews.Count",
      "Images.Primary.Large",
    ],
  });

  const auth = signPaApiRequest(creds, "POST", path, payload, amzDate, dateStamp);

  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Encoding": "amz-1.0",
      "X-Amz-Date": amzDate,
      "X-Amz-Target":
        "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems",
      Authorization: auth,
    },
    body: payload,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PA-API 请求失败 (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if ((data as { Errors?: unknown[] })?.Errors?.length) {
    throw new Error(
      `PA-API 错误: ${JSON.stringify((data as { Errors: unknown[] }).Errors).slice(0, 300)}`
    );
  }
  return parseGetItemsResponse(data);
}

/** 调用 PA-API SearchItems */
export async function searchAmazonProducts(
  creds: AmazonCredentials,
  params: AmazonSearchParams,
  fetchImpl: typeof fetch = fetch
): Promise<AmazonProduct[]> {
  const host = PA_API_HOSTS[creds.region || "US"];
  const marketplace = PA_API_MARKETPLACES[creds.region || "US"];
  const path = "/paapi5/searchitems";
  const url = `https://${host}${path}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const dateStamp = amzDate.slice(0, 8);

  const payload = JSON.stringify({
    Keywords: params.keywords,
    PartnerTag: creds.partnerTag,
    PartnerType: "Associates",
    Marketplace: marketplace,
    ItemCount: Math.min(Math.max(params.itemCount ?? 10, 1), 10),
    Resources: [
      "ItemInfo.Title",
      "Offers.Listings.Price",
      "Offers.Listings.Availability",
      "Offers.Listings.DeliveryInfo",
      "CustomerReviews.StarRating",
      "CustomerReviews.Count",
      "Images.Primary.Large",
    ],
    ...(params.minPrice !== undefined || params.maxPrice !== undefined
      ? {
          MinPrice: params.minPrice !== undefined ? Math.round(params.minPrice * 100) : undefined,
          MaxPrice: params.maxPrice !== undefined ? Math.round(params.maxPrice * 100) : undefined,
        }
      : {}),
  });

  const auth = signPaApiRequest(creds, "POST", path, payload, amzDate, dateStamp);

  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Encoding": "amz-1.0",
      "X-Amz-Date": amzDate,
      "X-Amz-Target":
        "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems",
      Authorization: auth,
    },
    body: payload,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PA-API 请求失败 (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if ((data as { Errors?: unknown[] })?.Errors?.length) {
    throw new Error(
      `PA-API 错误: ${JSON.stringify((data as { Errors: unknown[] }).Errors).slice(0, 300)}`
    );
  }
  return parseSearchItemsResponse(data);
}

/**
 * Amazon 选品评分（0-100）。
 * 权重：评分 25% + 评论数 20% + 价格适中 20% + Prime 15% + 有现货 20%
 */
export function scoreAmazonProduct(p: AmazonProduct): number {
  let score = 0;
  // 评分 (0-25)
  if (p.rating !== null) {
    score += Math.min(25, Math.max(0, (p.rating - 3.5) * 25));
  }
  // 评论数 (0-20): 1000+ 满分，对数衰减
  if (p.reviewCount !== null && p.reviewCount > 0) {
    score += Math.min(20, Math.log10(p.reviewCount + 1) * 6.67);
  }
  // 价格 (0-20): $50-$200 最佳（佣金绝对值高且转化不太难）
  if (p.price !== null && p.price > 0) {
    if (p.price >= 50 && p.price <= 200) score += 20;
    else if (p.price >= 20 && p.price < 50) score += 14;
    else if (p.price > 200 && p.price <= 500) score += 12;
    else score += 6;
  }
  // Prime (0-15)
  if (p.isPrime) score += 15;
  // 有现货 (0-20)
  if (p.availability && /in stock/i.test(p.availability)) score += 20;
  return Math.round(Math.min(100, score));
}

/** NetworkAdapter 实现（用于统一的网络拉取框架） */
export class AmazonAdapter implements NetworkAdapter {
  readonly kind = "amazon";
  readonly displayName = "Amazon";
  readonly defaultBaseUrl = "https://api.amazon.com";

  async pullOffers(ctx: AdapterContext): Promise<NetworkOffer[]> {
    // Amazon 走选品流程而非全量拉取，这里返回空，实际用 searchAmazonProducts
    void ctx;
    return [];
  }
}
