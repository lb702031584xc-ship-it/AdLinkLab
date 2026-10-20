"use server";

/**
 * 数据管理导出/导入 — server actions。
 *
 * Backend contract:
 *   GET  /api/v1/user-data/export?type=offers|campaigns|settings&format=json|csv
 *   POST /api/v1/user-data/import  { type: "settings", data }
 *   （/api/v1/data/* 已被管理员 data-exchange 占用，用户自助走 /user-data/*）
 */
import {
  EntityApiError,
  getApiBaseUrl,
  mapEntityErrorMessage,
} from "./entities-config";
import { sessionHeaders } from "./session";
import { getLang } from "@/i18n/lang";

export type DataIoResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const base = getApiBaseUrl();
  const headers = await sessionHeaders();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      detail = body.message ?? body.error ?? "";
    } catch {
      /* ignore */
    }
    throw new EntityApiError(
      res.status,
      detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`
    );
  }
  return (await res.json()) as T;
}

export async function exportDataAction(
  type: "offers" | "campaigns" | "settings",
  format: "json" | "csv"
): Promise<DataIoResult<{ filename: string; mime: string; content: string }>> {
  try {
    const data = await apiFetch<{ filename: string; mime: string; content: string }>(
      `/api/v1/user-data/export?type=${type}&format=${format}`
    );
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: mapEntityErrorMessage(error, await getLang()) };
  }
}

export async function importSettingsAction(
  doc: unknown
): Promise<DataIoResult<{ applied: string[]; skipped: string[] }>> {
  try {
    const data = await apiFetch<{ applied: string[]; skipped: string[] }>(
      "/api/v1/user-data/import",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "settings", data: doc }),
      }
    );
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: mapEntityErrorMessage(error, await getLang()) };
  }
}
