"use server";

/**
 * 点击对账 server action：把两边点击数发给后端，拿回损耗判定。
 */
import { EntityApiError, getApiBaseUrl, mapEntityErrorMessage } from "./entities-config";
import { sessionHeaders } from "./session";
import { getLang } from "@/i18n/lang";

export interface ClickReconcileResult {
  googleClicks: number;
  networkClicks: number;
  lossRatePct: number | null;
  verdict: "ok" | "warning" | "critical" | "unknown";
  timezoneSuspected: boolean;
  causes: Array<{ cause: string; likelihood: "high" | "medium" | "low"; check: string }>;
  actions: string[];
  notes: string[];
}

export async function reconcileClicksAction(googleClicks: number, networkClicks: number) {
  try {
    const base = getApiBaseUrl();
    const headers = await sessionHeaders();
    const res = await fetch(`${base}/api/v1/tracking/click-reconcile`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ googleClicks, networkClicks }),
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
    return { ok: true as const, data: data as ClickReconcileResult };
  } catch (error) {
    return { ok: false as const, error: mapEntityErrorMessage(error, await getLang()) };
  }
}
