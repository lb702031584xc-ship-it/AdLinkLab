/**
 * P1-19：每租户 AI 限流（Redis 固定窗口计数器）。
 *
 * - 20 次/分钟 + 200 次/天（每 tenantId），作用于 POST /api/v1/ai/*。
 * - 失败开放（fail-open）：Redis 不可用/未配置时绝不拦截业务；
 *   Redis 故障时只记 log，请求继续。
 * - 与 P0-6 成本配额是不同层：本层限速率（rate），P0-6 限成本/次数（quota）。
 * - 429 响应带 Retry-After（分钟窗口剩余秒数）。
 *
 * Redis 客户端：ioredis lazy client（同 token-revocation 模式），
 * 无 REDIS_URL 时整个限流器禁用（fail-open）。
 */
import { Redis } from "ioredis";

export const AI_RATE_LIMIT_PER_MINUTE = 20;
export const AI_RATE_LIMIT_PER_DAY = 200;

export interface AiRateLimitRedisLike {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
}

let sharedRedis: Redis | null | undefined;

function getSharedRedis(): Redis | null {
  if (sharedRedis !== undefined) return sharedRedis;
  const url = (process.env.REDIS_URL ?? "").trim();
  if (!url) {
    sharedRedis = null;
    return null;
  }
  try {
    const client = new Redis(url, {
      lazyConnect: true,
      enableReadyCheck: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    client.on("error", () => undefined);
    sharedRedis = client;
  } catch {
    sharedRedis = null;
  }
  return sharedRedis;
}

/**
 * 固定窗口计数：key 首次出现时设过期；返回 { allowed, retryAfterSeconds }。
 * Redis 故障 → { allowed: true }（fail-open）。
 */
export async function checkAiRateLimit(
  tenantId: string,
  deps: { redis?: AiRateLimitRedisLike | null; now?: Date } = {}
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const redis = deps.redis !== undefined ? deps.redis : getSharedRedis();
  if (!redis) return { allowed: true };
  const now = deps.now ?? new Date();
  try {
    const minuteKey = `ai-ratelimit:${tenantId}:min:${Math.floor(now.getTime() / 60000)}`;
    const dayKey = `ai-ratelimit:${tenantId}:day:${now.toISOString().slice(0, 10)}`;
    const [minCount, dayCount] = await Promise.all([
      redis.incr(minuteKey),
      redis.incr(dayKey),
    ]);
    // 首次计数时设过期（窗口长度 + 1s 余量）。
    if (minCount === 1) await redis.expire(minuteKey, 61);
    if (dayCount === 1) await redis.expire(dayKey, 86401);
    if (minCount > AI_RATE_LIMIT_PER_MINUTE) {
      const ttl = await redis.ttl(minuteKey);
      return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : 60 };
    }
    if (dayCount > AI_RATE_LIMIT_PER_DAY) {
      const ttl = await redis.ttl(dayKey);
      return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : 3600 };
    }
    return { allowed: true };
  } catch (e) {
    // Fail-open：Redis 故障绝不拦截业务。
    console.error("[ai-rate-limit] Redis failure, failing open", e);
    return { allowed: true };
  }
}
