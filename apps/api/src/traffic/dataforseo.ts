/**
 * DataForSEO Labs — 关键词绝对搜索量（付费 login/password，用户自备）。
 *
 * - 凭证读 AiSetting `traffic.dataforseoLogin` / `traffic.dataforseoPassword`
 *   （加密）；缺任一 → 所有方法返回 null。
 * - getKeywordVolume：调 Labs `google/historical_search_volume/live`，
 *   Basic auth，取各词 keyword_info.search_volume（月均搜索量，美国英语）。
 * - getMonthlyVisits：DataForSEO 无简单"官网月访问"口径 → null
 *   （该口径由 SimilarWeb 负责）。
 *
 * 实现可简化：失败 → null，绝不抛错。
 */
import type { PrismaClient } from "@adlinklab/database";
import { readEncryptedTrafficSetting } from "./settings.js";
import type { TrafficProvider } from "./types.js";

export const DATAFORSEO_LOGIN_SETTING = "traffic.dataforseoLogin";
export const DATAFORSEO_PASSWORD_SETTING = "traffic.dataforseoPassword";

const HISTORICAL_SEARCH_VOLUME_URL =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/historical_search_volume/live";
const KEYWORD_SUGGESTIONS_URL =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_suggestions/live";

interface HistoricalSearchVolumeItem {
  keyword?: unknown;
  keyword_info?: {
    search_volume?: unknown;
    monthly_searches?: unknown;
  };
}

/** DataForSEO 月搜索量历史（用于季节 YoY；月均 + 逐月明细）。 */
export interface DataForSeoVolumeHistory {
  keyword: string;
  /** 月均搜索量（绝对值，付费数据）；null = 无数据/未配置凭证 */
  volume: number | null;
  /** 逐月搜索量（有则用于算去年同期 YoY；缺则为空） */
  monthly: Array<{ year: number; month: number; volume: number }>;
}

interface KeywordSuggestionItem {
  keyword?: unknown;
  keyword_info?: { search_volume?: unknown };
}

export class DataForSeoProvider implements TrafficProvider {
  readonly name = "dataforseo" as const;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  private async getCredentials(): Promise<{
    login: string;
    password: string;
  } | null> {
    const login = await readEncryptedTrafficSetting(
      this.prisma,
      DATAFORSEO_LOGIN_SETTING
    );
    const password = await readEncryptedTrafficSetting(
      this.prisma,
      DATAFORSEO_PASSWORD_SETTING
    );
    if (!login || !password) return null;
    return { login, password };
  }

  async getMonthlyVisits(_domain: string): Promise<number | null> {
    void _domain;
    return null;
  }

  /**
   * 长尾词候选（付费）：Labs `google/keyword_suggestions/live`。
   * 返回种子词的相关/长尾建议，带月均搜索量；失败 → []，绝不抛错。
   */
  async getKeywordSuggestions(
    seed: string
  ): Promise<Array<{ keyword: string; volume: number | null }>> {
    const kw = seed.trim();
    const creds = await this.getCredentials();
    if (!creds || !kw) return [];
    try {
      const auth = Buffer.from(`${creds.login}:${creds.password}`).toString(
        "base64"
      );
      const res = await this.fetchImpl(KEYWORD_SUGGESTIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          {
            keyword: kw,
            location_code: 2840,
            language_code: "en",
            include_seed_keyword: false,
            limit: 50,
          },
        ]),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as {
        tasks?: Array<{ result?: Array<{ items?: KeywordSuggestionItem[] }> }>;
      };
      const items =
        data?.tasks?.[0]?.result?.[0]?.items ??
        ([] as KeywordSuggestionItem[]);
      const out: Array<{ keyword: string; volume: number | null }> = [];
      const seen = new Set<string>();
      for (const item of items) {
        if (typeof item?.keyword !== "string") continue;
        const keyword = item.keyword.trim();
        const key = keyword.toLowerCase();
        if (!keyword || seen.has(key)) continue;
        seen.add(key);
        const raw = item.keyword_info?.search_volume;
        out.push({
          keyword,
          volume: typeof raw === "number" && Number.isFinite(raw) ? raw : null,
        });
      }
      return out;
    } catch {
      return [];
    }
  }

  async getKeywordVolume(
    keywords: string[]
  ): Promise<Array<{ keyword: string; volume: number | null }>> {
    const history = await this.getKeywordVolumeHistory(keywords);
    return history.map(({ keyword, volume }) => ({ keyword, volume }));
  }

  /**
   * 月搜索量（绝对值，付费）+ 逐月明细（用于季节 YoY）。
   * 按国家：传 location_name（国家名，如 "United Kingdom"），不用数字 code，零错配。
   * DataForSEO 文档：historical_search_volume 接受 location_name 或 location_code 二选一。
   * 无凭证 / 请求失败 / 无数据 → volume null、monthly []，绝不抛错。
   */
  async getKeywordVolumeHistory(
    keywords: string[],
    locationName = "United States",
    languageCode = "en"
  ): Promise<DataForSeoVolumeHistory[]> {
    const kws = keywords.map((k) => k.trim()).filter(Boolean);
    const creds = await this.getCredentials();
    if (!creds || kws.length === 0) {
      return keywords.map((keyword) => ({ keyword, volume: null, monthly: [] }));
    }
    try {
      const auth = Buffer.from(`${creds.login}:${creds.password}`).toString(
        "base64"
      );
      const res = await this.fetchImpl(HISTORICAL_SEARCH_VOLUME_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          {
            keywords: kws,
            location_name: locationName,
            language_code: languageCode,
          },
        ]),
      });
      if (!res.ok) {
        return kws.map((keyword) => ({ keyword, volume: null, monthly: [] }));
      }
      const data = (await res.json()) as {
        tasks?: Array<{ result?: Array<{ items?: HistoricalSearchVolumeItem[] }> }>;
      };
      const items =
        data?.tasks?.[0]?.result?.[0]?.items ??
        ([] as HistoricalSearchVolumeItem[]);
      const byKeyword = new Map<string, HistoricalSearchVolumeItem>();
      for (const item of items) {
        if (typeof item?.keyword === "string") {
          byKeyword.set(item.keyword.toLowerCase(), item);
        }
      }
      return kws.map((keyword) => {
        const info = byKeyword.get(keyword.toLowerCase())?.keyword_info;
        const raw = info?.search_volume;
        const volume =
          typeof raw === "number" && Number.isFinite(raw) ? raw : null;
        const monthly: DataForSeoVolumeHistory["monthly"] = [];
        const rawMonthly = info?.monthly_searches;
        if (Array.isArray(rawMonthly)) {
          for (const m of rawMonthly) {
            const entry = m as { year?: unknown; month?: unknown; search_volume?: unknown };
            const year = Number(entry?.year);
            const month = Number(entry?.month);
            const v = Number(entry?.search_volume);
            if (
              Number.isInteger(year) &&
              Number.isInteger(month) &&
              month >= 1 &&
              month <= 12 &&
              Number.isFinite(v)
            ) {
              monthly.push({ year, month, volume: v });
            }
          }
        }
        return { keyword, volume, monthly };
      });
    } catch {
      return kws.map((keyword) => ({ keyword, volume: null, monthly: [] }));
    }
  }
}
