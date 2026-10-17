"use server";

/** P1-21：DLQ server actions。 */
import { getApiBaseUrl, mapEntityErrorMessage } from "./entities-config";
import { sessionHeaders } from "./session";
import { getLang } from "@/i18n/lang";

export type DeadLetterActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface DeadLetterJob {
  id: string;
  tenantId: string;
  jobName: string;
  payload: unknown;
  error: string | null;
  retryCount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

async function attempt<T>(fn: () => Promise<T>): Promise<DeadLetterActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, error: mapEntityErrorMessage(error, await getLang()) };
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getApiBaseUrl();
  const headers = await sessionHeaders();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...headers },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Dead-letter request failed (HTTP ${res.status}) ${body}`);
  }
  return JSON.parse(await res.text()) as T;
}

export async function listDeadLetterAction(status?: string) {
  return attempt(() =>
    apiFetch<{ items: DeadLetterJob[]; total: number }>(
      `/api/v1/jobs/dead-letter${status ? `?status=${encodeURIComponent(status)}` : ""}`
    )
  );
}

export async function retryDeadLetterAction(id: string) {
  return attempt(() =>
    apiFetch(`/api/v1/jobs/dead-letter/${encodeURIComponent(id)}/retry`, { method: "POST" })
  );
}

export async function discardDeadLetterAction(id: string) {
  return attempt(() =>
    apiFetch(`/api/v1/jobs/dead-letter/${encodeURIComponent(id)}/discard`, { method: "POST" })
  );
}
