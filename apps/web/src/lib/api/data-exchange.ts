import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

/** P1-27：数据导出/导入（导出默认脱敏；导入跳过受保护 Token）。 */
export type DataExchangeKind = "offers" | "campaigns" | "settings";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getApiBaseUrl();
  const headers = await sessionHeaders();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...headers },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `请求失败（${res.status}）`);
  }
  return res.json() as Promise<T>;
}

export async function exportData(kind: DataExchangeKind, includeSensitive: boolean) {
  return apiFetch<{
    exportedBy: string;
    version: number;
    exportedAt: string;
    kind: string;
    sensitiveIncluded: boolean;
    items: unknown[];
  }>("/api/v1/data/export", {
    method: "POST",
    body: JSON.stringify({ kind, includeSensitive }),
  });
}

export async function importData(kind: DataExchangeKind, data: unknown) {
  return apiFetch<{
    kind: string;
    applied: boolean;
    mode: string;
    note: string;
    wouldImport: string[];
    skippedProtected: string[];
    created?: number;
    replayed?: number;
    skipped: unknown;
  }>("/api/v1/data/import", {
    method: "POST",
    body: JSON.stringify({ kind, data }),
  });
}
