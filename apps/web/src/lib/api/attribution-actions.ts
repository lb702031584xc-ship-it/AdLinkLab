"use server";

/**
 * P1-11：归因冲突 + 归因设置 + 归因拆分 server actions。
 */
import { sessionHeaders } from "./session";
import { getApiBaseUrl, mapEntityErrorMessage } from "./entities-config";
import { getLang } from "@/i18n/lang";

export type AttributionActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface AttributionSettings {
  tenantId: string;
  attributionWindowDays: number;
  gclidDedupeMinutes: number;
  duplicateClicksCountAsConversion: boolean;
}

export interface AttributionConflict {
  id: string;
  orderId: string;
  mainOfferId: string | null;
  conflictOfferIds: unknown;
  reason: string | null;
  status: string;
  resolvedOfferId: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface AttributionReport {
  attributable: {
    orders: number;
    value: number;
    byOffer: Array<{ offerId: string; orders: number; value: number }>;
  };
  unattributable: { orders: number; value: number; note: string };
  total: { orders: number; value: number };
}

async function attempt<T>(fn: () => Promise<T>): Promise<AttributionActionResult<T>> {
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

export async function getAttributionSettingsAction() {
  return attempt(() => apiFetch<AttributionSettings>("/api/v1/attribution/settings"));
}

export async function updateAttributionSettingsAction(input: {
  attributionWindowDays: number;
  gclidDedupeMinutes: number;
  duplicateClicksCountAsConversion: boolean;
}) {
  return attempt(() =>
    apiFetch<AttributionSettings>("/api/v1/attribution/settings", {
      method: "PUT",
      body: JSON.stringify(input),
    })
  );
}

export async function listAttributionConflictsAction() {
  return attempt(() =>
    apiFetch<{ items: AttributionConflict[] }>("/api/v1/attribution/conflicts")
  );
}

export async function resolveAttributionConflictAction(id: string, resolvedOfferId: string) {
  return attempt(() =>
    apiFetch(`/api/v1/attribution/conflicts/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      body: JSON.stringify({ resolvedOfferId }),
    })
  );
}

export async function getAttributionReportAction() {
  return attempt(() => apiFetch<AttributionReport>("/api/v1/reports/attribution"));
}
