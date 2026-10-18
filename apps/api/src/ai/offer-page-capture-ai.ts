/**
 * 抓取页面 AI 提取 offer 佣金 / 预估 payout：联盟网络 offer 详情页
 * （如 Commission: 13% / Est. Payout: $23.4）插件抓取后，AI 识别佣金与
 * 预估 payout 自动填入 Offer 表单，用户检查后保存。
 *
 * 绝不编造：prompt 要求页面没有的字段填 null；normalize 再做一次校验。
 * 关键区分：百分比是佣金（commission），美元金额是预估 payout（estimatedPayout），
 * 两者绝不混淆；没有美元 payout 数字时 estimatedPayout 填 null，不许用
 * 佣金率 × 价格自行算出一个“预估”来冒充页面数字。
 */
import { chatJson } from "./llm.js";

export interface OfferPageCapture {
  offerName: string | null;
  network: string | null;
  commissionValue: number | null;
  commissionType: "percentage" | "fixed" | null;
  estimatedPayout: number | null;
  averageOrderValue: number | null;
  currency: string | null;
  cookieDays: number | null;
  /** 30 天 EPC（美元/点击，网络后台口径）。 */
  epc: number | null;
  /** 转化率（%，网络后台口径）。 */
  conversionRate: number | null;
  /** 品类（如 Arts, Crafts & Sewing）。 */
  category: string | null;
  /** 支持地区（如 ["US","DE","CA"]）。 */
  regions: string[] | null;
  /** 验收率（%，如 100）。 */
  acceptanceRate: number | null;
  /** 每项的页面原文证据（用户核对用）。 */
  evidence: { commission: string | null; payout: string | null; price: string | null };
}

export type AnalysisLanguage = "zh" | "en";

export function buildOfferPageExtractPrompt(
  pageText: string,
  language: AnalysisLanguage
): { system: string; user: string } {
  const text = (pageText ?? "").slice(0, 10000);
  if (language === "en") {
    return {
      system:
        "You are an affiliate-offer-info extraction expert. Return JSON only. Never invent: any field not present in the page text must be null.",
      user: `A browser extension captured the text of an affiliate network offer details page. Extract the offer's commission and payout info.\n\nTasks:\n1. offerName: the offer / program name.\n2. network: the affiliate network name when explicitly shown.\n3. commission: the commission for this offer. \"Commission: 13%\" -> {\"value\":13,\"type\":\"percentage\"}. \"Commission: $25\" / \"$25 per sale\" -> {\"value\":25,\"type\":\"fixed\"}. If the page shows BOTH a % and a $ figure (e.g. Commission 13% + Est. Payout $23.4), the % is the commission and the $ is the estimated payout below, NOT the commission.\n4. estimatedPayout: the estimated earnings per conversion, only if a $ payout figure is shown (\"Est. Payout\", \"Estimated Payout\", \"Payout\", \"EPC\"). If the page shows only a % commission and no $ payout figure, this is null. Never compute it from rate x price.\n5. averageOrderValue: average order value / AOV / average sale / product price when shown (number only). This is the product's price, NOT the payout.\n6. currency: USD / EUR / etc. when shown.\n7. cookieDays: cookie duration in days (\"Cookie: 30 days\" -> 30), null when not shown.\n8. evidence: the exact short source snippet for commission, payout, price (copy from the page, at most 120 chars each), null when the field is null.\n9. Return JSON only: {\"offerName\":\"...\",\"network\":\"...\",\"commission\":{\"value\":13,\"type\":\"percentage\"},\"estimatedPayout\":23.4,\"averageOrderValue\":180,\"currency\":\"USD\",\"cookieDays\":30,\"evidence\":{\"commission\":\"Commission: 13%\",\"payout\":\"Est. Payout: $23.4\",\"price\":\"Average order value: $180\"}}\n\nStrict rules:\n- Everything must come from the page text. Never invent, estimate, or fill in. Missing field -> null.\n- NEVER confuse the payout $ amount with the commission %: they are different fields.\n- Do NOT treat navigation, ads, related offers, or other offers' rows as this offer.\n- If the page is not an affiliate offer page, return all nulls.\n\nCaptured page text:\n---\n${text}\n---`,
    };
  }
  return {
    system:
      "你是一个联盟 offer 信息提取专家。只返回 JSON。绝不编造：页面里没有的字段填 null。",
    user: `浏览器插件抓下了一个联盟网络 offer 详情页的正文。提取该 offer 的佣金与预估 payout 信息。\n\n任务：\n1. offerName：offer / 项目名称。\n2. network：页面明确给出的联盟网络名。\n3. commission：该 offer 的佣金。“Commission: 13%”→ {\"value\":13,\"type\":\"percentage\"}；“Commission: $25”/“每单 $25”→ {\"value\":25,\"type\":\"fixed\"}。如果页面同时有 % 和 $ 两个数（如 Commission 13% + Est. Payout $23.4），% 是佣金，$ 是下面的预估 payout，绝不是佣金。\n4. estimatedPayout：每次转化的预估收益，只有页面明确给出了 $ payout 数字时才填（“Est. Payout”/“预估 payout”/“Payout”/“EPC”）。如果页面只有 % 佣金、没有 $ payout 数字，填 null。不许用佣金率 × 价格自己算一个“预估”来冒充页面数字。\n5. averageOrderValue：平均订单金额 / AOV / 平均客单价 / 产品售价（只写数字）。这是产品的价格，不是 payout。\n6. currency：页面给出的货币（USD / EUR 等）。\n7. cookieDays：Cookie 有效期天数（“Cookie: 30 天”→ 30），没给填 null。\n8. evidence：佣金 / payout / 价格三项的页面原文证据（照抄页面短句，每条最多 120 字），对应字段为 null 时填 null。\n9. 只返回 JSON：{\"offerName\":\"...\",\"network\":\"...\",\"commission\":{\"value\":13,\"type\":\"percentage\"},\"estimatedPayout\":23.4,\"averageOrderValue\":180,\"currency\":\"USD\",\"cookieDays\":30,\"evidence\":{\"commission\":\"Commission: 13%\",\"payout\":\"Est. Payout: $23.4\",\"price\":\"Average order value: $180\"}}\n\n严格规则：\n- 所有内容必须来自页面原文，不许编造、估算、补全。缺失字段填 null。\n- 绝不把 payout 的 $ 金额当成佣金 %：两者是不同字段。\n- 不要把导航、广告、相关 offer、其他 offer 的行当成这个 offer。\n- 页面不是联盟 offer 页就全部填 null。\n\n抓取到的页面正文：\n---\n${text}\n---`,
  };
}

const emptyEvidence = { commission: null, payout: null, price: null };

/** 校验 + 清洗 AI 返回的 offer 信息（防 AI 编造/格式跑偏/混淆佣金与 payout）。 */
export function normalizeOfferPage(raw: unknown): OfferPageCapture {
  const empty: OfferPageCapture = {
    offerName: null,
    network: null,
    commissionValue: null,
    commissionType: null,
    estimatedPayout: null,
    averageOrderValue: null,
    currency: null,
    cookieDays: null,
    epc: null,
    conversionRate: null,
    category: null,
    regions: null,
    acceptanceRate: null,
    evidence: { ...emptyEvidence },
  };
  if (!raw || typeof raw !== "object") return empty;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t ? t.slice(0, max) : null;
  };
  const num = (v: unknown): number | null => {
    const n =
      typeof v === "number"
        ? v
        : typeof v === "string"
          ? Number(v.replace(/[^0-9.]/g, ""))
          : NaN;
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  let commissionValue: number | null = null;
  let commissionType: "percentage" | "fixed" | null = null;
  const commission = r.commission;
  if (commission && typeof commission === "object") {
    const c = commission as Record<string, unknown>;
    const t = c.type === "percentage" || c.type === "fixed" ? c.type : null;
    const v = num(c.value);
    if (t && v != null) {
      // 百分比佣金超过 100% 几乎一定是把 payout 金额误认成 %，丢弃。
      if (t === "percentage" && v > 100) {
        commissionValue = null;
        commissionType = null;
      } else {
        commissionValue = v;
        commissionType = t;
      }
    }
  }
  const cookie = num(r.cookieDays);
  const evidenceRaw =
    r.evidence && typeof r.evidence === "object"
      ? (r.evidence as Record<string, unknown>)
      : {};
  const regionsRaw = Array.isArray(r.regions)
    ? r.regions
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim().toUpperCase())
        .slice(0, 20)
    : null;
  return {
    offerName: str(r.offerName, 300),
    network: str(r.network, 100),
    commissionValue,
    commissionType,
    estimatedPayout: num(r.estimatedPayout),
    averageOrderValue: num(r.averageOrderValue),
    currency: str(r.currency, 10),
    cookieDays: cookie != null ? Math.round(cookie) : null,
    epc: num(r.epc),
    conversionRate: num(r.conversionRate),
    category: str(r.category, 200),
    regions: regionsRaw && regionsRaw.length > 0 ? regionsRaw : null,
    acceptanceRate: num(r.acceptanceRate),
    evidence: {
      commission: str(evidenceRaw.commission, 120),
      payout: str(evidenceRaw.payout, 120),
      price: str(evidenceRaw.price, 120),
    },
  };
}

/** 把提取结果格式化成一行摘要（填表前给用户核对）。 */
export function buildOfferPageSummaryText(p: OfferPageCapture, language: AnalysisLanguage): string {
  const parts: string[] = [];
  if (language === "en") {
    if (p.commissionValue != null && p.commissionType) {
      parts.push(
        p.commissionType === "percentage"
          ? `Commission: ${p.commissionValue}%`
          : `Commission: ${p.currency ?? ""} ${p.commissionValue}`.trim()
      );
    }
    if (p.estimatedPayout != null) parts.push(`Est. Payout: ${p.currency ?? ""} ${p.estimatedPayout}`.trim());
    if (p.averageOrderValue != null) parts.push(`Avg order value: ${p.currency ?? ""} ${p.averageOrderValue}`.trim());
    if (p.cookieDays != null) parts.push(`Cookie: ${p.cookieDays} days`);
    if (p.epc != null) parts.push(`EPC: $${p.epc}`);
    if (p.conversionRate != null) parts.push(`CVR: ${p.conversionRate}%`);
    if (p.network) parts.push(`Network: ${p.network}`);
  } else {
    if (p.commissionValue != null && p.commissionType) {
      parts.push(
        p.commissionType === "percentage"
          ? `佣金：${p.commissionValue}%（按比例）`
          : `佣金：${p.currency ?? ""}${p.commissionValue}（固定）`
      );
    }
    if (p.estimatedPayout != null) parts.push(`预估 payout：${p.currency ?? ""}${p.estimatedPayout}`);
    if (p.averageOrderValue != null) parts.push(`均价：${p.currency ?? ""}${p.averageOrderValue}`);
    if (p.cookieDays != null) parts.push(`Cookie：${p.cookieDays} 天`);
    if (p.epc != null) parts.push(`EPC：$${p.epc}`);
    if (p.conversionRate != null) parts.push(`转化率：${p.conversionRate}%`);
    if (p.network) parts.push(`网络：${p.network}`);
  }
  return parts.join(" · ");
}

export async function extractOfferPageWithAi(
  deps: {
    baseUrl: string;
    model: string;
    apiKey: string;
    language?: AnalysisLanguage;
    chatJsonImpl?: typeof chatJson;
  },
  pageText: string
): Promise<{ offer: OfferPageCapture; summaryText: string }> {
  const language = deps.language ?? "zh";
  const { system, user } = buildOfferPageExtractPrompt(pageText, language);
  const run = deps.chatJsonImpl ?? chatJson;
  const parsed = await run({
    baseUrl: deps.baseUrl,
    model: deps.model,
    apiKey: deps.apiKey,
    system,
    user,
  });
  const offer = normalizeOfferPage(parsed);
  return { offer, summaryText: buildOfferPageSummaryText(offer, language) };
}
