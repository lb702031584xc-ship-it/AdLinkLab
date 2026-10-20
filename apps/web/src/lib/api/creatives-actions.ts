"use server";

/**
 * 创意管理库 — server actions。
 *
 * Backend contract:
 *   GET    /api/v1/creatives?status=&offerId=&q=&page=&pageSize=
 *   POST   /api/v1/creatives                  { title, description, finalUrl?, angle?, offerId?, source? }
 *   PUT    /api/v1/creatives/:id              { title?, description?, finalUrl?, angle?, offerId?, status? }
 *   DELETE /api/v1/creatives/:id
 *   POST   /api/v1/creatives/import-archive   { archiveId? }
 */
import { revalidatePath } from "next/cache";
import {
  EntityApiError,
  getApiBaseUrl,
  mapEntityErrorMessage,
} from "./entities-config";
import { sessionHeaders } from "./session";
import { getLang } from "@/i18n/lang";

export type CreativesActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface Creative {
  id: string;
  tenantId: string;
  offerId: string | null;
  offerName: string | null;
  title: string;
  description: string;
  finalUrl: string | null;
  angle: string | null;
  status: "DRAFT" | "USED" | "ARCHIVED";
  source: "MANUAL" | "AI" | "ARCHIVE";
  createdAt: string;
  updatedAt: string;
}

export interface CreativeListResult {
  items: Creative[];
  total: number;
  page: number;
  pageSize: number;
}

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

async function attempt<T>(
  fn: () => Promise<T>
): Promise<CreativesActionResult<T>> {
  try {
    const data = await fn();
    revalidatePath("/creatives");
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: mapEntityErrorMessage(error, await getLang()),
    };
  }
}

export async function listCreativesAction(params: {
  status?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}) {
  const sp = new URLSearchParams();
  if (params.status) sp.set("status", params.status);
  if (params.q) sp.set("q", params.q);
  sp.set("page", String(params.page ?? 1));
  sp.set("pageSize", String(params.pageSize ?? 50));
  return attempt(() =>
    apiFetch<CreativeListResult>(`/api/v1/creatives?${sp.toString()}`)
  );
}

export async function createCreativeAction(input: {
  title: string;
  description: string;
  finalUrl?: string;
  angle?: string;
  offerId?: string;
}) {
  return attempt(() =>
    apiFetch<{ creative: Creative }>("/api/v1/creatives", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).then((r) => r.creative)
  );
}

export async function updateCreativeAction(
  id: string,
  input: Partial<{
    title: string;
    description: string;
    finalUrl: string | null;
    angle: string | null;
    status: "DRAFT" | "USED" | "ARCHIVED";
  }>
) {
  return attempt(() =>
    apiFetch<{ creative: Creative }>(`/api/v1/creatives/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).then((r) => r.creative)
  );
}

export async function deleteCreativeAction(id: string) {
  return attempt(() =>
    apiFetch<{ ok: boolean }>(`/api/v1/creatives/${id}`, {
      method: "DELETE",
    }).then((r) => r.ok)
  );
}

export async function importArchiveCreativesAction() {
  return attempt(() =>
    apiFetch<{ created: number; skipped: number; archives: number }>(
      "/api/v1/creatives/import-archive",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
    )
  );
}
