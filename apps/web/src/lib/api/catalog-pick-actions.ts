"use server";

/**
 * 商品库挑选 server action。
 */
import { EntityApiError, getApiBaseUrl, mapEntityErrorMessage } from "./entities-config";
import { sessionHeaders } from "./session";
import { getLang } from "@/i18n/lang";

export interface CatalogPickItem {
  productId: string;
  name: string;
  brand: string | null;
  payoutUsd: number;
  /** 预期每单佣金（页面佣金 × 折损系数）。 */
  expectedPayoutUsd?: number;
  breakevenCpcUsd: number;
  countryCode: string | null;
  note: string;
}

export interface CatalogPickDropped {
  productId: string;
  name: string;
  brand: string | null;
  code: string;
  reason: string;
}

export interface CatalogPickPayload {
  baseline: {
    cpcUsd: number;
    source: string;
    samples: number;
    confidence: string;
    note: string;
  };
  /** 按类目 CPC 反推的建议佣金门槛（美元）；0 = 算不出来。 */
  suggestedMinCommissionUsd?: number;
  result: {
    picked: CatalogPickItem[];
    dropped: CatalogPickDropped[];
    counts: { total: number; picked: number; dropped: number };
    summary: { topDropCode: string | null; topDropCount: number };
    notes: string[];
  };
}

export async function catalogPickAction(input: {
  minPayoutUsd?: number;
  category?: string;
  broadCategory?: string;
  perBrand?: number;
}) {
  try {
    const base = getApiBaseUrl();
    const headers = await sessionHeaders();
    const res = await fetch(`${base}/api/v1/catalog/pick`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      throw new EntityApiError(
        res.status,
        (data as { message?: string } | null)?.message ?? `Request failed (${res.status})`
      );
    }
    return { ok: true as const, data: data as CatalogPickPayload };
  } catch (error) {
    return { ok: false as const, error: mapEntityErrorMessage(error, await getLang()) };
  }
}
