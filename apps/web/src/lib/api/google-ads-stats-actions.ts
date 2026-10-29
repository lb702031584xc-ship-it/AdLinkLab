"use server";

/**
 * Google Ads 效果数据 — server actions。
 * Backend: GET /api/v1/google-accounts/:id/campaign-stats（provider 直读）。
 * 与 campaigns-actions 的站内聚合区分：这里是 Google Ads API 的效果数。
 */
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export interface GoogleAdsCampaignStatRow {
  campaignId: string;
  campaignName: string;
  impressions: number;
  clicks: number;
  costMicros: number;
  conversions: number;
}

export interface GoogleAdsCampaignStatsResult {
  accountId: string;
  customerId: string;
  provider: "mock" | "api";
  currency: string;
  startDate: string;
  endDate: string;
  stats: GoogleAdsCampaignStatRow[];
}

export async function getGoogleAdsCampaignStatsAction(
  accountId: string,
  startDate: string,
  endDate: string
): Promise<GoogleAdsCampaignStatsResult> {
  const base = getApiBaseUrl();
  const headers = await sessionHeaders();
  const qs = new URLSearchParams({ startDate, endDate }).toString();
  const res = await fetch(
    `${base}/api/v1/google-accounts/${encodeURIComponent(accountId)}/campaign-stats?${qs}`,
    { headers, cache: "no-store" }
  );
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { message?: unknown; error?: unknown };
      if (typeof data.message === "string" && data.message) {
        message = data.message;
      } else if (typeof data.error === "string" && data.error) {
        message = data.error;
      }
    } catch {
      // Keep the status-based message.
    }
    throw new Error(message);
  }
  return (await res.json()) as GoogleAdsCampaignStatsResult;
}
