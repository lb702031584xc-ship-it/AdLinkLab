"use server";

/**
 * 测试止损（第七批）server actions.
 *
 * 后端契约：
 *   GET /api/v1/offers/:id/kill-switch → config（含 testSpendCap/testZeroConvSpend）
 *   PUT /api/v1/offers/:id/kill-switch → 保存阈值
 *   GET /api/v1/offers/:id/test-spend  → { spend, clicks, conversions, testSpendCap, testZeroConvSpend }
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export interface KillSwitchConfigData {
  offerId: string;
  enabled: boolean;
  maxSpend: number | null;
  minExpectedProfit: number | null;
  minCvr: number | null;
  maxPolicyRisk: number | null;
  pauseOnMerchantTerminated: boolean;
  testSpendCap: number | null;
  testZeroConvSpend: number | null;
  /** P0-10: also queue a Google Ads campaign-toggle PAUSE on auto-pause. */
  pauseGoogleAdsToo: boolean;
  configured: boolean;
}

export interface TestSpendData {
  offerId: string;
  spend: number | null;
  clicks: number | null;
  conversions: number | null;
  testSpendCap: number | null;
  testZeroConvSpend: number | null;
}

export type KillSwitchActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function callApi<T>(
  path: string,
  method: "GET" | "PUT",
  body?: Record<string, unknown>
): Promise<KillSwitchActionResult<T>> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", ...authHeaders },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "网络请求失败，请稍后重试。" };
  }
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `请求失败（${res.status}）`;
    try {
      const b = (await res.json()) as { message?: string; error?: string };
      message = b.message ?? b.error ?? message;
    } catch {
      // 忽略解析失败
    }
    return { ok: false, error: message };
  }
  try {
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, error: "响应解析失败。" };
  }
}

export async function getKillSwitchAction(
  offerId: string
): Promise<KillSwitchActionResult<KillSwitchConfigData>> {
  return callApi<KillSwitchConfigData>(
    `/api/v1/offers/${encodeURIComponent(offerId)}/kill-switch`,
    "GET"
  );
}

export async function saveKillSwitchAction(
  offerId: string,
  input: {
    enabled: boolean;
    testSpendCap: number | null;
    testZeroConvSpend: number | null;
    pauseGoogleAdsToo?: boolean;
  }
): Promise<KillSwitchActionResult<KillSwitchConfigData>> {
  return callApi<KillSwitchConfigData>(
    `/api/v1/offers/${encodeURIComponent(offerId)}/kill-switch`,
    "PUT",
    input
  );
}

export async function getTestSpendAction(
  offerId: string
): Promise<KillSwitchActionResult<TestSpendData>> {
  return callApi<TestSpendData>(
    `/api/v1/offers/${encodeURIComponent(offerId)}/test-spend`,
    "GET"
  );
}
