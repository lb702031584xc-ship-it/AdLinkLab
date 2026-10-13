/**
 * 无头浏览器截图模块测试。
 * 真实 Chromium 不在单测里启动（launchImpl 注入）。
 */
import { describe, expect, it } from "vitest";
import {
  isBlockedContent,
  screenshotPage,
  PageShotError,
} from "./page-shot.js";

describe("isBlockedContent", () => {
  it("识别验证码/拒绝页", () => {
    expect(isBlockedContent("Robot Check", "please solve captcha")).toBe(true);
    expect(isBlockedContent("Access Denied", "")).toBe(true);
  });
  it("正常页面不误判", () => {
    expect(isBlockedContent("NordVPN – Best VPN", "Fast and secure VPN")).toBe(false);
    expect(isBlockedContent(null, "")).toBe(false);
  });
});

describe("screenshotPage", () => {
  it("launchImpl 注入直接返回（不启动浏览器）", async () => {
    const shot = await screenshotPage("https://example.com/", {
      launchImpl: async (url) => ({
        png: Buffer.from("fake-png"),
        title: "Example",
        finalUrl: url,
      }),
      dnsLookup: async () => [{ address: "93.184.215.14" }],
    });
    expect(shot.title).toBe("Example");
    expect(shot.png.length).toBeGreaterThan(0);
  });

  it("非 http(s) 直接拒绝", async () => {
    await expect(
      screenshotPage("ftp://example.com/x", {
        launchImpl: async () => {
          throw new Error("should not be called");
        },
      })
    ).rejects.toBeInstanceOf(PageShotError);
  });

  it("SSRF：内网地址拒绝", async () => {
    await expect(
      screenshotPage("http://127.0.0.1/admin", {
        launchImpl: async () => {
          throw new Error("should not be called");
        },
      })
    ).rejects.toBeInstanceOf(PageShotError);
  });
});

describe("fetchPageTextWithFallback", () => {
  it("直抓成功 → 用 HTML 文本", async () => {
    const { fetchPageTextWithFallback } = await import("./page-shot.js");
    const r = await fetchPageTextWithFallback("https://example.com/", {
      fetchImpl: (async () => ({
        finalUrl: "https://example.com/",
        html: "<html></html>",
        text: "hello world",
        fetchMs: 10,
      })) as never,
      screenshotImpl: async () => {
        throw new Error("should not be called");
      },
    });
    expect(r.source).toBe("html");
    expect(r.text).toBe("hello world");
  });

  it("直抓被反爬 → 截图+OCR 降级", async () => {
    const { fetchPageTextWithFallback } = await import("./page-shot.js");
    const { AiError } = await import("./llm.js");
    const r = await fetchPageTextWithFallback("https://example.com/", {
      fetchImpl: (async () => {
        throw new AiError("blocked", 403);
      }) as never,
      screenshotImpl: (async () => ({
        png: Buffer.from("fake"),
        title: "Example",
        finalUrl: "https://example.com/",
      })) as never,
      ocrImpl: async () => ({ text: "OCR 识别的正文 $9.99", confidence: 80 }),
    });
    expect(r.source).toBe("screenshot");
    expect(r.text).toContain("$9.99");
  });

  it("非 AiError（SSRF 等）直接抛出，不降级", async () => {
    const { fetchPageTextWithFallback } = await import("./page-shot.js");
    const { PageShotError } = await import("./page-shot.js");
    await expect(
      fetchPageTextWithFallback("http://127.0.0.1/", {
        fetchImpl: (async () => {
          throw new PageShotError("URL target is not allowed");
        }) as never,
        screenshotImpl: (async () => {
          throw new Error("should not be called");
        }) as never,
      })
    ).rejects.toBeInstanceOf(PageShotError);
  });

  it("OCR 无文字 → 抛原始抓取错误", async () => {
    const { fetchPageTextWithFallback } = await import("./page-shot.js");
    const { AiError } = await import("./llm.js");
    const original = new AiError("blocked", 403);
    await expect(
      fetchPageTextWithFallback("https://example.com/", {
        fetchImpl: (async () => {
          throw original;
        }) as never,
        screenshotImpl: (async () => ({
          png: Buffer.from("fake"),
          title: null,
          finalUrl: "https://example.com/",
        })) as never,
        ocrImpl: async () => ({ text: "   ", confidence: null }),
      })
    ).rejects.toBe(original);
  });
});
