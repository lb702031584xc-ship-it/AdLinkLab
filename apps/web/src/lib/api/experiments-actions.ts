"use server";

/**
 * Experiment server actions: thin wrappers returning
 * {ok, data} | {ok:false, error}. Never logs secrets.
 */
import { zh, en } from "@/i18n/dict/experiment";
import { getLang } from "@/i18n/lang";
import {
  ExperimentApiError,
  cancelExperiment,
  completeExperiment,
  createExperiment,
  getExperiment,
  graduateExperiment,
  listExperiments,
  startExperiment,
  submitExperimentMetrics,
  type CompleteExperimentResult,
  type CreateExperimentInput,
  type Experiment,
  type ExperimentListResult,
  type ExperimentMetrics,
  type ExperimentStatus,
} from "./experiments";

export type ExperimentActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

function mapError(
  e: unknown,
  fallback: string
): { ok: false; error: string; code?: string } {
  if (e instanceof ExperimentApiError) {
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
  return (await getLang()) === "en" ? en : zh;
}

export async function listExperimentsAction(params?: {
  offerId?: string;
  status?: ExperimentStatus;
}): Promise<ExperimentActionResult<ExperimentListResult>> {
  const d = await t();
  try {
    return { ok: true, data: await listExperiments(params) };
  } catch (e) {
    return mapError(e, d.list.loadFailed);
  }
}

export async function getExperimentAction(
  id: string
): Promise<ExperimentActionResult<Experiment>> {
  const d = await t();
  try {
    return { ok: true, data: await getExperiment(id) };
  } catch (e) {
    return mapError(e, d.detail.loadFailed);
  }
}

export async function createExperimentAction(
  input: CreateExperimentInput
): Promise<ExperimentActionResult<Experiment>> {
  const d = await t();
  try {
    return { ok: true, data: await createExperiment(input) };
  } catch (e) {
    return mapError(e, d.form.createFailed);
  }
}

export async function startExperimentAction(
  id: string
): Promise<ExperimentActionResult<Experiment>> {
  const d = await t();
  try {
    return { ok: true, data: await startExperiment(id) };
  } catch (e) {
    return mapError(e, d.detail.startFailed);
  }
}

export async function submitMetricsAction(
  id: string,
  variant: "A" | "B",
  metrics: ExperimentMetrics
): Promise<ExperimentActionResult<Experiment>> {
  const d = await t();
  try {
    return {
      ok: true,
      data: await submitExperimentMetrics(id, variant, metrics),
    };
  } catch (e) {
    return mapError(e, d.detail.metricsFailed);
  }
}

export async function completeExperimentAction(
  id: string
): Promise<ExperimentActionResult<CompleteExperimentResult>> {
  const d = await t();
  try {
    return { ok: true, data: await completeExperiment(id) };
  } catch (e) {
    return mapError(e, d.detail.completeFailed);
  }
}

export async function cancelExperimentAction(
  id: string
): Promise<ExperimentActionResult<Experiment>> {
  const d = await t();
  try {
    return { ok: true, data: await cancelExperiment(id) };
  } catch (e) {
    return mapError(e, d.detail.cancelFailed);
  }
}

/** P1-12：毕业（pause_loser 只返回 Script 指引，不直接暂停）。 */
export async function graduateExperimentAction(
  id: string
): Promise<ExperimentActionResult<Experiment & { graduation: unknown }>> {
  const d = await t();
  try {
    return { ok: true, data: await graduateExperiment(id) };
  } catch (e) {
    return mapError(e, d.detail.graduateFailed ?? d.detail.completeFailed);
  }
}
