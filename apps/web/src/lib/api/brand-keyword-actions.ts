"use server";

/**
 * 品牌词分级管理 server actions（server-side only）。
 * Forwards the user's `alk_session` cookie to the API. Never logs tokens.
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export interface BrandKeyword {
  id: string;
  tenantId: string;
  keyword: string;
  brand: string | null;
  offerId: string | null;
  biddingEnabled: boolean;
  status: string;
  warningCount: number;
  lastWarningKind: string | null;
  lastWarningAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type BrandKeywordActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function brandKeywordFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...authHeaders,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `Brand keyword API ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

function toError(e: unknown): { ok: false; error: string } {
  return {
    ok: false,
    error: e instanceof Error && e.message ? e.message : "Unknown error",
  };
}

export async function listBrandKeywordsAction(): Promise<
  BrandKeywordActionResult<BrandKeyword[]>
> {
  try {
    const data = await brandKeywordFetch<{ keywords: BrandKeyword[] }>(
      "/api/v1/brand-keywords"
    );
    return { ok: true, data: data.keywords };
  } catch (e) {
    return toError(e);
  }
}

export async function createBrandKeywordAction(input: {
  keyword: string;
  brand?: string | null;
  offerId?: string | null;
}): Promise<BrandKeywordActionResult<BrandKeyword>> {
  try {
    const data = await brandKeywordFetch<{ keyword: BrandKeyword }>(
      "/api/v1/brand-keywords",
      { method: "POST", body: JSON.stringify(input) }
    );
    return { ok: true, data: data.keyword };
  } catch (e) {
    return toError(e);
  }
}

export async function updateBrandKeywordAction(
  id: string,
  patch: Partial<{
    biddingEnabled: boolean;
    status: string;
    brand: string | null;
    offerId: string | null;
  }>
): Promise<BrandKeywordActionResult<BrandKeyword>> {
  try {
    const data = await brandKeywordFetch<{ keyword: BrandKeyword }>(
      `/api/v1/brand-keywords/${id}`,
      { method: "PATCH", body: JSON.stringify(patch) }
    );
    return { ok: true, data: data.keyword };
  } catch (e) {
    return toError(e);
  }
}

export async function warnBrandKeywordAction(
  id: string,
  kind: string
): Promise<BrandKeywordActionResult<BrandKeyword>> {
  try {
    const data = await brandKeywordFetch<{ keyword: BrandKeyword }>(
      `/api/v1/brand-keywords/${id}/warning`,
      { method: "POST", body: JSON.stringify({ kind }) }
    );
    return { ok: true, data: data.keyword };
  } catch (e) {
    return toError(e);
  }
}

export async function reenableBrandKeywordAction(
  id: string
): Promise<BrandKeywordActionResult<BrandKeyword>> {
  try {
    const data = await brandKeywordFetch<{ keyword: BrandKeyword }>(
      `/api/v1/brand-keywords/${id}/reenable`,
      { method: "POST", body: JSON.stringify({}) }
    );
    return { ok: true, data: data.keyword };
  } catch (e) {
    return toError(e);
  }
}
