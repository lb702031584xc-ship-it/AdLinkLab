"use server";

/**
 * 功能2 — 自动化广告 server actions：{ok, data} | {ok:false, error}。
 * 不记录密钥与完整 URL 列表以外的敏感信息。
 */
import { EntityApiError } from "./entities-config";
import {
  confirmAdPlan,
  getClickMonitorScript,
  getCopyPackText,
  getCreateCampaignScript,
  getRotationScript,
  listBulkOperations,
  requestAdPlan,
  rollbackBulkOperation,
  runPreflight,
  type AdPlanAdSchedule,
  type AutoCreateResult,
  type PreflightResult,
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
  opts: { language?: "zh" | "en"; googleAccountId?: string; pageTexts?: Array<string | null>; keywords?: Array<{ text: string; matchType?: string }>; copyStyle?: "official" | "affiliate" | "expert"; serpCaptureId?: string; fxRate?: number; promotion?: string } = {}
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
    /** P1-25：确认时全量替换各组否词（[x]=精确，"x"=词组，裸词=词组）。 */
    negativeKeywords?: string[];
    /** P1-25：确认时全量替换排期。 */
    adSchedules?: AdPlanAdSchedule[];
  }
): Promise<AdsAutoActionResult<ConfirmResult>> {
  try {
    return { ok: true, data: await confirmAdPlan(planId, maxCpc, overrides) };
  } catch (e) {
    return mapError(e, "创建 Script 任务失败，请稍后重试。");
  }
}

export async function runPreflightAction(input: {
  accountId: string;
  landingUrl?: string;
  dailyBudget?: number;
}): Promise<AdsAutoActionResult<PreflightResult>> {
  try {
    return { ok: true, data: await runPreflight(input) };
  } catch (e) {
    return mapError(e, "Preflight 检查失败，请稍后重试。");
  }
}

/** P1-16：批量审计 + 回滚。 */
export async function listBulkOperationsAction(page = 1, pageSize = 20) {
  try {
    return { ok: true as const, data: await listBulkOperations(page, pageSize) };
  } catch (e) {
    return mapError(e, "加载批量审计日志失败，请稍后重试。");
  }
}

export async function rollbackBulkOperationAction(auditLogId: string) {
  try {
    return { ok: true as const, data: await rollbackBulkOperation(auditLogId) };
  } catch (e) {
    return mapError(e, "回滚失败，请稍后重试。");
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

export async function getClickMonitorScriptAction(
  label: string,
  maxClicks: number
): Promise<
  AdsAutoActionResult<{ fileName: string; templateVersion: string; source: string }>
> {
  try {
    return { ok: true, data: await getClickMonitorScript(label, maxClicks) };
  } catch (e) {
    return mapError(e, "生成点击监测 Script 失败，请稍后重试。");
  }
}
