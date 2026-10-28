"use server";

/**
 * 「今天」页的数据入口：一次拿回待测 / 该停 / 缺证据 / 校准四块。
 * 与其它 server action 同构（apiFetch + attempt）。
 */
import { EntityApiError, getApiBaseUrl, mapEntityErrorMessage } from "./entities-config";
import { sessionHeaders } from "./session";
import { getLang } from "@/i18n/lang";

export type TodayActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface TodayData {
  counts: {
    total: number;
    go: number;
    unknown: number;
    stop: number;
    notScreened: number;
  };
  toTest: Array<{ id: string; name: string }>;
  recentKills: Array<{
    offerId: string | null;
    name: string | null;
    actionTaken: string;
    at: string;
  }>;
  calibration: {
    samples: number;
    k: number | null;
    confidence: "insufficient" | "weak" | "ok";
    notes: string[];
  };
}

async function apiFetch<T>(path: string): Promise<T> {
  const base = getApiBaseUrl();
  const headers = await sessionHeaders();
  const res = await fetch(`${base}${path}`, { headers, cache: "no-store" });
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
      (data as { message?: string } | null)?.message ??
        `Request failed (${res.status})`
    );
  }
  return data as T;
}

export async function getTodayAction() {
  try {
    return { ok: true as const, data: await apiFetch<TodayData>("/api/v1/today") };
  } catch (error) {
    return {
      ok: false as const,
      error: mapEntityErrorMessage(error, await getLang()),
    };
  }
}
