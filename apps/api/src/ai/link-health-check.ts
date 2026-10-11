/**
 * Automation pack ① — dead link monitor: SSRF-safe link health check.
 *
 * SSRF defenses mirror `fetch-page.ts` (copied pattern, not shared wiring):
 * - Only http/https schemes; URLs with credentials rejected.
 * - Every hop's hostname is DNS-resolved and every resolved address is
 *   checked against private/loopback/link-local/multicast/reserved ranges
 *   via `isBlockedIp` (reused from fetch-page.ts).
 * - Redirects are followed manually (max 5 hops) with per-hop re-validation,
 *   so a redirect to an internal address cannot bypass the check.
 * - 10s timeout per request (AbortSignal.timeout).
 *
 * A link is considered DEAD when:
 * - the final status code is 404 / 410 / 5xx,
 * - the request times out or DNS resolution fails,
 * - a redirect lands on the site homepage (final path is `/` or empty while
 *   the original URL had a non-root path) — merchants often 302 expired
 *   offer pages back to `/`.
 *
 * Never throws: every failure mode is returned as `{ isAlive: false, ... }`.
 */
import { lookup } from "node:dns/promises";
import { isBlockedIp } from "./fetch-page.js";

export const LINK_CHECK_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

export interface LinkHealthResult {
  statusCode?: number;
  finalUrl: string;
  isAlive: boolean;
  failureReason?: string;
  /** Wall-clock ms for the whole check (all hops). */
  responseTimeMs: number;
}

export interface CheckLinkHealthOpts {
  /**
   * Injectable DNS guard for unit tests. Defaults to real DNS resolution
   * plus the private-IP block list.
   */
  dnsCheck?: (hostname: string) => Promise<void>;
  /**
   * When true (default), the final response body is fetched and validated:
   * blank pages (too little text) and soft-error pages (error keywords in
   * title/body) are reported dead. Disable for a cheap status-only check.
   */
  checkContent?: boolean;
}

/** Max body bytes to read for content validation (avoid huge downloads). */
const MAX_BODY_BYTES = 500_000;
/** Minimum visible text chars; below this the page counts as blank. */
const MIN_TEXT_CHARS = 500;

/** Soft-error indicators: pages returning 200 but showing an error. */
const ERROR_PATTERNS = [
  /404\s*(not\s*found|error)/i,
  /page\s*not\s*found/i,
  /this\s*page\s*(does\s*not\s*exist|is\s*not\s*available|has\s*been\s*removed)/i,
  /product\s*not\s*(found|available)/i,
  /offer\s*(expired|not\s*available|no\s*longer\s*available)/i,
  /out\s*of\s*stock/i,
  /something\s*went\s*wrong/i,
  /access\s*denied/i,
  /forbidden/i,
];

/** Strip tags/scripts/styles, collapse whitespace → visible text. */
function extractVisibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]{0,500})<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

/**
 * Validate final page content: not blank, not a soft error page.
 * Returns a failureReason string, or null when content looks fine.
 */
function validateContent(html: string): string | null {
  const title = extractTitle(html);
  const text = extractVisibleText(html);
  if (text.length < MIN_TEXT_CHARS) {
    return "blank_page";
  }
  const haystack = `${title}\n${text.slice(0, 5000)}`;
  for (const re of ERROR_PATTERNS) {
    if (re.test(haystack)) {
      return "soft_error_page";
    }
  }
  return null;
}

/** DNS resolution + SSRF guard for one hop. Throws on failure/block. */
async function assertPublicHostname(rawHostname: string): Promise<void> {
  // WHATWG URL keeps IPv6 brackets: http://[::1]/ → hostname "[::1]".
  const hostname =
    rawHostname.startsWith("[") && rawHostname.endsWith("]")
      ? rawHostname.slice(1, -1)
      : rawHostname;
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new Error("dns_lookup_failed");
  }
  if (addresses.length === 0) {
    throw new Error("dns_lookup_failed");
  }
  for (const a of addresses) {
    if (isBlockedIp(a.address)) {
      throw new Error("blocked_target");
    }
  }
}

function classifyFailure(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === "dns_lookup_failed") return "dns_failed";
    if (error.message === "blocked_target") return "blocked_target";
    if (
      error.name === "TimeoutError" ||
      /timed out|timeout/i.test(error.message)
    ) {
      return "timeout";
    }
    return "network_error";
  }
  return "network_error";
}

/**
 * HEAD request with GET fallback for servers that reject HEAD (405/501).
 * `redirect: "manual"` — redirects are followed explicitly so each hop can
 * be SSRF-checked. Response bodies are discarded (health check only).
 */
async function headOrGet(url: string): Promise<Response> {
  const head = await fetch(url, {
    method: "HEAD",
    redirect: "manual",
    signal: AbortSignal.timeout(LINK_CHECK_TIMEOUT_MS),
    headers: { "User-Agent": "AdLinkLab-LinkCheck/1.0" },
  });
  if (head.status === 405 || head.status === 501) {
    await head.arrayBuffer().catch(() => undefined);
    const get = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(LINK_CHECK_TIMEOUT_MS),
      headers: { "User-Agent": "AdLinkLab-LinkCheck/1.0" },
    });
    await get.body?.cancel().catch(() => undefined);
    return get;
  }
  await head.arrayBuffer().catch(() => undefined);
  return head;
}

function deadResult(
  finalUrl: string,
  failureReason: string,
  startedAt: number,
  statusCode?: number
): LinkHealthResult {
  return {
    statusCode,
    finalUrl,
    isAlive: false,
    failureReason,
    responseTimeMs: Date.now() - startedAt,
  };
}

function classifyFinalStatus(
  finalUrl: string,
  statusCode: number,
  originalPath: string,
  startedAt: number
): LinkHealthResult {
  const responseTimeMs = Date.now() - startedAt;
  const finalPath = new URL(finalUrl).pathname;
  const redirectedToHomepage =
    (finalPath === "/" || finalPath === "") &&
    originalPath !== "/" &&
    originalPath !== "";
  if (statusCode === 404 || statusCode === 410 || statusCode >= 500) {
    return {
      statusCode,
      finalUrl,
      isAlive: false,
      failureReason: `http_${statusCode}`,
      responseTimeMs,
    };
  }
  if (redirectedToHomepage) {
    return {
      statusCode,
      finalUrl,
      isAlive: false,
      failureReason: "redirected_to_homepage",
      responseTimeMs,
    };
  }
  return { statusCode, finalUrl, isAlive: true, responseTimeMs };
}

/**
 * Check whether `url` is alive. SSRF-safe, never throws — every failure
 * mode is returned as `{ isAlive: false, failureReason }`.
 */
export async function checkLinkHealth(
  url: string,
  opts: CheckLinkHealthOpts = {}
): Promise<LinkHealthResult> {
  const startedAt = Date.now();
  const dnsCheck = opts.dnsCheck ?? assertPublicHostname;
  const checkContent = opts.checkContent ?? true;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return deadResult(url, "invalid_url", startedAt);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return deadResult(url, "unsupported_protocol", startedAt);
  }
  if (parsed.username || parsed.password) {
    return deadResult(url, "url_with_credentials", startedAt);
  }

  const originalPath = parsed.pathname;
  let current = parsed.toString();

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const u = new URL(current);
      await dnsCheck(u.hostname);

      const res = await headOrGet(current);

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get("location");
        if (!location) {
          return deadResult(
            current,
            "redirect_without_location",
            startedAt,
            res.status
          );
        }
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          return deadResult(
            current,
            "invalid_redirect_target",
            startedAt,
            res.status
          );
        }
        if (next.protocol !== "http:" && next.protocol !== "https:") {
          return deadResult(
            current,
            "unsupported_protocol",
            startedAt,
            res.status
          );
        }
        current = next.toString();
        continue;
      }

      // Final hop: status gate first.
      const statusVerdict = classifyFinalStatus(
        current,
        res.status,
        originalPath,
        startedAt
      );
      if (!statusVerdict.isAlive) return statusVerdict;

      // Content gate: fetch body, reject blank / soft-error pages.
      if (checkContent) {
        const contentVerdict = await validateFinalContent(current, startedAt);
        if (contentVerdict) return contentVerdict;
      }

      return {
        statusCode: res.status,
        finalUrl: current,
        isAlive: true,
        responseTimeMs: Date.now() - startedAt,
      };
    }
    return deadResult(current, "too_many_redirects", startedAt);
  } catch (error) {
    return deadResult(current, classifyFailure(error), startedAt);
  }
}

/**
 * GET the final URL and validate its content. Returns a dead LinkHealthResult
 * on blank/soft-error/timeout, or null when the page looks healthy.
 * Body is capped at MAX_BODY_BYTES; non-HTML content types are skipped
 * (a PDF/image/redirect-target file is not a "blank page").
 */
async function validateFinalContent(
  finalUrl: string,
  startedAt: number
): Promise<LinkHealthResult | null> {
  let res: Response;
  try {
    // Re-request with GET (the hop above may have been HEAD).
    res = await fetch(finalUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(LINK_CHECK_TIMEOUT_MS),
      headers: {
        "User-Agent": "AdLinkLab-LinkCheck/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
    });
  } catch (error) {
    return deadResult(finalUrl, classifyFailure(error), startedAt);
  }
  if (res.status === 404 || res.status === 410 || res.status >= 500) {
    await res.body?.cancel().catch(() => undefined);
    return deadResult(finalUrl, `http_${res.status}`, startedAt, res.status);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml/i.test(contentType)) {
    // Not an HTML page (file download, image, etc.) — status gate already passed.
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  let html = "";
  try {
    const reader = res.body?.getReader();
    if (!reader) {
      await res.body?.cancel().catch(() => undefined);
      return deadResult(finalUrl, "empty_body", startedAt, res.status);
    }
    const decoder = new TextDecoder();
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BODY_BYTES) break; // enough for validation
      html += decoder.decode(value, { stream: true });
    }
    html += decoder.decode();
    await reader.cancel().catch(() => undefined);
  } catch (error) {
    return deadResult(finalUrl, classifyFailure(error), startedAt, res.status);
  }
  const contentFailure = validateContent(html);
  if (contentFailure) {
    return deadResult(finalUrl, contentFailure, startedAt, res.status);
  }
  return null;
}
