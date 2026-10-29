import { describe, expect, it, vi } from "vitest";
import {
  isRateLimitedError,
  throttleOnly,
  withThrottle,
} from "./net-throttle.js";

const noSleep = async () => {};

describe("isRateLimitedError", () => {
  it("识别 429 与 rate limit 文案", () => {
    expect(isRateLimitedError({ status: 429 })).toBe(true);
    expect(isRateLimitedError({ message: "Too Many Requests" })).toBe(true);
    expect(isRateLimitedError({ code: "RATE_LIMIT" })).toBe(true);
  });

  it("普通错误不误判", () => {
    expect(isRateLimitedError({ status: 500, message: "boom" })).toBe(false);
    expect(isRateLimitedError(null)).toBe(false);
    expect(isRateLimitedError("oops")).toBe(false);
  });
});

describe("withThrottle", () => {
  it("正常调用只执行一次", async () => {
    const fn = vi.fn(async () => "ok");
    await expect(withThrottle(fn, { sleep: noSleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("限流错误会重试并在成功时返回", async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      n += 1;
      if (n < 2) throw { status: 429 };
      return "ok";
    });
    await expect(
      withThrottle(fn, { sleep: noSleep, maxRetries: 2, baseBackoffMs: 0 })
    ).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("超过重试次数后抛出", async () => {
    const fn = vi.fn(async () => {
      throw { status: 429 };
    });
    await expect(
      withThrottle(fn, { sleep: noSleep, maxRetries: 1, baseBackoffMs: 0 })
    ).rejects.toEqual({ status: 429 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("非限流错误立即抛出，不重试", async () => {
    const fn = vi.fn(async () => {
      throw { status: 500 };
    });
    await expect(
      withThrottle(fn, { sleep: noSleep, maxRetries: 3 })
    ).rejects.toEqual({ status: 500 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("会先等待再调用（限速生效）", async () => {
    const sleep = vi.fn(async () => {});
    await withThrottle(async () => "ok", {
      minDelayMs: 100,
      maxDelayMs: 100,
      sleep,
    });
    expect(sleep).toHaveBeenCalledWith(100);
  });
});

describe("throttleOnly", () => {
  it("等待落在区间内", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    await throttleOnly({ minDelayMs: 800, maxDelayMs: 1500, sleep });
    const ms = (sleep.mock.calls[0] as unknown[])[0] as number;
    expect(ms).toBeGreaterThanOrEqual(800);
    expect(ms).toBeLessThanOrEqual(1500);
  });
});
