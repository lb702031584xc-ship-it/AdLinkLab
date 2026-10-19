/**
 * PartnerBoost — 登录态(session)商品库适配器（第二条线路；官方 API 线路见 partnerboost-adapter.ts）。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ToS 风险提示：使用登录态（Cookie）自动采集商品数据，可能违反 PartnerBoost
 * 服务条款中关于自动化访问的条款，存在账号被警告、限流或封禁的风险。请仅
 * 采集您自己账号可见的商品数据，不要高频抓取。如官方 API 可用请优先切换
 * 为官方 API 模式。继续即代表您已了解并自行承担该风险。
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 现实约束（未验证声明）：
 * - session 商品列表路径默认为 "/api/products"，仅为占位模板（TODO）：
 *   以用户 PartnerBoost 后台实际商品列表接口为准，用户可在网络设置里覆盖
 *   apiBaseUrl + sessionListPath。字段映射复用官方 datafeed 的已知字段名
 *   （product_id/product_name/asin/commission/brand_name…）做防御式映射；
 *   结构对不上时抛 SESSION_TEMPLATE_UNVERIFIED 明错，统一降级（FAILED + 审计）。
 */
import {
  pickField,
  sessionAsNumber,
  sessionAsString,
  TemplateSessionAdapter,
  type SessionListTemplate,
  type SessionProduct,
} from "./session-adapter.js";
import { PARTNERBOOST_DEFAULT_BASE_URL, deriveLandingPageType } from "./partnerboost-adapter.js";

/**
 * TODO(需真实账号验证)：默认商品列表路径为占位模板。
 * PartnerBoost publisher 后台的 session 商品列表接口尚未确认；
 * 请用真实账号登录后台 → F12 Network 找到商品列表请求后覆盖 sessionListPath。
 */
export const PARTNERBOOST_DEFAULT_SESSION_LIST_PATH = "/api/products";

function parseCommissionToParts(raw: unknown): {
  amount: number | null;
  rate: number | null;
} {
  if (raw == null) return { amount: null, rate: null };
  const s = String(raw).trim();
  const pct = s.match(/([\d.]+)\s*%/);
  if (pct) {
    const n = parseFloat(pct[1]);
    return { amount: null, rate: Number.isFinite(n) ? n : null };
  }
  const n = parseFloat(s.replace(/[$,\s]/g, ""));
  return { amount: Number.isFinite(n) ? n : null, rate: null };
}

export class PartnerBoostSessionAdapter extends TemplateSessionAdapter {
  readonly sessionKind = "partnerboost";
  readonly sessionDisplayName = "PartnerBoost";
  readonly defaultSessionBaseUrl = PARTNERBOOST_DEFAULT_BASE_URL;

  protected readonly defaultSessionListPath =
    PARTNERBOOST_DEFAULT_SESSION_LIST_PATH;
  protected readonly listTemplate: SessionListTemplate = {
    verified: false,
    jsonListPaths: ["data.list", "data.items", "data.products", "list", "items"],
    jsonHasMorePaths: ["data.has_more", "data.hasMore", "has_more", "hasMore"],
    description:
      "PartnerBoost 后台商品列表接口（未验证）：字段映射复用官方 datafeed 已知字段名 " +
      "（product_id/product_name/asin/commission/brand_name/discount_price…）防御式映射。",
  };

  protected mapSessionItem(item: Record<string, unknown>): SessionProduct {
    const { amount, rate } = parseCommissionToParts(
      pickField(item, "commission", "commission_rate", "commissionRate")
    );
    const promoUrl =
      sessionAsString(
        pickField(
          item,
          "partnerboost_link",
          "partnerboostLink",
          "promo_url",
          "promoUrl",
          "link",
          "url"
        )
      ) ?? null;
    return {
      externalId:
        sessionAsString(pickField(item, "product_id", "productId", "id", "asin")) ??
        "",
      name:
        sessionAsString(pickField(item, "product_name", "productName", "name", "title")) ??
        "Unknown product",
      payout: amount ?? rate,
      currency: sessionAsString(pickField(item, "currency")) ?? "USD",
      termsText:
        sessionAsString(pickField(item, "category", "discount", "coupon")) ?? null,
      url: promoUrl,
      countryCode:
        sessionAsString(
          pickField(item, "country_code", "countryCode", "country")
        ) ?? null,
      landingPageType: deriveLandingPageType(promoUrl),
      brand: sessionAsString(pickField(item, "brand_name", "brandName", "brand")),
      asin: sessionAsString(pickField(item, "asin")),
      price: sessionAsNumber(
        pickField(item, "discount_price", "discountPrice", "price", "original_price")
      ),
      commissionAmount: amount,
      commissionRate: rate,
      reviewCount: sessionAsNumber(
        pickField(item, "reviews", "review_count", "reviewCount")
      ),
      promoUrl,
      rawData: item,
    };
  }
}
