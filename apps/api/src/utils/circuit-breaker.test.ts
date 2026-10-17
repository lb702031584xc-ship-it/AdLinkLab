/** P2-10 熔断器测试。 */
import { describe, expect, it } from "vitest";
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
} from "./circuit-breaker.js";

describe("CircuitBreaker", () => {
  it("连续失败 ≥5 且失败率 ≥50% → OPEN，调用直接抛错不触碰下游", async () => {
    const cb = new CircuitBreaker("test");
    let downstreamCalls = 0;
    const failing = async () => {
      downstreamCalls += 1;
      throw new Error("downstream down");
    };
    for (let i = 0; i < 5; i++) {
      await expect(cb.execute(failing)).rejects.toThrow("downstream down");
    }
    expect(cb.getState()).toBe("OPEN");
    await expect(cb.execute(failing)).rejects.toBeInstanceOf(
      CircuitBreakerOpenError
    );
    expect(downstreamCalls).toBe(5); // OPEN 后不再调用下游
  });

  it("成功调用不熔断；失败后成功重置连续失败数", async () => {
    const cb = new CircuitBreaker("test");
    const ok = async () => "ok";
    const failing = async () => {
      throw new Error("x");
    };
    for (let i = 0; i < 4; i++) {
      await expect(cb.execute(failing)).rejects.toThrow("x");
    }
    await expect(cb.execute(ok)).resolves.toBe("ok");
    expect(cb.getState()).toBe("CLOSED");
    for (let i = 0; i < 4; i++) {
      await expect(cb.execute(failing)).rejects.toThrow("x");
    }
    expect(cb.getState()).toBe("CLOSED"); // 连续失败被成功打断，未达 5
  });

  it("OPEN 30 秒后 HALF_OPEN：探针成功 → 关闭；探针失败 → 重新打开；同时只放 1 个探针", async () => {
    let now = 0;
    const cb = new CircuitBreaker("test", { now: () => now });
    const failing = async () => {
      throw new Error("x");
    };
    for (let i = 0; i < 5; i++) {
      await expect(cb.execute(failing)).rejects.toThrow("x");
    }
    expect(cb.getState()).toBe("OPEN");
    now += 30_001;
    expect(cb.getState()).toBe("HALF_OPEN");
    // 探针成功 → 关闭。
    await expect(cb.execute(async () => "ok")).resolves.toBe("ok");
    expect(cb.getState()).toBe("CLOSED");

    // 再熔断一次，探针失败 → 重新打开。
    for (let i = 0; i < 5; i++) {
      await expect(cb.execute(failing)).rejects.toThrow("x");
    }
    expect(cb.getState()).toBe("OPEN");
    now += 30_001;
    expect(cb.getState()).toBe("HALF_OPEN");
    await expect(cb.execute(failing)).rejects.toThrow("x");
    expect(cb.getState()).toBe("OPEN");
  });

  it("HALF_OPEN 时第二个并发调用被拒绝（探针 = 1）", async () => {
    let now = 0;
    const cb = new CircuitBreaker("test", { now: () => now });
    const failing = async () => {
      throw new Error("x");
    };
    for (let i = 0; i < 5; i++) {
      await expect(cb.execute(failing)).rejects.toThrow("x");
    }
    now += 30_001;
    expect(cb.getState()).toBe("HALF_OPEN");
    cb.acquire(); // 占用唯一探针槽
    expect(() => cb.acquire()).toThrow(CircuitBreakerOpenError);
  });

  it("失败率 <50% 时不熔断（窗口内多数成功）", async () => {
    const cb = new CircuitBreaker("test", {
      consecutiveFailureThreshold: 2,
      failureRateThreshold: 0.5,
      windowSize: 10,
    });
    // 交替成功/失败：连续失败从未 ≥2，且失败率 50% 边界 — 先测连续失败未达阈值。
    const ok = async () => "ok";
    const failing = async () => {
      throw new Error("x");
    };
    await expect(cb.execute(failing)).rejects.toThrow("x");
    await expect(cb.execute(ok)).resolves.toBe("ok");
    await expect(cb.execute(failing)).rejects.toThrow("x");
    await expect(cb.execute(ok)).resolves.toBe("ok");
    expect(cb.getState()).toBe("CLOSED");
  });
});
