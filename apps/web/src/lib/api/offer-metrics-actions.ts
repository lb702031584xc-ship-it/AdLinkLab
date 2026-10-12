"use server";

/**
 * Offer 最终链接指标抓取 + 推荐指数 server actions.
 *
 * 后端契约：POST /api/v1/offers/:id/fetch-metrics
 *   → { offerId, metrics, score, grade, breakdown, metricsSummary }
 * 客户端组件通过这里调用，避免 import server-only 模块。
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export interface MetricsSummary {
  score: number | null;
  grade: string | null;
  fetchedAt: string;
}

export interface OfferMetricsData {
  url: string;
  finalUrl: string | null;
  title: string | null;
  price: number | null;
  currency: string | null;
  rating: number | null;
  reviewCount: number | null;
  soldCount: number | null;
  availability: string | null;
  bsr: number | null;
  fetchedAt: string;
  failures: string[];
}

export interface ScoreBreakdownItem {
  key: string;
  weight: number;
  contributed: boolean;
  rawValue: number | null;
  score: number | null;
}

export interface FetchMetricsResult {
  offerId: string;
  metrics: OfferMetricsData;
  score: number | null;
  grade: string | null;
  breakdown: ScoreBreakdownItem[];
  metricsSummary: MetricsSummary;
}

export type OfferMetricsActionResult =
  | { ok: true; data: FetchMetricsResult }
  | { ok: false; error: string };

export async function fetchOfferMetricsAction(
  offerId: string
): Promise<OfferMetricsActionResult> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(
      `${base}/api/v1/offers/${encodeURIComponent(offerId)}/fetch-metrics`,
      {
        method: "POST",
        headers: { ...authHeaders },
        cache: "no-store",
      }
    );
  } catch {
    return { ok: false, error: "网络请求失败，请稍后重试。" };
  }
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `抓取失败（${res.status}）`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      // 忽略解析失败
    }
    return { ok: false, error: message };
  }
  try {
    const data = (await res.json()) as FetchMetricsResult;
    return { ok: true, data };
  } catch {
    return { ok: false, error: "响应解析失败。" };
  }
}
