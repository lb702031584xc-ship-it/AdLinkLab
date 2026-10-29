import type {
  CampaignStatsOptions,
  ConversionUploadInput,
  ConversionUploadResult,
  GoogleAdsAd,
  GoogleAdsAdGroup,
  GoogleAdsAdGroupCriterion,
  GoogleAdsCampaign,
  GoogleAdsCampaignStats,
  GoogleAdsCustomer,
  GoogleAdsListOptions,
  GoogleAdsProvider,
  UpdateEntityUrlInput,
  UpdateEntityUrlResult,
} from "./provider.js";
import { GoogleAdsProviderError } from "./errors.js";
import type { GoogleCredentialProvider } from "./credentials.js";
import { EnvGoogleCredentialProvider } from "./credentials.js";

/**
 * Minimal fetch shape the provider depends on. The default implementation
 * wraps globalThis.fetch (with a 30s timeout); tests inject a stub.
 * Secrets never appear in this shape — headers are built per call.
 */
export type ApiFetchFn = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  }
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

function defaultFetch(): ApiFetchFn {
  return async (url, init) => {
    const res = await globalThis.fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: AbortSignal.timeout(30_000),
    });
    return {
      ok: res.ok,
      status: res.status,
      json: () => res.json() as Promise<unknown>,
      text: () => res.text(),
    };
  };
}

export interface GoogleAdsApiProviderConfig {
  /** Opaque credential reference — never pass raw OAuth secrets into domain */
  credentialRef?: string;
  credentialProvider?: GoogleCredentialProvider;
  /**
   * @deprecated Prefer credentialRef + GoogleCredentialProvider.
   * Kept for factory wiring; values are NOT logged.
   */
  developerTokenConfigured?: boolean;
  /**
   * Google Ads API version, e.g. "v22". Defaults to env
   * GOOGLE_ADS_API_VERSION, else "v22" (probed live 2026-10-28: v22/v23
   * answer 401 = version exists, v20/v21 answer 404 = sunset, v17 dead).
   * If Google ever sunsets the default, bump the env var — no code change.
   */
  apiVersion?: string;
  /**
   * Manager (MCC) account id for the login-customer-id header. Only needed
   * when the OAuth user reaches the customer through a manager account;
   * direct-account access leaves this unset. From env
   * GOOGLE_ADS_LOGIN_CUSTOMER_ID.
   */
  loginCustomerId?: string;
  /** Injectable fetch for tests; defaults to globalThis.fetch. */
  fetchFn?: ApiFetchFn;
}

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_HOST = "https://googleads.googleapis.com";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC_ID_RE = /^\d+$/;

/** GAQL int64 fields arrive as strings in REST JSON; doubles as numbers. */
function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Read-only live adapter for the real Google Ads API (REST + GAQL).
 *
 * - Auth: OAuth2 refresh-token grant, cached until expiry (60s skew).
 * - Reads: GAQL search with page-token drain; listCustomers via
 *   customers:listAccessibleCustomers + one customer query each.
 * - Mutations: explicitly refused by design — real changes go through
 *   Google Ads Scripts the advertiser runs manually, never this provider.
 * - Secrets live only in process env and per-call headers; error details
 *   carry variable NAMES, never values, and never request bodies.
 *
 * Still not implemented in this slice: ad-group / ad / criterion reads.
 * Their interface signatures carry no customerId, which GAQL paths need;
 * that resolution (config default vs signature change) belongs to the
 * hierarchy-sync slice, not to campaign stats.
 */
export class GoogleAdsApiProvider implements GoogleAdsProvider {
  private readonly credentialRef: string;
  private readonly credentials: GoogleCredentialProvider;
  private readonly developerTokenConfigured: boolean;
  private readonly apiVersion: string;
  private readonly loginCustomerId?: string;
  private readonly fetchFn: ApiFetchFn;
  private cachedToken: { token: string; expiresAtMs: number } | null = null;

  constructor(config: GoogleAdsApiProviderConfig = {}) {
    this.credentialRef =
      config.credentialRef ?? "env:GOOGLE_ADS_DEVELOPER_TOKEN";
    this.credentials =
      config.credentialProvider ?? new EnvGoogleCredentialProvider();
    this.developerTokenConfigured = Boolean(config.developerTokenConfigured);
    this.apiVersion =
      config.apiVersion ??
      process.env.GOOGLE_ADS_API_VERSION ??
      "v22";
    this.loginCustomerId =
      config.loginCustomerId ??
      process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ??
      undefined;
    this.fetchFn = config.fetchFn ?? defaultFetch();
  }

  /** Construction / health probe — no secrets returned. */
  async getStatus(): Promise<{
    kind: "api";
    credentialRef: string;
    isConfigured: boolean;
    liveApiEnabled: false;
    mutationsEnabled: false;
  }> {
    const handle = await this.credentials.resolve(this.credentialRef);
    return {
      kind: "api",
      credentialRef: handle.credentialRef,
      isConfigured: handle.isConfigured || this.developerTokenConfigured,
      liveApiEnabled: false,
      mutationsEnabled: false,
    };
  }

  private notImplemented(method: string): never {
    throw new GoogleAdsProviderError(
      `GoogleAdsApiProvider.${method} is not implemented yet.`,
      {
        code: "NOT_IMPLEMENTED",
        details: {
          method,
          credentialRef: this.credentialRef,
          developerTokenConfigured: this.developerTokenConfigured,
        },
      }
    );
  }

  private mutationForbidden(method: string): never {
    throw new GoogleAdsProviderError(
      `GoogleAdsApiProvider.${method} mutation is forbidden by design.`,
      {
        code: "INVALID_ARGUMENT",
        details: { method, mutationsEnabled: false },
      }
    );
  }

  private missingCredentialVars(): string[] {
    const missing: string[] = [];
    if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN)
      missing.push("GOOGLE_ADS_DEVELOPER_TOKEN");
    if (!process.env.GOOGLE_ADS_CLIENT_ID)
      missing.push("GOOGLE_ADS_CLIENT_ID");
    if (!process.env.GOOGLE_ADS_CLIENT_SECRET)
      missing.push("GOOGLE_ADS_CLIENT_SECRET");
    if (!process.env.GOOGLE_ADS_REFRESH_TOKEN)
      missing.push("GOOGLE_ADS_REFRESH_TOKEN");
    return missing;
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (
      this.cachedToken &&
      this.cachedToken.expiresAtMs > now + 60_000
    ) {
      return this.cachedToken.token;
    }
    const missing = this.missingCredentialVars();
    if (missing.length > 0) {
      throw new GoogleAdsProviderError(
        "Google Ads API credentials are not configured.",
        { code: "UNAUTHORIZED", details: { missing } }
      );
    }
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.GOOGLE_ADS_CLIENT_ID as string,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET as string,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN as string,
    }).toString();
    const res = await this.fetchFn(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      const snippet = (await res.text()).slice(0, 300);
      throw new GoogleAdsProviderError(
        "Google Ads OAuth refresh failed.",
        {
          code: "UNAUTHORIZED",
          details: { status: res.status, googleMessage: snippet },
        }
      );
    }
    const data = asRecord(await res.json());
    const token = data?.access_token;
    if (typeof token !== "string" || token === "") {
      throw new GoogleAdsProviderError(
        "Google Ads OAuth refresh returned no access token.",
        { code: "UNAUTHORIZED" }
      );
    }
    const expiresIn =
      typeof data?.expires_in === "number" ? data.expires_in : 3600;
    this.cachedToken = {
      token,
      expiresAtMs: now + expiresIn * 1000,
    };
    return token;
  }

  private apiHeaders(accessToken: string): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN as string,
      "Content-Type": "application/json",
    };
    if (this.loginCustomerId) {
      headers["login-customer-id"] = this.loginCustomerId;
    }
    return headers;
  }

  private async mapApiError(
    res: { status: number; text: () => Promise<string> },
    method: string
  ): Promise<GoogleAdsProviderError> {
    const raw = (await res.text()).slice(0, 500);
    let googleMessage = raw;
    try {
      const parsed = asRecord(JSON.parse(raw));
      const err = asRecord(parsed?.error);
      if (typeof err?.message === "string") googleMessage = err.message;
    } catch {
      // Keep raw text as the message.
    }
    const status = res.status;
    const code =
      status === 400
        ? "INVALID_ARGUMENT"
        : status === 401 || status === 403
          ? "UNAUTHORIZED"
          : status === 404
            ? "NOT_FOUND"
            : status === 429
              ? "RATE_LIMITED"
              : status >= 500
                ? "TEMPORARY_ERROR"
                : "PROVIDER_ERROR";
    return new GoogleAdsProviderError(
      `Google Ads API ${method} failed (HTTP ${status}).`,
      {
        code,
        details: { method, status, googleMessage },
      }
    );
  }

  /** GAQL search with page-token drain. Returns raw result rows. */
  private async search(
    customerId: string,
    query: string,
    method: string
  ): Promise<Record<string, unknown>[]> {
    this.requireNumericId(customerId, "customerId");
    const accessToken = await this.getAccessToken();
    const url = `${API_HOST}/${this.apiVersion}/customers/${customerId}/googleAds:search`;
    const rows: Record<string, unknown>[] = [];
    let pageToken: string | undefined;
    do {
      const payload: Record<string, unknown> = { query, pageSize: 1000 };
      if (pageToken) payload.pageToken = pageToken;
      const res = await this.fetchFn(url, {
        method: "POST",
        headers: this.apiHeaders(accessToken),
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw await this.mapApiError(res, method);
      const data = asRecord(await res.json());
      const results = data?.results;
      if (Array.isArray(results)) {
        for (const row of results) {
          const record = asRecord(row);
          if (record) rows.push(record);
        }
      }
      pageToken =
        typeof data?.nextPageToken === "string" && data.nextPageToken !== ""
          ? data.nextPageToken
          : undefined;
    } while (pageToken);
    return rows;
  }

  private requireNumericId(value: string, field: string): void {
    if (!NUMERIC_ID_RE.test(value)) {
      throw new GoogleAdsProviderError(
        `Google Ads ${field} must be a numeric id.`,
        { code: "INVALID_ARGUMENT", details: { field } }
      );
    }
  }

  private validateDateRange(
    startDate: string,
    endDate: string
  ): void {
    if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
      throw new GoogleAdsProviderError(
        "startDate and endDate must be YYYY-MM-DD.",
        { code: "INVALID_ARGUMENT", details: { startDate, endDate } }
      );
    }
    if (startDate > endDate) {
      throw new GoogleAdsProviderError(
        "startDate must not be after endDate.",
        { code: "INVALID_ARGUMENT", details: { startDate, endDate } }
      );
    }
  }

  async getCustomer(customerId: string): Promise<GoogleAdsCustomer> {
    const rows = await this.search(
      customerId,
      "SELECT customer.id, customer.descriptive_name, " +
        "customer.currency_code, customer.time_zone FROM customer",
      "getCustomer"
    );
    const customer = asRecord(rows[0]?.customer);
    if (!customer) {
      throw new GoogleAdsProviderError(
        `Customer not found: ${customerId}`,
        { code: "NOT_FOUND", details: { customerId } }
      );
    }
    return {
      customerId: String(customer.id ?? customerId),
      descriptiveName: String(customer.descriptive_name ?? ""),
      currencyCode: String(customer.currency_code ?? ""),
      timeZone: String(customer.time_zone ?? ""),
    };
  }

  async listCustomers(
    options?: GoogleAdsListOptions
  ): Promise<GoogleAdsCustomer[]> {
    const accessToken = await this.getAccessToken();
    const res = await this.fetchFn(
      `${API_HOST}/${this.apiVersion}/customers:listAccessibleCustomers`,
      { method: "GET", headers: this.apiHeaders(accessToken) }
    );
    if (!res.ok) throw await this.mapApiError(res, "listCustomers");
    const data = asRecord(await res.json());
    const names = data?.resourceNames;
    const ids: string[] = [];
    if (Array.isArray(names)) {
      for (const name of names) {
        if (typeof name === "string" && name.startsWith("customers/")) {
          const id = name.slice("customers/".length);
          if (NUMERIC_ID_RE.test(id)) ids.push(id);
        }
      }
    }
    const customers: GoogleAdsCustomer[] = [];
    for (const id of ids) {
      customers.push(await this.getCustomer(id));
    }
    if (options?.pageSize !== undefined && options.pageSize >= 0) {
      return customers.slice(0, options.pageSize);
    }
    return customers;
  }

  async getCampaign(
    customerId: string,
    campaignId: string
  ): Promise<GoogleAdsCampaign> {
    this.requireNumericId(campaignId, "campaignId");
    const rows = await this.search(
      customerId,
      "SELECT campaign.id, campaign.name, campaign.status FROM campaign " +
        `WHERE campaign.id = ${campaignId}`,
      "getCampaign"
    );
    const campaign = asRecord(rows[0]?.campaign);
    if (!campaign) {
      throw new GoogleAdsProviderError(
        `Campaign not found: ${campaignId}`,
        { code: "NOT_FOUND", details: { customerId, campaignId } }
      );
    }
    return {
      campaignId: String(campaign.id ?? campaignId),
      customerId,
      name: String(campaign.name ?? ""),
      status: String(campaign.status ?? ""),
    };
  }

  async listCampaigns(
    customerId: string,
    options?: GoogleAdsListOptions
  ): Promise<GoogleAdsCampaign[]> {
    const rows = await this.search(
      customerId,
      "SELECT campaign.id, campaign.name, campaign.status FROM campaign " +
        "ORDER BY campaign.id ASC",
      "listCampaigns"
    );
    const campaigns = rows
      .map((row) => asRecord(row.campaign))
      .filter(
        (c): c is Record<string, unknown> => c !== null
      )
      .map((c) => ({
        campaignId: String(c.id ?? ""),
        customerId,
        name: String(c.name ?? ""),
        status: String(c.status ?? ""),
      }))
      .filter((c) => c.campaignId !== "");
    if (options?.pageSize !== undefined && options.pageSize >= 0) {
      return campaigns.slice(0, options.pageSize);
    }
    return campaigns;
  }

  async listCampaignStats(
    customerId: string,
    options: CampaignStatsOptions
  ): Promise<GoogleAdsCampaignStats[]> {
    this.validateDateRange(options.startDate, options.endDate);
    const campaignFilter =
      options.campaignIds && options.campaignIds.length > 0
        ? ` AND campaign.id IN (${options.campaignIds.map((id) => {
            this.requireNumericId(id, "campaignId");
            return `'${id}'`;
          }).join(", ")})`
        : "";
    const rows = await this.search(
      customerId,
      "SELECT campaign.id, campaign.name, metrics.impressions, " +
        "metrics.clicks, metrics.cost_micros, metrics.conversions " +
        "FROM campaign " +
        `WHERE segments.date BETWEEN '${options.startDate}' AND '${options.endDate}'` +
        campaignFilter,
      "listCampaignStats"
    );
    const byId = new Map<string, GoogleAdsCampaignStats>();
    for (const row of rows) {
      const campaign = asRecord(row.campaign);
      const metrics = asRecord(row.metrics);
      if (!campaign || !metrics) continue;
      const id = String(campaign.id ?? "");
      if (id === "") continue;
      const prev = byId.get(id) ?? {
        campaignId: id,
        campaignName: String(campaign.name ?? ""),
        impressions: 0,
        clicks: 0,
        costMicros: 0,
        conversions: 0,
      };
      prev.impressions += toNumber(metrics.impressions);
      prev.clicks += toNumber(metrics.clicks);
      prev.costMicros += toNumber(metrics.cost_micros);
      prev.conversions += toNumber(metrics.conversions);
      byId.set(id, prev);
    }
    const stats = [...byId.values()].sort((a, b) =>
      a.campaignId < b.campaignId ? -1 : a.campaignId > b.campaignId ? 1 : 0
    );
    if (options.pageSize !== undefined && options.pageSize >= 0) {
      return stats.slice(0, options.pageSize);
    }
    return stats;
  }

  async getAdGroup(
    _campaignId: string,
    _adGroupId: string
  ): Promise<GoogleAdsAdGroup> {
    this.notImplemented("getAdGroup");
  }

  async listAdGroups(
    _campaignId: string,
    _options?: GoogleAdsListOptions
  ): Promise<GoogleAdsAdGroup[]> {
    this.notImplemented("listAdGroups");
  }

  async getAd(_adGroupId: string, _adId: string): Promise<GoogleAdsAd> {
    this.notImplemented("getAd");
  }

  async listAds(
    _adGroupId: string,
    _options?: GoogleAdsListOptions
  ): Promise<GoogleAdsAd[]> {
    this.notImplemented("listAds");
  }

  async listAdGroupCriteria(
    _adGroupId: string,
    _options?: GoogleAdsListOptions
  ): Promise<GoogleAdsAdGroupCriterion[]> {
    this.notImplemented("listAdGroupCriteria");
  }

  async updateEntityUrl(
    _input: UpdateEntityUrlInput
  ): Promise<UpdateEntityUrlResult> {
    this.mutationForbidden("updateEntityUrl");
  }

  async updateAdUrl(
    _adId: string,
    _finalUrl: string,
    _trackingTemplate?: string
  ): Promise<void> {
    this.mutationForbidden("updateAdUrl");
  }

  async uploadConversion(
    _input: ConversionUploadInput
  ): Promise<ConversionUploadResult> {
    this.mutationForbidden("uploadConversion");
  }
}
