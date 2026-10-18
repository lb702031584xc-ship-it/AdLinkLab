/**
 * 流量需求门评估（Traffic Gate）。
 *
 * 判定逻辑：
 * - 有官网（自动检测到，或调用方直接提供 domain 跳过检测）：
 *   ① SimilarWeb key 已配置 → 官网月访问量（付费绝对值）>= 阈值；
 *   ② 无 key/获取失败 → Google Trends 品牌热度（免费 0-100 相对值）>= 阈值兜底。
 * - 无官网：
 *   ① Google Trends 核心关键词热度（免费相对值）>= 阈值；
 *   ② DataForSEO key 已配置 → 关键词月均搜索量（付费绝对值）仅展示，不判定。
 *
 * 铁律：相对热度（Trends）绝不写成访问量/搜索量；任一判定信号无数据时
 * 整体 passed=null（unknown），不直接判 fail；内部永不抛错。
 */
import type { PrismaClient } from "@adlinklab/database";
import { registrableDomain } from "../ai/compliance.js";
import {
  detectOfficialSite,
  isMarketplaceDomain,
} from "./official-site.js";
import { getKeywordInterest } from "./trends.js";
import { SimilarWebProvider } from "./similarweb.js";
import { DataForSeoProvider } from "./dataforseo.js";
import type {
  OfficialSiteInfo,
  TrafficGateResult,
  TrafficSignal,
  TrafficThresholds,
} from "./types.js";

export interface EvaluateTrafficGateInput {
  brand: string | null;
  title: string;
  keywords: string[];
  thresholds: TrafficThresholds;
  prisma: PrismaClient;
  fetchImpl?: typeof fetch;
  /**
   * 调用方直接提供的官网域名：非空时跳过 DuckDuckGo 自动检测，
   * officialSite = { found: true, domain, confidence: 'medium' }。
   */
  domain?: string | null;
  /** Trends 地理区域，默认 'US'。 */
  geo?: string;
  /**
   * 用户手动输入的月访问量（正整数）：提供时以它为准做通过/不通过判定，
   * 不再 unknown；只对比"官网月访问量阈值"这一档。
   */
  manualMonthlyVisits?: number | null;
  /**
   * SEMrush 域名概览手动输入（用户自己看 SEMrush 填，全部可选）：
   * - organicTraffic：自然流量（月访问量）
   * - paidTraffic：付费流量（月访问量，可为 0）
   * - paidKeywords：付费关键词数（可为 0）
   * 付费为零规则：organicTraffic >= thresholds.organicTrafficMin 且
   * paidTraffic === 0 → 流量门直接判 fail（同行已验证付费跑不正）。
   * 数据不足（organic 未知/低于阈值，或 paid 未知）时不触发判定，
   * 绝不因"没数据"误杀。未来可接 SEMrush 官方 API 或插件抓取自动填。
   */
  organicTraffic?: number | null;
  paidTraffic?: number | null;
  paidKeywords?: number | null;
}

/** 中英文停用词（标题分词/品牌提取时过滤）。 */
const STOPWORDS: ReadonlySet<string> = new Set([
  // 英文
  "a", "an", "the", "and", "or", "for", "with", "of", "to", "in", "on",
  "at", "by", "new", "best", "top", "hot", "sale", "official", "original",
  "genuine", "premium", "deluxe", "portable", "mini", "large", "small",
  "pack", "set", "pro", "plus", "max", "ultra",
  // 中文
  "的", "地", "得", "和", "与", "或", "在", "了", "是", "有",
  "新款", "正品", "官方", "旗舰", "迷你", "便携", "套装", "新品",
]);

/** 标题分词：去停用词，保留长度>=2 或含数字的 token。 */
function tokenizeTitle(title: string): string[] {
  return (title ?? "")
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map((t) => t.trim())
    .filter(
      (t) => t !== "" && !STOPWORDS.has(t) && (t.length >= 2 || /\d/.test(t))
    );
}

/**
 * 从产品标题启发式提取品牌：取前 2 个有效 token。
 * 例："Anker 737 Power Bank 120W" → "anker 737"；"安克 充电宝 20000mAh" → "安克 充电宝"。
 * 无有效 token → null。
 */
export function deriveBrandFromTitle(title: string): string | null {
  const tokens = tokenizeTitle(title);
  if (tokens.length === 0) return null;
  return tokens.slice(0, 2).join(" ");
}

/**
 * 提取核心关键词：优先用调用方给的 keywords（前 2 个），
 * 否则从标题分词取 1-2 个词组（每组最多 2 个 token）。
 */
export function extractCoreKeywords(
  title: string,
  fallbackKeywords: string[]
): string[] {
  const fromFallback = (fallbackKeywords ?? [])
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 2);
  if (fromFallback.length > 0) return fromFallback;
  const tokens = tokenizeTitle(title);
  const phrases: string[] = [];
  for (let i = 0; i < tokens.length && phrases.length < 2; i += 2) {
    phrases.push(tokens.slice(i, i + 2).join(" "));
  }
  return phrases;
}

/** 归一化调用方提供的域名：去协议/路径/首尾空白，转小写。 */
function normalizeProvidedDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    ?.trim() ?? "";
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function describeSignal(s: TrafficSignal): string {
  const v = s.value === null ? "暂无数据" : fmtInt(s.value);
  const t = s.threshold === null ? "无" : fmtInt(s.threshold);
  return `${s.label}：${v}（阈值 ${t}）`;
}

/** 付费为零规则的信号标签（reason 组装时用它识别，走专用 fail 文案）。 */
const PAID_ZERO_SIGNAL_LABEL =
  "付费流量为零检查（SEMrush 域名概览，用户手动输入）";

/** 归一化：正整数（>=1）才有效，否则 null。 */
function normPositiveInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0
    ? Math.floor(v)
    : null;
}

/** 归一化：非负整数（0 允许）才有效，否则 null。 */
function normNonNegInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0
    ? Math.floor(v)
    : null;
}

/**
 * 判定依据说明（中英）：付费存在=购买意图确认（行业经验）；
 * SEMrush 流量为 clickstream 建模估算值（非精确数），阈值仅作方向性判断。
 */
const BASIS_NOTE =
  "依据：付费存在=购买意图确认（行业经验）；" +
  "SEMrush 流量为 clickstream 建模估算值，阈值仅作方向性判断。" +
  "(Basis: paid presence confirms purchase intent (industry experience); " +
  "SEMrush traffic is clickstream-modeled estimates — thresholds are directional only.)";

/**
 * 付费为零规则（用户经验规则，确定性判定，不走 LLM）：
 * - kill 档：自然流量 >= organicTrafficMin 且 付费流量 === 0 → fail
 *   （自然流量很好但没人投付费，说明同行已验证付费跑不正，直接 PK）。
 * - caution 档：自然流量达标 且 0 < 付费流量 < 自然流量 × warnRatio → 警告
 *   （付费投入微弱，谨慎测试、小预算验证；不 kill）。
 * 数据不足（organic 未知/低于阈值，或 paid 未知）时返回 null——
 * 不加判定信号，绝不因"没数据"误杀（unknown 语义不变）。
 * 未来可接 SEMrush 官方 API 或插件抓取自动填这三个值。
 */
function evaluatePaidZeroRule(
  organicTraffic: unknown,
  paidTraffic: unknown,
  paidKeywords: unknown,
  organicTrafficMin: number,
  warnRatio: number
): {
  signal: TrafficSignal;
  organic: number;
  paid: number;
  paidKw: number | null;
  caution: string | null;
} | null {
  const organic = normPositiveInt(organicTraffic);
  const paid = normNonNegInt(paidTraffic);
  if (organic === null || organic < organicTrafficMin || paid === null) {
    return null;
  }
  const paidKw = normNonNegInt(paidKeywords);
  const kill = paid === 0;
  const cautionHit = !kill && paid < organic * warnRatio;
  const caution = cautionHit
    ? paidZeroCautionReason(organic, paid, warnRatio)
    : null;
  return {
    organic,
    paid,
    paidKw,
    caution,
    signal: {
      source: "manual",
      label: PAID_ZERO_SIGNAL_LABEL,
      value: organic,
      threshold: organicTrafficMin,
      passed: kill ? false : true,
      note:
        `自然流量 ${fmtInt(organic)}（阈值 ${fmtInt(organicTrafficMin)}），` +
        `付费流量 ${fmtInt(paid)}` +
        (paidKw !== null ? `，付费关键词 ${fmtInt(paidKw)}` : "") +
        (cautionHit
          ? `；付费不到自然流量的 ${Math.round(warnRatio * 100)}%，判 caution（不 kill）。`
          : "") +
        `数据来源：SEMrush 域名概览（用户手动输入，非系统实测）。`,
    },
  };
}

/** 付费为零规则 kill 档命中时的专用 fail 文案（中英，附判定依据）。 */
function paidZeroFailReason(
  organic: number,
  paidKw: number | null
): string {
  const kwPart = paidKw !== null ? `（付费关键词 ${fmtInt(paidKw)}）` : "";
  return (
    `自然流量 ${fmtInt(organic)} 但付费流量为 0${kwPart}——` +
    `同行已验证付费跑不正，直接 PK，不进入下一步` +
    ` (Organic traffic ${fmtInt(organic)} but paid traffic is 0 — ` +
    `competitors have proven paid doesn't convert; kill it, don't go further.)` +
    ` ${BASIS_NOTE}`
  );
}

/** 付费为零规则 caution 档命中时的专用警告文案（中英，附判定依据）。 */
function paidZeroCautionReason(
  organic: number,
  paid: number,
  warnRatio: number
): string {
  const pct = Math.round(warnRatio * 100);
  return (
    `付费流量极少（不到自然流量的 ${pct}%）：` +
    `自然流量 ${fmtInt(organic)}，付费流量 ${fmtInt(paid)}——` +
    `同行付费投入微弱，谨慎测试、小预算验证` +
    ` (Paid traffic is minimal (<${pct}% of organic): ` +
    `organic ${fmtInt(organic)}, paid ${fmtInt(paid)} — ` +
    `competitors invest little in paid; test cautiously with a small budget.)` +
    ` ${BASIS_NOTE}`
  );
}

async function evaluate(
  input: EvaluateTrafficGateInput
): Promise<TrafficGateResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const geo = (input.geo ?? "US").trim() || "US";
  const thresholds = input.thresholds;
  const signals: TrafficSignal[] = [];
  /** 任一 Trends 调用被限流（429/403）时为 true，用于 reason 文案区分。 */
  let trendsRateLimited = false;

  // ---- 手动输入值归一化：正整数才有效 ----
  const rawManual = input.manualMonthlyVisits;
  const manual =
    typeof rawManual === "number" &&
    Number.isFinite(rawManual) &&
    rawManual > 0
      ? Math.floor(rawManual)
      : null;

  // ---- 付费为零规则（用户经验规则）：自然流量达标但付费为 0 → 直接 fail；
  // 付费极少（>0 但 < 自然流量 × warnRatio）→ caution（不 kill） ----
  // 数据不足时不加信号，不影响其他判定（unknown 语义不变）。
  const paidZero = evaluatePaidZeroRule(
    input.organicTraffic,
    input.paidTraffic,
    input.paidKeywords,
    thresholds.organicTrafficMin,
    thresholds.paidTrafficWarnRatio
  );
  if (paidZero) {
    signals.push(paidZero.signal);
  }

  // ---- 官网判定 ----
  // 规则：电商平台域名（amazon/ebay/walmart…）永远不能视为品牌官网。
  // - 平台域名 + 有 brand → 对 brand 跑自动检测，用检出的品牌官网做流量门；
  // - 平台域名 + 无 brand → officialSite 判 found=false，reason 请补充品牌名，不硬 fail；
  // - 普通商家域名直给 → 视为官网，跳过检测（现有行为保持）。
  const providedDomain = normalizeProvidedDomain(input.domain ?? "");
  const brandForDetection =
    (input.brand ?? "").trim() || deriveBrandFromTitle(input.title ?? "");
  let officialSite: OfficialSiteInfo;
  let detectionNote = "";
  /** 实际用于流量判定的官网域名；null 表示没有可用官网走关键词分支。 */
  let siteDomain: string | null = null;

  if (providedDomain && isMarketplaceDomain(providedDomain)) {
    if (brandForDetection) {
      const detected = await detectOfficialSite(brandForDetection ?? "", fetchImpl);
      if (
        detected.found &&
        detected.domain &&
        !isMarketplaceDomain(detected.domain)
      ) {
        officialSite = {
          ...detected,
          reason: `品牌“${brandForDetection}”的官网（DuckDuckGo 自动检测）；链接是电商平台，平台域名不视为品牌官网`,
        };
        siteDomain = detected.domain;
        detectionNote = officialSite.reason ?? "";
      } else {
        officialSite = {
          found: false,
          domain: providedDomain,
          confidence: "low",
          reason: "链接是电商平台，平台域名不视为品牌官网；未能检出品牌官网",
        };
        detectionNote = officialSite.reason ?? "";
      }
    } else {
      officialSite = {
        found: false,
        domain: providedDomain,
        confidence: "low",
        reason: "链接是电商平台，平台域名不视为品牌官网；请补充品牌名以检测品牌官网",
      };
      detectionNote = officialSite.reason ?? "";
    }
  } else if (providedDomain) {
    officialSite = { found: true, domain: providedDomain, confidence: "medium" };
    siteDomain = providedDomain;
    detectionNote = "官网域名由调用方提供，跳过自动检测";
  } else {
    const detected = await detectOfficialSite(brandForDetection ?? "", fetchImpl);
    // 防御：即使搜索过滤漏网，检出的平台域名也不采信。
    if (
      detected.found &&
      detected.domain &&
      isMarketplaceDomain(detected.domain)
    ) {
      officialSite = {
        found: false,
        domain: null,
        confidence: "low",
        reason: `检出域名 ${detected.domain} 是电商平台，不视为品牌官网`,
      };
    } else {
      officialSite = detected;
    }
    detectionNote =
      officialSite.found && officialSite.domain
        ? `官网 ${officialSite.domain}（DuckDuckGo 免费自动检测，置信度 ${officialSite.confidence}）`
        : "未找到品牌官网（DuckDuckGo 免费自动检测）";
    if (officialSite.found && officialSite.domain) siteDomain = officialSite.domain;
  }

  // ---- 手动值优先：以手动为准判定，不再 unknown ----
  if (manual !== null) {
    signals.push({
      source: "manual",
      label: "手动输入月访问量（用户提供，非实测流量）",
      value: manual,
      threshold: thresholds.officialSiteMonthlyVisits,
      passed: manual >= thresholds.officialSiteMonthlyVisits,
      note:
        "使用手动输入值判定：只对比“官网月访问量阈值”这一档。" +
        "数字由用户手动提供（建议来源：SimilarWeb 免费版），非系统实测。" +
        detectionNote,
    });
  } else if (siteDomain) {
    const domain = siteDomain;
    // ---- 有官网：优先 SimilarWeb 付费绝对流量 ----
    const sw = new SimilarWebProvider(input.prisma, fetchImpl);
    const visits = await sw.getMonthlyVisits(domain);
    if (visits !== null) {
      signals.push({
        source: "similarweb",
        label: "官网月访问量（SimilarWeb 付费 API）",
        value: visits,
        threshold: thresholds.officialSiteMonthlyVisits,
        passed: visits >= thresholds.officialSiteMonthlyVisits,
        note: detectionNote,
      });
    } else {
      // ---- 无 key/获取失败：Trends 品牌热度兜底（免费相对值） ----
      const brandKeyword =
        (input.brand ?? "").trim() ||
        deriveBrandFromTitle(input.title ?? "") ||
        (registrableDomain(domain).split(".")[0] ?? domain);
      const interest = await getKeywordInterest([brandKeyword], geo, fetchImpl);
      if (interest.rateLimited) trendsRateLimited = true;
      signals.push({
        source: "trends",
        label: "品牌热度（Google Trends 免费相对值，非访问量）",
        value: interest.value,
        threshold: thresholds.brandInterest,
        passed:
          interest.value === null ? null : interest.value >= thresholds.brandInterest,
        note:
          `${detectionNote}；SimilarWeb 未配置（需付费 key）或获取失败，` +
          `改用免费品牌热度。关键词：${brandKeyword}` +
          (interest.rateLimited ? "；Google Trends 在服务器 IP 上被限流（429），免费热度不可用" : ""),
      });
    }
  } else {
    // ---- 无官网：Trends 核心关键词热度（免费相对值） ----
    const coreKeywords = extractCoreKeywords(
      input.title ?? "",
      input.keywords ?? []
    );
    const interest =
      coreKeywords.length > 0
        ? await getKeywordInterest(coreKeywords, geo, fetchImpl)
        : { value: null as number | null, rateLimited: false };
    if (interest.rateLimited) trendsRateLimited = true;
    signals.push({
      source: "trends",
      label: "核心关键词热度（Google Trends 免费相对值，非搜索量）",
      value: interest.value,
      threshold: coreKeywords.length > 0 ? thresholds.keywordInterest : null,
      passed:
        interest.value === null ? null : interest.value >= thresholds.keywordInterest,
      note:
        `${detectionNote}。关键词：${coreKeywords.join(" / ") || "无"}` +
        (interest.rateLimited ? "；Google Trends 在服务器 IP 上被限流（429），免费热度不可用" : ""),
    });
    // ---- DataForSEO 绝对搜索量：仅展示，不判定 ----
    const df = new DataForSeoProvider(input.prisma, fetchImpl);
    const volumes = await df.getKeywordVolume(coreKeywords);
    for (const v of volumes) {
      signals.push({
        source: "dataforseo",
        label: `关键词月均搜索量（DataForSEO 付费 API，仅展示）`,
        value: v.volume,
        threshold: null,
        passed: null,
        note: `关键词：${v.keyword}`,
      });
    }
  }

  // ---- 综合判定：只看带阈值的信号 ----
  const decisive = signals.filter((s) => s.threshold !== null);
  let passed: boolean | null;
  let reason: string;
  if (decisive.length === 0 || decisive.some((s) => s.passed === null)) {
    passed = null;
    const missing = decisive
      .filter((s) => s.passed === null)
      .map((s) => s.label);
    reason =
      `流量门结果未知（unknown）：暂无数据——` +
      (trendsRateLimited
        ? "Google Trends 在服务器 IP 上被限流（429），免费热度不可用；"
        : "") +
      (missing.length > 0
        ? `${missing.join("；")}未配置（需付费 key）或获取失败`
        : "无可判定的数据源") +
      `。免费数据源（Google Trends）与付费数据源（SimilarWeb/DataForSEO）均未能返回有效判定数据。` +
      (officialSite.reason ? `官网说明：${officialSite.reason}。` : "");
  } else if (decisive.every((s) => s.passed === true)) {
    passed = true;
    reason =
      `流量门通过：${decisive.map(describeSignal).join("；")}。` +
      (providedDomain && !isMarketplaceDomain(providedDomain)
        ? "官网域名由调用方提供，跳过自动检测。"
        : "");
  } else {
    passed = false;
    reason =
      `流量门未通过：${decisive
        .filter((s) => s.passed === false)
        .map((s) =>
          // 付费为零规则命中时用专用文案（含中英），而不是通用 describeSignal。
          s.label === PAID_ZERO_SIGNAL_LABEL && paidZero
            ? paidZeroFailReason(paidZero.organic, paidZero.paidKw)
            : describeSignal(s)
        )
        .join("；")}。` +
      (providedDomain && !isMarketplaceDomain(providedDomain)
        ? "官网域名由调用方提供，跳过自动检测。"
        : "");
  }

  return { passed, reason, officialSite, signals, caution: paidZero?.caution ?? null };
}

/**
 * 流量门评估入口。内部永不抛错：任何异常都收敛为
 * passed=null（unknown）+ 说明原因的 TrafficGateResult。
 */
export async function evaluateTrafficGate(
  input: EvaluateTrafficGateInput
): Promise<TrafficGateResult> {
  try {
    return await evaluate(input);
  } catch (e) {
    return {
      passed: null,
      reason:
        "流量门评估异常（unknown）：内部错误，未拿到任何数据源数据——" +
        (e instanceof Error ? e.message : String(e)),
      officialSite: null,
      signals: [],
      caution: null,
    };
  }
}
