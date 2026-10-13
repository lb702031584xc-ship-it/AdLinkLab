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
