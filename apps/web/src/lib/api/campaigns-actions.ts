"use server";

/**
 * 广告系列卡片统计 — server actions。
 * Backend: GET /api/v1/campaigns/stats?ids=<csv>（真实聚合，不造数）。
 */
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export interface CampaignStat {
  campaignId: string;
  adGroups: number;
  trackingLinks: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
}

export async function getCampaignStatsAction(
  ids: string[]
): Promise<Record<string, CampaignStat>> {
  if (ids.length === 0) return {};
  try {
    const base = getApiBaseUrl();
    const headers = await sessionHeaders();
    const res = await fetch(
      `${base}/api/v1/campaigns/stats?ids=${encodeURIComponent(ids.join(","))}`,
      { headers, cache: "no-store" }
    );
    if (!res.ok) return {};
    const data = (await res.json()) as { stats: CampaignStat[] };
    const out: Record<string, CampaignStat> = {};
    for (const s of data.stats ?? []) out[s.campaignId] = s;
    return out;
  } catch {
    return {};
  }
}
