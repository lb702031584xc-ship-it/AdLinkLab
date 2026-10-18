/**
* Impact — 登录态(session)商品库适配器。
*
* ═══════════════════════════════════════════════════════════════════════
* ToS 风险提示（中）：使用登录态（Cookie）自动采集商品数据，可能违反 Impact
* 服务条款中关于自动化访问的条款，存在账号被警告、限流或封禁的风险。请仅
* 采集您自己账号可见的商品数据，不要高频抓取。如官方 API 可用请优先切换
* 为官方 API 模式。继续即代表您已了解并自行承担该风险。
* ═══════════════════════════════════════════════════════════════════════
*
* 现实约束（未验证声明）：
* - 我们没有 Impact publisher 后台的真实页面结构可验证（没登录过）。
* - defaultSessionBaseUrl https://app.impact.com 为公开的 publisher 门户常识，未验证。
* - defaultSessionListPath "/api/products" 为占位模板（TODO）：请用真实账号
* 登录后台 → F12 Network 找到商品/Campaigns 列表请求后，覆盖 sessionListPath
* 并微调下方字段映射。结构对不上时抛 SESSION_TEMPLATE_UNVERIFIED 明错，
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

/** TODO(需真实账号验证)：publisher 门户域名为公开常识，未验证。 */
export const IMPACT_DEFAULT_SESSION_BASE_URL = "https://app.impact.com";
/** TODO(需真实账号验证)：列表路径为占位模板，以后台实际接口为准。 */
export const IMPACT_DEFAULT_SESSION_LIST_PATH = "/api/products";

export class ImpactSessionAdapter extends TemplateSessionAdapter {
readonly sessionKind = "impact";
readonly sessionDisplayName = "Impact";
readonly defaultSessionBaseUrl = IMPACT_DEFAULT_SESSION_BASE_URL;

protected readonly defaultSessionListPath = IMPACT_DEFAULT_SESSION_LIST_PATH;
protected readonly listTemplate: SessionListTemplate = {
verified: false,
jsonListPaths: ["data.list", "data.items", "data.campaigns", "list", "items"],
jsonHasMorePaths: ["data.has_more", "data.hasMore", "has_more", "hasMore"],
description:
"Impact 后台商品/Campaigns 列表接口（未验证）：期望 JSON 列表；字段名按常见变体防御式映射。",
};

protected mapSessionItem(item: Record<string, unknown>): SessionProduct {
return {
externalId:
sessionAsString(pickField(item, "id", "campaign_id", "campaignId"))?? "",
name:
sessionAsString(pickField(item, "name", "title", "campaign", "advertiser"))??
"Unknown product",
payout: sessionAsNumber(pickField(item, "payout", "commission", "default_payout")),
currency: sessionAsString(pickField(item, "currency"))?? "USD",
termsText: sessionAsString(pickField(item, "terms", "description"))?? null,
url: sessionAsString(pickField(item, "url", "link", "tracking_url"))?? null,
brand: sessionAsString(pickField(item, "brand", "advertiser")),
asin: null,
price: sessionAsNumber(pickField(item, "price")),
commissionAmount: sessionAsNumber(pickField(item, "commission_amount", "payout")),
commissionRate: sessionAsNumber(pickField(item, "commission_rate", "commissionRate")),
reviewCount: null,
promoUrl: sessionAsString(pickField(item, "promo_url", "tracking_url", "url"))?? null,
rawData: item,
};
}
}
