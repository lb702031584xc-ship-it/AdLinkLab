"use server";

/**
 * Lander Intel ① server actions: thin wrappers returning
 * {ok, data} | {ok:false, error}. Never logs secrets.
 */
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";
import type { P1ActionResult } from "./p1-actions";
import { entityApi } from "./entities";
import {
  LanderApiError,
  analyzeLandingPage,
  checkCompetitorWatchNow,
  createCompetitorWatch,
  deleteCompetitorWatch,
  getLanderAnalysis,
  listCompetitorWatchChanges,
  listCompetitorWatches,
  listLanderAnalyses,
  listLanderTemplates,
  previewLanderTemplate,
  updateCompetitorWatch,
  useLanderTemplate,
  type CompetitorChangeList,
  type CompetitorCheckResult,
  type CompetitorWatch,
  type CompetitorWatchList,
  type CreatedLandingPage,
  type LanderAnalysis,
  type LanderAnalysisList,
  type LanderTemplateList,
  type LanderTemplatePreview,
} from "./lander";

function mapError(
  e: unknown,
  fallback: string
): { ok: false; error: string; code?: string } {
  if (e instanceof LanderApiError) {
    return { ok: false, error: e.message, code: e.code };
  }
  return {
    ok: false,
    error: e instanceof Error && e.message ? e.message : fallback,
  };
}

async function t() {
  return getDictionary(await getLang());
}

export async function analyzeLandingPageAction(
  url: string,
  html?: string
): Promise<P1ActionResult<LanderAnalysis>> {
  const d = (await t()).ai.lander;
  try {
    const data = await analyzeLandingPage(url, html);
    return { ok: true, data };
  } catch (e) {
    return mapError(e, d.failed);
  }
}

export async function listLanderAnalysesAction(
  page = 1,
  pageSize = 20
): Promise<P1ActionResult<LanderAnalysisList>> {
  const d = (await t()).ai.lander;
  try {
    const data = await listLanderAnalyses(page, pageSize);
    return { ok: true, data };
  } catch (e) {
    return mapError(e, d.historyFailed);
  }
}

export async function getLanderAnalysisAction(
  id: string
): Promise<P1ActionResult<LanderAnalysis>> {
  const d = (await t()).ai.lander;
  try {
    const data = await getLanderAnalysis(id);
    return { ok: true, data };
  } catch (e) {
    return mapError(e, d.historyFailed);
  }
}

// ---------------------------------------------------------------------------
// Lander Intel ② — competitor watch actions
// ---------------------------------------------------------------------------

async function watchT() {
  return (await t()).ai.competitorWatch;
}

export async function createCompetitorWatchAction(input: {
  name: string;
  url: string;
  checkInterval: number;
}): Promise<P1ActionResult<CompetitorWatch>> {
  const d = await watchT();
  try {
    const data = await createCompetitorWatch(input);
    return { ok: true, data };
  } catch (e) {
    return mapError(e, d.createFailed);
  }
}

export async function listCompetitorWatchesAction(): Promise<
  P1ActionResult<CompetitorWatchList>
> {
  const d = await watchT();
  try {
    const data = await listCompetitorWatches();
    return { ok: true, data };
  } catch (e) {
    return mapError(e, d.loadFailed);
  }
}

export async function updateCompetitorWatchAction(
  id: string,
  patch: { name?: string; isActive?: boolean; checkInterval?: number }
): Promise<P1ActionResult<CompetitorWatch>> {
  const d = await watchT();
  try {
    const data = await updateCompetitorWatch(id, patch);
    return { ok: true, data };
  } catch (e) {
    return mapError(e, d.updateFailed);
  }
}

export async function deleteCompetitorWatchAction(
  id: string
): Promise<P1ActionResult<{ ok: boolean }>> {
  const d = await watchT();
  try {
    const data = await deleteCompetitorWatch(id);
    return { ok: true, data };
  } catch (e) {
    return mapError(e, d.deleteFailed);
  }
}

export async function listCompetitorWatchChangesAction(
  id: string,
  page = 1,
  pageSize = 20
): Promise<P1ActionResult<CompetitorChangeList>> {
  const d = await watchT();
  try {
    const data = await listCompetitorWatchChanges(id, page, pageSize);
    return { ok: true, data };
  } catch (e) {
    return mapError(e, d.timelineFailed);
  }
}

export async function checkCompetitorWatchNowAction(
  id: string
): Promise<P1ActionResult<CompetitorCheckResult>> {
  const d = await watchT();
  try {
    const data = await checkCompetitorWatchNow(id);
    return { ok: true, data };
  } catch (e) {
    return mapError(e, d.checkFailed);
  }
}

// ---------------------------------------------------------------------------
// Lander Intel ③ — template library actions
// ---------------------------------------------------------------------------

async function templatesT() {
  return (await t()).ai.lander.templates;
}

export async function listLanderTemplatesAction(
  category?: string
): Promise<P1ActionResult<LanderTemplateList>> {
  const d = await templatesT();
  try {
    const lang = await getLang();
    const data = await listLanderTemplates(category, lang);
    return { ok: true, data };
  } catch (e) {
    return mapError(e, d.loadFailed);
  }
}

export async function previewLanderTemplateAction(
  id: string,
  variables: Record<string, unknown>
): Promise<P1ActionResult<LanderTemplatePreview>> {
  const d = await templatesT();
  try {
    const lang = await getLang();
    const data = await previewLanderTemplate(id, variables, lang);
    return { ok: true, data };
  } catch (e) {
    return mapError(e, d.previewFailed);
  }
}

export async function useLanderTemplateAction(
  id: string,
  input: {
    offerId: string;
    name: string;
    variables: Record<string, unknown>;
    url?: string;
  }
): Promise<P1ActionResult<CreatedLandingPage>> {
  const d = await templatesT();
  try {
    const lang = await getLang();
    const data = await useLanderTemplate(id, { ...input, lang });
    return { ok: true, data };
  } catch (e) {
    return mapError(e, d.useFailed);
  }
}

export async function listOfferOptionsAction(): Promise<
  P1ActionResult<Array<{ id: string; name: string }>>
> {
  const d = await templatesT();
  try {
    const page = await entityApi.offers.list(1, 100);
    return {
      ok: true,
      data: page.items.map((o) => ({ id: o.id, name: o.name })),
    };
  } catch (e) {
    return mapError(e, d.offersLoadFailed);
  }
}
