/**
 * 工作台状态持久化 API 客户端（server-side only）。
 * 通过 sessionHeaders 转发用户 alk_session cookie；不记录密钥。
 */
import { redirect } from "next/navigation";
import {
  EntityApiError,
  getApiBaseUrl,
} from "./entities-config";
import { sessionHeaders } from "./session";

export type WorkStatePage =
  | "ai-worksheet"
  | "keyword-launch"
  | "keyword-research"
  | "traffic-planner"
  | "ai-terms"
  | "ai-compliance"
  | "ai-blueprint"
  | "ads-auto";

export interface WorkStateHistoryItem {
  id: string;
  offerId: string | null;
  label: string | null;
  updatedAt: string;
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...authHeaders,
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new EntityApiError(0, "无法连接到 API 服务");
  }
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `请求失败（${res.status}）`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    throw new EntityApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export async function saveWorkState(
  page: WorkStatePage,
  state: Record<string, unknown>,
  opts: { offerId?: string | null; label?: string | null } = {}
): Promise<{ id: string; updatedAt: string }> {
  return apiFetch<{ id: string; updatedAt: string }>("/api/v1/work-state", {
    method: "PUT",
    body: JSON.stringify({
      page,
      offerId: opts.offerId ?? null,
      label: opts.label ?? null,
      state,
    }),
  });
}

export async function loadWorkState(
  page: WorkStatePage,
  offerId?: string | null
): Promise<{ state: Record<string, unknown> | null; label: string | null; updatedAt: string | null }> {
  const q = new URLSearchParams({ page });
  if (offerId) q.set("offerId", offerId);
  const res = await apiFetch<{
    state: Record<string, unknown> | null;
    label?: string | null;
    updatedAt?: string;
  }>(`/api/v1/work-state?${q.toString()}`);
  return {
    state: res.state,
    label: res.label ?? null,
    updatedAt: res.updatedAt ?? null,
  };
}

export async function listWorkStateHistory(
  page: WorkStatePage,
  opts: { offerId?: string | null; limit?: number } = {}
): Promise<WorkStateHistoryItem[]> {
  const q = new URLSearchParams({ page });
  if (opts.offerId) q.set("offerId", opts.offerId);
  if (opts.limit) q.set("limit", String(opts.limit));
  const res = await apiFetch<{ items: WorkStateHistoryItem[] }>(
    `/api/v1/work-state/history?${q.toString()}`
  );
  return res.items ?? [];
}
