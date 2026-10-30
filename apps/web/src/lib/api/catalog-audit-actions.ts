"use server";

/**
 * 全站体检 server action。
 */
import { EntityApiError, getApiBaseUrl, mapEntityErrorMessage } from "./entities-config";
import { sessionHeaders } from "./session";
import { getLang } from "@/i18n/lang";

export interface AuditPickedItem {
  productId: string;
  name: string;
  brand: string | null;
  payoutUsd: number;
  expectedPayoutUsd: number;
  breakevenCpcUsd: number;
  countryCode: string | null;
  category: string;
  baselineSource: string;
  cpcUsd: number;
  roi: number | null;
  verdict: "invest" | "breakeven" | "unknown";
}

export interface AuditPayload {
  picked: AuditPickedItem[];
  dropped: Array<{ productId: string; name: string; category: string; reason: string }>;
  counts: { total: number; picked: number; dropped: number; categories: number };
  notes: string[];
  /** 类目 CPC 探针（DataForSEO）的结果。 */
  probe?: {
    used: boolean;
    categories: number;
    note: string | null;
  };
}

export async function catalogAuditAction(input: {
  minReviews?: number;
  minPayoutUsd?: number;
}) {
  try {
    const base = getApiBaseUrl();
    const headers = await sessionHeaders();
    const res = await fetch(`${base}/api/v1/catalog/audit`, {
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
    return { ok: true as const, data: data as AuditPayload };
  } catch (error) {
    return { ok: false as const, error: mapEntityErrorMessage(error, await getLang()) };
  }
}
