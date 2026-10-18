/**
 * 流量需求门阈值管理 + 通用流量门评估 API。
 *
 * - GET /api/v1/traffic/thresholds — 当前阈值（含默认值合并）
 * - PUT /api/v1/traffic/thresholds — 更新阈值（部分字段）
 * - POST /api/v1/traffic/gate — 通用流量门评估（brand/domain/keywords 三选一）
 * - POST /api/v1/traffic/seasonality — 季节选品：按国家查关键词季节信号 + 节日窗口
 *
 * 阈值是全局 AiSetting（key: traffic.thresholds），沿用 amazon.paapiEnc
 * 全局键的一致性，不做 tenant 隔离；但仍需 session 认证。
 * /gate 按 tenant 限流 20 次/分钟（Redis；Redis 不可用时 fail-open）。
 */
import { Redis } from "ioredis";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { AppError, UnauthorizedError, ValidationError } from "@adlinklab/shared";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import {
  getTrafficThresholds,
  saveTrafficThresholds,
} from "../traffic/thresholds.js";
import { evaluateTrafficGate } from "../traffic/gate.js";
import type { TrafficThresholds } from "../traffic/types.js";
import { getKeywordTimeline } from "../traffic/trends.js";
import {
  analyzeSeasonality,
  computeVolumeYoy,
  getSeasonalWindows,
  seasonalCountry,
  seasonalScore,
  SEASONAL_COUNTRIES,
  type SeasonalSignal,
  type SeasonalWindow,
} from "../traffic/seasonality.js";
import {
  DataForSeoProvider,
  type DataForSeoVolumeHistory,
} from "../traffic/dataforseo.js";

/** 限流用 Redis 最小接口（ioredis 的 Redis 满足该结构；测试可注入 mock）。 */
export interface GateRateLimitRedis {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

interface Deps {
  prisma: PrismaClient;
  /** 注入式 Redis（测试用）；生产缺省时按需懒建共享连接。 */
  redis?: GateRateLimitRedis;
}

async function requireSession(
  deps: Deps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) {
    throw new UnauthorizedError("Authentication required");
  }
  return info;
}

const num = (v: unknown, name: string): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new ValidationError(`${name} 必须是数字`);
  }
  return n;
};

/** 校验 PUT body：各字段可选，提供时 officialSiteMonthlyVisits 为正数、heat 类 0-100 */
function validateThresholdPatch(body: unknown): Partial<TrafficThresholds> {
  const o = (body ?? {}) as Record<string, unknown>;
  const patch: Partial<TrafficThresholds> = {};

  const visits = num(o.officialSiteMonthlyVisits, "officialSiteMonthlyVisits");
  if (visits !== undefined) {
    if (visits <= 0) {
      throw new ValidationError("officialSiteMonthlyVisits 必须为正数");
    }
    patch.officialSiteMonthlyVisits = visits;
  }

  for (const name of ["brandInterest", "keywordInterest"] as const) {
    const heat = num(o[name], name);
    if (heat !== undefined) {
      if (heat < 0 || heat > 100) {
        throw new ValidationError(`${name} 必须在 0-100 之间`);
      }
      patch[name] = heat;
    }
  }

  if (Object.keys(patch).length === 0) {
    throw new ValidationError("至少提供一个阈值字段");
  }
  return patch;
}

/** /gate 入参校验与归一化。 */
function validateGateInput(body: unknown): {
  brand: string | null;
  title: string | null;
  domain: string | null;
  keywords: string[];
  geo: string;
  manualMonthlyVisits: number | null;
} {
  const o = (body ?? {}) as Record<string, unknown>;
  const optString = (v: unknown, name: string): string | null => {
    if (v === undefined || v === null) return null;
    if (typeof v !== "string") {
      throw new ValidationError(`${name} 必须是字符串`);
    }
    const t = v.trim();
    return t ? t : null;
  };
  const brand = optString(o.brand, "brand");
  const title = optString(o.title, "title");
  const domain = optString(o.domain, "domain");

  let keywords: string[] = [];
  if (o.keywords !== undefined && o.keywords !== null) {
    if (!Array.isArray(o.keywords)) {
      throw new ValidationError("keywords 必须是字符串数组");
    }
    keywords = (o.keywords as unknown[]).map((k, i) => {
      if (typeof k !== "string" || !k.trim()) {
        throw new ValidationError(`keywords[${i}] 必须是非空字符串`);
      }
      return k.trim();
    });
    if (keywords.length > 5) {
      throw new ValidationError("keywords 最多 5 个");
    }
  }

  // 手动输入月访问量：正整数，上限 1e12；非法值直接 400。
  let manualMonthlyVisits: number | null = null;
  const mv = o.manualMonthlyVisits;
  if (mv !== undefined && mv !== null && mv !== "") {
    const n = Number(mv);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > 1e12) {
      throw new ValidationError("manualMonthlyVisits 必须是 1~1000000000000 的正整数");
    }
    manualMonthlyVisits = n;
  }

  if (!brand && !title && !domain && keywords.length === 0 && manualMonthlyVisits === null) {
    throw new ValidationError("brand、title、domain、keywords、manualMonthlyVisits 至少提供一个");
  }
  return { brand, title, domain, keywords, geo: optString(o.geo, "geo") ?? "US", manualMonthlyVisits };
}

/** /gate 限流：20 次/分钟/tenant。 */
const GATE_RATE_LIMIT_PER_MINUTE = 20;

/**
 * 生产环境共享 Redis（懒建）。连接失败不抛错、不自动重连：
 * 首次失败即断开并标记不可用，后续请求直接 fail-open，避免重试风暴。
 */
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
    // 限流是旁路能力：连接错误静默，fail-open，不让进程崩溃。
    client.on("error", () => undefined);
    sharedRedis = client;
    return client;
  } catch {
    sharedRedisBroken = true;
    return null;
  }
}

function minuteStamp(now: Date = new Date()): string {
  return now.toISOString().slice(0, 16).replace(/[-T:]/g, "");
}

/**
 * 检查 /gate 频率。返回 true=放行，false=超限。
 * Redis 不可用（未注入且懒建失败，或命令异常）→ fail-open 直接放行，绝不抛错。
 */
async function checkGateRateLimit(
  redis: GateRateLimitRedis | undefined,
  tenantId: string
): Promise<boolean> {
  const client = redis ?? getSharedRedis();
  if (!client) return true;
  const ownedShared = !redis;
  try {
    const key = `traffic:ratelimit:${tenantId}:${minuteStamp()}`;
    const count = await client.incr(key);
    if (count === 1) {
      try {
        await client.expire(key, 120);
      } catch {
        // 忽略过期设置失败
      }
    }
    return count <= GATE_RATE_LIMIT_PER_MINUTE;
  } catch {
    if (ownedShared) {
      // 共享连接已坏：断开并标记，后续直接 fail-open
      sharedRedisBroken = true;
      try {
        (client as Redis).disconnect();
      } catch {
        // 忽略断开异常
      }
      sharedRedis = null;
    }
    return true;
  }
}

export function registerTrafficRoutes(
  app: FastifyInstance,
  deps: Deps
): void {
  const { prisma } = deps;

  /** 当前阈值（存储值与默认值合并） */
  app.get("/api/v1/traffic/thresholds", async (request) => {
    await requireSession(deps, request);
    const thresholds = await getTrafficThresholds(prisma);
    return { thresholds };
  });

  /** 更新阈值（部分字段，未提供的字段保持原值） */
  app.put<{
    Body: {
      officialSiteMonthlyVisits?: unknown;
      brandInterest?: unknown;
      keywordInterest?: unknown;
    };
  }>("/api/v1/traffic/thresholds", async (request) => {
    await requireSession(deps, request);
    const patch = validateThresholdPatch(request.body ?? {});
    const current = await getTrafficThresholds(prisma);
    const thresholds = await saveTrafficThresholds(prisma, {
      ...current,
      ...patch,
    });
    return { thresholds };
  });

  /**
   * 通用流量门评估。
   * 入参 { brand?, domain?, keywords?, geo? }（geo 默认 'US'；keywords 最多 5 个；
   * brand/domain/keywords 至少填一个）。出参与 discovery 共用 TrafficGateResult 结构。
   */
  app.post<{
    Body: {
      brand?: unknown;
      title?: unknown;
      domain?: unknown;
      keywords?: unknown;
      geo?: unknown;
      manualMonthlyVisits?: unknown;
    };
  }>("/api/v1/traffic/gate", async (request) => {
    const info = await requireSession(deps, request);
    const input = validateGateInput(request.body ?? {});
    const allowed = await checkGateRateLimit(deps.redis, info.tenantId);
    if (!allowed) {
      throw new AppError("流量门评估频率超限（20 次/分钟），请稍后再试", {
        code: "RATE_LIMITED",
        statusCode: 429,
      });
    }
    const thresholds = await getTrafficThresholds(prisma);
    return evaluateTrafficGate({
      brand: input.brand,
      title: input.title ?? "",
      keywords: input.keywords,
      thresholds,
      prisma,
      domain: input.domain,
      geo: input.geo,
      manualMonthlyVisits: input.manualMonthlyVisits,
    });
  });

  /**
   * 季节选品（按国家）。
   * 入参 { keywords?: string[]（0-10 个）, country?: string（默认 US）, leadDays?: number（默认 14） }。
   * 每词返回：Trends 时间线算出的季节信号 + DataForSEO 绝对月搜索量（付费，未配置 → null）。
   * 顶层返回该国未来 60 天节日/季节窗口。keywords 为空时只返回窗口（不调外部接口，不花钱）。
   * Trends 被限流时该词 rateLimited=true，信号为 insufficient，其余词不受影响；DataForSEO 失败时 volume=null。
   */
  app.post<{
    Body: {
      keywords?: unknown;
      country?: unknown;
      leadDays?: unknown;
    };
  }>("/api/v1/traffic/seasonality", async (request) => {
    const info = await requireSession(deps, request);
    const allowed = await checkGateRateLimit(deps.redis, info.tenantId);
    if (!allowed) {
      throw new AppError("季节查询频率超限（20 次/分钟），请稍后再试", {
        code: "RATE_LIMITED",
        statusCode: 429,
      });
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const country =
      seasonalCountry(typeof body.country === "string" ? body.country : "") ??
      SEASONAL_COUNTRIES[0]!;
    const leadDaysRaw = Number(body.leadDays);
    const leadDays =
      Number.isFinite(leadDaysRaw) && leadDaysRaw >= 1 && leadDaysRaw <= 60
        ? Math.floor(leadDaysRaw)
        : 14;
    const nowMs = Date.now();
    const windows: SeasonalWindow[] = getSeasonalWindows(country.code, nowMs, 60);

    const rawKeywords = body.keywords;
    const keywords = (
      Array.isArray(rawKeywords) ? rawKeywords : []
    )
      .map((k) => (typeof k === "string" ? k.trim() : ""))
      .filter(Boolean)
      .slice(0, 10);
    if (keywords.length === 0) {
      return { country: country.code, windows, results: [] };
    }

    // DataForSEO：一次批量查全部词（按国家名，未配置凭证 → 全部 null）。
    const provider = new DataForSeoProvider(prisma);
    const volumeHistory: DataForSeoVolumeHistory[] =
      await provider.getKeywordVolumeHistory(
        keywords,
        country.dataforseoLocation,
        country.languageCode
      );
    const volumeByKeyword = new Map(
      volumeHistory.map((v) => [v.keyword.toLowerCase(), v])
    );

    const results = await Promise.all(
      keywords.map(async (keyword) => {
        const timeline = await getKeywordTimeline(keyword, country.code);
        const signal: SeasonalSignal = analyzeSeasonality(
          timeline.points,
          nowMs,
          leadDays
        );
        const vol = volumeByKeyword.get(keyword.toLowerCase());
        const volumeYoyPct = computeVolumeYoy(vol?.monthly ?? [], nowMs);
        return {
          keyword,
          country: country.code,
          trendsRateLimited: timeline.rateLimited,
          timeline: timeline.points,
          signal,
          volume: vol?.volume ?? null,
          volumeYoyPct,
          /** 季节评分（代码按实测信号算，透明分项，不经过 LLM）。 */
          score: seasonalScore(signal, volumeYoyPct, leadDays),
        };
      })
    );
    return { country: country.code, windows, results };
  });
}
