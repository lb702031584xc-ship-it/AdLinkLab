/**
 * DataForSEO 关键词流水线客户端（/keywords/starter 实测扩词 + 广告测算）。
 *
 * - 凭证读 AiSetting `traffic.dataforseoLogin` / `traffic.dataforseoPassword`
 *   （加密，与流量门共用同一对凭证）；缺任一 → 抛 DATAFORSEO_NOT_CONFIGURED。
 * - 接口（均为 Live，交互式按钮触发；价格 2026-10-20 官网核实）：
 *   - Labs `google/related_keywords/live`：一粒种子扩长尾（$0.012/次 +
 *     $0.00012/条）。条目自带 search_volume / cpc / competition(0–1)。
 *   - Labs `google/search_intent/live`：购买意图标签（≤1000 词/次）。
 *   - Labs `google/keyword_overview/live`：给短名单补 cpc（≤700 词/次）。
 *   - Keywords Data `google_ads/search_volume/live`：页首出价区间
 *     low/high_top_of_page_bid + competition_index（$0.09/任务装 ≤1000 词）。
 *     ⚠️ 该接口已无 cpc 字段，估算 CPC 只能走 Labs（见专项研究报告）。
 * - 错误不吞：HTTP 失败透出 DataForSEO 的 status_message（dataforseo-error
 *   helper），让用户能分清是凭证错、未激活还是余额不足。
 * - 数据真实性：响应里缺失的字段一律返回 null（未知），绝不用 0 冒充。
 */
import type { PrismaClient } from "@adlinklab/database";
import {
  DATAFORSEO_LOGIN_SETTING,
  DATAFORSEO_PASSWORD_SETTING,
} from "../traffic/dataforseo.js";
import { readEncryptedTrafficSetting } from "../traffic/settings.js";
import {
  dataForSeoErrorMessage,
  readDataForSeoErrorDetail,
} from "../ai/dataforseo-error.js";

const RELATED_KEYWORDS_URL =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/related_keywords/live";
const SEARCH_INTENT_URL =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/search_intent/live";
const KEYWORD_OVERVIEW_URL =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live";
const ADS_SEARCH_VOLUME_URL =
  "https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live";

export type DataForSeoKeywordsErrorCode =
  | "DATAFORSEO_NOT_CONFIGURED"
  | "DATAFORSEO_REQUEST_FAILED";

export class DataForSeoKeywordsError extends Error {
  readonly code: DataForSeoKeywordsErrorCode;
  readonly statusCode: number;

  constructor(
    message: string,
    code: DataForSeoKeywordsErrorCode,
    statusCode: number
  ) {
    super(message);
    this.name = "DataForSeoKeywordsError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function notConfiguredError(): DataForSeoKeywordsError {
  return new DataForSeoKeywordsError(
    "DataForSEO 未配置：请先在 AI 设置 → 流量信号凭证里填写 DataForSEO 账号（login + password），再使用实测扩词与广告测算。",
    "DATAFORSEO_NOT_CONFIGURED",
    400
  );
}

/** Labs related keywords 候选（实测数据，非 AI 现编）。 */
export interface DfsRelatedCandidate {
  keyword: string;
  /** 月均搜索量；null = 响应未给（未知，不用 0 冒充） */
  searchVolume: number | null;
  /** Labs 估算 CPC（账号货币随 DataForSEO 账户设置）；null = 未知 */
  cpc: number | null;
  /** 付费竞争度 0–1；null = 未知 */
  competition: number | null;
  /** 竞争等级原文（LOW / MEDIUM / HIGH）；null = 未知 */
  competitionLevel: string | null;
}

/** Labs search intent 单词结果。 */
export interface DfsIntentResult {
  keyword: string;
  /** informational / navigational / commercial / transactional；null = 未验证 */
  intent: string | null;
  /** 意图概率 0–1；null = 未知 */
  probability: number | null;
}

/** Keywords Data google_ads/search_volume 单词结果（该接口无 cpc 字段）。 */
export interface DfsAdsVolumeRow {
  keyword: string;
  searchVolume: number | null;
  /** 竞争等级原文（LOW / MEDIUM / HIGH）；null = 未知 */
  competition: string | null;
  /** 竞争指数 0–100；null = 未知 */
  competitionIndex: number | null;
  /** 页首出价估算区间下界；null = 未知 */
  lowTopBid: number | null;
  /** 页首出价估算区间上界；null = 未知 */
  highTopBid: number | null;
}

/* ------------------------------------------------------------------ */
/* 纯解析函数（可单测；对响应形状做多形态容错，缺字段 → null）            */
/* ------------------------------------------------------------------ */

function asFiniteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asTrimmedStringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

interface DfsTaskEnvelope {
  tasks?: Array<{
    status_code?: unknown;
    status_message?: unknown;
    result?: unknown;
  }>;
}

/** 取 tasks[0].result；任务级 status_code ≥ 40000 视为失败并抛错。 */
function firstTaskResult(data: unknown): unknown {
  const envelope = (data ?? {}) as DfsTaskEnvelope;
  const task = envelope.tasks?.[0];
  if (!task) return undefined;
  const code = task.status_code;
  if (typeof code === "number" && code >= 40000) {
    const msg = asTrimmedStringOrNull(task.status_message);
    throw new DataForSeoKeywordsError(
      `DataForSEO 任务异常（status_code=${code}${msg ? `：${msg}` : ""}）`,
      "DATAFORSEO_REQUEST_FAILED",
      502
    );
  }
  return task.result;
}

/** Labs 系列：result 是 [{ items: [...] }]；Keywords Data：result 直接是条目数组。 */
function resultItems(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) {
    const first = result[0] as { items?: unknown } | undefined;
    if (first && Array.isArray(first.items)) {
      return first.items.filter(
        (i): i is Record<string, unknown> =>
          !!i && typeof i === "object"
      );
    }
    return result.filter(
      (i): i is Record<string, unknown> => !!i && typeof i === "object"
    );
  }
  return [];
}

/** Labs 条目：字段在 keyword_data 里（部分接口平铺在条目顶层），两处都认。 */
function keywordDataOf(
  item: Record<string, unknown>
): Record<string, unknown> {
  const kd = item.keyword_data;
  if (kd && typeof kd === "object") return kd as Record<string, unknown>;
  return item;
}

function keywordInfoOf(
  kd: Record<string, unknown>
): Record<string, unknown> {
  const info = kd.keyword_info;
  return info && typeof info === "object"
    ? (info as Record<string, unknown>)
    : {};
}

/** 解析 Labs related_keywords 响应 → 候选列表（去重、剔除种子词本身、上限截断）。 */
export function parseRelatedKeywordsResponse(
  data: unknown,
  seed: string,
  limit: number
): DfsRelatedCandidate[] {
  const items = resultItems(firstTaskResult(data));
  const out: DfsRelatedCandidate[] = [];
  const seen = new Set<string>();
  const seedKey = seed.trim().toLowerCase();
  for (const item of items) {
    const kd = keywordDataOf(item);
    const keyword = asTrimmedStringOrNull(kd.keyword);
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (key === seedKey || seen.has(key)) continue;
    seen.add(key);
    const info = keywordInfoOf(kd);
    out.push({
      keyword,
      searchVolume: asFiniteNumber(info.search_volume),
      cpc: asFiniteNumber(info.cpc),
      competition: asFiniteNumber(info.competition),
      competitionLevel: asTrimmedStringOrNull(info.competition_level),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** 解析 Labs search_intent 响应 → 每词意图标签 + 概率。 */
export function parseSearchIntentResponse(
  data: unknown
): DfsIntentResult[] {
  const items = resultItems(firstTaskResult(data));
  const out: DfsIntentResult[] = [];
  for (const item of items) {
    const keyword = asTrimmedStringOrNull(item.keyword);
    if (!keyword) continue;
    const intentObj =
      item.keyword_intent && typeof item.keyword_intent === "object"
        ? (item.keyword_intent as Record<string, unknown>)
        : null;
    const intentInfo =
      item.search_intent_info && typeof item.search_intent_info === "object"
        ? (item.search_intent_info as Record<string, unknown>)
        : null;
    const label =
      asTrimmedStringOrNull(intentObj?.label) ??
      asTrimmedStringOrNull(intentInfo?.main_intent) ??
      asTrimmedStringOrNull(item.intent);
    out.push({
      keyword,
      intent: label ? label.toLowerCase() : null,
      probability: asFiniteNumber(intentObj?.probability),
    });
  }
  return out;
}

/** 解析 Labs keyword_overview 响应 → keyword（小写）→ cpc 映射（只收有 cpc 的）。 */
export function parseKeywordOverviewCpc(
  data: unknown
): Map<string, number> {
  const items = resultItems(firstTaskResult(data));
  const map = new Map<string, number>();
  for (const item of items) {
    const kd = keywordDataOf(item);
    const keyword = asTrimmedStringOrNull(kd.keyword);
    if (!keyword) continue;
    const cpc = asFiniteNumber(keywordInfoOf(kd).cpc);
    if (cpc !== null) map.set(keyword.toLowerCase(), cpc);
  }
  return map;
}

/** 解析 Keywords Data google_ads/search_volume 响应（无 cpc 字段，不要去找）。 */
export function parseAdsSearchVolumeResponse(
  data: unknown
): DfsAdsVolumeRow[] {
  const items = resultItems(firstTaskResult(data));
  const out: DfsAdsVolumeRow[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const keyword = asTrimmedStringOrNull(item.keyword);
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      keyword,
      searchVolume: asFiniteNumber(item.search_volume),
      competition: asTrimmedStringOrNull(item.competition),
      competitionIndex: asFiniteNumber(item.competition_index),
      lowTopBid: asFiniteNumber(item.low_top_of_page_bid),
      highTopBid: asFiniteNumber(item.high_top_of_page_bid),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 客户端                                                               */
/* ------------------------------------------------------------------ */

export class DataForSeoKeywordService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  private async getCredentials(): Promise<{
    login: string;
    password: string;
  }> {
    const login = await readEncryptedTrafficSetting(
      this.prisma,
      DATAFORSEO_LOGIN_SETTING
    );
    const password = await readEncryptedTrafficSetting(
      this.prisma,
      DATAFORSEO_PASSWORD_SETTING
    );
    if (!login || !password) throw notConfiguredError();
    return { login, password };
  }

  private async postJson(url: string, payload: unknown): Promise<unknown> {
    const creds = await this.getCredentials();
    const auth = Buffer.from(`${creds.login}:${creds.password}`).toString(
      "base64"
    );
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([payload]),
      });
    } catch {
      throw new DataForSeoKeywordsError(
        "DataForSEO 请求失败（网络异常，未收到响应）",
        "DATAFORSEO_REQUEST_FAILED",
        502
      );
    }
    if (!res.ok) {
      const detail = await readDataForSeoErrorDetail(res);
      throw new DataForSeoKeywordsError(
        dataForSeoErrorMessage(res.status, detail),
        "DATAFORSEO_REQUEST_FAILED",
        502
      );
    }
    try {
      return await res.json();
    } catch {
      throw new DataForSeoKeywordsError(
        "DataForSEO 请求失败（响应不是合法 JSON）",
        "DATAFORSEO_REQUEST_FAILED",
        502
      );
    }
  }

  /** 一粒种子 → 长尾候选（Labs Related Keywords，depth=2）。 */
  async getRelatedKeywords(input: {
    seed: string;
    locationCode: number;
    languageCode: string;
    limit: number;
  }): Promise<DfsRelatedCandidate[]> {
    const data = await this.postJson(RELATED_KEYWORDS_URL, {
      keyword: input.seed,
      location_code: input.locationCode,
      language_code: input.languageCode,
      depth: 2,
      limit: input.limit,
    });
    return parseRelatedKeywordsResponse(data, input.seed, input.limit);
  }

  /** 一批词 → 购买意图标签（Labs Search Intent，≤1000 词）。 */
  async getSearchIntents(input: {
    keywords: string[];
    locationCode: number;
    languageCode: string;
  }): Promise<DfsIntentResult[]> {
    const data = await this.postJson(SEARCH_INTENT_URL, {
      keywords: input.keywords,
      location_code: input.locationCode,
      language_code: input.languageCode,
    });
    return parseSearchIntentResponse(data);
  }

  /** 一批词 → 估算 CPC 映射（Labs Keyword Overview；Keywords Data 无 cpc）。 */
  async getKeywordOverviewCpc(input: {
    keywords: string[];
    locationCode: number;
    languageCode: string;
  }): Promise<Map<string, number>> {
    const data = await this.postJson(KEYWORD_OVERVIEW_URL, {
      keywords: input.keywords,
      location_code: input.locationCode,
      language_code: input.languageCode,
      include_serp_info: false,
      include_clickstream_data: false,
    });
    return parseKeywordOverviewCpc(data);
  }

  /** 一批词 → 搜索量/竞争指数/页首出价区间（Keywords Data google_ads）。 */
  async getAdsSearchVolume(input: {
    keywords: string[];
    locationCode: number;
    languageCode: string;
  }): Promise<DfsAdsVolumeRow[]> {
    const data = await this.postJson(ADS_SEARCH_VOLUME_URL, {
      keywords: input.keywords,
      location_code: input.locationCode,
      language_code: input.languageCode,
    });
    return parseAdsSearchVolumeResponse(data);
  }
}
