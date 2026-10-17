"use server";

/** P2-9：每日预警 server action（原始输入；分级在 Web 端计算）。 */
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";
import type { DailyAlertsInput } from "@/lib/daily-alerts";

export async function getDailyAlertsAction(): Promise<
  | { ok: true; data: DailyAlertsInput }
  | { ok: false; error: string }
> {
  try {
    const base = getApiBaseUrl();
    const headers = await sessionHeaders();
    const res = await fetch(`${base}/api/v1/monitoring/daily-alerts`, {
      headers,
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: text || `请求失败（${res.status}）` };
    }
    return { ok: true, data: (await res.json()) as DailyAlertsInput };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error && e.message ? e.message : "每日预警加载失败",
    };
  }
}
