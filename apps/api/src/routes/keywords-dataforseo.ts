/**
 * DataForSEO 关键词流水线（/keywords/starter 实测扩词 → 筛选 → 广告测算）。
 *
 * 省钱口径（用户拍板）：付费调用只发生在流水线两端——
 * ① 扩词（Labs Related Keywords，按返回条数计费，上限参数就是计费阀门）；
 * ② 筛选阶段唯一允许的付费调用 = 意图过滤（只对前几轮幸存词调 Search Intent）；
 * ③ 广告测算（Keywords Data + Labs Overview）必须先过人工勾选，服务端对
 *    空关键词列表直接拒绝，绝不为没勾的词花钱。
 *
 * - POST /api/v1/keywords/expand        种子词 → 长尾候选（14 天 Redis 缓存）
 * - POST /api/v1/keywords/intent-filter 一批词 → 购买意图（失败 fail-soft）
 * - POST /api/v1/keywords/ad-measure    勾选词 → 搜索量/CPC/页首出价区间（估算，仅展示）
 *
 * 测算结果硬隔离：只回给前端展示，绝不写入出价公式、投流快照或任何 bid
 * 字段（出价唯一来源是 profit-calc，先例 bcf16d95）。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Redis } from "ioredis";
import type { PrismaClient } from "@adlinklab/database";
import {
  AppError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import {
  DataForSeoKeywordService,
  DataForSeoKeywordsError,
  type DfsAdsVolumeRow,
  type DfsRelatedCandidate,
} from "../services/dataforseo-keywords.js";

/* 参数默认值与范围（用户拍板口径，输入框旁有推荐值标注） */
export const EXPAND_LIMIT_DEFAULT = 100; // 每种子候选上限（Labs 按条计费阀门）
export const EXPAND_LIMIT_MIN = 10;
export const EXPAND_LIMIT_MAX = 200;
export const MEASURE_LIMIT_DEFAULT = 20; // 测算返回条数（推荐 10–30）
export const MEASURE_LIMIT_MIN = 5;
export const MEASURE_LIMIT_MAX = 100;
export const DEFAULT_LOCATION_CODE = 2840; // 美国
export const DEFAULT_LANGUAGE_CODE = "en";
export const INTENT_KEYWORD_MAX = 1000; // Search Intent 单次上限
export const MEASURE_KEYWORD_MAX = 1000; // Keywords Data 单任务上限

/** 扩词缓存 TTL：14 天（沿用品牌广告数 AD_COUNT_CACHE_TTL 的站内口径）。 */
export const EXPAND_CACHE_TTL_SECONDS = 14 * 24 * 3600;

export interface ExpandCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export interface KeywordDataForSeoRouteDeps {
  prisma: PrismaClient;
  fetchImpl?: typeof fetch;
  /** 不传 = 用共享 Redis（fail-open）；传 null = 禁用缓存（测试用）。 */
  cache?: ExpandCache | null;
}

/* ------------------------------------------------------------------ */
/* 共享 Redis（懒建；失败 fail-open），与 amazon-trends.ts 相同策略。      */
/* ------------------------------------------------------------------ */
let sharedRedis: Redis | null = null;
let sharedRedisBroken = false;

function getSharedRedis(): Redis | null {
  if (sharedRedisBroken) return null;
  if (sharedRedis) return sharedRedis;
  try {
    const client = new Redis(
      process.env.REDIS_URL ?? "redis://localhost:6379",
      {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
      }
    );
    client.on("error", () => undefined);
    sharedRedis = client;
    return client;
  } catch {
    sharedRedisBroken = true;
    return null;
  }
}

const redisExpandCache: ExpandCache = {
  async get(key) {
    const client = getSharedRedis();
    if (!client) return null;
    try {
      return await client.get(key);
    } catch {
      return null;
    }
  },
  async set(key, value, ttlSeconds) {
    const client = getSharedRedis();
    if (!client) return;
    try {
      await client.set(key, value, "EX", ttlSeconds);
    } catch {
      // 缓存写入失败不阻塞主流程
    }
  },
};

/* ------------------------------------------------------------------ */
/* 参数解析（默认值口径集中在这里，测试直接断言）                          */
/* ------------------------------------------------------------------ */

function asTrimmedString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function parseLimit(
  v: unknown,
  field: string,
  def: number,
  min: number,
  max: number
): number {
  if (v === undefined || v === null) return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ValidationError(
      `${field} must be an integer between ${min} and ${max}`
    );
  }
  return n;
}

function parseLocationCode(v: unknown): number {
  if (v === undefined || v === null) return DEFAULT_LOCATION_CODE;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ValidationError("locationCode must be a positive integer");
  }
  return n;
}

function parseLanguageCode(v: unknown): string {
  if (v === undefined || v === null) return DEFAULT_LANGUAGE_CODE;
  const s = asTrimmedString(v).toLowerCase();
  if (!s || s.length > 10) {
    throw new ValidationError("languageCode must be a non-empty string");
  }
  return s;
}

function parseKeywords(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) {
    throw new ValidationError("keywords must be a non-empty array");
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    const kw = asTrimmedString(item);
    if (!kw) continue;
    const key = kw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(kw);
  }
  if (out.length === 0) {
    throw new ValidationError("keywords must be a non-empty array");
  }
  if (out.length > max) {
    throw new ValidationError(`keywords accepts at most ${max} items`);
  }
  return out;
}

async function requireSession(
  deps: KeywordDataForSeoRouteDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) throw new UnauthorizedError("Authentication required");
  return info;
}

/** 服务层错误 → HTTP 错误（未配置 400，其余 502，透出 status_message）。 */
function toHttpError(e: unknown): unknown {
  if (e instanceof DataForSeoKeywordsError) {
    return new AppError(e.message, {
      code: e.code,
      statusCode: e.statusCode,
    });
  }
  return e;
}

export async function registerKeywordDataForSeoRoutes(
  app: FastifyInstance,
  deps: KeywordDataForSeoRouteDeps
): Promise<void> {
  const cache: ExpandCache | null =
    deps.cache === undefined ? redisExpandCache : deps.cache;
  const newService = () =>
    new DataForSeoKeywordService(deps.prisma, deps.fetchImpl ?? fetch);

  /**
   * ① 长尾扩词（实测数据）：种子词 → Labs Related Keywords 候选。
   * limit 是计费阀门（Labs 按条收费），默认 100（10–200）。
   * 同（种子+国家+语言+上限）14 天内走缓存，不重复花钱。
   */
  app.post<{ Body: Record<string, unknown> }>(
    "/api/v1/keywords/expand",
    async (request) => {
      await requireSession(deps, request);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const seed = asTrimmedString(body.seed);
      if (!seed || seed.length < 2 || seed.length > 100) {
        throw new ValidationError("seed must be 2-100 characters");
      }
      const locationCode = parseLocationCode(body.locationCode);
      const languageCode = parseLanguageCode(body.languageCode);
      const limit = parseLimit(
        body.limit,
        "limit",
        EXPAND_LIMIT_DEFAULT,
        EXPAND_LIMIT_MIN,
        EXPAND_LIMIT_MAX
      );

      const cacheKey = `dfs:related:v1:${locationCode}:${languageCode}:${limit}:${seed.toLowerCase()}`;
      if (cache) {
        const hit = await cache.get(cacheKey);
        if (hit) {
          try {
            const parsed = JSON.parse(hit) as { candidates?: unknown };
            if (Array.isArray(parsed.candidates)) {
              return {
                seed,
                locationCode,
                languageCode,
                limit,
                candidates: parsed.candidates,
                total: parsed.candidates.length,
                cached: true,
              };
            }
          } catch {
            // 缓存损坏 → 当未命中，重新调 API
          }
        }
      }

      let candidates: DfsRelatedCandidate[];
      try {
        candidates = await newService().getRelatedKeywords({
          seed,
          locationCode,
          languageCode,
          limit,
        });
      } catch (e) {
        throw toHttpError(e);
      }
      if (cache) {
        await cache.set(
          cacheKey,
          JSON.stringify({ candidates }),
          EXPAND_CACHE_TTL_SECONDS
        );
      }
      return {
        seed,
        locationCode,
        languageCode,
        limit,
        candidates,
        total: candidates.length,
        cached: false,
      };
    }
  );

  /**
   * ② 购买意图过滤（筛选阶段唯一允许的付费调用，只对幸存词调）。
   * fail-soft：DataForSEO 失败/未配置 → 200 + verified=false + 意图全 null，
   * 调用方保留词并标注"意图未验证"，绝不整步报错丢词。
   */
  app.post<{ Body: Record<string, unknown> }>(
    "/api/v1/keywords/intent-filter",
    async (request) => {
      await requireSession(deps, request);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const keywords = parseKeywords(body.keywords, INTENT_KEYWORD_MAX);
      const locationCode = parseLocationCode(body.locationCode);
      const languageCode = parseLanguageCode(body.languageCode);
      const unverified = (extra: Record<string, unknown>) => ({
        verified: false,
        results: keywords.map((keyword) => ({
          keyword,
          intent: null,
          probability: null,
        })),
        ...extra,
      });
      try {
        const results = await newService().getSearchIntents({
          keywords,
          locationCode,
          languageCode,
        });
        const byKey = new Map(
          results.map((r) => [r.keyword.toLowerCase(), r])
        );
        return {
          verified: true,
          results: keywords.map((keyword) => {
            const hit = byKey.get(keyword.toLowerCase());
            return {
              keyword,
              intent: hit?.intent ?? null,
              probability: hit?.probability ?? null,
            };
          }),
        };
      } catch (e) {
        if (
          e instanceof DataForSeoKeywordsError &&
          e.code === "DATAFORSEO_NOT_CONFIGURED"
        ) {
          return unverified({ configured: false, error: e.message });
        }
        const message =
          e instanceof Error ? e.message : "DataForSEO intent request failed";
        return unverified({ configured: true, error: message });
      }
    }
  );

  /**
   * ③ 广告测算（出价参考）：只对人工勾选的词调。
   * 服务端硬门：keywords 为空直接 400 拒绝（不能只靠前端禁用按钮）。
   * Keywords Data 打包一任务拿搜索量/竞争指数/页首出价区间；CPC 由 Labs
   * Keyword Overview 补（Keywords Data 无 cpc 字段；Overview 失败则 cpc 留
   * null，不许整表失败）。结果按搜索量降序取前 limit 条。
   * ⚠️ 结果仅供展示（估算），绝不写入出价公式/快照/bid 字段。
   */
  app.post<{ Body: Record<string, unknown> }>(
    "/api/v1/keywords/ad-measure",
    async (request) => {
      await requireSession(deps, request);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const keywords = parseKeywords(body.keywords, MEASURE_KEYWORD_MAX);
      const locationCode = parseLocationCode(body.locationCode);
      const languageCode = parseLanguageCode(body.languageCode);
      const limit = parseLimit(
        body.limit,
        "limit",
        MEASURE_LIMIT_DEFAULT,
        MEASURE_LIMIT_MIN,
        MEASURE_LIMIT_MAX
      );

      let volumeRows: DfsAdsVolumeRow[];
      try {
        volumeRows = await newService().getAdsSearchVolume({
          keywords,
          locationCode,
          languageCode,
        });
      } catch (e) {
        throw toHttpError(e);
      }

      let cpcByKeyword = new Map<string, number>();
      try {
        cpcByKeyword = await newService().getKeywordOverviewCpc({
          keywords,
          locationCode,
          languageCode,
        });
      } catch {
        // CPC 补数失败 fail-soft：cpc 显示未知，不丢整表结果。
        cpcByKeyword = new Map();
      }

      const byKey = new Map(
        volumeRows.map((r) => [r.keyword.toLowerCase(), r])
      );
      const merged = keywords.map((keyword) => {
        const row = byKey.get(keyword.toLowerCase());
        return {
          keyword,
          searchVolume: row?.searchVolume ?? null,
          cpc: cpcByKeyword.get(keyword.toLowerCase()) ?? null,
          competition: row?.competition ?? null,
          competitionIndex: row?.competitionIndex ?? null,
          lowTopBid: row?.lowTopBid ?? null,
          highTopBid: row?.highTopBid ?? null,
        };
      });
      // 搜索量降序；无搜索量（未知）排最后，不拿 0 冒充。
      merged.sort((a, b) => {
        if (a.searchVolume === null && b.searchVolume === null) return 0;
        if (a.searchVolume === null) return 1;
        if (b.searchVolume === null) return -1;
        return b.searchVolume - a.searchVolume;
      });
      const rows = merged.slice(0, limit);
      return {
        rows,
        total: rows.length,
        requestedCount: keywords.length,
        limit,
        estimate: true,
        measuredAt: new Date().toISOString(),
      };
    }
  );
}
