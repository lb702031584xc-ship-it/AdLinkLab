/**
 * Lander Intel ① — landing-page efficiency analyzer API clients
 * (server-side only). Talks to the API with the forwarded session cookie.
 * Never logs secrets.
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export class LanderApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "LanderApiError";
    this.status = status;
    this.code = code;
  }
}

async function landerFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        // Only declare a JSON body when one is actually sent — Fastify
        // rejects an empty body paired with content-type: application/json.
        ...(init.body != null ? { "content-type": "application/json" } : {}),
        ...authHeaders,
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new LanderApiError(0, "network failure");
  }
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `request failed (${res.status})`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as {
        message?: string;
        error?: string;
        code?: string;
      };
      message = body.message ?? body.error ?? message;
      code = body.code ?? body.error;
    } catch {
      /* ignore */
    }
    throw new LanderApiError(res.status, message, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Types (mirror apps/api/src/routes/lander-intel.ts contract)
// ---------------------------------------------------------------------------

export type LanderDimension =
  | "performance"
  | "cta"
  | "trust"
  | "mobile"
  | "copy"
  | "bounceRisk";

export interface LanderScores {
  performance: number;
  cta: number;
  trust: number;
  mobile: number;
  copy: number;
  bounceRisk: number;
}

export interface LanderIssue {
  dimension: LanderDimension;
  severity: "high" | "medium" | "low";
  message: string;
}

export interface LanderSuggestion {
  text: string;
  dataQuality: "PREDICTED";
}

export interface LanderAnalysis {
  id: string;
  url: string;
  domain: string;
  overallScore: number;
  scores: LanderScores;
  issues: LanderIssue[];
  suggestions: LanderSuggestion[];
  analyzedAt: string;
}

export interface LanderAnalysisList {
  items: LanderAnalysis[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export function analyzeLandingPage(url: string, html?: string): Promise<LanderAnalysis> {
  return landerFetch<LanderAnalysis>("/api/v1/landing-pages/analyze", {
    method: "POST",
    body: JSON.stringify({ url, html: html || undefined }),
  });
}

export function listLanderAnalyses(
  page = 1,
  pageSize = 20
): Promise<LanderAnalysisList> {
  return landerFetch<LanderAnalysisList>(
    `/api/v1/landing-pages/analyses?page=${page}&pageSize=${pageSize}`
  );
}

export function getLanderAnalysis(id: string): Promise<LanderAnalysis> {
  return landerFetch<LanderAnalysis>(
    `/api/v1/landing-pages/analyses/${encodeURIComponent(id)}`
  );
}

// ---------------------------------------------------------------------------
// Lander Intel ② — competitor watch (mirror apps/api/src/routes/lander-intel.ts)
// ---------------------------------------------------------------------------

export interface CompetitorDiff {
  title?: { before: string | null; after: string };
  price?: { before: string[] | null; after: string[] };
  cta?: { before: string[] | null; after: string[] };
  sectionsAdded?: string[];
  sectionsRemoved?: string[];
}

export interface CompetitorWatch {
  id: string;
  name: string;
  url: string;
  checkInterval: number;
  lastHash: string | null;
  lastCheckedAt: string | null;
  isActive: boolean;
  createdAt: string | null;
  changeCount: number;
}

export interface CompetitorWatchList {
  items: CompetitorWatch[];
  total: number;
}

export interface CompetitorChangeItem {
  id: string;
  watchId: string;
  changedAt: string | null;
  diffSummary: CompetitorDiff;
}

export interface CompetitorChangeList {
  items: CompetitorChangeItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CompetitorCheckResult {
  changed: boolean;
  baseline?: boolean;
  changeId?: string;
  diff?: CompetitorDiff;
  alertCreated?: boolean;
  skippedByRobots?: boolean;
  fetchFailed?: boolean;
}

export function createCompetitorWatch(input: {
  name: string;
  url: string;
  checkInterval?: number;
}): Promise<CompetitorWatch> {
  return landerFetch<CompetitorWatch>("/api/v1/landing-pages/watches", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listCompetitorWatches(): Promise<CompetitorWatchList> {
  return landerFetch<CompetitorWatchList>("/api/v1/landing-pages/watches");
}

export function updateCompetitorWatch(
  id: string,
  patch: { name?: string; isActive?: boolean; checkInterval?: number }
): Promise<CompetitorWatch> {
  return landerFetch<CompetitorWatch>(
    `/api/v1/landing-pages/watches/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(patch) }
  );
}

export function deleteCompetitorWatch(
  id: string
): Promise<{ ok: boolean }> {
  return landerFetch<{ ok: boolean }>(
    `/api/v1/landing-pages/watches/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
}

export function listCompetitorWatchChanges(
  id: string,
  page = 1,
  pageSize = 20
): Promise<CompetitorChangeList> {
  return landerFetch<CompetitorChangeList>(
    `/api/v1/landing-pages/watches/${encodeURIComponent(
      id
    )}/changes?page=${page}&pageSize=${pageSize}`
  );
}

export function checkCompetitorWatchNow(
  id: string
): Promise<CompetitorCheckResult> {
  return landerFetch<CompetitorCheckResult>(
    `/api/v1/landing-pages/watches/${encodeURIComponent(id)}/check`,
    { method: "POST" }
  );
}

// ---------------------------------------------------------------------------
// Lander Intel ③ — high-converting template library
// (mirror apps/api/src/routes/lander-intel.ts)
// ---------------------------------------------------------------------------

export type LanderTemplateCategory =
  | "review"
  | "comparison"
  | "listicle"
  | "quiz"
  | "coupon"
  | "guide";

export interface LanderTemplate {
  id: string;
  tenantId: string | null;
  name: string;
  category: LanderTemplateCategory;
  description: string | null;
  thumbnailUrl: string | null;
  isBuiltIn: boolean;
  /** Placeholder names the frontend renders as form fields. */
  variables: string[];
}

export interface LanderTemplateList {
  items: LanderTemplate[];
  total: number;
}

export interface LanderTemplatePreview {
  html: string;
}

export interface CreatedLandingPage {
  id: string;
  offerId: string;
  name: string;
  url: string;
  domain: string;
  status: string;
  createdAt: string;
}

export function listLanderTemplates(
  category?: string,
  lang: "zh" | "en" = "zh"
): Promise<LanderTemplateList> {
  const params = new URLSearchParams({ lang });
  if (category && category !== "all") params.set("category", category);
  return landerFetch<LanderTemplateList>(
    `/api/v1/landing-pages/templates?${params.toString()}`
  );
}

export function previewLanderTemplate(
  id: string,
  variables: Record<string, unknown>,
  lang: "zh" | "en" = "zh"
): Promise<LanderTemplatePreview> {
  const params = new URLSearchParams({
    lang,
    variables: JSON.stringify(variables ?? {}),
  });
  return landerFetch<LanderTemplatePreview>(
    `/api/v1/landing-pages/templates/${encodeURIComponent(
      id
    )}?${params.toString()}`
  );
}

export function createLanderTemplate(input: {
  name: string;
  category: LanderTemplateCategory;
  description?: string;
  htmlTemplate: string;
  thumbnailUrl?: string;
}): Promise<LanderTemplate> {
  return landerFetch<LanderTemplate>("/api/v1/landing-pages/templates", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function useLanderTemplate(
  id: string,
  input: {
    offerId: string;
    name: string;
    variables: Record<string, unknown>;
    url?: string;
    lang?: "zh" | "en";
  }
): Promise<CreatedLandingPage> {
  return landerFetch<CreatedLandingPage>(
    `/api/v1/landing-pages/templates/${encodeURIComponent(id)}/use`,
    { method: "POST", body: JSON.stringify(input) }
  );
}
