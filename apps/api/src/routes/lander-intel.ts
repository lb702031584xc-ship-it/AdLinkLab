import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import {
  assertAiSettingsPepperConfigured,
  decryptSecret,
} from "../ai/crypto.js";
import {
  AiError,
  chatJson,
  chatJsonValidated,
  type ChatJsonArgs,
} from "../ai/llm.js";
import { fetchPageHtml } from "../ai/fetch-page.js";
import { afterAnalysisForUrl } from "../services/lp-analysis-hook.js";
import {
  analyzeLander,
  buildLanderSuggestionsPrompt,
  validateLanderSuggestionsShape,
  type LanderSuggestion,
} from "../ai/lander-analyzer.js";
import {
  BUILT_IN_TEMPLATES,
  extractTemplateVariables,
  getBuiltInTemplate,
  isTemplateCategory,
  renderTemplate,
  type TemplateCategory,
  type TemplateVariables,
} from "../ai/lander-templates.js";
import {
  checkCompetitorWatch,
  COMPETITOR_WATCH_MIN_INTERVAL_S,
} from "../queue/competitor-watch-worker.js";
import {
  applyRewritesToHtml,
  buildRequirementsRewritePrompt,
  pageTextExcerpt,
  parseRewriteRequirements,
  rescoreRewrittenHtml,
  validateRewriteShape,
  type RewriteRequirements,
} from "../ai/lp-rewriter.js";

/**
 * Lander Intel ① — landing-page efficiency analyzer API
 * (one tenant per user; session auth only).
 * Pure addition: new endpoints only, no existing route behavior changed.
 *
 * Contract (consumed by the Web worker — do not rename fields):
 * - POST /api/v1/landing-pages/analyze { url } →
 *   { id, url, domain, overallScore, scores, issues, suggestions, analyzedAt }
 * - GET  /api/v1/landing-pages/analyses → { items, total, page, pageSize }
 * - GET  /api/v1/landing-pages/analyses/:id → analysis object
 */

export interface LanderIntelRouteDeps {
  prisma: PrismaClient;
  /** Injectable for tests. */
  chatJsonImpl?: typeof chatJson;
  /** Injectable for tests. */
  fetchPageHtmlImpl?: typeof fetchPageHtml;
}

async function requireSession(
  deps: LanderIntelRouteDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) {
    throw new UnauthorizedError("Authentication required");
  }
  return info;
}

const SETTING_BASE_URL = "llm.baseUrl";
const SETTING_MODEL = "llm.model";
const SETTING_API_KEY_ENC = "llm.apiKeyEnc";

interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

/** Null when the LLM is not configured — suggestions are then skipped. */
async function optionalLlmConfig(
  prisma: PrismaClient
): Promise<LlmConfig | null> {
  const rows = (await prisma.aiSetting.findMany()) as Array<{
    key: string;
    value: string;
  }>;
  const out: { baseUrl?: string; model?: string; apiKeyEnc?: string } = {};
  for (const r of rows) {
    if (r.key === SETTING_BASE_URL) out.baseUrl = r.value;
    else if (r.key === SETTING_MODEL) out.model = r.value;
    else if (r.key === SETTING_API_KEY_ENC) out.apiKeyEnc = r.value;
  }
  if (!out.baseUrl || !out.model || !out.apiKeyEnc) return null;
  const pepper = assertAiSettingsPepperConfigured();
  return {
    baseUrl: out.baseUrl,
    model: out.model,
    apiKey: decryptSecret(out.apiKeyEnc, pepper),
  };
}

/** Throw AiError (→ 502) when the LLM is not configured. */
async function requireLlmConfig(prisma: PrismaClient): Promise<LlmConfig> {
  const cfg = await optionalLlmConfig(prisma);
  if (!cfg) {
    throw new AiError(
      "AI 未配置：请先在「AI 设置」中填写模型服务地址、模型与密钥"
    );
  }
  return cfg;
}

function parsePagination(
  pageRaw: string | undefined,
  pageSizeRaw: string | undefined
): { page: number; pageSize: number } {
  const page = Math.max(1, Number(pageRaw) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(pageSizeRaw) || 20));
  return { page, pageSize };
}

function toPublicRow(row: {
  id: string;
  url: string;
  domain: string;
  overallScore: number;
  scores: unknown;
  issues: unknown;
  suggestions: unknown;
  analyzedAt: Date;
}) {
  return {
    id: row.id,
    url: row.url,
    domain: row.domain,
    overallScore: row.overallScore,
    scores: row.scores,
    issues: row.issues,
    suggestions: row.suggestions,
    analyzedAt:
      row.analyzedAt instanceof Date
        ? row.analyzedAt.toISOString()
        : row.analyzedAt,
  };
}

function assertHttpUrl(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ValidationError("url must be a valid http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError("url must be a valid http(s) URL");
  }
}

export async function registerLanderIntelRoutes(
  app: FastifyInstance,
  deps: LanderIntelRouteDeps
): Promise<void> {
  const prisma = deps.prisma;
  const fetchPageHtmlImpl = deps.fetchPageHtmlImpl ?? fetchPageHtml;
  const chatImpl = deps.chatJsonImpl ?? chatJson;

  /**
   * Analyze a landing page: SSRF-safe fetch → deterministic dimension
   * scoring → LLM suggestions (skipped when the LLM is not configured) →
   * persist as LanderAnalysis.
   */
  app.post<{
    Body: { url?: unknown; html?: unknown };
  }>("/api/v1/landing-pages/analyze", async (request) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as { url?: unknown; html?: unknown };
    const url =
      typeof body.url === "string" ? body.url.trim() : "";
    if (!url) throw new ValidationError("url is required");
    assertHttpUrl(url);

    // 手动粘贴模式：直接分析粘贴的 HTML/文字，跳过抓取（反爬站点用）
    const pastedHtml = typeof body.html === "string" ? body.html.trim() : "";
    let html: string;
    let finalUrl: string;
    let fetchMs: number;
    if (pastedHtml) {
      html = pastedHtml.slice(0, 500_000);
      finalUrl = url;
      fetchMs = 0;
    } else {
      const fetched = await fetchPageHtmlImpl(url);
      html = fetched.html;
      finalUrl = fetched.finalUrl;
      fetchMs = fetched.fetchMs;
    }
    const result = analyzeLander(html, fetchMs);

    let suggestions: LanderSuggestion[] = [];
    const llm = await optionalLlmConfig(prisma);
    if (llm) {
      const { system, user } = buildLanderSuggestionsPrompt({
        scores: result.scores,
        issues: result.issues,
        summary: result.summary,
        lang: "zh",
      });
      const args: ChatJsonArgs = {
        baseUrl: llm.baseUrl,
        model: llm.model,
        apiKey: llm.apiKey,
        system,
        user,
      };
      suggestions = await chatJsonValidated(
        args,
        validateLanderSuggestionsShape,
        chatImpl
      );
    }

    const domain = new URL(finalUrl).hostname;
    const analyzedAt = new Date();
    const created = await prisma.landerAnalysis.create({
      data: {
        id: randomUUID(),
        tenantId: info.tenantId,
        url: finalUrl,
        domain,
        overallScore: result.overallScore,
        scores: JSON.parse(JSON.stringify(result.scores)) as never,
        issues: JSON.parse(JSON.stringify(result.issues)) as never,
        suggestions: JSON.parse(JSON.stringify(suggestions)) as never,
        analyzedAt,
      },
    });
    // Automation pack: auto-create optimization task if score < 70
    await afterAnalysisForUrl(prisma, info.tenantId, finalUrl, result).catch(
      () => undefined
    );
    return toPublicRow({
      id: created.id as string,
      url: created.url as string,
      domain: created.domain as string,
      overallScore: created.overallScore as number,
      scores: created.scores,
      issues: created.issues,
      suggestions: created.suggestions,
      analyzedAt: created.analyzedAt as Date,
    });
  });

  /** Paginated analysis history (tenant-scoped, soft-delete aware). */
  app.get<{
    Querystring: { page?: string; pageSize?: string };
  }>("/api/v1/landing-pages/analyses", async (request) => {
    const info = await requireSession(deps, request);
    const { page, pageSize } = parsePagination(
      request.query.page,
      request.query.pageSize
    );
    const where = { tenantId: info.tenantId, deletedAt: null };
    const total = await prisma.landerAnalysis.count({ where });
    const rows = await prisma.landerAnalysis.findMany({
      where,
      orderBy: { analyzedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      items: rows.map((r) =>
        toPublicRow({
          id: r.id,
          url: r.url,
          domain: r.domain,
          overallScore: r.overallScore,
          scores: r.scores,
          issues: r.issues,
          suggestions: r.suggestions,
          analyzedAt: r.analyzedAt,
        })
      ),
      total,
      page,
      pageSize,
    };
  });

  /** Single analysis by id (tenant-scoped). */
  app.get<{
    Params: { id: string };
  }>("/api/v1/landing-pages/analyses/:id", async (request) => {
    const info = await requireSession(deps, request);
    const row = await prisma.landerAnalysis.findFirst({
      where: {
        id: request.params.id,
        tenantId: info.tenantId,
        deletedAt: null,
      },
    });
    if (!row) throw new NotFoundError("Analysis not found");
    return toPublicRow({
      id: row.id,
      url: row.url,
      domain: row.domain,
      overallScore: row.overallScore,
      scores: row.scores,
      issues: row.issues,
      suggestions: row.suggestions,
      analyzedAt: row.analyzedAt,
    });
  });

  registerCompetitorWatchRoutes(app, deps);
  registerLanderTemplateRoutes(app, deps);
}

// ---------------------------------------------------------------------------
// Lander Intel ② — competitor landing-page watch (additive).
//
// Contract:
// - POST   /api/v1/landing-pages/watches { name, url, checkInterval? } → watch
// - GET    /api/v1/landing-pages/watches → { items, total }
// - PATCH  /api/v1/landing-pages/watches/:id { name?, isActive?, checkInterval? }
// - DELETE /api/v1/landing-pages/watches/:id (soft delete)
// - GET    /api/v1/landing-pages/watches/:id/changes → paginated timeline
// - POST   /api/v1/landing-pages/watches/:id/check → run one scan now
// ---------------------------------------------------------------------------

/** Hard floor: checkInterval < 3600s is rejected with 400. */
function parseWatchInterval(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") {
    return COMPETITOR_WATCH_MIN_INTERVAL_S;
  }
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) {
    throw new ValidationError("checkInterval must be a number of seconds");
  }
  if (n < COMPETITOR_WATCH_MIN_INTERVAL_S) {
    throw new ValidationError(
      `checkInterval must be at least ${COMPETITOR_WATCH_MIN_INTERVAL_S} seconds (1 hour)`
    );
  }
  return n;
}

function toIso(value: unknown): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

function toPublicWatch(
  row: {
    id: string;
    name: string;
    url: string;
    checkInterval: number;
    lastHash: string | null;
    lastCheckedAt: unknown;
    isActive: boolean;
    createdAt: unknown;
  },
  changeCount: number
) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    checkInterval: row.checkInterval,
    lastHash: row.lastHash ?? null,
    lastCheckedAt: toIso(row.lastCheckedAt),
    isActive: row.isActive,
    createdAt: toIso(row.createdAt),
    changeCount,
  };
}

function toPublicChange(row: {
  id: string;
  watchId: string;
  changedAt: unknown;
  diffSummary: unknown;
}) {
  return {
    id: row.id,
    watchId: row.watchId,
    changedAt: toIso(row.changedAt),
    diffSummary: row.diffSummary,
  };
}

async function findTenantWatch(
  prisma: PrismaClient,
  tenantId: string,
  id: string
) {
  const row = await prisma.competitorWatch.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
  if (!row) throw new NotFoundError("Watch not found");
  return row as {
    id: string;
    tenantId: string;
    name: string;
    url: string;
    checkInterval: number;
    lastHash: string | null;
    lastCheckedAt: Date | null;
    isActive: boolean;
    createdAt: Date;
  };
}

async function countWatchChanges(
  prisma: PrismaClient,
  tenantId: string,
  watchId: string
): Promise<number> {
  return prisma.competitorChange.count({
    where: { watchId, tenantId },
  });
}

function registerCompetitorWatchRoutes(
  app: FastifyInstance,
  deps: LanderIntelRouteDeps
): void {
  const prisma = deps.prisma;
  const fetchPageHtmlImpl = deps.fetchPageHtmlImpl ?? fetchPageHtml;

  /** Create a watch. checkInterval defaults to 3600s; < 3600s → 400. */
  app.post<{
    Body: { name?: unknown; url?: unknown; checkInterval?: unknown };
  }>("/api/v1/landing-pages/watches", async (request) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as {
      name?: unknown;
      url?: unknown;
      checkInterval?: unknown;
    };
    const name =
      typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new ValidationError("name is required");
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) throw new ValidationError("url is required");
    // Same http(s) URL validation as the analyzer; SSRF enforcement happens
    // inside fetchPageHtml at scan time.
    assertHttpUrl(url);
    const checkInterval = parseWatchInterval(body.checkInterval);

    const created = (await prisma.competitorWatch.create({
      data: {
        id: randomUUID(),
        tenantId: info.tenantId,
        name: name.slice(0, 200),
        url,
        checkInterval,
        isActive: true,
      },
    })) as Parameters<typeof toPublicWatch>[0];
    return toPublicWatch(created, 0);
  });

  /** List watches with change counts (tenant-scoped, soft-delete aware). */
  app.get("/api/v1/landing-pages/watches", async (request) => {
    const info = await requireSession(deps, request);
    const rows = (await prisma.competitorWatch.findMany({
      where: { tenantId: info.tenantId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    })) as Array<Parameters<typeof toPublicWatch>[0]>;
    const items = [];
    for (const row of rows) {
      items.push(
        toPublicWatch(row, await countWatchChanges(prisma, info.tenantId, row.id))
      );
    }
    return { items, total: items.length };
  });

  /** Update name / isActive / checkInterval (tenant-scoped). */
  app.patch<{
    Params: { id: string };
    Body: { name?: unknown; isActive?: unknown; checkInterval?: unknown };
  }>("/api/v1/landing-pages/watches/:id", async (request) => {
    const info = await requireSession(deps, request);
    const row = await findTenantWatch(prisma, info.tenantId, request.params.id);
    const body = (request.body ?? {}) as {
      name?: unknown;
      isActive?: unknown;
      checkInterval?: unknown;
    };
    const data: {
      name?: string;
      isActive?: boolean;
      checkInterval?: number;
    } = {};
    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) throw new ValidationError("name must not be empty");
      data.name = name.slice(0, 200);
    }
    if (body.isActive !== undefined) {
      data.isActive = Boolean(body.isActive);
    }
    if (body.checkInterval !== undefined) {
      data.checkInterval = parseWatchInterval(body.checkInterval);
    }
    const updated = (await prisma.competitorWatch.update({
      where: { id: row.id },
      data,
    })) as Parameters<typeof toPublicWatch>[0];
    return toPublicWatch(
      updated,
      await countWatchChanges(prisma, info.tenantId, row.id)
    );
  });

  /** Soft-delete a watch (tenant-scoped). */
  app.delete<{
    Params: { id: string };
  }>("/api/v1/landing-pages/watches/:id", async (request) => {
    const info = await requireSession(deps, request);
    const row = await findTenantWatch(prisma, info.tenantId, request.params.id);
    await prisma.competitorWatch.update({
      where: { id: row.id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  });

  /** Change timeline for one watch (tenant-scoped, paginated). */
  app.get<{
    Params: { id: string };
    Querystring: { page?: string; pageSize?: string };
  }>("/api/v1/landing-pages/watches/:id/changes", async (request) => {
    const info = await requireSession(deps, request);
    const watch = await findTenantWatch(
      prisma,
      info.tenantId,
      request.params.id
    );
    const { page, pageSize } = parsePagination(
      request.query.page,
      request.query.pageSize
    );
    const where = { watchId: watch.id, tenantId: info.tenantId };
    const total = await prisma.competitorChange.count({ where });
    const rows = (await prisma.competitorChange.findMany({
      where,
      orderBy: { changedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    })) as Array<Parameters<typeof toPublicChange>[0]>;
    return {
      items: rows.map((r) => toPublicChange(r)),
      total,
      page,
      pageSize,
    };
  });

  /** Manually run one scan for a watch right now (tenant-scoped). */
  app.post<{
    Params: { id: string };
  }>("/api/v1/landing-pages/watches/:id/check", async (request) => {
    const info = await requireSession(deps, request);
    const watch = await findTenantWatch(
      prisma,
      info.tenantId,
      request.params.id
    );
    return checkCompetitorWatch(prisma, watch, { fetchPageHtmlImpl });
  });
}

// ---------------------------------------------------------------------------
// Lander Intel ③ — high-converting template library (additive).
//
// Contract (consumed by the Web worker — do not rename fields):
// - GET  /api/v1/landing-pages/templates?category?=&lang?= → { items, total }
//      items: built-in (code constants, isBuiltIn: true, tenantId: null) +
//             this tenant's custom templates. Each item carries `variables`
//             (placeholder names for the frontend form).
// - GET  /api/v1/landing-pages/templates/:id?lang?=&variables[..]= → { html }
//      preview render; all variable values are HTML-escaped server-side.
// - POST /api/v1/landing-pages/templates { name, category, description?,
//      htmlTemplate, thumbnailUrl? } → created custom template
// - POST /api/v1/landing-pages/templates/:id/use { offerId, name,
//      variables?, url? } → rendered HTML stored as
//      LandingPage.htmlContent; returns the created landing page
// - POST /api/v1/landing-pages/templates/:id/rewrite-brief
//      { lang?, variables?, requirements } → renders the template, generates
//      a requirements-driven AI rewrite DRAFT (landingPageId is null; the
//      rendered HTML is stored in rewrittenContent.baseHtml), and returns
//      previewHtml (the rewritten HTML, i.e. what deploy would persist).
//      Deploy it with POST /api/v1/landing-pages/rewrites/:rewriteId/deploy.
// ---------------------------------------------------------------------------

interface TemplateListItem {
  id: string;
  tenantId: string | null;
  name: string;
  category: TemplateCategory;
  description: string | null;
  thumbnailUrl: string | null;
  isBuiltIn: boolean;
  variables: string[];
}

interface TemplateSource {
  id: string;
  tenantId: string | null;
  name: string;
  category: TemplateCategory;
  description: string | null;
  thumbnailUrl: string | null;
  isBuiltIn: boolean;
  htmlTemplate: string;
}

function resolveLang(raw: unknown): "zh" | "en" {
  return raw === "en" ? "en" : "zh";
}

function toTemplateListItem(src: TemplateSource): TemplateListItem {
  return {
    id: src.id,
    tenantId: src.tenantId,
    name: src.name,
    category: src.category,
    description: src.description,
    thumbnailUrl: src.thumbnailUrl,
    isBuiltIn: src.isBuiltIn,
    variables: extractTemplateVariables(src.htmlTemplate),
  };
}

/** Built-in template mapped to the DB row shape (never persisted). */
function builtInSource(
  id: string,
  lang: "zh" | "en"
): TemplateSource | null {
  const tpl = getBuiltInTemplate(id);
  if (!tpl) return null;
  return {
    id: tpl.id,
    tenantId: null,
    name: tpl.name[lang],
    category: tpl.category,
    description: tpl.description[lang],
    thumbnailUrl: null,
    isBuiltIn: true,
    htmlTemplate: tpl.html[lang],
  };
}

async function findTemplateSource(
  prisma: PrismaClient,
  tenantId: string,
  id: string,
  lang: "zh" | "en"
): Promise<TemplateSource> {
  const builtIn = builtInSource(id, lang);
  if (builtIn) return builtIn;
  const row = await prisma.landerTemplate.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
  if (!row) throw new NotFoundError("Template not found");
  const r = row as {
    id: string;
    tenantId: string | null;
    name: string;
    category: string;
    description: string | null;
    thumbnailUrl: string | null;
    isBuiltIn: boolean;
    htmlTemplate: string;
  };
  if (!isTemplateCategory(r.category)) {
    throw new ValidationError("Template has an invalid category");
  }
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    category: r.category,
    description: r.description,
    thumbnailUrl: r.thumbnailUrl,
    isBuiltIn: r.isBuiltIn,
    htmlTemplate: r.htmlTemplate,
  };
}

/**
 * Parse preview variables from the query string. Supports both
 * `?variables[productName]=x&variables[pros]=a&variables[pros]=b`
 * (bracket keys; repeated keys become arrays) and a single JSON-encoded
 * `?variables={...}` for complex values.
 */
function parsePreviewVariables(
  query: Record<string, unknown>
): TemplateVariables {
  const out: TemplateVariables = {};
  const raw = query.variables;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as TemplateVariables;
      }
    } catch {
      /* fall through to bracket-style parsing */
    }
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    // Query parser that nests bracket keys (e.g. qs).
    Object.assign(out, raw as TemplateVariables);
  }
  for (const [key, value] of Object.entries(query)) {
    const m = /^variables\[(.+)\]$/.exec(key);
    if (m) {
      out[m[1]] = value as TemplateVariables[string];
    }
  }
  return out;
}

/** `{{products}}` renders as cards for listicles, table rows otherwise. */
function productsLayoutFor(category: TemplateCategory): "table" | "cards" {
  return category === "listicle" ? "cards" : "table";
}

function assertOptionalHttpUrl(raw: unknown): { url: string; domain: string } {
  if (raw === undefined || raw === null || raw === "") {
    // Template-created pages may not be published yet; the rendered HTML is
    // what matters (stored in htmlContent).
    return { url: "", domain: "" };
  }
  if (typeof raw !== "string") {
    throw new ValidationError("url must be a string");
  }
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ValidationError("url must be a valid http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError("url must be a valid http(s) URL");
  }
  return { url: trimmed, domain: parsed.hostname };
}

function registerLanderTemplateRoutes(
  app: FastifyInstance,
  deps: LanderIntelRouteDeps
): void {
  const prisma = deps.prisma;

  /** Merged list: built-ins (all tenants) + this tenant's customs. */
  app.get<{
    Querystring: { category?: string; lang?: string };
  }>("/api/v1/landing-pages/templates", async (request) => {
    const info = await requireSession(deps, request);
    const lang = resolveLang(request.query.lang);
    const categoryFilter =
      typeof request.query.category === "string" &&
      request.query.category !== ""
        ? request.query.category
        : null;
    if (categoryFilter && !isTemplateCategory(categoryFilter)) {
      throw new ValidationError(
        "category must be one of review|comparison|listicle|quiz|coupon|guide"
      );
    }

    const items: TemplateListItem[] = [];
    for (const tpl of BUILT_IN_TEMPLATES) {
      if (categoryFilter && tpl.category !== categoryFilter) continue;
      const src = builtInSource(tpl.id, lang);
      if (src) items.push(toTemplateListItem(src));
    }
    const rows = (await prisma.landerTemplate.findMany({
      where: {
        tenantId: info.tenantId,
        deletedAt: null,
        ...(categoryFilter ? { category: categoryFilter } : {}),
      },
      orderBy: { createdAt: "desc" },
    })) as Array<{
      id: string;
      tenantId: string | null;
      name: string;
      category: string;
      description: string | null;
      thumbnailUrl: string | null;
      isBuiltIn: boolean;
      htmlTemplate: string;
    }>;
    for (const r of rows) {
      if (!isTemplateCategory(r.category)) continue;
      items.push(
        toTemplateListItem({
          id: r.id,
          tenantId: r.tenantId,
          name: r.name,
          category: r.category,
          description: r.description,
          thumbnailUrl: r.thumbnailUrl,
          isBuiltIn: r.isBuiltIn,
          htmlTemplate: r.htmlTemplate,
        })
      );
    }
    return { items, total: items.length };
  });

  /** Preview render: query variables are all HTML-escaped server-side. */
  app.get<{
    Params: { id: string };
    Querystring: { lang?: string; variables?: unknown };
  }>("/api/v1/landing-pages/templates/:id", async (request) => {
    const info = await requireSession(deps, request);
    const lang = resolveLang(request.query.lang);
    const src = await findTemplateSource(
      prisma,
      info.tenantId,
      request.params.id,
      lang
    );
    const variables = parsePreviewVariables(
      request.query as Record<string, unknown>
    );
    return {
      html: renderTemplate(src.htmlTemplate, variables, {
        productsLayout: productsLayoutFor(src.category),
      }),
    };
  });

  /** Create a tenant custom template. */
  app.post<{
    Body: {
      name?: unknown;
      category?: unknown;
      description?: unknown;
      htmlTemplate?: unknown;
      thumbnailUrl?: unknown;
    };
  }>("/api/v1/landing-pages/templates", async (request) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as {
      name?: unknown;
      category?: unknown;
      description?: unknown;
      htmlTemplate?: unknown;
      thumbnailUrl?: unknown;
    };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new ValidationError("name is required");
    if (!isTemplateCategory(body.category)) {
      throw new ValidationError(
        "category must be one of review|comparison|listicle|quiz|coupon|guide"
      );
    }
    const htmlTemplate =
      typeof body.htmlTemplate === "string" ? body.htmlTemplate : "";
    if (!htmlTemplate.trim()) {
      throw new ValidationError("htmlTemplate is required");
    }
    if (htmlTemplate.length > 200_000) {
      throw new ValidationError("htmlTemplate is too large (max 200KB)");
    }
    const description =
      typeof body.description === "string" && body.description.trim() !== ""
        ? body.description.trim().slice(0, 2000)
        : null;
    const thumbnailUrl =
      typeof body.thumbnailUrl === "string" && body.thumbnailUrl.trim() !== ""
        ? body.thumbnailUrl.trim().slice(0, 2000)
        : null;

    const created = (await prisma.landerTemplate.create({
      data: {
        id: randomUUID(),
        tenantId: info.tenantId,
        name: name.slice(0, 200),
        category: body.category,
        description,
        htmlTemplate,
        thumbnailUrl,
        isBuiltIn: false,
      },
    })) as {
      id: string;
      tenantId: string | null;
      name: string;
      category: string;
      description: string | null;
      thumbnailUrl: string | null;
      isBuiltIn: boolean;
      htmlTemplate: string;
    };
    return toTemplateListItem({
      id: created.id,
      tenantId: created.tenantId,
      name: created.name,
      category: created.category as TemplateCategory,
      description: created.description,
      thumbnailUrl: created.thumbnailUrl,
      isBuiltIn: created.isBuiltIn,
      htmlTemplate: created.htmlTemplate,
    });
  });

  /**
   * Render a template with variables and persist it as a LandingPage
   * (rendered HTML goes to htmlContent). `offerId` is required because
   * LandingPage.offerId is non-nullable.
   */
  app.post<{
    Params: { id: string };
    Body: {
      offerId?: unknown;
      name?: unknown;
      variables?: unknown;
      url?: unknown;
      lang?: unknown;
    };
  }>("/api/v1/landing-pages/templates/:id/use", async (request) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as {
      offerId?: unknown;
      name?: unknown;
      variables?: unknown;
      url?: unknown;
      lang?: unknown;
    };
    const offerId =
      typeof body.offerId === "string" ? body.offerId.trim() : "";
    if (!offerId) throw new ValidationError("offerId is required");
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new ValidationError("name is required");

    const lang = resolveLang(
      typeof body.lang === "string" ? body.lang : undefined
    );
    const src = await findTemplateSource(
      prisma,
      info.tenantId,
      request.params.id,
      lang
    );

    const offer = await prisma.offer.findFirst({
      where: { id: offerId, tenantId: info.tenantId, deletedAt: null },
    });
    if (!offer) throw new NotFoundError("Offer not found");

    const variables: TemplateVariables =
      body.variables && typeof body.variables === "object"
        ? (body.variables as TemplateVariables)
        : {};
    const html = renderTemplate(src.htmlTemplate, variables, {
      productsLayout: productsLayoutFor(src.category),
    });
    const { url, domain } = assertOptionalHttpUrl(body.url);

    const created = (await prisma.landingPage.create({
      data: {
        id: randomUUID(),
        tenantId: info.tenantId,
        offerId,
        name: name.slice(0, 200),
        url,
        domain,
        htmlContent: html,
        status: "ACTIVE",
      },
    })) as {
      id: string;
      offerId: string;
      name: string;
      url: string;
      domain: string;
      status: string;
      createdAt: Date;
    };
    return {
      id: created.id,
      offerId: created.offerId,
      name: created.name,
      url: created.url,
      domain: created.domain,
      status: created.status,
      createdAt:
        created.createdAt instanceof Date
          ? created.createdAt.toISOString()
          : created.createdAt,
    };
  });

  /**
   * Rewrite brief from a template (AI rewrite workbench): render the
   * template with variables, then generate a requirements-driven rewrite
   * DRAFT via the shared strict-JSON rewrite chain. No LandingPage exists
   * yet, so landingPageId is null and the rendered HTML is stored in
   * rewrittenContent.baseHtml; deploy it later with
   * POST /api/v1/landing-pages/rewrites/:rewriteId/deploy.
   */
  app.post<{
    Params: { id: string };
    Body: { lang?: unknown; variables?: unknown; requirements?: unknown };
  }>("/api/v1/landing-pages/templates/:id/rewrite-brief", async (request) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as {
      lang?: unknown;
      variables?: unknown;
      requirements?: unknown;
    };
    const lang = resolveLang(
      typeof body.lang === "string" ? body.lang : undefined
    );
    const src = await findTemplateSource(
      prisma,
      info.tenantId,
      request.params.id,
      lang
    );

    let requirements: RewriteRequirements | undefined;
    try {
      requirements = parseRewriteRequirements(body.requirements);
    } catch (e) {
      // Input-shape problems are the caller's fault (400), not an LLM
      // failure (502).
      if (e instanceof AiError) throw new ValidationError(e.message);
      throw e;
    }
    if (!requirements) {
      throw new ValidationError("requirements is required");
    }

    const variables: TemplateVariables =
      body.variables && typeof body.variables === "object"
        ? (body.variables as TemplateVariables)
        : {};
    const baseHtml = renderTemplate(src.htmlTemplate, variables, {
      productsLayout: productsLayoutFor(src.category),
    });

    const llm = await requireLlmConfig(prisma);
    const { system, user } = buildRequirementsRewritePrompt({
      pageName: src.name,
      pageUrl: "",
      pageText: pageTextExcerpt(baseHtml),
      requirements,
    });
    const args: ChatJsonArgs = {
      baseUrl: llm.baseUrl,
      model: llm.model,
      apiKey: llm.apiKey,
      system,
      user,
    };
    let llmResult;
    try {
      llmResult = await chatJsonValidated(
        args,
        validateRewriteShape,
        deps.chatJsonImpl ?? chatJson
      );
    } catch (e) {
      if (e instanceof AiError) throw e;
      throw new AiError("LLM request failed");
    }

    // Deterministic textual apply for the estimate, then re-score with the
    // existing analyzer — same convention as the page rewrite route.
    const applied = applyRewritesToHtml(baseHtml, llmResult.rewrites);
    const originalScore = Math.round(rescoreRewrittenHtml(baseHtml));
    const newScore = Math.round(rescoreRewrittenHtml(applied.html));

    const row = (await prisma.landingPageRewrite.create({
      data: {
        id: randomUUID(),
        tenantId: info.tenantId,
        landingPageId: null,
        originalScore,
        issues: [],
        rewrittenContent: JSON.parse(
          JSON.stringify({
            rewrites: llmResult.rewrites,
            aiEstimatedNewScore: llmResult.aiEstimatedNewScore,
            appliedCount: applied.applied,
            skipped: applied.skipped,
            requirements,
            source: { kind: "template", templateId: src.id, lang },
            baseHtml,
          })
        ) as never,
        newScore,
        status: "DRAFT",
      },
    })) as {
      id: string;
      landingPageId: string | null;
      originalScore: number;
      issues: unknown;
      rewrittenContent: unknown;
      newScore: number | null;
      status: string;
      createdAt: Date;
    };

    return {
      rewrite: {
        id: row.id,
        landingPageId: row.landingPageId,
        originalScore: row.originalScore,
        issues: row.issues,
        rewrittenContent: row.rewrittenContent,
        newScore: row.newScore,
        status: row.status,
        createdAt:
          row.createdAt instanceof Date
            ? row.createdAt.toISOString()
            : row.createdAt,
      },
      // Rendered result with the rewrites applied (what deploy persists).
      previewHtml: applied.html,
    };
  });
}
