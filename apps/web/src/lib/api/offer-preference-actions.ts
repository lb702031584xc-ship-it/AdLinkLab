"use server";

/**
 * P1-6：Offer 自动状态联动 server actions（偏好 + 手动检查）。
 * Server-side only：转发用户 session cookie 到 API。
 */
import { sessionHeaders } from "./session";
import { getApiBaseUrl, mapEntityErrorMessage } from "./entities-config";
import { getLang } from "@/i18n/lang";

export type OfferPreferenceActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface OfferPreferences {
  offerId: string;
  autoStatusEnabled: boolean;
  zeroPerfDays: number;
  roscDeclineDays: number;
}

export interface AutoStatusCheckResult {
  offerId: string;
  offerStatus: string;
  prefs: OfferPreferences;
  suggestion: string;
  willAutoPause: boolean;
  reason: string;
}

async function attempt<T>(fn: () => Promise<T>): Promise<OfferPreferenceActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: mapEntityErrorMessage(e, await getLang()) };
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(await sessionHeaders()) },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Request failed: ${res.status}`);
  return JSON.parse(text) as T;
}

export async function getOfferPreferencesAction(offerId: string) {
  return attempt(() =>
    apiFetch<OfferPreferences>(`/api/v1/offers/${encodeURIComponent(offerId)}/preferences`)
  );
}

export async function updateOfferPreferencesAction(
  offerId: string,
  input: { autoStatusEnabled: boolean; zeroPerfDays: number; roscDeclineDays: number }
) {
  return attempt(() =>
    apiFetch<OfferPreferences>(`/api/v1/offers/${encodeURIComponent(offerId)}/preferences`, {
      method: "PUT",
      body: JSON.stringify(input),
    })
  );
}

export async function checkOfferAutoStatusAction(offerId: string) {
  return attempt(() =>
    apiFetch<AutoStatusCheckResult>(
      `/api/v1/offers/${encodeURIComponent(offerId)}/auto-status/check`,
      { method: "POST", body: JSON.stringify({}) }
    )
  );
}
