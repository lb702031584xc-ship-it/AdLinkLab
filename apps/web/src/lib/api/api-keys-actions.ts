"use server";

/**
 * Admin API key management server actions: create / rotate / revoke.
 * Forwards the admin's session cookie to the API; never logs keys.
 * Create/rotate return the plaintext key exactly once — the caller must
 * display it immediately and never persist it beyond the one-time box.
 */
import { revalidatePath } from "next/cache";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";
import { getLang } from "@/i18n/lang";
import { en, zh, type AdminApiKeysDict } from "@/i18n/dict/admin-api-keys";

export type ApiKeyStatus = "active" | "grace" | "revoked" | "expired";

export interface AdminApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  ipWhitelist: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  graceExpiresAt: string | null;
  lastUsedAt: string | null;
  status: ApiKeyStatus;
  createdAt: string;
  updatedAt: string;
}

export type ApiKeyMutationResult =
  | { ok: true; apiKey: AdminApiKey; key: string }
  | { ok: false; error: string };

export type ApiKeyRevokeResult =
  | { ok: true }
  | { ok: false; error: string };

function dictForLang(lang: string): AdminApiKeysDict {
  return lang === "en" ? en : zh;
}

interface ApiFailure {
  status: number;
  message: string;
}

async function readApiFailure(res: Response): Promise<ApiFailure> {
  let message = "";
  try {
    const body = (await res.json()) as { message?: string };
    if (typeof body.message === "string") message = body.message;
  } catch {
    /* fall through */
  }
  return { status: res.status, message };
}

function mapError(
  action: "create" | "rotate" | "revoke",
  failure: ApiFailure,
  t: AdminApiKeysDict
): string {
  const { status, message } = failure;
  if (status === 0) return t.errors.networkError;
  if (status === 401 || status === 403) return t.errors.forbidden;
  if (status === 404) return t.errors.notFound;
  if (status === 409) {
    if (/already revoked/i.test(message)) return t.errors.alreadyRevoked;
    return t.errors.unknown;
  }
  if (/invalid IP/i.test(message)) return t.errors.invalidIp;
  if (/expiresAt/i.test(message)) return t.errors.invalidExpiry;
  if (action === "create") return t.errors.createFailed;
  if (action === "rotate") return t.errors.rotateFailed;
  return t.errors.revokeFailed;
}

async function callApiKeysApi(
  path: string,
  init: { method: string; body?: unknown }
): Promise<{ res: Response } | { failure: ApiFailure }> {
  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}${path}`, {
      method: init.method,
      headers: {
        ...(await sessionHeaders()),
        "content-type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
  } catch {
    return { failure: { status: 0, message: "" } };
  }
  return { res };
}

/** Admin-only: list this tenant's DB API keys (never includes hashes). */
export async function listApiKeys(): Promise<AdminApiKey[] | null> {
  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}/api/v1/auth/api-keys`, {
      headers: await sessionHeaders(),
      cache: "no-store",
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    const data = (await res.json()) as { apiKeys?: AdminApiKey[] };
    return data.apiKeys ?? [];
  } catch {
    return null;
  }
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Admin-only: create a key. Returns the plaintext key exactly once. */
export async function createApiKeyAction(input: {
  name: string;
  scopes: string;
  ipWhitelist: string;
  expiresAt: string;
}): Promise<ApiKeyMutationResult> {
  const t = dictForLang(await getLang());
  const name = input.name.trim();
  if (!name) return { ok: false, error: t.errors.required };
  const body: Record<string, unknown> = {
    name,
    scopes: splitList(input.scopes),
    ipWhitelist: splitList(input.ipWhitelist),
  };
  const expiresAt = input.expiresAt.trim();
  if (expiresAt) body.expiresAt = expiresAt;

  const call = await callApiKeysApi("/api/v1/auth/api-keys", {
    method: "POST",
    body,
  });
  if ("failure" in call) return { ok: false, error: mapError("create", call.failure, t) };
  if (!call.res.ok) {
    return { ok: false, error: mapError("create", await readApiFailure(call.res), t) };
  }
  const data = (await call.res.json()) as { apiKey: AdminApiKey; key: string };
  revalidatePath("/admin/api-keys");
  return { ok: true, apiKey: data.apiKey, key: data.key };
}

/** Admin-only: rotate a key. Returns the new plaintext key exactly once. */
export async function rotateApiKeyAction(
  keyId: string
): Promise<ApiKeyMutationResult> {
  const t = dictForLang(await getLang());
  const call = await callApiKeysApi(
    `/api/v1/auth/api-keys/${encodeURIComponent(keyId)}/rotate`,
    { method: "POST" }
  );
  if ("failure" in call) return { ok: false, error: mapError("rotate", call.failure, t) };
  if (!call.res.ok) {
    return { ok: false, error: mapError("rotate", await readApiFailure(call.res), t) };
  }
  const data = (await call.res.json()) as { apiKey: AdminApiKey; key: string };
  revalidatePath("/admin/api-keys");
  return { ok: true, apiKey: data.apiKey, key: data.key };
}

/** Admin-only: revoke a key immediately (no grace period). */
export async function revokeApiKeyAction(
  keyId: string
): Promise<ApiKeyRevokeResult> {
  const t = dictForLang(await getLang());
  const call = await callApiKeysApi(
    `/api/v1/auth/api-keys/${encodeURIComponent(keyId)}/revoke`,
    { method: "POST" }
  );
  if ("failure" in call) return { ok: false, error: mapError("revoke", call.failure, t) };
  if (!call.res.ok) {
    return { ok: false, error: mapError("revoke", await readApiFailure(call.res), t) };
  }
  revalidatePath("/admin/api-keys");
  return { ok: true };
}
