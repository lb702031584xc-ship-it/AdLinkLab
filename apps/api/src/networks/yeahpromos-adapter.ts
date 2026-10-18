/**
 * YeahPromos — 登录态(session)商品库适配器。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ToS 风险提示：使用登录态（Cookie）自动采集商品数据，可能违反 YeahPromos
 * 服务条款中关于自动化访问的条款，存在账号被警告、限流或封禁的风险。请仅
 * 采集您自己账号可见的商品数据，不要高频抓取。如 YeahPromos 日后提供官方
 * 商品 API，请优先切换为官方 API 模式。继续即代表您已了解并自行承担该风险。
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 现实约束（未验证声明）：
 * - YeahPromos 官方商品 API 尚未确认：pullOffers(api 模式) 直接抛 NOT_IMPLEMENTED，
 *   不硬编码猜测的端点。
 * - session 商品列表路径默认为 "/api/products"，仅为占位模板（TODO）：
 *   以用户 YeahPromos 后台实际商品列表接口为准，用户可在网络设置里覆盖
 *   apiBaseUrl + sessionListPath。解析为防御式（JSON data.list/data.items…
 *   候选路径 + HTML 表格最小回退）；结构对不上时抛 SESSION_TEMPLATE_UNVERIFIED
 *   明错，由同步服务统一降级（FAILED + 审计），不死循环、不伪造数据。
 */
import { NetworkAdapterError } from "./partnerboost-adapter.js";
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

export class YeahPromosAdapter
  extends TemplateSessionAdapter
  implements NetworkAdapter
{
  readonly kind = "yeahpromos";
  readonly displayName = "YeahPromos";
  /** 官方 API base（尚未确认有商品接口；session 模式不用它）。 */
  readonly defaultBaseUrl = YP_DEFAULT_SESSION_BASE_URL;
  readonly supportsModes: readonly SyncMode[] = ["session"] as const;

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

  /** api 模式：官方商品 API 尚未确认，不硬编码猜测的端点，直接明错。 */
  async pullOffers(_ctx: AdapterContext): Promise<NetworkOffer[]> {
    void _ctx;
    throw new NetworkAdapterError(
      "NOT_IMPLEMENTED",
      "YeahPromos 官方商品 API 尚未确认，当前仅支持登录态(session)模式"
    );
  }
}
