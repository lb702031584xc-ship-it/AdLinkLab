"use server";

/**
 * DataForSEO 关键词流水线 server actions（转发到 API 的 /api/v1/keywords/*）。
 * 全部是实测数据（付费），不走 LLM；错误透出 API 的 message（含未配置指引）。
 */
import { redirect } from "next/navigation";
import { EntityApiError, getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export interface DfsCandidate {
  keyword: string;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
  competitionLevel: string | null;
}

export interface DfsExpandResult {
  seed: string;
  locationCode: number;
  languageCode: string;
  limit: number;
  candidates: DfsCandidate[];
  total: number;
  cached: boolean;
}

export interface DfsIntentItem {
  keyword: string;
  intent: string | null;
  probability: number | null;
}

export interface DfsIntentResult {
  verified: boolean;
  configured?: boolean;
  error?: string;
  results: DfsIntentItem[];
}

export interface DfsMeasureRow {
  keyword: string;
  searchVolume: number | null;
  cpc: number | null;
  competition: string | null;
  competitionIndex: number | null;
  lowTopBid: number | null;
  highTopBid: number | null;
}

export interface DfsMeasureResult {
  rows: DfsMeasureRow[];
  total: number;
  requestedCount: number;
  limit: number;
  estimate: boolean;
  measuredAt: string;
}

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new EntityApiError(0, "无法连接到 API 服务");
  }
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `请求失败（${res.status}）`;
    try {
      const parsed = (await res.json()) as { message?: string; error?: string };
      message = parsed.message ?? parsed.error ?? message;
    } catch {
      /* ignore */
    }
    throw new EntityApiError(res.status, message);
  }
  return (await res.json()) as T;
}

function toResult<T>(p: Promise<T>): Promise<ActionResult<T>> {
  return p.then(
    (data) => ({ ok: true as const, data }),
    (e: unknown) => ({
      ok: false as const,
      error:
        e instanceof EntityApiError
          ? e.message
          : "操作失败，请稍后重试。",
    })
  );
}

export async function expandKeywordsAction(input: {
  seed: string;
  locationCode?: number;
  languageCode?: string;
  limit?: number;
}): Promise<ActionResult<DfsExpandResult>> {
  return toResult(apiPost<DfsExpandResult>("/api/v1/keywords/expand", input));
}

export async function intentFilterAction(input: {
  keywords: string[];
  locationCode?: number;
  languageCode?: string;
}): Promise<ActionResult<DfsIntentResult>> {
  return toResult(
    apiPost<DfsIntentResult>("/api/v1/keywords/intent-filter", input)
  );
}

export async function adMeasureAction(input: {
  keywords: string[];
  locationCode?: number;
  languageCode?: string;
  limit?: number;
}): Promise<ActionResult<DfsMeasureResult>> {
  return toResult(apiPost<DfsMeasureResult>("/api/v1/keywords/ad-measure", input));
}
