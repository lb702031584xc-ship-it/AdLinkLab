"use server";

/**
 * 关键词 AI 检查 server action：{ok, data} | {ok:false, error}。
 * 投流前逐词判定相关性与政策风险（relevant / irrelevant / risky）。
 * 不记录密钥与完整关键词列表以外的敏感信息。
 */
import { redirect } from "next/navigation";
import { EntityApiError, getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export type KeywordCheckResult = {
  keyword: string;
  verdict: "relevant" | "irrelevant" | "risky";
  reason: string;
};

export type KeywordCheckActionResult =
  | { ok: true; data: { results: KeywordCheckResult[] } }
  | { ok: false; error: string };

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        // 无 body 的请求不带 JSON 头，否则 Fastify 会因
        // "application/json + 空 body" 直接 400
        ...(init.body != null ? { "content-type": "application/json" } : {}),
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

export async function checkKeywordsAction(input: {
  productDescription: string;
  offerName: string;
  offerUrl?: string;
  keywords: string[];
}): Promise<KeywordCheckActionResult> {
  try {
    const data = await apiFetch<{ results: KeywordCheckResult[] }>(
      "/api/v1/ai/check-keywords",
      {
        method: "POST",
        body: JSON.stringify({
          productDescription: input.productDescription,
          offerName: input.offerName,
          offerUrl: input.offerUrl || undefined,
          keywords: input.keywords,
        }),
      }
    );
    return { ok: true, data };
  } catch (e) {
    if (e instanceof EntityApiError) {
      return { ok: false, error: e.message };
    }
    return { ok: false, error: "关键词检查失败，请稍后重试。" };
  }
}
