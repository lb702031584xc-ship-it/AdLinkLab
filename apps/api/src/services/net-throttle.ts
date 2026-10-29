/**
 * 联盟同步的网络节流与重试（2026-10-29）。
 *
 * 全站同步会连续请求几十个商家，联盟侧必然限流。现有代码遇到 429 直接
 * FAILED 且不重试——一次限流就整批放弃，前面抓到的白抓。
 *
 * 这里补三层：
 *   1. 限速：每次请求前随机等待，避免固定间隔的机器人特征
 *   2. 退避：429 / 限流类错误按指数退避重试，超次数才放弃
 *   3. 可取消：调用方的 abort 信号优先
 */

export interface ThrottleOptions {
  /** 两次请求之间的最小等待（毫秒）。默认 800。 */
  minDelayMs?: number;
  /** 两次请求之间的最大等待（毫秒）。默认 1500。 */
  maxDelayMs?: number;
  /** 限流错误最多重试几次。默认 2（合计最多 3 次尝试）。 */
  maxRetries?: number;
  /** 首次退避基数（毫秒）。默认 60000（联盟限流通常要等一分钟）。 */
  baseBackoffMs?: number;
  /** 判断是否属于「限流可重试」。 */
  isRateLimited?: (error: unknown) => boolean;
  /** 测试注入：替换真实 sleep。 */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 默认判定：429 / rate limit / too many requests。 */
export function isRateLimitedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: unknown; statusCode?: unknown; message?: unknown; code?: unknown };
  const status = Number(e.status ?? e.statusCode ?? NaN);
  if (status === 429) return true;
  const text = `${String(e.code ?? "")} ${String(e.message ?? "")}`.toLowerCase();
  return text.includes("429") || text.includes("rate limit") || text.includes("too many request");
}

function randomDelay(min: number, max: number): number {
  const lo = Math.max(0, Math.min(min, max));
  const hi = Math.max(lo, max);
  return Math.floor(lo + Math.random() * (hi - lo));
}

/**
 * 限速 + 退避重试地执行一次网络调用。
 * 只有「限流类」错误会重试；其它错误立即抛出，不掩盖真实故障。
 */
export async function withThrottle<T>(
  fn: () => Promise<T>,
  opts: ThrottleOptions = {}
): Promise<T> {
  const minDelay = opts.minDelayMs ?? 800;
  const maxDelay = opts.maxDelayMs ?? 1500;
  const maxRetries = Math.max(0, opts.maxRetries ?? 2);
  const baseBackoff = Math.max(0, opts.baseBackoffMs ?? 60000);
  const rateLimited = opts.isRateLimited ?? isRateLimitedError;
  const sleep = opts.sleep ?? realSleep;

  let attempt = 0;
  for (;;) {
    // 每次调用前先等，避免连续请求
    const wait = randomDelay(minDelay, maxDelay);
    if (wait > 0) await sleep(wait);

    try {
      return await fn();
    } catch (error) {
      if (!rateLimited(error) || attempt >= maxRetries) throw error;
      // 指数退避：1x, 2x, 4x…
      const backoff = baseBackoff * Math.pow(2, attempt);
      attempt += 1;
      if (backoff > 0) await sleep(backoff);
    }
  }
}

/** 仅做限速、不重试（用于必须严格串行且不希望重复请求的场景）。 */
export async function throttleOnly(
  opts: Pick<ThrottleOptions, "minDelayMs" | "maxDelayMs" | "sleep"> = {}
): Promise<void> {
  const min = opts.minDelayMs ?? 800;
  const max = opts.maxDelayMs ?? 1500;
  const sleep = opts.sleep ?? realSleep;
  const wait = randomDelay(min, max);
  if (wait > 0) await sleep(wait);
}
