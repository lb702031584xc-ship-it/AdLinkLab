"use server";

/**
 * 初筛（零成本杀法则）server actions。
 * - 黑名单检查：POST /api/v1/catalog/blacklist/check-offer（需 offerId；
 *   手动 offer 无 ID 时调用方不调，直接标 unknown）。
 * - 付费为零阈值：GET /api/v1/traffic/thresholds（取 organicTrafficMin /
 *   paidTrafficWarnRatio；失败回退默认值，fail-soft）。
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export type BlacklistCheckResult =
  | {
      ok: true;
      blacklisted: boolean;
      reason?: string;
      matched?: { entityType: string; entityId: string };
    }
  | { ok: false; error: string };

export async function checkOfferBlacklistAction(
  offerId: string,
): Promise<BlacklistCheckResult> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/catalog/blacklist/check-offer`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders },
      body: JSON.stringify({ offerId }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "网络请求失败，请稍后重试。" };
  }
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `黑名单检查失败（${res.status}）`;
    try {
      const body = (await res.json()) as {
        message?: string;
        error?: string;
      };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    return { ok: false, error: message };
  }
  try {
    const data = (await res.json()) as {
      blacklisted?: boolean;
      reason?: string;
      matched?: { entityType: string; entityId: string };
    };
    return {
      ok: true,
      blacklisted: data.blacklisted === true,
      reason: data.reason,
      matched: data.matched,
    };
  } catch {
    return { ok: false, error: "黑名单检查结果解析失败。" };
  }
}

/** 付费为零规则阈值（与后端 DEFAULT_TRAFFIC_THRESHOLDS 一致的回退值）。 */
export interface PaidZeroThresholds {
  organicTrafficMin: number;
  paidTrafficWarnRatio: number;
}

const FALLBACK_THRESHOLDS: PaidZeroThresholds = {
  organicTrafficMin: 1000,
  paidTrafficWarnRatio: 0.05,
};

export async function getPaidZeroThresholdsAction(): Promise<PaidZeroThresholds> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  try {
    const res = await fetch(`${base}/api/v1/traffic/thresholds`, {
      headers: { ...authHeaders },
      cache: "no-store",
    });
    if (res.status === 401) redirect("/login");
    if (!res.ok) return FALLBACK_THRESHOLDS;
    const body = (await res.json()) as {
      thresholds?: Partial<PaidZeroThresholds>;
      organicTrafficMin?: unknown;
      paidTrafficWarnRatio?: unknown;
    };
    // 后端返回 { thresholds } 包裹；防御性兼容裸对象。
    const t = (body.thresholds ?? body) as Partial<PaidZeroThresholds>;
    const organicTrafficMin =
      typeof t.organicTrafficMin === "number" && t.organicTrafficMin > 0
        ? t.organicTrafficMin
        : FALLBACK_THRESHOLDS.organicTrafficMin;
    const paidTrafficWarnRatio =
      typeof t.paidTrafficWarnRatio === "number" &&
      t.paidTrafficWarnRatio > 0 &&
      t.paidTrafficWarnRatio < 1
        ? t.paidTrafficWarnRatio
        : FALLBACK_THRESHOLDS.paidTrafficWarnRatio;
    return { organicTrafficMin, paidTrafficWarnRatio };
  } catch {
    return FALLBACK_THRESHOLDS;
  }
}
