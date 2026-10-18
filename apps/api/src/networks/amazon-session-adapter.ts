/**
* Amazon Associates — 登录态(session)商品库适配器。
*
* ═══════════════════════════════════════════════════════════════════════
* ⚠️ ToS 风险提示（极高，红字警告）：
* Amazon Associates Operating Agreement 明确禁止自动化抓取/采集行为。
* 使用登录态（Cookie）自动采集 Amazon 商品数据，违反 Operating Agreement
* 中关于自动化访问的条款，账号被警告、限流或封禁的风险极高，且可能影响
* 佣金结算。强烈建议仅使用官方 Product Advertising API（PA-API）获取商品数据，
* 不要启用本 session 模式。如您坚持启用，即代表您已了解并自行承担全部风险。
* ═══════════════════════════════════════════════════════════════════════
*
* 现实约束（未验证声明）：
* - 我们没有 Amazon Associates 后台的真实页面结构可验证（没登录过）。
* - defaultSessionBaseUrl https://affiliate-program.amazon.com 为公开的 Associates
* Central 门户常识，未验证。
* - defaultSessionListPath "/api/products" 为占位模板（TODO）：Associates 后台
* 并无公开的商品列表 JSON 接口是已知事实，该路径几乎必然不对；请勿在未
* 理解上述红字风险前启用。结构对不上时抛 SESSION_TEMPLATE_UNVERIFIED 明错，
* 由同步服务统一降级（FAILED + 审计），不死循环、不伪造数据。
*/
import {
pickField,
sessionAsNumber,
sessionAsString,
TemplateSessionAdapter,
type SessionListTemplate,
type SessionProduct,
} from "./session-adapter.js";

/** TODO(需真实账号验证)：Associates Central 门户域名为公开常识，未验证。 */
export const AMAZON_DEFAULT_SESSION_BASE_URL = "https://affiliate-program.amazon.com";
/**
* TODO(需真实账号验证)：列表路径为占位模板——Associates 后台并无公开商品列表
* JSON 接口是已知事实，该模板仅为满足基类结构而存在，实际不可用。
*/
export const AMAZON_DEFAULT_SESSION_LIST_PATH = "/api/products";

export class AmazonSessionAdapter extends TemplateSessionAdapter {
readonly sessionKind = "amazon";
readonly sessionDisplayName = "Amazon";
readonly defaultSessionBaseUrl = AMAZON_DEFAULT_SESSION_BASE_URL;

protected readonly defaultSessionListPath = AMAZON_DEFAULT_SESSION_LIST_PATH;
protected readonly listTemplate: SessionListTemplate = {
verified: false,
jsonListPaths: ["data.list", "data.items", "list", "items"],
jsonHasMorePaths: ["data.has_more", "data.hasMore", "has_more", "hasMore"],
description:
"Amazon Associates 后台商品列表接口（未验证，且已知无公开 JSON 接口）：占位模板，实际不可用。",
};

protected mapSessionItem(item: Record<string, unknown>): SessionProduct {
return {
externalId: sessionAsString(pickField(item, "asin", "id"))?? "",
name: sessionAsString(pickField(item, "title", "name"))?? "Unknown product",
payout: sessionAsNumber(pickField(item, "commission", "payout")),
currency: sessionAsString(pickField(item, "currency"))?? "USD",
termsText: null,
url: sessionAsString(pickField(item, "url", "link"))?? null,
brand: sessionAsString(pickField(item, "brand")),
asin: sessionAsString(pickField(item, "asin")),
price: sessionAsNumber(pickField(item, "price")),
commissionAmount: sessionAsNumber(pickField(item, "commission_amount")),
commissionRate: sessionAsNumber(pickField(item, "commission_rate", "commissionRate")),
reviewCount: sessionAsNumber(pickField(item, "review_count", "reviews")),
promoUrl: sessionAsString(pickField(item, "promo_url", "url"))?? null,
rawData: item,
};
}
}
