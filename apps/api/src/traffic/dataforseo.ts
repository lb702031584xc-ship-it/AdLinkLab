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
  keyword_info?: { search_volume?: unknown };
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
    const kws = keywords.map((k) => k.trim()).filter(Boolean);
    const creds = await this.getCredentials();
    if (!creds || kws.length === 0) {
      return keywords.map((keyword) => ({ keyword, volume: null }));
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
          { keywords: kws, location_code: 2840, language_code: "en" },
        ]),
      });
      if (!res.ok) {
        return kws.map((keyword) => ({ keyword, volume: null }));
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
        const raw = byKeyword.get(keyword.toLowerCase())?.keyword_info
          ?.search_volume;
        const volume =
          typeof raw === "number" && Number.isFinite(raw) ? raw : null;
        return { keyword, volume };
      });
    } catch {
      return kws.map((keyword) => ({ keyword, volume: null }));
    }
  }
}
