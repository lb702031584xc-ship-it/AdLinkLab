/**
 * 广告投放数量（对标 AutoAds）：按品牌+国家查 Google SERP 付费广告数。
 *
 * - 数据源：DataForSEO SERP `google/organic/live/advanced`（凭证复用流量信号
 *   凭证：AiSetting `traffic.dataforseoLogin` / `traffic.dataforseoPassword`，
 *   加密存储）。凭证缺失 → 抛错（明确提示未配置），不静默返回假数据。
 * - 口径：keyword = 品牌名，广告数 = 文字广告＋购物广告（tallySerpAds）：
 *   SERP items 里 type === "paid" 的条数 + type === "shopping" 块内
 *   shopping_element 的条数（购物广告是独立 item type，只数 paid 会漏掉
 *   卖货品牌的主力形态）。广告落地页域名含品牌名 → 自投（self）；其余 →
 *   他投（others）——self/others 与 home/product 拆分只看 paid 条目 URL
 *   （v1 口径，不扩展到购物条目）。
 *   另按落地页 URL 分类累计 adCountHome（落首页/旗舰店）/ adCountProduct
 *   （落商品页），other 不计入——用来看同行在用哪种打法投这个品牌。
 *   落地页是 Amazon 的商品分不清自投/他投（谁投落地页都是 amazon.com），
 *   只记 total，self/others 记 null。
 * - 多探针（2026-10-21）：裸品牌词之外再派生长尾探针（品牌+型号/品类词，
 *   deriveLongtailProbes），各探针广告数（同一文字＋购物口径）的 MAX 写
 *   adCountLongtail——联盟客投的是长尾型号词，裸词 0 ≠ 没人投；「在投」
 *   判定 = adCount ≥ 1 || adCountLongtail ≥ 1。组内 Top5 商品名命中武器
 *   配件类模式 → adPolicyRisk=true（该类目付费广告禁投，0 是政策墙不是空白）。
 * - 探针深度 12 + 明细（2026-10-21 二批）：每组 SERP 查询 ≤ 12 次（裸词 1
 *   + 长尾 ≤ 11，deriveLongtailProbes v2：型号粘连/带空格双形态都查、
 *   纯数字型号紧跟品牌也算）；每次计算实际跑的每条探针逐条明细
 *   （{q, kind, paid, shopping, total}）写 adProbeDetail，供前端逐条
 *   验真——双 0 时先看探针词对不对，再下"没人投"的结论。
 * - 缓存：同一（品牌，国家）组内任一商品 14 天内查过 → 整组跳过，不重复花钱。
 *   例外：组 adCountLongtail 为 null 且能派生长尾探针 = 多探针上线前的
 *   旧印记，视为过期，下一次计算必须重探（派生不出探针的组 null 是
 *   终局值，不反复重查）；adProbeDetail 为 null 同理视为旧印记待重探
 *   （明细上线前的组都没有 detail，一律按新口径重探一次）。
 *   deps.force=true 可显式绕过（仅人工入口，提交前有预估确认）；
 *   deps.aliveOnly=true 时整组判死的组（初筛 kill 或已下线）整组跳过，
 *   单独计入 skippedDeadGroups。两项默认关，既有调用方行为不变。
 * - 历史快照：重算写入新值前，把组内旧 adCount/adCountCheckedAt 挪到
 *   lastAdCount/lastAdCountCheckedAt，趋势（deriveAdTrend）由新旧两值现算。
 * - 单组 SERP 失败不中断整批：跳过该组并把原因记入返回值 errors。
 * - 深度可选 + 费用预估（2026-10-21 三批）：每组查询深度按次可选
 *   4 / 8 / 12（calcBrandAdCounts deps.depth，默认 12 = 历史行为；
 *   one-click-screen / offer-prescreen 内部调用不传 → 默认 12）。
 *   preview 用本地派生（零 API）预估实际查询数 expectedQueries，
 *   并按 SERP_QUERY_PRICE_USD 估算费用——确认框签的是看得见的钱，
 *   不是盲签的最坏值。
 * - 透明中心旁证 TC（2026-10-21 四批）：SERP 快照只能证"有"不能证
 *   "无"（实证：SERP 对 olight 反复抓 0，Google 广告透明中心有 11 家
 *   广告主）。故仅当一组 SERP 裸词+长尾双 0（都已知）时，才补查
 *   DataForSEO Ads Advertisers（透明中心数据源，fetchTcAdvertisers）
 *   做旁证：TC ≥ 1 = 实际有人在投（tcRescued）；TC = 0 才与 SERP
 *   合并判"无人投放"；TC 未知（未查/失败）绝不当 0。省钱口径：
 *   SERP 已 >0 的组 presence 已证，不查 TC；TC 有自己的 14 天新鲜度
 *   （tcCheckedAt），SERP 侧新鲜但 TC 过期且存量双 0 时可单独补查
 *   TC 一腿（不重跑 SERP）。TC 查询失败不抛错、不拖垮整轮 calc，
 *   计入 tcFailed 并记 errors，下次计算自动重试。
 */
import type { PrismaClient } from "@adlinklab/database";
import {
  DATAFORSEO_LOGIN_SETTING,
  DATAFORSEO_PASSWORD_SETTING,
} from "../traffic/dataforseo.js";
import { readEncryptedTrafficSetting } from "../traffic/settings.js";

export const AD_COUNT_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const SERP_API_URL =
  "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";

/**
 * 单次 SERP 查询的估算单价（美元）——费用预估的唯一出处，全站不得
 * 另编第二个数。口径：端点 serp/google/organic/live/advanced
 * （Live、depth=100）。仓内研究报告（2026-10-20，
 * research_notes/dataforseo-data-catalog-affiliate-ads-20261020-2054）
 * 未针对该端点确证单价，仅记录通用 SERP Live 参考价 $0.002/次。
 * 故此值是**估算单价，待 DataForSEO 实际账单校准**；确认框文案亦
 * 按估算口径标注，不当作精确账单。
 */
export const SERP_QUERY_PRICE_USD = 0.002;

const TC_TASK_POST_URL =
  "https://api.dataforseo.com/v3/serp/google/ads_advertisers/task_post";
const TC_TASK_GET_BASE =
  "https://api.dataforseo.com/v3/serp/google/ads_advertisers/task_get/advanced";

/**
 * 透明中心旁证（Ads Advertisers）单次查询单价（美元）：2026-10-21
 * 实测 cost $0.0006/次（task_post 一次的价格，轮询 task_get 不另计）。
 * 与 SERP_QUERY_PRICE_USD 分开：两种查询计价口径不同，记账与预估
 * 都按各自单价走，不混淆。
 */
export const TC_QUERY_PRICE_USD = 0.0006;

/** TC 轮询默认间隔（15s，规格 10–20s）与最大轮询次数（13 次 ≈ 上限约 3 分钟）。 */
export const TC_POLL_INTERVAL_MS = 15000;
export const TC_POLL_MAX_ATTEMPTS = 13;

/** 国家 → DataForSEO location_code。未知国家默认美国。 */
const LOCATION_CODES: Record<string, number> = {
  US: 2840,
  UK: 2826,
  GB: 2826,
  DE: 2276,
  CA: 2124,
  FR: 2250,
  ES: 2724,
  IT: 2380,
  NL: 2528,
  MX: 2484,
  AU: 2036,
};

/** 国家 → 搜索语言（仅非英语国家覆盖，其余 en）。 */
const LANGUAGE_CODES: Record<string, string> = {
  DE: "de",
  FR: "fr",
  ES: "es",
  IT: "it",
  NL: "nl",
};

export interface AdCountClassification {
  total: number;
  self: number;
  others: number;
}

/** 广告数趋势（本次 adCount vs 上次快照 lastAdCount 现算，不落库）。 */
export type AdTrend = "first" | "new" | "stopped" | "active" | "none";

/**
 * 由本次广告数与上次快照派生趋势：
 * - adCount 未计算（null）→ null（无从判断）
 * - 没有上次快照（lastAdCount 为 null）→ "first"（首次计算）
 * - 上次 0、本次 >0 → "new"（新投）；上次 >0、本次 0 → "stopped"（疑似停投）
 * - 两次都 >0 → "active"（持续在投）；两次都 0 → "none"（持续无人投）
 */
export function deriveAdTrend(
  adCount: number | null,
  lastAdCount: number | null
): AdTrend | null {
  if (adCount == null) return null;
  if (lastAdCount == null) return "first";
  if (lastAdCount === 0 && adCount > 0) return "new";
  if (lastAdCount > 0 && adCount === 0) return "stopped";
  if (lastAdCount > 0 && adCount > 0) return "active";
  return "none";
}

/** 广告数分档（品牌+国家观测广告数，经验口径；null = 未计算）。 */
export type AdBand = "none" | "small" | "sweet" | "hot" | "redocean";

function adBandOfBare(adCount: number | null): AdBand | null {
  if (adCount == null) return null;
  if (adCount === 0) return "none";
  if (adCount <= 5) return "small";
  if (adCount <= 20) return "sweet";
  if (adCount <= 50) return "hot";
  return "redocean";
}

/**
 * 广告数分档（多探针口径）：在裸品牌词分档之上加一条地板规则——
 * 裸词档位为 none（0）或未算（null），但长尾探针（品牌+型号/品类词）
 * 有广告在投（adCountLongtail ≥ 1）时，按 small 档计：联盟客投的是
 * 长尾型号词，裸词 0 ≠ 没人投。adCountLongtail 不传（undefined）时
 * 行为与旧口径完全一致（保护其他调用方）。
 */
export function adBandOf(
  adCount: number | null,
  adCountLongtail?: number | null
): AdBand | null {
  const bare = adBandOfBare(adCount);
  if (
    adCountLongtail != null &&
    adCountLongtail >= 1 &&
    (bare === null || bare === "none")
  ) {
    return "small";
  }
  return bare;
}

/** 按非字母数字切分 token（统一小写；与站内 keyword-marks 同口径）。 */
function tokensOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * 型号 token：含相邻字母+数字的 token（如 s8、q7、x40、s8pro）。
 * 纯数字（年份/容量）与纯字母都不算——与站内 keyword-marks.hasModelToken
 * 同口径，此处是 api 侧自带实现（两包不互相 import）。
 */
export function modelTokensOf(name: string): string[] {
  const out: string[] = [];
  for (const tk of tokensOf(name ?? "")) {
    if (/[a-z]\d|\d[a-z]/.test(tk) && !out.includes(tk)) out.push(tk);
  }
  return out;
}

/** 从 rawData 提取类目（PB datafeed 的 category 字段）；无/不可用 → null。 */
export function extractProductCategory(rawData: unknown): string | null {
  let raw: unknown = rawData;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object") return null;
  const v = (raw as Record<string, unknown>).category;
  if (typeof v !== "string") return null;
  // 类目可能是路径（"A > B > Flashlights"）：取最后一段。
  const last = v
    .split(/[>/|»]+/)
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .pop();
  if (!last || last.length < 2 || last.length > 40) return null;
  return last;
}

/** 探针派生的商品输入（组内商品的最小形状）。 */
export interface ProbeSourceProduct {
  name: string;
  recommendationScore: number | null;
  reviewCount: number | null;
  category?: string | null;
}

/** 探针排序口径：推荐分降序（null 最后）→ 评论数降序（null 最后）。 */
function sortForProbes(
  products: ProbeSourceProduct[]
): ProbeSourceProduct[] {
  return [...products].sort((a, b) => {
    const sa = a.recommendationScore;
    const sb = b.recommendationScore;
    if (sa === null && sb !== null) return 1;
    if (sa !== null && sb === null) return -1;
    if (sa !== null && sb !== null && sa !== sb) return sb - sa;
    const ra = a.reviewCount ?? -1;
    const rb = b.reviewCount ?? -1;
    return rb - ra;
  });
}

/** 每组 SERP 查询总预算上限（裸品牌词 1 + 长尾探针 ≤ 11）= 默认深度。 */
export const MAX_QUERIES_PER_GROUP = 12;
/** 每组长尾探针上限（总预算减裸品牌词 1 次，随所选深度变化）。 */
export const MAX_LONGTAIL_PROBES = MAX_QUERIES_PER_GROUP - 1;

/** 每组查询深度的可选档位（总查询数，含裸品牌词 1 次）。 */
export const CALC_DEPTH_OPTIONS = [4, 8, 12] as const;
/** 默认深度 = 历史行为（每组最多 12 次）。 */
export const DEFAULT_CALC_DEPTH = 12;

/**
 * 深度归一：未传 → 默认 12；合法档位（4/8/12）→ 原样；其余 → 抛错
 * （路由层另有校验并回 400，此处是服务层防线，防止内部调用方传脏值
 * 静默放大付费查询量）。
 */
export function resolveCalcDepth(depth?: number | null): number {
  if (depth === undefined || depth === null) return DEFAULT_CALC_DEPTH;
  if ((CALC_DEPTH_OPTIONS as readonly number[]).includes(depth)) return depth;
  throw new Error(`depth 非法（每组查询深度仅支持 4/8/12）：${depth}`);
}

/** 长尾探针类型：model = 品牌+型号；category = 品牌+类目。 */
export type LongtailProbeKind = "model" | "category";

/** 一条长尾探针（查询词 + 类型）。 */
export interface LongtailProbe {
  q: string;
  kind: LongtailProbeKind;
}

/** 探针明细一条（adProbeDetail 的元素形状）：一条实际跑过的探针 + 计数。 */
export interface AdProbeDetailEntry {
  q: string;
  kind: "bare" | LongtailProbeKind;
  /** 文字广告（type="paid"）条数。 */
  paid: number;
  /** 购物广告（shopping_element）条数。 */
  shopping: number;
  /** 合计 = paid + shopping（与 adCount / adCountLongtail 同口径）。 */
  total: number;
}

/** 粘连型号 token 的拆分：字母段（≥2）+ 数字段（可带 1 个尾字母），如 baton4 → baton / 4。 */
const GLUED_MODEL_RE = /^([a-z]{2,})(\d+[a-z]?)$/;

/**
 * 单件商品的型号候选（按商品名 token 顺序，纯函数）：
 * - 混合 token（字母+数字相邻，modelTokensOf 口径）：粘连形
 *   （/^[a-z]{2,}\d+[a-z]?$/，如 baton4）额外给一个「字母段 数字段」
 *   的带空格形态 spaced（baton 4）——真人两种都搜，两条都查；
 * - 纯数字型号补充：3–4 位纯数字 token 且紧跟在品牌 token 之后
 *   （如 "Anker 737 PowerBank" 的 737）也算型号（单形态）。
 */
export function modelCandidatesOf(
  name: string,
  brand: string
): Array<{ token: string; spaced: string | null }> {
  const tokens = tokensOf(name ?? "");
  if (tokens.length === 0) return [];
  const mixed = new Set(modelTokensOf(name ?? ""));
  // 品牌 token 在商品名中的结束位置（首个连续出现处）：紧随其后的
  // 纯数字 token 才是"品牌+数字型号"，名中间的数字（年份/容量）不算。
  const brandTokens = tokensOf(brand ?? "");
  let afterBrandIdx = -1;
  if (brandTokens.length > 0) {
    outer: for (let i = 0; i + brandTokens.length <= tokens.length; i++) {
      for (let j = 0; j < brandTokens.length; j++) {
        if (tokens[i + j] !== brandTokens[j]) continue outer;
      }
      afterBrandIdx = i + brandTokens.length;
      break;
    }
  }
  const out: Array<{ token: string; spaced: string | null }> = [];
  tokens.forEach((tk, idx) => {
    if (mixed.has(tk)) {
      const m = GLUED_MODEL_RE.exec(tk);
      out.push({ token: tk, spaced: m ? `${m[1]} ${m[2]}` : null });
    } else if (idx === afterBrandIdx && /^\d{3,4}$/.test(tk)) {
      out.push({ token: tk, spaced: null });
    }
  });
  return out;
}

/**
 * 派生长尾探针 v2（纯函数）：联盟客投的是「品牌+型号」长尾词。
 * - 遍历口径：组内商品按探针排序（推荐分降序 → 评论数降序）逐件抽
 *   型号（modelCandidatesOf），逐个型号入队：先原文形态，粘连型号
 *   再入带空格形态；两种形态各算一条、各占预算。
 * - 去重：同一查询词（小写归一）只入队一次；探针不得等于裸品牌词。
 * - 预算：长尾最多 maxProbes 条（默认 MAX_LONGTAIL_PROBES = 深度 12
 *   的 11；深度可选后由调用方按 depth − 1 传入），满额即停。
 * - 类目回退：型号探针不足 4 条且组有类目（排序后第一件带类目的
 *   商品的类目）时，补 1 条 `{品牌} {类目}`（未被型号探针覆盖时，
 *   同样受预算约束）。
 * 无任何长尾探针可派生 → 空数组（该组 adCountLongtail 恒 null，
 * 是终局不是缺失）。
 */
export function deriveLongtailProbes(
  brand: string,
  products: ProbeSourceProduct[],
  maxProbes: number = MAX_LONGTAIL_PROBES
): LongtailProbe[] {
  const b = (brand ?? "").trim();
  if (!b) return [];
  const sorted = sortForProbes(products);
  const probes: LongtailProbe[] = [];
  const seen = new Set<string>();
  const bareKey = b.toLowerCase();
  const push = (q: string, kind: LongtailProbeKind): boolean => {
    if (probes.length >= maxProbes) return false;
    const key = q.toLowerCase();
    if (key === bareKey || seen.has(key)) return true;
    seen.add(key);
    probes.push({ q, kind });
    return true;
  };
  for (const p of sorted) {
    if (probes.length >= maxProbes) break;
    for (const cand of modelCandidatesOf(p.name ?? "", b)) {
      if (!push(`${b} ${cand.token}`, "model")) break;
      if (cand.spaced && !push(`${b} ${cand.spaced}`, "model")) break;
    }
  }
  if (probes.length < 4) {
    const category =
      sorted.map((p) => p.category?.trim()).find(Boolean) || null;
    if (category) push(`${b} ${category}`, "category");
  }
  return probes;
}

/**
 * 政策风险模式（武器配件类）：商品名（小写）命中任一 → 该类目付费
 * 广告禁投。只收武器灯的确定性表述，不收 "tactical" / "flashlight"
 * 这类普通手电也会用的词（防误伤 EDC 手电）。
 */
export const AD_POLICY_RISK_PATTERNS: readonly string[] = [
  "weapon light",
  "weaponlight",
  "gun light",
  "rifle light",
  "pistol light",
  "weapon-mounted",
  "weapon mounted",
  "枪灯",
  "武器灯",
];

/** 单件商品名是否命中武器配件类政策风险模式（纯函数）。 */
export function hasAdPolicyRisk(name: string): boolean {
  const n = (name ?? "").toLowerCase();
  if (!n) return false;
  return AD_POLICY_RISK_PATTERNS.some((p) => n.includes(p));
}

/** 组级政策风险：Top5（探针排序口径）任一商品命中 → 整组 true。 */
export function groupAdPolicyRisk(products: ProbeSourceProduct[]): boolean {
  return sortForProbes(products)
    .slice(0, 5)
    .some((p) => hasAdPolicyRisk(p.name ?? ""));
}

/** 品牌名归一化：小写 + 只留字母数字（去空格/符号），用于域名包含判断。 */
function normalizeBrand(brand: string): string {
  return brand.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isAmazonDomain(domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, "");
  return d === "amazon" || d.startsWith("amazon.") || d.includes(".amazon.");
}

/**
 * 把文字广告（paid 条目）按落地页域名分类：域名含品牌名 → 自投；其余
 * （含 amazon.*）→ 他投。纯函数，无副作用。注意返回的 total 只含 paid
 * 条数——写回 adCount 的总数（含购物广告）来自 tallySerpAds 的 total。
 */
export function classifyAds(
  brand: string,
  ads: Array<{ domain?: string }>
): AdCountClassification {
  const needle = normalizeBrand(brand);
  let self = 0;
  let others = 0;
  for (const ad of ads) {
    const domain = (ad.domain ?? "").toLowerCase().trim();
    const host = domain.replace(/^www\./, "");
    if (
      needle &&
      host &&
      !isAmazonDomain(host) &&
      host.replace(/[^a-z0-9]/g, "").includes(needle)
    ) {
      self += 1;
    } else {
      others += 1;
    }
  }
  return { total: ads.length, self, others };
}

/** 广告落地页类型：home（首页/旗舰店）| product（商品页）| other（判不了）。 */
export type AdLandingType = "home" | "product" | "other";

/**
 * 按落地页 URL 启发式分类广告落在哪里（纯函数）：
 * - Amazon 站：/dp/、/gp/product/、/product/ → product；
 *   /stores/、/store/、/shop/ 或根路径 → home；其余 other。
 * - 其他站：根路径 → home；/product、/products/、/item、/p/、/dp/ → product；
 *   其余 other。
 * 判不了的一律 other，绝不硬凑（这是看同行打法的参考信号，不是精确归因）。
 */
export function classifyLandingType(rawUrl: string): AdLandingType {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return "other";
  }
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  if (host.includes("amazon.")) {
    if (
      path.includes("/dp/") ||
      path.includes("/gp/product/") ||
      path.includes("/product/")
    )
      return "product";
    if (
      path.includes("/stores/") ||
      path.includes("/store/") ||
      path.includes("/shop/") ||
      path === "/" ||
      path === ""
    )
      return "home";
    return "other";
  }
  if (path === "/" || path === "") return "home";
  if (
    path.includes("/product") ||
    path.includes("/products/") ||
    path.includes("/item") ||
    path.includes("/p/") ||
    path.includes("/dp/")
  )
    return "product";
  return "other";
}

/** 一组广告 URL 的落地类型计数（other 不计入 home/product 两数）。 */
export function countLandingTypes(urls: Array<string | undefined>): {
  home: number;
  product: number;
} {
  let home = 0;
  let product = 0;
  for (const u of urls) {
    const t = classifyLandingType(u ?? "");
    if (t === "home") home += 1;
    else if (t === "product") product += 1;
  }
  return { home, product };
}

export interface BrandAdCountResult {
  groupsQueried: number;
  groupsSkippedCache: number;
  /**
   * aliveOnly 模式下整组判死而跳过的组数（与缓存跳过分开计数，避免混淆）。
   * 可选字段：one-click-screen / offer-prescreen 的注入 fake 不带此字段，
   * 真实实现恒写入；消费方读取时按 `?? 0` 处理。
   */
  skippedDeadGroups?: number;
  /**
   * 实际完成的 SERP 查询次数（裸品牌词 + 长尾探针，只计成功返回的）。
   * 深度 12 后一组最多 12 次，付费用量记账应以此为准（`?? groupsQueried`
   * 兼容旧 fake）。可选字段同 skippedDeadGroups 的兼容口径。
   */
  serpQueries?: number;
  /** 本次发起 TC（透明中心旁证）查询的组数（每组至多查一次）。 */
  tcChecked?: number;
  /** TC 查询失败/超时的组数（这些组 TC 维持未知，绝不当 0）。 */
  tcFailed?: number;
  /** SERP 双 0 但 TC ≥ 1 的组数（快照未捕获、实际有人投，被旁证翻案）。 */
  tcRescued?: number;
  /**
   * 实际发出的 TC task_post 次数（付费记账口径，单价 TC_QUERY_PRICE_USD；
   * 与 serpQueries 分开记，两个价格不同不得混算）。
   */
  tcQueries?: number;
  productsUpdated: number;
  errors: Array<{ brand: string; countryCode: string | null; message: string }>;
}

export interface BrandAdCountDeps {
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /**
   * 付费数据网关解析出的凭证：传入时优先用它（租户自备 key 路径）；
   * 不传 → 读站级流量信号凭证（平台路径/历史行为）。
   */
  credentials?: { login: string; password: string } | null;
  /**
   * 强制重算：true → 不执行 14 天缓存跳过（新鲜组也重新计费查询）。
   * 默认 false。仅 calc-ad-count 入口的用户显式勾选可传 true；
   * one-click-screen / offer-prescreen 不传，行为不变。
   */
  force?: boolean;
  /**
   * 只算活口径组：true → 整组商品全部判死（screenVerdict="kill" 或
   * status 非 "active"）的组整组跳过（计入 skippedDeadGroups，不花钱）；
   * 组内只要有一件活口径商品 → 照常查，写回仍覆盖组内全部商品。
   * 默认 false。
   */
  aliveOnly?: boolean;
  /**
   * 每组查询深度（总查询数含裸词）：4 / 8 / 12，默认 12（历史行为）。
   * 仅人工 calc 入口按用户所选传入；one-click-screen / offer-prescreen
   * 的内部增量调用不传 → 默认 12，行为不变。
   */
  depth?: number;
  /** TC 轮询间隔覆盖（测试注入 0 加速；生产默认 TC_POLL_INTERVAL_MS）。 */
  tcPollIntervalMs?: number;
  /** TC 轮询次数上限覆盖（测试注入小值模拟超时；生产默认 TC_POLL_MAX_ATTEMPTS）。 */
  tcPollMaxAttempts?: number;
}

/** calc 的只读预估（不调 DataForSEO、不需要凭证）：提交付费计算前的数字。 */
export interface BrandAdCountPreview {
  /** 全部品牌+国家组数。 */
  groupsTotal: number;
  /** 缓存内（14 天内查过）的组数——正常增量模式会跳过。 */
  groupsFresh: number;
  /** 过期/从未查的组数——正常增量模式将计费查询的组数。 */
  groupsStale: number;
  /** aliveOnly 时整组皆死的组数（将被跳过）；scope=all 时恒为 0。 */
  deadGroupsSkipped: number;
  /** 每组 SERP 查询上限（= 本次预估采用的深度）：确认框按 组数 × 此值 估最坏消耗。 */
  maxQueriesPerGroup: number;
  /** 本次预估采用的每组查询深度（4/8/12，回显给确认框标注）。 */
  depth: number;
  /**
   * 预计实际查询数：对每个将计费组（死组跳过、增量模式下新鲜组跳过
   * 后实际会跑的组）按本地派生预算 = 1（裸词）+ 该组在所选深度下可
   * 派生的长尾探针数，求和。近似精确——仅个别查询 API 失败时实际
   * 略低，不是 组数 × 深度的最坏值。
   */
  expectedQueries: number;
  /** 最坏查询数 = 将计费组数 × 深度（上限参考）。 */
  worstCaseQueries: number;
  /** 单次 SERP 查询单价（美元，= SERP_QUERY_PRICE_USD，估算单价）。 */
  unitPriceUsd: number;
  /**
   * 预计费用（美元，4 位小数）= SERP 部分（expectedQueries ×
   * unitPriceUsd）+ TC 部分（tcEstimatedCostUsd）。构成可拆分展示，
   * 总数只有一个，不另造第二口径。
   */
  estimatedCostUsd: number;
  /**
   * 预计补查 TC 的组数（下限估算）：非死组、存量 SERP 双 0 已知且 TC
   * 未查/过期 → 本轮会补查。用存量值预测：从未算过的组（SERP 值未知）
   * 无法预判双 0，不计入——实际可能略多于此数，注释与文案按预估口径。
   */
  tcChecksExpected: number;
  /** TC 单次查询单价（美元，= TC_QUERY_PRICE_USD，2026-10-21 实测 cost）。 */
  tcUnitPriceUsd: number;
  /** 预计 TC 费用（美元，4 位小数）= tcChecksExpected × tcUnitPriceUsd。 */
  tcEstimatedCostUsd: number;
}

interface ProductRow {
  id: string;
  name: string;
  brand: string | null;
  countryCode: string | null;
  landingPageType: string | null;
  adCount: number | null;
  adCountLongtail: number | null;
  /** 探针明细（Json 原样；null = 尚未按明细口径计算过，新鲜度视为待重探）。 */
  adProbeDetail: unknown;
  /** 透明中心广告主数（组级印记；null = 从未查过，绝不当 0 用）。 */
  tcAdvertisersCount: number | null;
  /** 透明中心头部广告主（Json 原样，仅展示）。 */
  tcTopAdvertisers: unknown;
  /** TC 上次查询时间（TC 专用新鲜度，14 天）。 */
  tcCheckedAt: Date | null;
  adCountCheckedAt: Date | null;
  screenVerdict: string | null;
  status: string;
  /** 探针派生用：推荐分（Decimal 已转 number）/ 评论数 / 类目（rawData 提取）。 */
  recommendationScore: number | null;
  reviewCount: number | null;
  category: string | null;
}

interface AdCountGroup {
  brand: string;
  countryCode: string | null;
  items: ProductRow[];
}

/** 读行（calc 与 preview 共用同一取数口径；aliveOnly 判活在分组层做，不在 where 过滤）。 */
async function loadAdCountRows(
  prisma: PrismaClient,
  tenantId: string,
  productIds?: string[]
): Promise<ProductRow[]> {
  const rows = (await prisma.networkProduct.findMany({
    where: {
      tenantId,
      ...(productIds && productIds.length > 0
        ? { id: { in: productIds } }
        : {}),
    },
    select: {
      id: true,
      name: true,
      brand: true,
      countryCode: true,
      landingPageType: true,
      adCount: true,
      adCountLongtail: true,
      adProbeDetail: true,
      tcAdvertisersCount: true,
      tcTopAdvertisers: true,
      tcCheckedAt: true,
      adCountCheckedAt: true,
      screenVerdict: true,
      status: true,
      recommendationScore: true,
      reviewCount: true,
      rawData: true,
    },
  })) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as string,
    name: (r.name as string) ?? "",
    brand: (r.brand as string | null) ?? null,
    countryCode: (r.countryCode as string | null) ?? null,
    landingPageType: (r.landingPageType as string | null) ?? null,
    adCount: typeof r.adCount === "number" ? r.adCount : null,
    adCountLongtail:
      typeof r.adCountLongtail === "number" ? r.adCountLongtail : null,
    adProbeDetail: r.adProbeDetail ?? null,
    tcAdvertisersCount:
      typeof r.tcAdvertisersCount === "number" ? r.tcAdvertisersCount : null,
    tcTopAdvertisers: r.tcTopAdvertisers ?? null,
    tcCheckedAt: r.tcCheckedAt instanceof Date ? r.tcCheckedAt : null,
    adCountCheckedAt:
      r.adCountCheckedAt instanceof Date ? r.adCountCheckedAt : null,
    screenVerdict: (r.screenVerdict as string | null) ?? null,
    status: (r.status as string) ?? "active",
    recommendationScore:
      r.recommendationScore == null ? null : Number(r.recommendationScore),
    reviewCount: typeof r.reviewCount === "number" ? r.reviewCount : null,
    category: extractProductCategory(r.rawData),
  }));
}

/** 按（品牌小写，国家大写首个）分组；brand 为空的商品跳过。calc 与 preview 共用。 */
function groupAdCountRows(rows: ProductRow[]): Map<string, AdCountGroup> {
  const groups = new Map<string, AdCountGroup>();
  for (const r of rows) {
    const brand = (r.brand ?? "").trim();
    if (!brand) continue;
    const country = (r.countryCode ?? "").split(",")[0]?.trim().toUpperCase() || null;
    const key = `${brand.toLowerCase()}|${country ?? ""}`;
    const g = groups.get(key);
    if (g) g.items.push(r);
    else groups.set(key, { brand, countryCode: country, items: [r] });
  }
  return groups;
}

/**
 * 新鲜度判定（14 天缓存 + 多探针口径，calc 与 preview 共用）：
 * - 组内任一商品 14 天内查过，才可能新鲜；
 * - 且探针明细口径已落地：组内任一商品 adProbeDetail 非 null。detail
 *   为 null = 明细上线前算的旧印记（哪怕长尾已探过），与长尾 null 同
 *   处理，视为待重探——下次计算按 v2 派生 + 深度 12 重探一次并落
 *   detail，之后才恢复正常 14 天缓存（本判定只出现在计算入口，
 *   不存在"为补 detail 单独烧钱"的旁路）；
 * - 且长尾口径已落地：组内任一商品 adCountLongtail 非 null → 新鲜；
 *   长尾为 null 但派生不出任何长尾探针（无型号/类目）→ null 即终局
 *   值（探无可探），也算新鲜，不反复重查裸词烧钱；
 *   长尾为 null 且能派生探针 → 探针全失败或旧印记，视为过期，
 *   下一次计算（哪怕非 force）必须重探。
 */
function isGroupFresh(
  brand: string,
  items: ProductRow[],
  now: number
): boolean {
  const recent = items.some(
    (p) =>
      p.adCountCheckedAt instanceof Date &&
      now - p.adCountCheckedAt.getTime() < AD_COUNT_CACHE_TTL_MS
  );
  if (!recent) return false;
  if (!items.some((p) => p.adProbeDetail != null)) return false;
  if (items.some((p) => p.adCountLongtail != null)) return true;
  // 新鲜度不看 depth：此处派生用默认上限，只判"有没有探针可派生"
  // （detail 在不在 + 有无可探才是新鲜度标准，与本次所选深度无关）。
  return deriveLongtailProbes(brand, items).length === 0;
}

/**
 * 死组判定（aliveOnly）：组内全部商品都满足「初筛判死（screenVerdict="kill"）
 * 或已下线（status !== "active"）」→ 整组是死组。任一活口径商品即非死组。
 */
function isDeadGroup(items: ProductRow[]): boolean {
  return items.every((p) => p.screenVerdict === "kill" || p.status !== "active");
}

/** 组级数值读取（组级统一写入，取第一个非 null 即组值；全 null → null）。 */
function firstGroupNumber(values: Array<number | null>): number | null {
  for (const v of values) if (v != null) return v;
  return null;
}

/** SERP 双 0 已知判定：裸词与长尾都已知（非 null）且都为 0。任一未知 → false（"无"未证）。 */
function serpDoubleZeroKnown(
  bare: number | null,
  longtail: number | null
): boolean {
  return bare === 0 && longtail === 0;
}

/**
 * TC 是否需要（补）查：组内无任一 tcCheckedAt 在 14 天内 → 需要。
 * TC 的新鲜度独立于 SERP：SERP 新鲜的组 TC 可能从未查过/已过期，
 * 反之亦然（SERP 重跑时 TC 新鲜则沿用存量，不重复花钱）。
 */
function tcNeedsCheck(items: ProductRow[], now: number): boolean {
  return !items.some(
    (p) =>
      p.tcCheckedAt instanceof Date &&
      now - p.tcCheckedAt.getTime() < AD_COUNT_CACHE_TTL_MS
  );
}

interface SerpItem {
  type?: unknown;
  domain?: unknown;
  url?: unknown;
  /** type="shopping" 块的子条目（购物广告元素在 items 里，自身不是顶层广告）。 */
  items?: SerpItem[];
}

function itemDomain(item: SerpItem): string {
  if (typeof item.domain === "string" && item.domain.trim())
    return item.domain.trim();
  if (typeof item.url === "string" && item.url.trim()) {
    try {
      return new URL(item.url).hostname;
    } catch {
      return "";
    }
  }
  return "";
}

function itemUrl(item: SerpItem): string {
  return typeof item.url === "string" ? item.url.trim() : "";
}

export interface SerpAdTally {
  /** 文字广告（type="paid"）条目：自投/他投与落地拆分的唯一依据。 */
  paidAds: Array<{ domain: string; url: string }>;
  /** 购物广告条数：type="shopping" 块内 type="shopping_element" 的条数。 */
  shoppingCount: number;
  /** 广告总数 = paid 条数 + shopping 条数（adCount / adCountLongtail 口径）。 */
  total: number;
}

/**
 * 统一广告计数（纯函数，裸词探针与长尾探针共用同一口径）：
 * total = 文字广告（type="paid"）条数 + 购物广告条数。购物广告在
 * DataForSEO SERP 里是独立 item type——{type:"shopping", items:[{
 * type:"shopping_element", …}]}，不是 paid，只数 paid 会系统性漏掉
 * 卖货品牌的主力广告形态。organic / 其他类型一律不计。
 * 注意：self/others 与 home/product 拆分只看 paid 条目的 URL（v1 口径，
 * 不扩展到购物条目——购物条目的落地归属另行处理），故 paidAds 单独带出。
 */
export function tallySerpAds(items: SerpItem[]): SerpAdTally {
  const paidAds: Array<{ domain: string; url: string }> = [];
  let shoppingCount = 0;
  for (const it of items) {
    if (!it) continue;
    if (it.type === "paid") {
      paidAds.push({ domain: itemDomain(it), url: itemUrl(it) });
    } else if (it.type === "shopping") {
      for (const el of it.items ?? []) {
        if (el?.type === "shopping_element") shoppingCount += 1;
      }
    }
  }
  return { paidAds, shoppingCount, total: paidAds.length + shoppingCount };
}

/** 调一次 DataForSEO SERP，返回广告计数（文字广告条目 + 购物广告条数）。失败抛错（调用方捕获跳组）。 */
async function fetchSerpAdTally(
  fetchImpl: typeof fetch,
  creds: { login: string; password: string },
  keyword: string,
  countryCode: string | null
): Promise<SerpAdTally> {
  const cc = (countryCode ?? "").trim().toUpperCase();
  const auth = Buffer.from(`${creds.login}:${creds.password}`).toString(
    "base64"
  );
  const res = await fetchImpl(SERP_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      {
        keyword,
        location_code: LOCATION_CODES[cc] ?? 2840,
        language_code: LANGUAGE_CODES[cc] ?? "en",
        device: "desktop",
        os: "windows",
        depth: 100,
      },
    ]),
  });
  if (!res.ok) {
    throw new Error(`DataForSEO SERP HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    tasks?: Array<{
      status_code?: number;
      status_message?: string;
      result?: Array<{ items?: SerpItem[] }>;
    }>;
  };
  const task = data?.tasks?.[0];
  if (!task || task.status_code !== 20000) {
    throw new Error(
      `DataForSEO 任务异常（status_code=${task?.status_code ?? "?"}${task?.status_message ? `：${task.status_message}` : ""}）`
    );
  }
  const items = task.result?.[0]?.items ?? [];
  return tallySerpAds(items);
}

/** 透明中心头部广告主一条（tcTopAdvertisers 的元素形状，仅展示）。 */
export interface TcAdvertiserEntry {
  name: string;
  /** 该广告主在透明中心的广告条数近似值；接口没给数值 → null（不臆造）。 */
  approxAds: number | null;
}

/** 一次 TC 查询的解析结果：广告主总数（权威计数）+ 头部广告主（展示）。 */
export interface TcAdvertisersResult {
  count: number;
  top: TcAdvertiserEntry[];
}

/** 广告主条目的名称候选字段（实测首条为 title，其余条目字段名可能不一 → 防御式取）。 */
function tcEntryName(item: Record<string, unknown>): string | null {
  for (const key of ["title", "advertiser_name", "advertiserName", "name"]) {
    const v = item[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** 广告主条目的广告数近似值候选字段：只取数值型，非数值一律 null。 */
function tcEntryApproxAds(item: Record<string, unknown>): number | null {
  for (const key of [
    "approx_ads_count",
    "approxAds",
    "ads_count",
    "adsCount",
  ]) {
    const v = item[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

interface TcTaskEnvelope {
  tasks?: Array<{
    id?: unknown;
    status_code?: number;
    status_message?: string;
    result?: Array<{
      items_count?: unknown;
      items?: Array<Record<string, unknown>>;
    }>;
  }>;
}

/**
 * 查一次透明中心旁证（Ads Advertisers，Google 广告透明中心数据源）：
 * 该接口只有 Standard 排队版（无 /live）：task_post 建任务 →
 * 轮询 task_get/advanced（40601/40602 = 排队中）直到完成。
 * - 权威计数 = result[0].items_count；头部广告主从 items 防御式解析
 *   （名称/近似广告数候选字段见上），最多取 3 条，仅展示。
 * - 任何失败（HTTP 非 2xx、任务异常状态、轮询超时、响应形状不符）
 *   → 返回 null（未知），**绝不抛错、绝不当 0**：调用方据此保持
 *   "TC 未知"口径，下次计算重试。device/os 由服务端默认
 *   （desktop/windows），与 SERP 口径一致。
 */
export async function fetchTcAdvertisers(
  fetchImpl: typeof fetch,
  creds: { login: string; password: string },
  keyword: string,
  countryCode: string | null,
  poll: { intervalMs?: number; maxAttempts?: number } = {}
): Promise<TcAdvertisersResult | null> {
  const intervalMs = poll.intervalMs ?? TC_POLL_INTERVAL_MS;
  const maxAttempts = poll.maxAttempts ?? TC_POLL_MAX_ATTEMPTS;
  const cc = (countryCode ?? "").trim().toUpperCase();
  const auth = Buffer.from(`${creds.login}:${creds.password}`).toString(
    "base64"
  );
  try {
    const postRes = await fetchImpl(TC_TASK_POST_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        { keyword, location_code: LOCATION_CODES[cc] ?? 2840 },
      ]),
    });
    if (!postRes.ok) return null;
    const postData = (await postRes.json()) as TcTaskEnvelope;
    const created = postData?.tasks?.[0];
    if (
      !created ||
      (created.status_code !== 20000 && created.status_code !== 20100) ||
      typeof created.id !== "string" ||
      !created.id
    ) {
      return null;
    }
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (attempt > 0 && intervalMs > 0) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      const getRes = await fetchImpl(
        `${TC_TASK_GET_BASE}/${created.id}`,
        { method: "GET", headers: { Authorization: `Basic ${auth}` } }
      );
      if (!getRes.ok) return null;
      const data = (await getRes.json()) as TcTaskEnvelope;
      const task = data?.tasks?.[0];
      if (!task) return null;
      // 40601 = Task Handed，40602 = Task In Queue：继续轮询。
      if (task.status_code === 40601 || task.status_code === 40602) continue;
      if (task.status_code !== 20000) return null;
      const result0 = task.result?.[0];
      if (!result0) return null;
      const count =
        typeof result0.items_count === "number" &&
        Number.isFinite(result0.items_count)
          ? result0.items_count
          : null;
      if (count === null) return null;
      const top: TcAdvertiserEntry[] = [];
      for (const raw of result0.items ?? []) {
        if (top.length >= 3) break;
        if (!raw || typeof raw !== "object") continue;
        const name = tcEntryName(raw);
        if (!name) continue;
        top.push({ name, approxAds: tcEntryApproxAds(raw) });
      }
      return { count, top };
    }
    return null; // 轮询用尽仍未完成 → 超时，未知
  } catch {
    return null;
  }
}

/**
 * 批量计算广告投放数量（增量）：按（品牌，国家）分组，每组查一次 SERP，
 * 结果写回组内全部商品。productIds 为空/缺省 → 该 tenant 全部商品（仍受
 * 14 天缓存约束，只查过期/未查的组）。
 */
export async function calcBrandAdCounts(
  prisma: PrismaClient,
  tenantId: string,
  productIds?: string[],
  deps: BrandAdCountDeps = {}
): Promise<BrandAdCountResult> {
  const login = deps.credentials?.login ?? (await readEncryptedTrafficSetting(
    prisma,
    DATAFORSEO_LOGIN_SETTING
  ));
  const password = deps.credentials?.password ?? (await readEncryptedTrafficSetting(
    prisma,
    DATAFORSEO_PASSWORD_SETTING
  ));
  if (!login || !password) {
    throw new Error("DataForSEO credentials not configured");
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  // 每组查询深度（默认 12 = 历史行为）；非法值在花钱之前就抛错。
  const depth = resolveCalcDepth(deps.depth);

  const rows = await loadAdCountRows(prisma, tenantId, productIds);
  const groups = groupAdCountRows(rows);

  const result: BrandAdCountResult = {
    groupsQueried: 0,
    groupsSkippedCache: 0,
    skippedDeadGroups: 0,
    serpQueries: 0,
    tcChecked: 0,
    tcFailed: 0,
    tcRescued: 0,
    tcQueries: 0,
    productsUpdated: 0,
    errors: [],
  };
  const now = Date.now();

  /**
   * 对一组执行一次 TC 查询并统一记账/计数：task_post 发出即计 1 次
   * tcQueries（付费口径）；失败计入 tcFailed + errors 并返回 null
   * （TC 维持未知，不写任何 tc 字段，下次计算重试）；成功且 ≥1 家
   * 计入 tcRescued。失败绝不抛错、不拖垮整轮 calc。
   */
  const runTcQuery = async (
    g: AdCountGroup
  ): Promise<TcAdvertisersResult | null> => {
    result.tcQueries = (result.tcQueries ?? 0) + 1;
    result.tcChecked = (result.tcChecked ?? 0) + 1;
    const tc = await fetchTcAdvertisers(
      fetchImpl,
      { login, password },
      g.brand,
      g.countryCode,
      {
        intervalMs: deps.tcPollIntervalMs,
        maxAttempts: deps.tcPollMaxAttempts,
      }
    );
    if (tc == null) {
      result.tcFailed = (result.tcFailed ?? 0) + 1;
      result.errors.push({
        brand: g.brand,
        countryCode: g.countryCode,
        message:
          "透明中心旁证查询失败/超时（TC 未知，不影响 SERP 结果，下次计算重试）",
      });
      return null;
    }
    if (tc.count >= 1) result.tcRescued = (result.tcRescued ?? 0) + 1;
    return tc;
  };

  for (const g of groups.values()) {
    // 活口径（aliveOnly）：整组判死 → 跳过（单独计数，不与缓存跳过混淆）。
    // 先于缓存判定：死组即使新鲜也算死组跳过。
    if (deps.aliveOnly && isDeadGroup(g.items)) {
      result.skippedDeadGroups = (result.skippedDeadGroups ?? 0) + 1;
      continue;
    }
    // 14 天缓存：组内任一商品在缓存期内查过 → 整组跳过。
    // force=true 时不跳过（用户显式要求忽略缓存重新计费查询）。
    if (!deps.force && isGroupFresh(g.brand, g.items, now)) {
      // TC 单独补查：SERP 侧新鲜，但存量 SERP 双 0（都已知）且 TC
      // 未查/已过期 → 只补 TC 这一腿：不重跑 SERP、不动 SERP 印记
      // 与 last* 快照，只写 tc 三字段。补查失败同样不影响跳过口径
      // 之外的任何东西（runTcQuery 已记 errors/tcFailed）。
      const storedBare = firstGroupNumber(g.items.map((p) => p.adCount));
      const storedLongtail = firstGroupNumber(
        g.items.map((p) => p.adCountLongtail)
      );
      if (
        serpDoubleZeroKnown(storedBare, storedLongtail) &&
        tcNeedsCheck(g.items, now)
      ) {
        const tc = await runTcQuery(g);
        if (tc) {
          const res = await prisma.networkProduct.updateMany({
            where: { id: { in: g.items.map((p) => p.id) }, tenantId },
            data: {
              tcAdvertisersCount: tc.count,
              // Json 字段：纯 JSON 形状（与 adProbeDetail 同惯例）。
              tcTopAdvertisers: tc.top as never,
              tcCheckedAt: new Date(),
            },
          });
          result.productsUpdated += res.count;
        }
      } else {
        result.groupsSkippedCache += 1;
      }
      continue;
    }

    let tally: SerpAdTally;
    try {
      tally = await fetchSerpAdTally(
        fetchImpl,
        { login, password },
        g.brand,
        g.countryCode
      );
    } catch (e) {
      result.errors.push({
        brand: g.brand,
        countryCode: g.countryCode,
        message: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
    result.groupsQueried += 1;
    result.serpQueries = (result.serpQueries ?? 0) + 1;

    // 探针明细：本次实际跑的每条探针逐条入 detail（裸词先行），随组级
    // 字段一并回写——前端可展开逐条验真，排查"双 0"先看词对不对。
    const detail: AdProbeDetailEntry[] = [
      {
        q: g.brand,
        kind: "bare",
        paid: tally.paidAds.length,
        shopping: tally.shoppingCount,
        total: tally.total,
      },
    ];
    // 长尾探针（品牌+型号/品类词）：联盟客投的是长尾，裸词 0 ≠ 没人投。
    // 每探针单独查一次 SERP 数广告条数（与裸词同一 tallySerpAds 口径：
    // 文字广告＋购物广告），组长尾值 = 各探针 MAX；
    // 无可派生探针 → null（终局）；探针全失败 → null 并记 errors
    // （新鲜度规则会让该组下次重探，不静默当 0）；失败的探针不入
    // detail（没跑出结果就不留假记录）。
    const probes = deriveLongtailProbes(g.brand, g.items, depth - 1);
    let longtail: number | null = null;
    let probeSucceeded = 0;
    for (const probe of probes) {
      try {
        const probeTally = await fetchSerpAdTally(
          fetchImpl,
          { login, password },
          probe.q,
          g.countryCode
        );
        probeSucceeded += 1;
        result.serpQueries = (result.serpQueries ?? 0) + 1;
        detail.push({
          q: probe.q,
          kind: probe.kind,
          paid: probeTally.paidAds.length,
          shopping: probeTally.shoppingCount,
          total: probeTally.total,
        });
        longtail =
          longtail === null
            ? probeTally.total
            : Math.max(longtail, probeTally.total);
      } catch {
        // 单探针失败不中断其他探针/整组。
      }
    }
    if (probes.length > 0 && probeSucceeded === 0) {
      result.errors.push({
        brand: g.brand,
        countryCode: g.countryCode,
        message: "长尾探针查询失败（型号/品类词 SERP 全部失败）",
      });
    }
    // 政策风险（组级）：Top5 商品名命中武器配件类模式 → 整组标记。
    const policyRisk = groupAdPolicyRisk(g.items);

    // Amazon 落地页分不清自投/他投 → 只记 total。
    const isAmazonGroup = g.items.some(
      (p) =>
        p.landingPageType === "amazon_product" ||
        p.landingPageType === "amazon_storefront"
    );
    // 自投/他投拆分只看文字广告（paid）条目（classifyAds 的 total 是
    // paid-only，不写回 adCount）；adCount 写 tally.total（文字＋购物）。
    const counts = classifyAds(
      g.brand,
      tally.paidAds.map((a) => ({ domain: a.domain }))
    );
    // 落地类型拆分：同行这批广告是落首页/旗舰店还是落商品页（other 不计入）。
    // 同拆分口径：只看 paid 条目 URL，购物条目不扩展（v1）。
    const landing = countLandingTypes(tally.paidAds.map((a) => a.url));
    // 透明中心旁证（省钱口径）：仅当本轮 SERP 裸词+长尾双 0（都已知）
    // 才查 TC——SERP 已 >0 的组 presence 已证，不查；长尾未知（null）
    // 时"无"未证，同样不查。TC 自身守 14 天新鲜度：新鲜时沿用存量
    // （不重查、不写回）；force 只绕 SERP 缓存，不绕 TC 新鲜度。
    // TC 失败 → tcData 保持 null，本次写回不带 tc 字段（维持未知）。
    let tcData: {
      tcAdvertisersCount: number;
      tcTopAdvertisers: TcAdvertiserEntry[];
      tcCheckedAt: Date;
    } | null = null;
    if (
      serpDoubleZeroKnown(tally.total, longtail) &&
      tcNeedsCheck(g.items, now)
    ) {
      const tc = await runTcQuery(g);
      if (tc) {
        tcData = {
          tcAdvertisersCount: tc.count,
          tcTopAdvertisers: tc.top,
          tcCheckedAt: new Date(),
        };
      }
    }

    // 快照：把组内代表行（组级统一写入，任一行即组值）的旧广告数/旧查询时间
    // 挪到 last* 字段，供下次计算时派生趋势（新投/停投/持续）。
    const representative = g.items[0];
    const res = await prisma.networkProduct.updateMany({
      where: { id: { in: g.items.map((p) => p.id) }, tenantId },
      data: {
        adCount: tally.total,
        adCountSelf: isAmazonGroup ? null : counts.self,
        adCountOthers: isAmazonGroup ? null : counts.others,
        adCountHome: landing.home,
        adCountProduct: landing.product,
        adCountLongtail: longtail,
        adPolicyRisk: policyRisk,
        // Json 字段：明细是纯 JSON 形状（与 catalog-sync 写 rawData 同惯例）。
        adProbeDetail: detail as never,
        // TC 旁证本轮查到才写；未查/失败不带这三个字段（存量 TC 值原样保留）。
        ...(tcData
          ? {
              tcAdvertisersCount: tcData.tcAdvertisersCount,
              tcTopAdvertisers: tcData.tcTopAdvertisers as never,
              tcCheckedAt: tcData.tcCheckedAt,
            }
          : {}),
        adCountCheckedAt: new Date(),
        lastAdCount: representative?.adCount ?? null,
        lastAdCountCheckedAt: representative?.adCountCheckedAt ?? null,
      },
    });
    result.productsUpdated += res.count;
  }

  return result;
}

/**
 * 广告数付费计算的只读预估（提交前确认用）：只读本地库分组计数，
 * 不调 DataForSEO、不需要凭证、不写任何数据。分组/缓存/死组判定与
 * calcBrandAdCounts 共用同一套 helper，口径保证一致：
 * - groupsFresh = 缓存内组（正常模式跳过）；groupsStale = 其余组；
 * - deadGroupsSkipped 仅 aliveOnly 时统计（与 calc 一样先于缓存判死，
 *   死组同时也计入它自身的新鲜/过期归类——总数口径：
 *   groupsTotal = groupsFresh + groupsStale，死组是其中的子集）。
 * - 费用预估：将计费组 = 按 calc 同一顺序判定后实际会跑的组
 *   （aliveOnly 先跳死组；force=false 再跳新鲜组；force=true 全跑）。
 *   每组预计查询数 = 1（裸词）+ 本地派生在所选 depth 下的长尾探针数
 *   （deriveLongtailProbes 纯函数零 API，派生多少条就会查多少条）；
 *   estimatedCostUsd = expectedQueries × SERP_QUERY_PRICE_USD + TC 部分
 *   （tcChecksExpected × TC_QUERY_PRICE_USD，口径见接口字段注释）。
 */
export async function previewBrandAdCounts(
  prisma: PrismaClient,
  tenantId: string,
  opts: { aliveOnly?: boolean; force?: boolean; depth?: number } = {}
): Promise<BrandAdCountPreview> {
  const depth = resolveCalcDepth(opts.depth);
  const rows = await loadAdCountRows(prisma, tenantId);
  const groups = groupAdCountRows(rows);
  const now = Date.now();
  let groupsFresh = 0;
  let groupsStale = 0;
  let deadGroupsSkipped = 0;
  let billableGroups = 0;
  let expectedQueries = 0;
  let tcChecksExpected = 0;
  for (const g of groups.values()) {
    const fresh = isGroupFresh(g.brand, g.items, now);
    if (fresh) groupsFresh += 1;
    else groupsStale += 1;
    const dead = opts.aliveOnly === true && isDeadGroup(g.items);
    if (dead) deadGroupsSkipped += 1;
    // 将计费判定与 calc 的跳过顺序一致：死组先跳 → 新鲜组增量跳过。
    if (dead) continue;
    // TC 补查预估（与 calc 触发同口径，但只能用存量值预测）：非死组、
    // 存量 SERP 双 0 已知且 TC 未查/过期 → 本轮会补查 TC（含 SERP
    // 侧新鲜、只补 TC 一腿的组，故此判定在新鲜组跳过之前）。从未算
    // 过的组 SERP 值未知、无法预判双 0，不计入（下限估算）。
    const storedBare = firstGroupNumber(g.items.map((p) => p.adCount));
    const storedLongtail = firstGroupNumber(
      g.items.map((p) => p.adCountLongtail)
    );
    if (
      serpDoubleZeroKnown(storedBare, storedLongtail) &&
      tcNeedsCheck(g.items, now)
    ) {
      tcChecksExpected += 1;
    }
    if (!opts.force && fresh) continue;
    billableGroups += 1;
    expectedQueries +=
      1 + deriveLongtailProbes(g.brand, g.items, depth - 1).length;
  }
  const tcEstimatedCostUsd =
    Math.round(tcChecksExpected * TC_QUERY_PRICE_USD * 10000) / 10000;
  return {
    groupsTotal: groups.size,
    groupsFresh,
    groupsStale,
    deadGroupsSkipped,
    maxQueriesPerGroup: depth,
    depth,
    expectedQueries,
    worstCaseQueries: billableGroups * depth,
    unitPriceUsd: SERP_QUERY_PRICE_USD,
    // 总费用 = SERP 部分 + TC 部分（构成见 tcEstimatedCostUsd）。
    estimatedCostUsd:
      Math.round(
        (expectedQueries * SERP_QUERY_PRICE_USD + tcEstimatedCostUsd) * 10000
      ) / 10000,
    tcChecksExpected,
    tcUnitPriceUsd: TC_QUERY_PRICE_USD,
    tcEstimatedCostUsd,
  };
}
