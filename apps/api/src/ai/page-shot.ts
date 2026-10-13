/**
 * 无头浏览器截图（第二级抓取）。
 *
 * 当 HTML 直抓被反爬拦下时，用系统 Chromium（apk add chromium +
 * puppeteer-core，不下载浏览器）打开页面、截首屏，再走 tesseract OCR。
 * 与 fetch-page 相同的 SSRF 防护：DNS 解析出的所有地址逐一检查
 * 私有/回环/链路本地/组播/保留段（含 169.254 云元数据）。
 *
 * 限制：数据中心 IP 会被 Amazon 等站点的 WAF 直接拦（验证码/拒绝页），
 * 此时抛 PageBlockedError，调用方应提示用户手动传截图。
 */
import { lookup } from "node:dns/promises";
import puppeteer from "puppeteer-core";
import { AppError } from "@adlinklab/shared";
import { isBlockedIp } from "./fetch-page.js";

export class PageShotError extends AppError {
  constructor(message: string) {
    super(message, { code: "PAGE_SHOT_FAILED", statusCode: 422 });
    this.name = "PageShotError";
  }
}

export class PageBlockedError extends AppError {
  constructor(message = "该站拦截了自动化访问（验证码/拒绝页），请手动截图上传") {
    super(message, { code: "PAGE_BLOCKED", statusCode: 422 });
    this.name = "PageBlockedError";
  }
}

export interface PageShot {
  png: Buffer;
  title: string | null;
  finalUrl: string;
}

export interface PageShotDeps {
  /** 覆盖 Chromium 路径（默认 CHROME_PATH 或 /usr/bin/chromium-browser）。 */
  executablePath?: string;
  /** 测试注入：直接返回截图，不启动浏览器。 */
  launchImpl?: (url: string) => Promise<PageShot>;
  timeoutMs?: number;
  /** 测试注入 DNS（默认 node:dns/promises lookup）。 */
  dnsLookup?: (hostname: string) => Promise<Array<{ address: string }>>;
}

/** 验证码/拒绝页的标题与正文特征。 */
const BLOCK_PATTERNS =
  /captcha|robot check|are you a robot|access denied|unusual traffic|attention required|verify you are human|403 forbidden/i;

export function isBlockedContent(title: string | null, textSnippet: string): boolean {
  return BLOCK_PATTERNS.test(`${title ?? ""} ${textSnippet.slice(0, 500)}`);
}

async function assertPublicHostname(
  rawHostname: string,
  dnsLookup: PageShotDeps["dnsLookup"]
): Promise<void> {
  const hostname =
    rawHostname.startsWith("[") && rawHostname.endsWith("]")
      ? rawHostname.slice(1, -1)
      : rawHostname;
  const lookupFn = dnsLookup ?? ((h: string) => lookup(h, { all: true }));
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookupFn(hostname);
  } catch {
    throw new PageShotError("Could not resolve host");
  }
  if (addresses.length === 0) throw new PageShotError("Could not resolve host");
  for (const a of addresses) {
    if (isBlockedIp(a.address)) throw new PageShotError("URL target is not allowed");
  }
}

export async function screenshotPage(
  rawUrl: string,
  deps: PageShotDeps = {}
): Promise<PageShot> {
  // 先校验（测试注入也不能绕过 URL/SSRF 检查）
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new PageShotError("Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new PageShotError("Only http(s) URLs are allowed");
  }
  if (parsed.username || parsed.password) {
    throw new PageShotError("URLs with credentials are not allowed");
  }
  await assertPublicHostname(parsed.hostname, deps.dnsLookup);

  if (deps.launchImpl) return deps.launchImpl(rawUrl.trim());

  const executablePath =
    deps.executablePath ?? process.env.CHROME_PATH ?? "/usr/bin/chromium-browser";
  const timeoutMs = deps.timeoutMs ?? 45_000;
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--window-size=1366,1024",
      ],
      timeout: timeoutMs,
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 1024, deviceScaleFactor: 1 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    );
    const response = await page.goto(rawUrl.trim(), {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    if (response && response.status() >= 400) {
      throw new PageBlockedError(`对方返回 HTTP ${response.status()}，可能拦截了自动化访问`);
    }
    // 给 JS 渲染一点时间
    await new Promise((r) => setTimeout(r, 2500));
    const title = await page.title().catch(() => null);
    const bodyText: string = await page
      .$eval("body", (el) => el.textContent?.slice(0, 500) ?? "")
      .catch(() => "");
    if (isBlockedContent(title, bodyText)) {
      throw new PageBlockedError();
    }
    const png = (await page.screenshot({ type: "png" })) as Buffer;
    const finalUrl = page.url();
    await page.close();
    return { png: Buffer.from(png), title: title || null, finalUrl };
  } catch (e) {
    if (e instanceof PageBlockedError || e instanceof PageShotError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new PageShotError(`浏览器截图失败（${msg}）`);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // 忽略清理失败
      }
    }
  }
}
