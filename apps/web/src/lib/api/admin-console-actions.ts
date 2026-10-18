"use server";

/** 管理控制台 server actions。 */
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

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

export interface BackupStatusItem {
  id: string;
  time: string;
  sizeBytes: number;
  verified: boolean;
  status: string;
}

export interface BackupStatus {
  dir: string | null;
  configured: boolean;
  items: BackupStatusItem[];
}

/** 备份状态（admin-only；后端 requireAdmin）。失败返回 null，由 UI 展示错误态。 */
export async function getBackupStatusAction(): Promise<BackupStatus | null> {
  try {
    return await apiFetch<BackupStatus>("/api/v1/admin/backup-status");
  } catch {
    return null;
  }
}
