"use server";

/**
 * 导航毕业进度：跑够多少个 offer 之后可以解锁更深的模块。
 * 与其它 server action 同构（fetch + 错误映射）。
 */
import { EntityApiError, getApiBaseUrl, mapEntityErrorMessage } from "./entities-config";
import { sessionHeaders } from "./session";
import { getLang } from "@/i18n/lang";

export interface NavProgress {
  suggestedLevel: 0 | 1 | 2;
  reasons: string[];
  progress: {
    screenedOffers: number;
    archivesRun: number;
    totalSpend: number;
    hasPositiveRoi: boolean;
  };
  thresholds: {
    level1: { archives: number; screened: number; spend: number };
    level2: { archives: number; spend: number };
  };
}

export async function getNavProgressAction() {
  try {
    const base = getApiBaseUrl();
    const headers = await sessionHeaders();
    const res = await fetch(`${base}/api/v1/nav-progress`, {
      headers,
      cache: "no-store",
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      throw new EntityApiError(
        res.status,
        (data as { message?: string } | null)?.message ??
          `Request failed (${res.status})`
      );
    }
    return { ok: true as const, data: data as NavProgress };
  } catch (error) {
    return {
      ok: false as const,
      error: mapEntityErrorMessage(error, await getLang()),
    };
  }
}
