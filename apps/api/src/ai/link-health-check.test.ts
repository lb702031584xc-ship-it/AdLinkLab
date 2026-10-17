/**
 * Automation pack ① — dead link monitor health-check tests.
 * fetch is mocked globally; DNS is bypassed via the injected dnsCheck
 * (no network in tests).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkLinkHealth,
  type CheckLinkHealthOpts,
} from "./link-health-check.js";

const NO_DNS: CheckLinkHealthOpts = { dnsCheck: async () => undefined };

function mockResponse(status: number, location?: string): Response {
  return {
    status,
    headers: new Headers(location ? { location } : undefined),
    body: null,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkLinkHealth", () => {
  it("200 → alive", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(200)));
    const r = await checkLinkHealth(
      "https://merchant.example/deal?x=1",
      NO_DNS
    );
    expect(r.isAlive).toBe(true);
    expect(r.statusCode).toBe(200);
    expect(r.finalUrl).toBe("https://merchant.example/deal?x=1");
    expect(r.failureReason).toBeUndefined();
    expect(r.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("404 → dead", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(404)));
    const r = await checkLinkHealth("https://merchant.example/gone", NO_DNS);
    expect(r.isAlive).toBe(false);
    expect(r.statusCode).toBe(404);
    expect(r.failureReason).toBe("http_404");
  });

  it("410 → dead", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(410)));
    const r = await checkLinkHealth("https://merchant.example/old", NO_DNS);
    expect(r.isAlive).toBe(false);
    expect(r.failureReason).toBe("http_410");
  });

  it("503 → dead", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(503)));
    const r = await checkLinkHealth("https://merchant.example/deal", NO_DNS);
    expect(r.isAlive).toBe(false);
    expect(r.failureReason).toBe("http_503");
  });

  it("redirect to homepage → dead (expired offer pattern)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "https://merchant.example/"
          ? mockResponse(200)
          : mockResponse(302, "https://merchant.example/")
      )
    );
    const r = await checkLinkHealth(
      "https://merchant.example/summer-deal",
      NO_DNS
    );
    expect(r.isAlive).toBe(false);
    expect(r.failureReason).toBe("redirected_to_homepage");
    expect(r.finalUrl).toBe("https://merchant.example/");
  });

  it("redirect to a real page with 200 → alive", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "https://merchant.example/deal"
          ? mockResponse(302, "https://merchant.example/deal-new")
          : mockResponse(200)
      )
    );
    const r = await checkLinkHealth(
      "https://merchant.example/deal",
      NO_DNS
    );
    expect(r.isAlive).toBe(true);
    expect(r.statusCode).toBe(200);
    expect(r.finalUrl).toBe("https://merchant.example/deal-new");
  });

  it("timeout → dead", async () => {
    const timeoutError = Object.assign(new Error("The operation timed out"), {
      name: "TimeoutError",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw timeoutError;
      })
    );
    const r = await checkLinkHealth("https://merchant.example/slow", NO_DNS);
    expect(r.isAlive).toBe(false);
    expect(r.failureReason).toBe("timeout");
    expect(r.statusCode).toBeUndefined();
  });

  it("DNS failure → dead", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(200)));
    const r = await checkLinkHealth("https://merchant.example/deal", {
      dnsCheck: async () => {
        throw new Error("dns_lookup_failed");
      },
    });
    expect(r.isAlive).toBe(false);
    expect(r.failureReason).toBe("dns_failed");
  });

  it("blocked IP target → dead", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(200)));
    const r = await checkLinkHealth("https://merchant.example/deal", {
      dnsCheck: async () => {
        throw new Error("blocked_target");
      },
    });
    expect(r.isAlive).toBe(false);
    expect(r.failureReason).toBe("blocked_target");
  });

  it("HEAD 405 falls back to GET", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        seen.push(String(init?.method));
        return init?.method === "GET" ? mockResponse(200) : mockResponse(405);
      })
    );
    const r = await checkLinkHealth("https://merchant.example/deal", NO_DNS);
    // HEAD 405 → GET 落回；内容校验再做一次 GET（c2af8b7 内容门）。
    expect(seen).toEqual(["HEAD", "GET", "GET"]);
    expect(r.isAlive).toBe(true);
    expect(r.statusCode).toBe(200);
  });

  it("invalid URL → dead, never throws", async () => {
    const r = await checkLinkHealth("not a url", NO_DNS);
    expect(r.isAlive).toBe(false);
    expect(r.failureReason).toBe("invalid_url");
  });

  it("too many redirects → dead", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockResponse(302, "https://merchant.example/loop"))
    );
    const r = await checkLinkHealth("https://merchant.example/a", NO_DNS);
    expect(r.isAlive).toBe(false);
    expect(r.failureReason).toBe("too_many_redirects");
  });
});
