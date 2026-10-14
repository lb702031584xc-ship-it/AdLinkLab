/**
 * 电商页面抓取解析：把插件抓到的 Amazon / Keepa / Google Shopping
 * 页面正文解析成产品数据（价格/评分/评价数/BSR）。
 *
 * 纯启发式，找不到为 null，绝不编造。
 * 抓到的页面是用户浏览器里已登录/已渲染的页面（联盟后台、Amazon 详情页），
 * 服务器抓不到，所以走插件抓取。
 */
export interface EcommerceData {
  /** 产品价格（美元）。 */
  price: number | null;
  /** 评分 0-5。 */
  rating: number | null;
  /** 评价数。 */
  reviewCount: number | null;
  /** Best Sellers Rank 数字。 */
  bsr: number | null;
  /** BSR 类目，如 Beds。 */
  bsrCategory: string | null;
}

const EMPTY: EcommerceData = {
  price: null,
  rating: null,
  reviewCount: null,
  bsr: null,
  bsrCategory: null,
};

function num(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseEcommerceCapture(text: string): EcommerceData {
  const t = ` ${text ?? ""} `;
  const out: EcommerceData = { ...EMPTY };

  // 评分：4.5 out of 5 stars / 4.5 / 5
  let m = t.match(/(\d\.\d)\s*out of 5 stars/i) ?? t.match(/(\d\.\d)\s*\/\s*5\b/);
  if (m) {
    const r = Number(m[1]);
    if (Number.isFinite(r) && r >= 0 && r <= 5) out.rating = r;
  }

  // 评价数：1,234 ratings / 1,234 global ratings / 1,234 个评价
  m = t.match(/([\d,]+)\s*(?:global\s+)?ratings/i) ?? t.match(/([\d,]+)\s*个评价/);
  if (m) out.reviewCount = num(m[1]!);

  // 价格：优先 Price/价格 上下文，其次第一个 $ 金额
  m =
    t.match(/(?:price|价格|售价)[^$￥\d]{0,30}[$￥]?\s*([\d,]+\.?\d*)/i) ??
    t.match(/\$([\d,]+\.\d{2})/);
  if (m) {
    const p = num(m[1]!);
    if (p != null && p <= 100000) out.price = p;
  }

  // BSR：Best Sellers Rank #1,234 in Beds
  m =
    t.match(/Best Sellers Rank[^#\d]{0,30}#([\d,]+)\s+in\s+([^\n()]{1,60})/i) ??
    t.match(/#([\d,]+)\s+in\s+([A-Za-z][A-Za-z &'’-]{1,40})/);
  if (m) {
    out.bsr = num(m[1]!);
    const cat = (m[2] ?? "").trim().replace(/\s+/g, " ");
    out.bsrCategory = cat || null;
  }

  return out;
}
