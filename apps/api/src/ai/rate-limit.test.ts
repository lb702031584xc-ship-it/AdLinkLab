/**
 * P1-19：每租户 AI 限流 — 固定窗口计数 + fail-open（fake Redis）。
 */
import { describe, expect, it } from "vitest";
import {
  AI_RATE_LIMIT_PER_MINUTE,
  checkAiRateLimit,
} from "./rate-limit.js";

class FakeRedis {
  counts = new Map<string, number>();
  async incr(key: string): Promise<number> {
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next;
  }
  async expire(): Promise<unknown> {
    return 1;
  }
  async ttl(): Promise<number> {
    return 42;
  }
}

class FailingRedis {
  async incr(): Promise<number> {
    throw new Error("redis down");
  }
  async expire(): Promise<unknown> {
    throw new Error("redis down");
  }
  async ttl(): Promise<number> {
    throw new Error("redis down");
  }
}

describe("P1-19 checkAiRateLimit", () => {
  it("allows up to 20/min per tenant, then 429 with Retry-After", async () => {
    const redis = new FakeRedis();
    for (let i = 0; i < AI_RATE_LIMIT_PER_MINUTE; i++) {
      expect((await checkAiRateLimit("t1", { redis })).allowed).toBe(true);
    }
    const over = await checkAiRateLimit("t1", { redis });
    expect(over.allowed).toBe(false);
    expect(over.retryAfterSeconds).toBe(42);
    // 另一租户不受影响。
    expect((await checkAiRateLimit("t2", { redis })).allowed).toBe(true);
  });

  it("fails open when Redis is down or unconfigured", async () => {
    expect(
      (await checkAiRateLimit("t1", { redis: new FailingRedis() })).allowed
    ).toBe(true);
    expect((await checkAiRateLimit("t1", { redis: null })).allowed).toBe(true);
  });
});
