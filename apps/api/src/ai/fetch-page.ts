/**
 * Phase 11 — SSRF-safe page fetch for AI offer analysis.
 *
 * Defenses:
 * - Only http/https schemes.
 * - Every resolved address (v4 and v6, all `dns.lookup` results) is checked
 *   against private/loopback/link-local/multicast/reserved ranges.
 * - Redirects are followed manually (max 3 hops) with re-validation per hop,
 *   so a redirect to an internal address cannot bypass the check.
 * - 10s timeout per request, 8MB body cap. The cap counts RAW bytes before
 *   stripping scripts/styles (modern product pages easily exceed 2MB raw
 *   while only 12KB of text is kept), so it must sit well above real page
 *   sizes; it still bounds memory against abuse URLs.
 *
 * No new dependencies. Never log fetched URLs with credentials.
 */
import { lookup } from "node:dns/promises";
import { AiError } from "./llm.js";

export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_BODY_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_CHARS = 12_000;
const MAX_REDIRECTS = 3;

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

function inV4Cidr(ipInt: number, base: string, bits: number): boolean {
  const b = ipv4ToInt(base);
  if (b === null) return false;
  const mask = bits === 0 ? 0 : ((0xffffffff << (32 - bits)) >>> 0);
  return (ipInt & mask) === (b & mask);
}

/** [base, prefixBits] — blocked IPv4 ranges (RFC 1918, loopback, etc.). */
const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC 1918
  ["100.64.0.0", 10], // CGNAT shared space
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata!)
  ["172.16.0.0", 12], // RFC 1918
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay (deprecated)
  ["192.168.0.0", 16], // RFC 1918
  ["198.18.0.0", 15], // benchmark testing
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

/**
 * True when the literal IP address must not be fetched (SSRF guard).
 * Handles IPv4, IPv6, and IPv4-mapped IPv6 (::ffff:1.2.3.4).
 */
export function isBlockedIp(ip: string): boolean {
  const v4 = ipv4ToInt(ip);
  if (v4 !== null) {
    return BLOCKED_V4.some(([base, bits]) => inV4Cidr(v4, base, bits));
  }
  const lower = ip.toLowerCase();
  // IPv4-mapped IPv6: check the embedded v4 address.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (mapped) {
    const inner = ipv4ToInt(mapped[1] as string);
    return inner === null
      ? true
      : BLOCKED_V4.some(([base, bits]) => inV4Cidr(inner, base, bits));
  }
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  const first = lower.split(":")[0] ?? "";
  if (first === "ff" || first.startsWith("ff")) return true; // multicast ff00::/8
  if (first === "fe80" || first === "fe90" || first === "fea0" || first === "feb0")
    return true; // link-local fe80::/10 (covers fe80–febf)
  if (first.startsWith("fec0")) return true; // site-local (deprecated, still blocked)
  if (/^f[cd]/.test(first)) return true; // unique-local fc00::/7
  return false;
}

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
    throw new AiError("Could not resolve host", 400);
  }
  if (addresses.length === 0) {
    throw new AiError("Could not resolve host", 400);
  }
  for (const a of addresses) {
    if (isBlockedIp(a.address)) {
      throw new AiError("URL target is not allowed", 400);
    }
  }
}

/**
 * Remove scripts, styles, comments and tags; collapse whitespace.
 * Exported for unit tests.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function readCapped(res: Response): Promise<Buffer> {
  if (!res.body) throw new AiError("Empty response body");
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new AiError("Page too large", 400);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

/**
 * readCapped 的调用点包装：超限时把当时的 URL 带进报错里，
 * 多链接粘贴时用户能一眼看出是哪条链接超了。
 */
async function readCappedWithUrl(res: Response, url: string): Promise<Buffer> {
  try {
    return await readCapped(res);
  } catch (e) {
    if (e instanceof AiError && e.message === "Page too large") {
      throw new AiError(
        `Page too large (raw HTML over ${MAX_BODY_BYTES / 1024 / 1024}MB): ${url}`,
        400
      );
    }
    throw e;
  }
}

export interface FetchedPage {
  finalUrl: string;
  text: string;
  /** P1-3：重定向链（每跳 { url, status }）；0 跳 = 无重定向。 */
  redirectChain?: Array<{ url: string; status: number }>;
}

/** Raw-HTML fetch result for HTML-structure analysis (Lander Intel). */
export interface FetchedHtmlPage {
  finalUrl: string;
  /** Raw HTML (same buffer the plain text is stripped from). */
  html: string;
  /** Plain text derived from the HTML (same as fetchPage's `text`). */
  text: string;
  statusCode: number;
  redirectChain: Array<{ url: string; status: number }>;
  /** Wall-clock ms from first request to fully-read body. */
  fetchMs: number;
}

/**
 * Fetch a page with the SAME SSRF guards as fetchPage (private-IP blocking,
 * manual redirects with per-hop re-validation, 10s timeout, 8MB body cap),
 * but return the raw HTML for structural analysis. Additive only: the SSRF
 * logic above is untouched.
 */
export async function fetchPageHtml(rawUrl: string): Promise<FetchedHtmlPage> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new AiError("Invalid URL", 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AiError("Only http(s) URLs are allowed", 400);
  }
  if (parsed.username || parsed.password) {
    throw new AiError("URLs with credentials are not allowed", 400);
  }

  const startedAt = Date.now();
  const redirectChain: Array<{ url: string; status: number }> = [];
  let current = parsed.toString();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = new URL(current);
    await assertPublicHostname(u.hostname);

    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "User-Agent": "AdLinkLab-AI/1.0" },
      });
    } catch {
      throw new AiError("Page fetch failed: network error");
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      if (!location) throw new AiError("Redirect without location", 400);
      try {
        current = new URL(location, current).toString();
      } catch {
        throw new AiError("Invalid redirect target", 400);
      }
      const proto = new URL(current).protocol;
      if (proto !== "http:" && proto !== "https:") {
        throw new AiError("Only http(s) URLs are allowed", 400);
      }
      redirectChain.push({ url: current, status: res.status });
      continue;
    }

    if (!res.ok) {
      throw new AiError(`Page fetch failed (status ${res.status})`);
    }
    const buf = await readCappedWithUrl(res, current);
    const html = buf.toString("utf8");
    return {
      finalUrl: current,
      html,
      text: stripHtml(html).slice(0, MAX_TEXT_CHARS),
      statusCode: res.status,
      redirectChain,
      fetchMs: Date.now() - startedAt,
    };
  }
  throw new AiError("Too many redirects", 400);
}

/**
 * Fetch a page with SSRF guards. Returns collapsed plain text
 * (max MAX_TEXT_CHARS chars) and the final URL after redirects.
 */
export async function fetchPage(rawUrl: string): Promise<FetchedPage> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new AiError("Invalid URL", 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AiError("Only http(s) URLs are allowed", 400);
  }
  if (parsed.username || parsed.password) {
    throw new AiError("URLs with credentials are not allowed", 400);
  }

  let current = parsed.toString();
  const redirectChain: Array<{ url: string; status: number }> = [];
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = new URL(current);
    await assertPublicHostname(u.hostname);

    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "User-Agent": "AdLinkLab-AI/1.0" },
      });
    } catch {
      throw new AiError("Page fetch failed: network error");
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      if (!location) throw new AiError("Redirect without location", 400);
      try {
        current = new URL(location, current).toString();
      } catch {
        throw new AiError("Invalid redirect target", 400);
      }
      const proto = new URL(current).protocol;
      if (proto !== "http:" && proto !== "https:") {
        throw new AiError("Only http(s) URLs are allowed", 400);
      }
      redirectChain.push({ url: current, status: res.status });
      continue;
    }

    if (!res.ok) {
      throw new AiError(`Page fetch failed (status ${res.status})`);
    }
    const buf = await readCappedWithUrl(res, current);
    const text = stripHtml(buf.toString("utf8")).slice(0, MAX_TEXT_CHARS);
    return { finalUrl: current, text, redirectChain };
  }
  throw new AiError("Too many redirects", 400);
}
