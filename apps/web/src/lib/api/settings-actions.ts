"use server";

/**
 * 每租户系统设置（对标 autoads 系统设置）— server actions。
 * 密钥永不回显：AI Key / 代理 URL 只返回「已配置」布尔与个数。
 *
 * Backend contract:
 *   GET    /api/v1/settings
 *   PUT    /api/v1/settings/ai        { provider, model, endpoint?, apiKey? }
 *   DELETE /api/v1/settings/ai
 *   POST   /api/v1/settings/ai/test   { provider?, model?, endpoint?, apiKey? }
 *   PUT    /api/v1/settings/ads       { mccs: [{ name, customerId, mode }] }
 *   PUT    /api/v1/settings/proxies   { urls: string[] }
 *   PUT    /api/v1/settings/system    { defaultCurrency, linkCheckEnabled, linkCheckHour, linkCheckMinute }
 */
import { revalidatePath } from "next/cache";
import {
  EntityApiError,
  getApiBaseUrl,
  mapEntityErrorMessage,
} from "./entities-config";
import { sessionHeaders } from "./session";
import { getLang } from "@/i18n/lang";

export type SettingsActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; forbidden?: boolean };

export type AiProvider = "deepseek" | "gemini" | "relay";

export interface AiModelOption {
  id: string;
  label: string;
}

export interface SettingsAiMasked {
  provider: AiProvider | null;
  model: string;
  endpoint: string;
  apiKeyConfigured: boolean;
}

export interface MccConnection {
  id: string;
  name: string;
  customerId: string;
  mode: "script" | "api";
}

export interface TenantSettings {
  ai: SettingsAiMasked;
  ads: { mccs: MccConnection[] };
  proxies: { count: number };
  system: {
    defaultCurrency: string;
    linkCheckEnabled: boolean;
    linkCheckHour: number;
    linkCheckMinute: number;
  };
  aiModels: Record<AiProvider, AiModelOption[]>;
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
  fn: () => Promise<T>,
  revalidate: string[] = ["/settings"]
): Promise<SettingsActionResult<T>> {
  try {
    const data = await fn();
    for (const p of revalidate) revalidatePath(p);
    return { ok: true, data };
  } catch (error) {
    const forbidden =
      error instanceof EntityApiError && error.status === 403;
    return {
      ok: false,
      error: mapEntityErrorMessage(error, await getLang()),
      forbidden,
    };
  }
}

export async function getSettingsAction() {
  return attempt(() => apiFetch<TenantSettings>("/api/v1/settings"), []);
}

export async function saveSettingsAiAction(input: {
  provider: AiProvider;
  model: string;
  endpoint?: string;
  apiKey?: string;
}) {
  return attempt(() =>
    apiFetch<{ ai: SettingsAiMasked }>("/api/v1/settings/ai", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).then((r) => r.ai)
  );
}

export async function deleteSettingsAiAction() {
  return attempt(() =>
    apiFetch<{ ok: boolean }>("/api/v1/settings/ai", { method: "DELETE" }).then(
      (r) => r.ok
    )
  );
}

export async function testSettingsAiAction(input: {
  provider?: AiProvider;
  model?: string;
  endpoint?: string;
  apiKey?: string;
}) {
  return attempt(
    () =>
      apiFetch<{ ok: boolean; latencyMs?: number; message: string }>(
        "/api/v1/settings/ai/test",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }
      ),
    []
  );
}

export async function saveSettingsAdsAction(
  mccs: Array<{ name: string; customerId: string; mode: "script" | "api" }>
) {
  return attempt(() =>
    apiFetch<{ ads: { mccs: MccConnection[] } }>("/api/v1/settings/ads", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mccs }),
    }).then((r) => r.ads)
  );
}

export async function saveSettingsProxiesAction(urls: string[]) {
  return attempt(() =>
    apiFetch<{ proxies: { count: number } }>("/api/v1/settings/proxies", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    }).then((r) => r.proxies)
  );
}

export async function saveSettingsSystemAction(input: {
  defaultCurrency: string;
  linkCheckEnabled: boolean;
  linkCheckHour: number;
  linkCheckMinute: number;
}) {
  return attempt(() =>
    apiFetch<{ system: TenantSettings["system"] }>("/api/v1/settings/system", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).then((r) => r.system)
  );
}
