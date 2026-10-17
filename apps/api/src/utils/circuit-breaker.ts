/**
 * P2-10 — 熔断器（纯类；调用保护，绝不暂停广告）。
 *
 * 规则（本文件唯一口径；培训站用 half-open 3，本项目用 half-open 探针 1）：
 * - 连续失败 ≥5 次 且 失败率 ≥50% → 熔断打开（OPEN）30 秒。
 * - OPEN 期间调用直接抛 CircuitBreakerOpenError，不触碰下游。
 * - 30 秒后进入 HALF_OPEN：放行 1 个探针；探针成功 → 关闭（CLOSED），
 *   失败 → 重新打开（OPEN）30 秒。
 * - 失败率按最近窗口统计（默认最近 20 次调用；窗口未满时只看连续失败数）。
 */
export class CircuitBreakerOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker OPEN for ${name}: downstream call skipped`);
    this.name = "CircuitBreakerOpenError";
  }
}

export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  /** 连续失败阈值（默认 5）。 */
  consecutiveFailureThreshold?: number;
  /** 失败率阈值 0..1（默认 0.5）。 */
  failureRateThreshold?: number;
  /** OPEN 持续毫秒（默认 30_000）。 */
  openDurationMs?: number;
  /** 失败率统计窗口（默认 20）。 */
  windowSize?: number;
  /** 可注入时钟（测试）。 */
  now?: () => number;
}

export class CircuitBreaker {
  private readonly name: string;
  private readonly consecutiveFailureThreshold: number;
  private readonly failureRateThreshold: number;
  private readonly openDurationMs: number;
  private readonly windowSize: number;
  private readonly now: () => number;

  private state: CircuitBreakerState = "CLOSED";
  private consecutiveFailures = 0;
  private outcomes: boolean[] = []; // true = 成功，false = 失败（最近 windowSize 次）
  private openedAt: number | null = null;
  private halfOpenProbeInFlight = false;

  constructor(name: string, opts: CircuitBreakerOptions = {}) {
    this.name = name;
    this.consecutiveFailureThreshold = opts.consecutiveFailureThreshold ?? 5;
    this.failureRateThreshold = opts.failureRateThreshold ?? 0.5;
    this.openDurationMs = opts.openDurationMs ?? 30_000;
    this.windowSize = opts.windowSize ?? 20;
    this.now = opts.now ?? Date.now;
  }

  getState(): CircuitBreakerState {
    if (this.state === "OPEN" && this.openedAt !== null) {
      if (this.now() - this.openedAt >= this.openDurationMs) {
        this.state = "HALF_OPEN";
      }
    }
    return this.state;
  }

  /** 调用前检查：OPEN → 抛错；HALF_OPEN 探针占用中 → 抛错；否则放行。 */
  acquire(): void {
    const state = this.getState();
    if (state === "OPEN") throw new CircuitBreakerOpenError(this.name);
    if (state === "HALF_OPEN") {
      if (this.halfOpenProbeInFlight) {
        throw new CircuitBreakerOpenError(this.name);
      }
      this.halfOpenProbeInFlight = true;
    }
  }

  private record(success: boolean): void {
    this.outcomes.push(success);
    if (this.outcomes.length > this.windowSize) this.outcomes.shift();
    if (success) {
      this.consecutiveFailures = 0;
      if (this.state === "HALF_OPEN") {
        // 探针成功 → 关闭。
        this.state = "CLOSED";
        this.halfOpenProbeInFlight = false;
        this.openedAt = null;
      }
      return;
    }
    this.consecutiveFailures += 1;
    if (this.state === "HALF_OPEN") {
      // 探针失败 → 重新打开。
      this.state = "OPEN";
      this.openedAt = this.now();
      this.halfOpenProbeInFlight = false;
      return;
    }
    const failures = this.outcomes.filter((o) => !o).length;
    const rate = this.outcomes.length > 0 ? failures / this.outcomes.length : 0;
    if (
      this.consecutiveFailures >= this.consecutiveFailureThreshold &&
      rate >= this.failureRateThreshold
    ) {
      this.state = "OPEN";
      this.openedAt = this.now();
    }
  }

  /**
   * 包装一次调用：acquire → 执行 → record。调用保护而已，
   * 绝不暂停广告、绝不改业务状态。
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.acquire();
    try {
      const out = await fn();
      this.record(true);
      return out;
    } catch (e) {
      // 熔断器自身的 OPEN 错误不计入失败统计（它不是下游失败）。
      if (!(e instanceof CircuitBreakerOpenError)) this.record(false);
      throw e;
    }
  }
}
