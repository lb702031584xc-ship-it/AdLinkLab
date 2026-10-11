/**
 * Network API framework — Impact adapter.
 *
 * Credential format (stored encrypted, combined): `AccountSID:AuthToken`
 * Auth: HTTP Basic (AccountSID as username, AuthToken as password).
 * Catalog endpoint: GET {baseUrl}/Mediapartners/{AccountSID}/Campaigns
 *
 * Without real credentials this cannot be exercised against the live API —
 * the mapping below follows Impact's public Campaigns response shape
 * (CampaignId / CampaignName / DefaultPayout / CampaignDescription /
 * ContractTerms) and is covered by mock-fetch unit tests.
 */
import { lookup } from "node:dns/promises";
import { isBlockedIp } from "../ai/fetch-page.js";
import type {
  AdapterContext,
  NetworkAdapter,
  NetworkOffer,
} from "./types.js";

export const IMPACT_DEFAULT_BASE_URL = "https://api.impact.com";
export const IMPACT_PAGE_SIZE = 100;
export const IMPACT_MAX_PAGES = 50;
export const IMPACT_DEFAULT_TIMEOUT_MS = 15_000;

export class NetworkAdapterError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "NetworkAdapterError";
    this.code = code;
    this.status = status;
  }
}

interface ImpactCredentials {
  accountSid: string;
  authToken: string;
}

export function parseImpactCredentials(apiKey: string): ImpactCredentials {
  const idx = apiKey.indexOf(":");
  if (idx <= 0 || idx >= apiKey.length - 1) {
    throw new NetworkAdapterError(
      "BAD_CREDENTIALS",
      "Impact credentials must be in the form AccountSID:AuthToken"
    );
  }
  return {
    accountSid: apiKey.slice(0, idx).trim(),
    authToken: apiKey.slice(idx + 1),
  };
}

/**
 * SSRF guard for outbound network-API calls: only http/https, every resolved
 * address must be public (blocks RFC 1918, loopback, link-local incl. cloud
 * metadata, multicast). Injectable so tests can bypass DNS safely.
 */
export async function assertApiUrlSafe(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new NetworkAdapterError(
      "INVALID_URL",
      "Network API base URL is not a valid URL"
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new NetworkAdapterError(
      "INVALID_URL",
      "Network API base URL must be http(s)"
    );
  }
  if (parsed.username || parsed.password) {
    throw new NetworkAdapterError(
      "INVALID_URL",
      "Credentials must not be embedded in the base URL"
    );
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(parsed.hostname, { all: true });
  } catch {
    throw new NetworkAdapterError(
      "DNS_FAILED",
      "Could not resolve the network API host"
    );
  }
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new NetworkAdapterError(
        "SSRF_BLOCKED",
        "Network API host resolves to a blocked address"
      );
    }
  }
}

/** Impact Campaigns list response (subset of fields we map). */
export interface ImpactCampaign {
  CampaignId?: number | string;
  CampaignName?: string;
  DefaultPayout?: number | string;
  Currency?: string;
  CampaignDescription?: string;
  ContractTerms?: string;
  TrackingLink?: string;
  [key: string]: unknown;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

export function mapImpactCampaign(c: ImpactCampaign): NetworkOffer {
  const externalId = String(c.CampaignId ?? "").trim();
  const termsParts: string[] = [];
  const description = asString(c.CampaignDescription);
  const terms = asString(c.ContractTerms);
  if (description) termsParts.push(description);
  if (terms) termsParts.push(terms);
  const payout = asNumber(c.DefaultPayout);
  if (payout !== null) {
    termsParts.push(`Default payout: ${payout}`);
  }
  return {
    externalId,
    name: asString(c.CampaignName) ?? `Campaign ${externalId || "?"}`,
    payout,
    currency: asString(c.Currency) ?? "USD",
    termsText: termsParts.length > 0 ? termsParts.join("\n\n") : null,
    url: asString(c.TrackingLink),
    rawData: c as Record<string, unknown>,
  };
}

function normalizeCampaignList(body: unknown): ImpactCampaign[] {
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  const campaigns = record.Campaigns;
  if (Array.isArray(campaigns)) return campaigns as ImpactCampaign[];
  if (campaigns && typeof campaigns === "object") {
    const inner = (campaigns as Record<string, unknown>).Campaign;
    if (Array.isArray(inner)) return inner as ImpactCampaign[];
    if (inner && typeof inner === "object") return [inner as ImpactCampaign];
  }
  return [];
}

function readNumPages(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  const n = asNumber((body as Record<string, unknown>)["@numpages"]);
  return n !== null && n > 0 ? Math.floor(n) : null;
}

export class ImpactAdapter implements NetworkAdapter {
  readonly kind = "impact";
  readonly displayName = "Impact";
  readonly defaultBaseUrl = IMPACT_DEFAULT_BASE_URL;

  async pullOffers(ctx: AdapterContext): Promise<NetworkOffer[]> {
    const creds = parseImpactCredentials(ctx.apiKey);
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const timeoutMs = ctx.timeoutMs ?? IMPACT_DEFAULT_TIMEOUT_MS;
    const ssrfCheck =
      ctx.ssrfCheck ?? assertApiUrlSafe;

    const base = ctx.apiBaseUrl.trim().replace(/\/+$/, "");
    const campaignsUrl = `${base}/Mediapartners/${encodeURIComponent(creds.accountSid)}/Campaigns`;
    await ssrfCheck(campaignsUrl);

    const authHeader = `Basic ${Buffer.from(
      `${creds.accountSid}:${creds.authToken}`,
      "utf8"
    ).toString("base64")}`;

    const offers: NetworkOffer[] = [];
    let page = 1;
    for (;;) {
      const url =
        `${campaignsUrl}?Page=${page}&PageSize=${IMPACT_PAGE_SIZE}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: "GET",
          headers: {
            Authorization: authHeader,
            Accept: "application/json",
          },
          signal: controller.signal,
        });
      } catch (err) {
        throw new NetworkAdapterError(
          "NETWORK_ERROR",
          `Impact request failed: ${(err as Error).message}`
        );
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        const code =
          res.status === 401 || res.status === 403
            ? "AUTH_FAILED"
            : "HTTP_ERROR";
        throw new NetworkAdapterError(
          code,
          `Impact Campaigns API returned HTTP ${res.status}`,
          res.status
        );
      }

      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new NetworkAdapterError(
          "BAD_RESPONSE",
          "Impact Campaigns API returned invalid JSON"
        );
      }

      const campaigns = normalizeCampaignList(body);
      for (const c of campaigns) {
        const offer = mapImpactCampaign(c);
        if (offer.externalId) offers.push(offer);
      }

      const numPages = readNumPages(body);
      const doneByCount = campaigns.length < IMPACT_PAGE_SIZE;
      const doneByPages = numPages !== null && page >= numPages;
      if (doneByCount || doneByPages || page >= IMPACT_MAX_PAGES) break;
      page += 1;
    }
    return offers;
  }
}
