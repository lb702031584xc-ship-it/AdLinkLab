/**
 * Phase 12 (P0 anti-ban) — pure helpers for the direct-link compliance
 * URL checker: registrable-domain extraction, owned-domain suffix matching,
 * affiliate query-param detection, and verdict computation.
 *
 * No network access here; SSRF guards live in fetch-page.ts.
 */

/**
 * 补强 #24：直达链接（direct link）合规检查默认执行（默认开，用户可取消）。
 * 调用方未显式传 enabled 时按 true 处理；显式传 false 才跳过检查。
 * 只改默认值，不改判定逻辑（checkUrlVerdict 等纯函数不变）。
 * Web 端对应开关：worksheet-client 的 complianceCounted 已默认 true。
 */
export const DIRECT_LINK_CHECK_DEFAULT_ENABLED = true;

export function resolveDirectLinkCheckEnabled(
  enabled?: boolean | null,
): boolean {
  return enabled ?? DIRECT_LINK_CHECK_DEFAULT_ENABLED;
}

/** Query parameter names commonly used by affiliate tracking links. */
export const AFFILIATE_PARAMS: ReadonlySet<string> = new Set([
  "aff_id",
  "affiliate_id",
  "aff",
  "clickid",
  "click_id",
  "sid",
  "subid",
  "sub_id",
  "offer_id",
  "transaction_id",
  "aid",
  "pid",
]);

/** Common two-label public suffixes, for display-grade registrable domains. */
const TWO_LABEL_SUFFIXES: ReadonlySet<string> = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.jp",
  "ne.jp",
  "or.jp",
  "go.jp",
  "com.cn",
  "net.cn",
  "org.cn",
  "gov.cn",
  "co.kr",
  "or.kr",
  "go.kr",
  "com.hk",
  "com.tw",
  "com.sg",
  "co.nz",
  "com.br",
  "com.mx",
  "com.ar",
  "com.co",
  "co.in",
  "co.za",
  "co.th",
  "com.my",
  "com.ph",
  "co.id",
  "com.vn",
]);

function cleanHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

/**
 * Extract a display-grade registrable domain (eTLD+1 approximation).
 * Falls back to the hostname itself when it has fewer than 2 labels.
 */
export function registrableDomain(hostname: string): string {
  const host = cleanHost(hostname);
  const labels = host.split(".").filter(Boolean);
  if (labels.length >= 3) {
    const lastTwo = labels.slice(-2).join(".");
    if (TWO_LABEL_SUFFIXES.has(lastTwo)) {
      return labels.slice(-3).join(".");
    }
  }
  if (labels.length >= 2) {
    return labels.slice(-2).join(".");
  }
  return host;
}

/**
 * True when `hostname` is exactly `owned` or a subdomain of it.
 * Label-boundary suffix matching: evil-mydomain.com does NOT match
 * mydomain.com, while sub.mydomain.com does.
 */
export function isOwnedDomain(
  hostname: string,
  ownedDomains: readonly string[]
): boolean {
  const host = cleanHost(hostname);
  if (!host) return false;
  return ownedDomains.some((d) => {
    const owned = cleanHost(d);
    if (!owned) return false;
    return host === owned || host.endsWith(`.${owned}`);
  });
}

/**
 * Detect affiliate tracking query params (exact param-name match,
 * case-insensitive). Returns the matched param names in URL order.
 */
export function detectAffiliateParams(url: URL): string[] {
  const found: string[] = [];
  for (const key of url.searchParams.keys()) {
    const k = key.toLowerCase();
    if (AFFILIATE_PARAMS.has(k) && !found.includes(k)) {
      found.push(k);
    }
  }
  return found;
}

export type UrlVerdict = "owned" | "affiliate_direct" | "suspicious" | "unknown";

/**
 * Compute the compliance verdict for a resolved URL.
 * - owned: final host is one of the advertiser's own domains.
 * - affiliate_direct: not owned, but affiliate tracking params present.
 * - suspicious: redirected somewhere unowned with no affiliate params.
 * - unknown: fetch failed or nothing conclusive.
 */
export function checkUrlVerdict(args: {
  finalHost: string | null;
  redirected: boolean;
  affiliateParams: string[];
  ownedDomains: readonly string[];
}): UrlVerdict {
  if (
    args.finalHost &&
    isOwnedDomain(args.finalHost, args.ownedDomains)
  ) {
    return "owned";
  }
  if (args.affiliateParams.length > 0) {
    return "affiliate_direct";
  }
  if (args.redirected) {
    return "suspicious";
  }
  return "unknown";
}

/** Normalize a user-supplied owned domain; null when it is not domain-like. */
export function normalizeOwnedDomain(v: string): string | null {
  let d = v.trim().toLowerCase();
  if (!d) return null;
  // Tolerate pasted URLs: extract the hostname.
  if (d.includes("://")) {
    try {
      d = new URL(d).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  d = d.replace(/\.$/, "");
  if (d.includes("/") || d.includes(" ") || d.includes("@")) return null;
  // Labels of 1-63 [a-z0-9-], not starting/ending with '-', at least one dot.
  if (
    !/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(d)
  ) {
    return null;
  }
  return d;
}
