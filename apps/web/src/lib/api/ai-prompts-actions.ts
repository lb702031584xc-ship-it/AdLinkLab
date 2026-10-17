"use server";

/** P1-18：提示词 DB 化 — server actions（admin/owner）。 */
import { revalidatePath } from "next/cache";
import { sessionHeaders } from "./session";
import { getApiBaseUrl, mapEntityErrorMessage } from "./entities-config";
import { getLang } from "@/i18n/lang";

export type AiPromptActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function attempt<T>(fn: () => Promise<T>): Promise<AiPromptActionResult<T>> {
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
    throw new Error(`AI prompts request failed (HTTP ${res.status}) ${body}`);
  }
  return JSON.parse(await res.text()) as T;
}

export interface AiPromptRow {
  id: string;
  key: string;
  version: string;
  isActive: boolean;
  updatedAt: string;
  contentPreview?: string;
  content?: string;
}

export async function listAiPromptsAction() {
  return attempt(() =>
    apiFetch<{ items: AiPromptRow[] }>("/api/v1/admin/ai-prompts")
  );
}

export async function getAiPromptsByKeyAction(key: string) {
  return attempt(() =>
    apiFetch<{ items: AiPromptRow[] }>(
      `/api/v1/admin/ai-prompts/${encodeURIComponent(key)}`
    )
  );
}

export async function saveAiPromptAction(input: {
  key: string;
  version: string;
  content?: string;
}) {
  const res = await attempt(() =>
    apiFetch(`/api/v1/admin/ai-prompts/${encodeURIComponent(input.key)}`, {
      method: "PUT",
      body: JSON.stringify({ version: input.version, content: input.content }),
    })
  );
  if (res.ok) revalidatePath("/admin/ai-prompts");
  return res;
}
