/**
 * P1-23：失败分类回归测试（API 侧）。
 */
import { describe, expect, it } from "vitest";
import { classifyFailure } from "./failure.js";

describe("P1-23 classifyFailure", () => {
  it("classifies network / timeout / rate_limit / invalid_url", () => {
    expect(classifyFailure("fetch failed: ECONNREFUSED")).toMatchObject({
      category: "network",
      retryable: true,
      backoffSeconds: 30,
    });
    expect(classifyFailure("request timed out after 30s")).toMatchObject({
      category: "timeout",
      backoffSeconds: 60,
    });
    expect(classifyFailure("HTTP 429: rate limit exceeded")).toMatchObject({
      category: "rate_limit",
      backoffSeconds: 300,
    });
    expect(classifyFailure("invalid URL: must start with https://")).toMatchObject({
      category: "invalid_url",
      retryable: false,
      backoffSeconds: 0,
    });
  });

  it("defaults to internal_error", () => {
    expect(classifyFailure("something exploded")).toMatchObject({
      category: "internal_error",
      retryable: true,
      backoffSeconds: 120,
    });
  });

  it("has no content_policy category", () => {
    expect(classifyFailure("content policy violation")).toMatchObject({
      category: "internal_error",
    });
  });
});
