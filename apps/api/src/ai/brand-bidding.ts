/**
 * 品牌词投流检查：查某品牌词在 Google 上有哪些广告主在投，
 * 区分官方 vs 非官方，给出投流评估。
 *
 * 数据源：DataForSEO SERP API（google/organic/live/advanced，结果里含 paid 广告项）。
 * 凭证复用流量信号凭证：AiSetting `traffic.dataforseoLogin` / `traffic.dataforseoPassword`。
 * 无凭证 → status=unavailable（绝不编造，给手动核查指引）。
 * 接口/解析失败 → status=error（绝不 500）。
 */
import type { PrismaClient } from "@adlinklab/database";
import { AppError } from "@adlinklab/shared";
import { readEncryptedTrafficSetting } from "../traffic/settings.js";
import {
  DATAFORSEO_LOGIN_SETTING,
  DATAFORSEO_PASSWORD_SETTING,
} from "../traffic/dataforseo.js";

export class BrandBiddingError extends AppError {
  constructor(message: string) {
    super(message, { code: "BRAND_BIDDING_FAILED", statusCode: 422 });
    this.name = "BrandBiddingError";
  }
}

export type BrandBiddingVerdict =
  | "no_ads"
  | "official_only"
  | "non_official_present";

export interface BrandBidder {
  domain: string;
  title: string | null;
  isOfficial: boolean;
}

export interface BrandBiddingResult {
  status: "ok" | "unavailable" | "error";
  keyword: string;
  officialDomain: string;
  /** 搜到的付费广告总数 */
  adsFound: number;
  officialAds: number;
  nonOfficialAds: number;
  /** 非官方广告主（去重后域名） */
  nonOfficial: BrandBidder[];
  verdict: BrandBiddingVerdict | null;
  /** 评估判断（中文要点） */
  assessment: string[];
  checkedAt: string;
  /** 数据来源说明 */
  source: string;
}

export interface BrandBiddingDeps {
  prisma: PrismaClient;
  fetchImpl?: typeof fetch;
}

const SERP_API_URL =
  "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";

/** 归一化域名：小写去 www. */
export function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^www\./, "");
}

/** 是否官方域名（含子域名）。 */
export function isOfficialDomain(domain: string, officialDomain: string): boolean {
  const d = normalizeDomain(domain);
  const o = normalizeDomain(officialDomain);
  return d === o || d.endsWith(`.${o}`);
}

interface SerpPaidItem {
  type?: unknown;
  domain?: unknown;
  title?: unknown;
}

export function extractBidders(
  items: SerpPaidItem[],
  officialDomain: string
): BrandBidder[] {
  const seen = new Map<string, BrandBidder>();
  for (const item of items ?? []) {
    if (item?.type !== "paid") continue;
    const domain = typeof item.domain === "string" ? item.domain.trim() : "";
    if (!domain) continue;
    const key = normalizeDomain(domain);
    if (seen.has(key)) continue;
    seen.set(key, {
      domain: key,
      title: typeof item.title === "string" ? item.title.slice(0, 120) : null,
      isOfficial: isOfficialDomain(domain, officialDomain),
    });
  }
  return [...seen.values()];
}

export function buildAssessment(
  verdict: BrandBiddingVerdict,
  nonOfficial: BrandBidder[],
  keyword: string
): string[] {
  switch (verdict) {
    case "no_ads":
      return [
        `“${keyword}”当前没有付费广告。可能原因：搜索量小、官方没投、或非投放时段。`,
        "如果该词有一定搜索量却无广告，可能是蓝海——先小预算验证转化再放量。",
      ];
    case "official_only":
      return [
        `“${keyword}”的广告位被官方独占。`,
        "你投这个品牌词 = 直接和官方竞价，CPC 通常偏高；且多数 offer 条款禁止品牌词投流，先看条款解析的品牌词政策，违规可能被扣佣金甚至封号。",
      ];
    case "non_official_present": {
      const domains = nonOfficial.map((b) => b.domain).join("、");
      return [
        `“${keyword}”有 ${nonOfficial.length} 家非官方在投：${domains}。`,
        "有人愿意持续花钱，说明这个词有转化价值——值得跟进，但你要拼出价和落地页。",
        "风险提示：其中可能有违规投品牌词的 affiliate。品牌方投诉或 Google 抽查会导致封户；你跟投前必须先确认 offer 条款允许品牌词，不要默认“别人能投我也能投”。",
      ];
    }
  }
}

export async function checkBrandBidding(
  keyword: string,
  officialDomain: string,
  deps: BrandBiddingDeps
): Promise<BrandBiddingResult> {
  const kw = keyword.trim();
  const od = normalizeDomain(officialDomain);
  if (!kw) throw new BrandBiddingError("品牌词不能为空");
  if (!od || !od.includes(".")) throw new BrandBiddingError("官方域名无效");

  const login = await readEncryptedTrafficSetting(deps.prisma, DATAFORSEO_LOGIN_SETTING);
  const password = await readEncryptedTrafficSetting(
    deps.prisma,
    DATAFORSEO_PASSWORD_SETTING
  );
  const checkedAt = new Date().toISOString();
  if (!login || !password) {
    return {
      status: "unavailable",
      keyword: kw,
      officialDomain: od,
      adsFound: 0,
      officialAds: 0,
      nonOfficialAds: 0,
      nonOfficial: [],
      verdict: null,
      assessment: [
        "未配置 DataForSEO 凭证，无法自动检查（AI 设置 → 流量信号凭证）。",
        "手动核查：在 Google 搜品牌词看广告位，或打开 Google Ads Transparency Center（adstransparency.google.com）按关键词搜，看广告主是不是官方。",
      ],
      checkedAt,
      source: "unavailable: missing DataForSEO credentials",
    };
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  let items: SerpPaidItem[];
  try {
    const auth = Buffer.from(`${login}:${password}`).toString("base64");
    const res = await fetchImpl(SERP_API_URL, {
      method: "POST",
      headers: {
          Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          keyword: kw,
          location_code: 2840, // 美国
          language_code: "en",
          device: "desktop",
          os: "windows",
        },
      ]),
    });
    if (!res.ok) {
      throw new BrandBiddingError(`DataForSEO 请求失败（HTTP ${res.status}）`);
    }
    const data = (await res.json()) as {
      tasks?: Array<{ status_code?: number; result?: Array<{ items?: SerpPaidItem[] }> }>;
    };
    const task = data?.tasks?.[0];
    if (!task || task.status_code !== 20000) {
      throw new BrandBiddingError(
        `DataForSEO 任务异常（status_code=${task?.status_code ?? "?"})`
      );
    }
    items = task.result?.[0]?.items ?? [];
  } catch (e) {
    if (e instanceof BrandBiddingError) throw e;
    throw new BrandBiddingError(
      `品牌词检查失败（${e instanceof Error ? e.message : String(e)}）`
    );
  }

  const bidders = extractBidders(items, od);
  const officialAds = bidders.filter((b) => b.isOfficial).length;
  const nonOfficial = bidders.filter((b) => !b.isOfficial);
  const verdict: BrandBiddingVerdict =
    bidders.length === 0
      ? "no_ads"
      : nonOfficial.length > 0
        ? "non_official_present"
        : "official_only";

  return {
    status: "ok",
    keyword: kw,
    officialDomain: od,
    adsFound: bidders.length,
    officialAds,
    nonOfficialAds: nonOfficial.length,
    nonOfficial,
    verdict,
    assessment: buildAssessment(verdict, nonOfficial, kw),
    checkedAt,
    source: "DataForSEO SERP API（google/organic/live/advanced，美国/桌面端）",
  };
}
