"use server";

/**
 * P1 server actions: thin wrappers returning {ok, data} | {ok:false, error}.
 * Never logs secrets.
 */
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";
import {
  P1ApiError,
  ackMonitoringAlert,
  brandCheck,
  createDefaultMonitoringRules,
  createMonitoringRule,
  deleteMonitoringRule,
  getOfferPerformance,
  listMonitoringAlerts,
  listMonitoringErrors,
  listMonitoringRules,
  runMonitoringCheck,
  updateMonitoringRule,
  type BrandCheckResponse,
  type CreateRuleInput,
  type MonitoringAlert,
  type MonitoringError,
  type MonitoringRule,
  type OfferPerformance,
  type UpdateRuleInput,
} from "./p1";

export type P1ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

function mapError(
  e: unknown,
  fallback: string
): { ok: false; error: string; code?: string } {
  if (e instanceof P1ApiError) {
    return {
      ok: false,
      error: e.message,
      code: e.code,
    };
  }
  return {
    ok: false,
    error: e instanceof Error && e.message ? e.message : fallback,
  };
}

async function t() {
  return getDictionary(await getLang());
}

export async function brandCheckAction(
  keywords: string[],
  brandTerms: string[]
): Promise<P1ActionResult<BrandCheckResponse>> {
  const d = (await t()).ai.brand;
  try {
    const data = await brandCheck(keywords, brandTerms);
    return { ok: true, data };
  } catch (e) {
    return mapError(e, d.failed);
  }
}

export async function getOfferPerformanceAction(
  offerId: string,
  days: number
): Promise<P1ActionResult<OfferPerformance>> {
  const d = (await t()).ai.profit;
  try {
    const data = await getOfferPerformance(offerId, days);
    return { ok: true, data };
  } catch (e) {
    return mapError(e, d.statsFailed);
  }
}

export async function listMonitoringRulesAction(): Promise<
  P1ActionResult<MonitoringRule[]>
> {
  const d = (await t()).ai.monitoring;
  try {
    return { ok: true, data: await listMonitoringRules() };
  } catch (e) {
    return mapError(e, d.rulesFailed);
  }
}

export async function createMonitoringRuleAction(
  input: CreateRuleInput
): Promise<P1ActionResult<MonitoringRule>> {
  const d = (await t()).ai.monitoring;
  try {
    return { ok: true, data: await createMonitoringRule(input) };
  } catch (e) {
    return mapError(e, d.ruleSaveFailed);
  }
}

export async function updateMonitoringRuleAction(
  id: string,
  input: UpdateRuleInput
): Promise<P1ActionResult<MonitoringRule>> {
  const d = (await t()).ai.monitoring;
  try {
    return { ok: true, data: await updateMonitoringRule(id, input) };
  } catch (e) {
    return mapError(e, d.ruleSaveFailed);
  }
}

export async function deleteMonitoringRuleAction(
  id: string
): Promise<P1ActionResult<void>> {
  const d = (await t()).ai.monitoring;
  try {
    await deleteMonitoringRule(id);
    return { ok: true, data: undefined };
  } catch (e) {
    return mapError(e, d.ruleDeleteFailed);
  }
}

export async function createDefaultMonitoringRulesAction(): Promise<
  P1ActionResult<MonitoringRule[]>
> {
  const d = (await t()).ai.monitoring;
  try {
    return { ok: true, data: await createDefaultMonitoringRules() };
  } catch (e) {
    return mapError(e, d.ruleSaveFailed);
  }
}

export async function listMonitoringAlertsAction(
  status?: string
): Promise<P1ActionResult<MonitoringAlert[]>> {
  const d = (await t()).ai.monitoring;
  try {
    return { ok: true, data: await listMonitoringAlerts(status) };
  } catch (e) {
    return mapError(e, d.alertsFailed);
  }
}

export async function listMonitoringErrorsAction(): Promise<
  P1ActionResult<MonitoringError[]>
> {
  const d = (await t()).ai.monitoring;
  try {
    return { ok: true, data: await listMonitoringErrors() };
  } catch (e) {
    return mapError(e, d.errorsFailed);
  }
}

export async function ackMonitoringAlertAction(
  id: string
): Promise<P1ActionResult<void>> {
  const d = (await t()).ai.monitoring;
  try {
    await ackMonitoringAlert(id);
    return { ok: true, data: undefined };
  } catch (e) {
    return mapError(e, d.ackFailed);
  }
}

export async function runMonitoringCheckAction(): Promise<
  P1ActionResult<{ checked: number; alertsCreated: number }>
> {
  const d = (await t()).ai.monitoring;
  try {
    return { ok: true, data: await runMonitoringCheck() };
  } catch (e) {
    return mapError(e, d.runFailed);
  }
}
