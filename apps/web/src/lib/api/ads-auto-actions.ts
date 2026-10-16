"use server";

/**
 * 功能2 — 自动化广告 server actions：{ok, data} | {ok:false, error}。
 * 不记录密钥与完整 URL 列表以外的敏感信息。
 */
import { EntityApiError } from "./entities-config";
import {
  confirmAdPlan,
  getCopyPackText,
  getCreateCampaignScript,
  getRotationScript,
  requestAdPlan,
  type AutoCreateResult,
  type ConfirmResult,
  type CreateCampaignScript,
} from "./ads-auto";

export type AdsAutoActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function mapError(e: unknown, fallback: string): { ok: false; error: string } {
  if (e instanceof EntityApiError) {
    return { ok: false, error: e.message };
  }
  return { ok: false, error: fallback };
}

export async function requestAdPlanAction(
  urls: string[],
  opts: { language?: "zh" | "en"; googleAccountId?: string; pageTexts?: Array<string | null>; keywords?: Array<{ text: string; matchType?: string }>; copyStyle?: "official" | "affiliate" | "expert"; serpCaptureId?: string } = {}
): Promise<AdsAutoActionResult<AutoCreateResult>> {
  try {
    return { ok: true, data: await requestAdPlan(urls, opts) };
  } catch (e) {
    return mapError(e, "生成广告计划失败，请稍后重试。");
  }
}

export async function confirmAdPlanAction(
  planId: string,
  maxCpc?: number,
  overrides?: {
    dailyBudget?: number;
    dailyBudgetCurrency?: string;
    maxCpcCurrency?: string;
    geoTargets?: string[];
  }
): Promise<AdsAutoActionResult<ConfirmResult>> {
  try {
    return { ok: true, data: await confirmAdPlan(planId, maxCpc, overrides) };
  } catch (e) {
    return mapError(e, "创建 Script 任务失败，请稍后重试。");
  }
}

export async function getCopyPackAction(
  planId: string
): Promise<AdsAutoActionResult<{ text: string; fileName: string }>> {
  try {
    const text = await getCopyPackText(planId);
    return {
      ok: true,
      data: { text, fileName: `adlinklab-copy-pack-${planId.slice(0, 8)}.txt` },
    };
  } catch (e) {
    return mapError(e, "下载文案包失败，请稍后重试。");
  }
}

export async function getCreateCampaignScriptAction(
  planId: string
): Promise<AdsAutoActionResult<CreateCampaignScript>> {
  try {
    return { ok: true, data: await getCreateCampaignScript(planId) };
  } catch (e) {
    return mapError(e, "获取 Script 源码失败，请稍后重试。");
  }
}

export async function getRotationScriptAction(
  label: string
): Promise<
  AdsAutoActionResult<{ fileName: string; templateVersion: string; source: string }>
> {
  try {
    return { ok: true, data: await getRotationScript(label) };
  } catch (e) {
    return mapError(e, "生成轮换 Script 失败，请稍后重试。");
  }
}
