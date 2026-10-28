/**
 * fetch-page 抓取上限单测：DNS 与 fetch 全部 mock，不碰外网。
 * 背景：2MB 旧上限会误杀亚马逊商品页（原始 HTML 动辄超 2MB，
 * 而实际只取 12KB 正文），上限已提到 8MB。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

import { fetchPage, MAX_BODY_BYTES, MAX_TEXT_CHARS } from "./fetch-page.js";
import { AiError } from "./llm.js";

const URL = "https://example.com/product";

function stubFetch(body: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status: 200 }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchPage body cap", () => {
  it("2MB 以上的原始页面也能抓（旧上限误杀）", async () => {
    // 约 3MB 原始 HTML：标题在前，正文足够多。
    const body =
      "<html><body><h1>Acme Widget</h1><p>" +
      "word ".repeat(600_000) +
      "</p></body></html>";
    expect(body.length).toBeGreaterThan(2 * 1024 * 1024);
    expect(body.length).toBeLessThan(MAX_BODY_BYTES);
    stubFetch(body);
    const page = await fetchPage(URL);
    expect(page.text).toContain("Acme Widget");
    expect(page.text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
  });

  it("超过 8MB 的页面报错，并带出是哪个链接", async () => {
    stubFetch("x".repeat(MAX_BODY_BYTES + 1024));
    const err = await fetchPage(URL).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as Error).message).toContain("Page too large");
    expect((err as Error).message).toContain("example.com/product");
  });

  it("小页面正常返回去标签正文", async () => {
    stubFetch(
      "<html><body><h1>Hello</h1><script>var x=1;</script><p>World</p></body></html>"
    );
    const page = await fetchPage(URL);
    expect(page.text).toContain("Hello");
    expect(page.text).toContain("World");
    expect(page.text).not.toContain("var x=1");
    expect(page.finalUrl).toBe("https://example.com/product");
  });
});
