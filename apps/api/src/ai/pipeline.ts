/**
 * Phase 1 Offer Intelligence — 5-agent sequential pipeline (§31).
 *
 * No agent framework; each agent is a plain async function reusing the
 * existing `apps/api/src/ai/` modules (prompts, llm client, profitability).
 * Every agent persists its intermediate output to AiAnalysis (inputKind
 * carries the agent name); the final decision is persisted to OfferRiskScore.
 *
 * Safety: agents never claim "definitely allowed" without evidence, and
 * merchant reputation is always disclosed as model-knowledge + page signals,
 * not real-time affiliate data.
 */
import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { PrismaClient } from "@adlinklab/database";
import { AppError } from "@adlinklab/shared";
import {
  AiError,
  chatJson,
  chatJsonValidatedAccounting,
  type ChatJsonArgs,
  type LlmUsage,
} from "./llm.js";
import { estimateCostCents } from "./pricing.js";
import { recordAiUsage } from "./usage.js";
import {
  buildAnalysisPrompt,
  buildTermsPrompt,
  PROMPT_VERSION,
  validateAnalysisShape,
  validateTermsShape,
  type AnalysisLanguage,
  type TermsShape,
} from "./prompts.js";
import { fetchPage } from "./fetch-page.js";
import { computeProfitability } from "./profitability.js";
import {
  evaluateCriticalRules,
  type CriticalHit,
  type PolicyRuleName,
  type RuleVerdict,
  type TrafficMode,
} from "./policy-rules.js";
import { assertAiSettingsPepperConfigured, decryptSecret } from "./crypto.js";
import { getOfferPerformance } from "../stats/offer-performance.js";

// Re-export shared types so route consumers import from one place.
export type { AnalysisLanguage } from "./prompts.js";
export type { TrafficMode } from "./policy-rules.js";

export interface PipelineDeps {
  prisma: PrismaClient;
  /** Injectable for tests. */
  chatJsonImpl?: typeof chatJson;
  /** Injectable for tests. */
  fetchPageImpl?: typeof fetchPage;
}

export const MERCHANT_REPUTATION_DISCLAIMER =
  "Merchant reputation is based on model knowledge cutoff and page signals, not real-time affiliate data.";

const SETTING_BASE_URL = "llm.baseUrl";
const SETTING_MODEL = "llm.model";
const SETTING_API_KEY_ENC = "llm.apiKeyEnc";

interface LlmSettings {
  baseUrl?: string;
  model?: string;
  apiKeyEnc?: string;
}

async function readSettings(prisma: PrismaClient): Promise<LlmSettings> {
  const rows = await prisma.aiSetting.findMany();
  const out: LlmSettings = {};
  for (const r of rows as Array<{ key: string; value: string }>) {
    if (r.key === SETTING_BASE_URL) out.baseUrl = r.value;
    else if (r.key === SETTING_MODEL) out.model = r.value;
    else if (r.key === SETTING_API_KEY_ENC) out.apiKeyEnc = r.value;
  }
  return out;
}

function isConfigured(s: LlmSettings): boolean {
  return Boolean(s.baseUrl && s.model && s.apiKeyEnc);
}

interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

async function requireLlmConfig(prisma: PrismaClient): Promise<LlmConfig> {
  const settings = await readSettings(prisma);
  if (!isConfigured(settings)) {
    throw new AppError("AI is not configured", {
      code: "AI_NOT_CONFIGURED",
      statusCode: 400,
    });
  }
  const pepper = assertAiSettingsPepperConfigured();
  return {
    baseUrl: settings.baseUrl as string,
    model: settings.model as string,
    apiKey: decryptSecret(settings.apiKeyEnc as string, pepper),
  };
}

function chatArgs(config: LlmConfig, system: string, user: string): ChatJsonArgs {
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey,
    system,
    user,
  };
}

/** P0-6 — LLM agent 的记账元数据（usage 缺失时记 0）。 */
export interface AgentAccounting {
  model: string;
  usage: LlmUsage;
  latencyMs: number;
}

async function writeAgentAnalysis(
  deps: PipelineDeps,
  tenantId: string,
  userId: string | undefined,
  agentName: string,
  inputRef: string,
  result: unknown,
  accounting?: AgentAccounting
): Promise<string> {
  const id = randomUUID();
  const resultJson = JSON.parse(JSON.stringify(result)) as unknown;
  await deps.prisma.aiAnalysis.create({
    data: {
      id,
      tenantId,
      userId: userId ?? null,
      inputKind: `offer-intel:${agentName}`,
      inputRef,
      merchant: null,
      network: null,
      payout: null,
      payoutCurrency: null,
      estimatedCpc: null,
      result: resultJson as never,
      // P0-6 — 确定性 agent（无 LLM 调用）不传 accounting，字段保持 null。
      ...(accounting
        ? {
            model: accounting.model,
            promptVersion: PROMPT_VERSION,
            tokensIn: accounting.usage.promptTokens,
            tokensOut: accounting.usage.completionTokens,
            costCents: estimateCostCents(
              accounting.model,
              accounting.usage.promptTokens,
              accounting.usage.completionTokens
            ),
            latencyMs: accounting.latencyMs,
            status: "success",
          }
        : {}),
    },
  });
  return id;
}

/** P0-6 — 记一次 agent LLM 调用的用量（best-effort）。 */
async function trackAgentUsage(
  deps: PipelineDeps,
  tenantId: string,
  accounting: AgentAccounting
): Promise<void> {
  await recordAiUsage(deps.prisma, {
    tenantId,
    model: accounting.model,
    tokensIn: accounting.usage.promptTokens,
    tokensOut: accounting.usage.completionTokens,
    costCents: estimateCostCents(
      accounting.model,
      accounting.usage.promptTokens,
      accounting.usage.completionTokens
    ),
    calls: 1,
  });
}

// ---------------------------------------------------------------------------
// Agent 1 — Offer Analyst: parse terms text into structured restrictions
// (reuses the existing analyze-terms prompt + lenient validator).
// ---------------------------------------------------------------------------

export interface OfferAnalystInput {
  text: string;
  language: AnalysisLanguage;
}

export async function offerAnalyst(
  deps: PipelineDeps,
  tenantId: string,
  userId: string | undefined,
  input: OfferAnalystInput
): Promise<{ terms: TermsShape; analysisId: string }> {
  const text = input.text.trim();
  if (text.length < 50) {
    throw new AppError("text must be at least 50 characters of offer terms", {
      code: "INVALID_TERMS",
      statusCode: 400,
    });
  }
  const config = await requireLlmConfig(deps.prisma);
  const { system, user } = buildTermsPrompt(text.slice(0, 12_000), input.language);
  let terms: TermsShape;
  let accounting: AgentAccounting;
  try {
    const called = await chatJsonValidatedAccounting(
      chatArgs(config, system, user),
      validateTermsShape,
      deps.chatJsonImpl
    );
    terms = called.data;
    accounting = {
      model: config.model,
      usage: called.usage,
      latencyMs: called.latencyMs,
    };
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw new AiError("LLM request failed");
  }
  // P0-6 — 记账（usage 缺失时记 0）。
  await trackAgentUsage(deps, tenantId, accounting);
  const inputRef = createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
  const analysisId = await writeAgentAnalysis(
    deps,
    tenantId,
    userId,
    "offer-analyst",
    inputRef,
    { language: input.language, terms },
    accounting
  );
  return { terms, analysisId };
}

// ---------------------------------------------------------------------------
// Agent 2 — Risk Analyst: deterministic Critical Rules first, then LLM risk.
// ---------------------------------------------------------------------------

/** Map the terms-analyst verdict vocabulary to the deterministic rule set. */
export function termsToRuleVerdicts(terms: TermsShape): Record<PolicyRuleName, RuleVerdict> {
  const conv = (v: "allowed" | "forbidden" | "restricted" | "unknown"): RuleVerdict =>
    v === "allowed"
      ? "ALLOWED"
      : v === "forbidden"
        ? "FORBIDDEN"
        : v === "restricted"
          ? "REQUIRED"
          : "UNKNOWN";
  return {
    PPC: conv(terms.traffic.search),
    DIRECT_LINK: conv(terms.directLinking),
    BRAND_BIDDING: conv(terms.brandBidding),
    NON_BRAND_KEYWORDS: "UNKNOWN",
    SEARCH_ADS: conv(terms.traffic.search),
    DISPLAY: conv(terms.traffic.display),
    SOCIAL: conv(terms.traffic.social),
    // GEO list semantics are ambiguous in raw terms text; resolved from
    // geoRestrictions separately via extractForbiddenGeos().
    GEO: "UNKNOWN",
    // "restricted" (allowed with conditions) ≈ REQUIRED for the landing page.
    LANDING_PAGE: conv(terms.directLinking === "forbidden" ? "restricted" : "unknown"),
  };
}

/**
 * Pull forbidden ISO geo codes from terms geoRestrictions entries, e.g.
 * "Forbidden: CN, RU" or "not allowed in BR". Only 2-letter uppercase tokens
 * from entries that contain an explicit forbidden keyword.
 */
export function extractForbiddenGeos(geoRestrictions: string[]): string[] {
  const forbiddenPattern = /forbidd|prohibit|not allowed|banned|blocked|excluded|禁止/i;
  const out = new Set<string>();
  for (const entry of geoRestrictions) {
    if (!forbiddenPattern.test(entry)) continue;
    for (const token of entry.toUpperCase().split(/[^A-Z]+/)) {
      if (token.length === 2) out.add(token);
    }
  }
  return [...out];
}

export interface RiskAnalystInput {
  offerId: string;
  terms: TermsShape;
  trafficMode: TrafficMode;
  geo: string[];
  pageText?: string;
  merchant?: string;
  network?: string;
  language: AnalysisLanguage;
}

export interface RiskAnalystOutput {
  criticalHits: CriticalHit[];
  criticalDecision: "DO_NOT_RUN" | "PROCEED";
  /** 0-100 risk score (higher = riskier); null when skipped by critical hit. */
  riskScore: number | null;
  policyScore: number | null;
  merchantScore: number | null;
  findings: Array<{ area: string; severity: string; title: string; detail: string }>;
  suggestions: string[];
  summary: string;
  analysisId: string;
}

/** Score a single rule verdict 0-100 (risk scale: higher = riskier). */
export function verdictToRisk(v: RuleVerdict): number {
  return v === "FORBIDDEN" ? 100 : v === "REQUIRED" ? 55 : v === "ALLOWED" ? 5 : 50;
}

export async function riskAnalyst(
  deps: PipelineDeps,
  tenantId: string,
  userId: string | undefined,
  input: RiskAnalystInput
): Promise<RiskAnalystOutput> {
  const rules = termsToRuleVerdicts(input.terms);
  const critical = evaluateCriticalRules(rules, {
    trafficMode: input.trafficMode,
    geo: input.geo,
    forbiddenGeo: extractForbiddenGeos(input.terms.geoRestrictions),
  });
  if (critical.decision === "DO_NOT_RUN") {
    const analysisId = await writeAgentAnalysis(
      deps,
      tenantId,
      userId,
      "risk-analyst",
      input.offerId,
      {
        decision: "DO_NOT_RUN",
        criticalHits: critical.hits,
        summary:
          "Deterministic critical rule fired; LLM risk analysis skipped.",
      }
    );
    return {
      criticalHits: critical.hits,
      criticalDecision: "DO_NOT_RUN",
      riskScore: 100,
      policyScore: 0,
      merchantScore: null,
      findings: critical.hits.map((h) => ({
        area: "policy",
        severity: "high",
        title: `${h.rule} is FORBIDDEN`,
        detail: h.reason,
      })),
      suggestions: [
        "Switch to LANDING_PAGE traffic mode if allowed by the offer terms.",
      ],
      summary: critical.hits.map((h) => h.reason).join(" "),
      analysisId,
    };
  }

  const config = await requireLlmConfig(deps.prisma);
  const { system, user } = buildAnalysisPrompt({
    pageText: input.pageText ?? input.terms.summary,
    merchant: input.merchant,
    network: input.network,
    language: input.language,
  });
  let analysis;
  let accounting: AgentAccounting;
  try {
    const called = await chatJsonValidatedAccounting(
      chatArgs(config, system, user),
      validateAnalysisShape,
      deps.chatJsonImpl
    );
    analysis = called.data;
    accounting = {
      model: config.model,
      usage: called.usage,
      latencyMs: called.latencyMs,
    };
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw new AiError("LLM request failed");
  }
  // P0-6 — 记账（usage 缺失时记 0）。
  await trackAgentUsage(deps, tenantId, accounting);
  const analysisId = await writeAgentAnalysis(
    deps,
    tenantId,
    userId,
    "risk-analyst",
    input.offerId,
    {
      analysis,
      rules,
      disclaimer: MERCHANT_REPUTATION_DISCLAIMER,
    },
    accounting
  );
  return {
    criticalHits: [],
    criticalDecision: "PROCEED",
    riskScore: analysis.overallRisk,
    policyScore: analysis.scores.policy,
    merchantScore: analysis.scores.merchant,
    findings: analysis.findings.map((f) => ({
      area: f.area,
      severity: f.severity,
      title: f.title,
      detail: f.detail,
    })),
    suggestions: analysis.suggestions,
    summary: `Risk ${analysis.overallRisk}/100 (${analysis.riskLevel}). ${MERCHANT_REPUTATION_DISCLAIMER}`,
    analysisId,
  };
}

// ---------------------------------------------------------------------------
// Agent 3 — Profit Analyst: deterministic math + real stats when available.
// ---------------------------------------------------------------------------

export type DataQuality = "OBSERVED" | "PREDICTED" | "UNKNOWN";

export interface ScenarioRow {
  cvr: number;
  cpc: number;
  clicks: number;
  profit: number;
}

export interface Scenarios {
  worst: ScenarioRow;
  base: ScenarioRow;
  best: ScenarioRow;
}

/**
 * Deterministic three-scenario profit table (§7 formula).
 * ExpectedRevenue = clicks × cvr × approvalRate × commission × attributionRate
 * profit = ExpectedRevenue − adSpend − refundCost
 * Returns numbers only; the LLM never computes money.
 */
export function buildScenarios(args: {
  commission: number;
  approvalRate: number;
  attributionRate: number;
  refundRate: number;
  baseCvrPct: number | null;
  baseCpc: number | null;
  clicks: number;
}): { scenarios: Scenarios; dataQuality: DataQuality; observed: boolean } {
  const { commission, approvalRate, attributionRate, refundRate, clicks } = args;
  const cvrPct = args.baseCvrPct ?? 2;
  const cpc = args.baseCpc ?? 0.8;
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const build = (cvrShift: number, cpcShift: number): ScenarioRow => {
    const cvr = round2(cvrPct * cvrShift);
    const c = round2(cpc * cpcShift);
    const revenue = clicks * (cvr / 100) * approvalRate * commission * attributionRate;
    const adSpend = clicks * c;
    const refundCost = revenue * refundRate;
    return {
      cvr,
      cpc: c,
      clicks,
      profit: round2(revenue - adSpend - refundCost),
    };
  };

  const base = build(1, 1);
  return {
    scenarios: {
      worst: build(0.5, 1.5),
      base,
      best: build(1.5, 0.8),
    },
    dataQuality: args.baseCvrPct != null ? "OBSERVED" : "PREDICTED",
    observed: args.baseCvrPct != null,
  };
}

export interface ProfitAnalystInput {
  offerId: string;
  commission?: number | null;
  commissionType?: string | null;
  currency?: string | null;
  expectedCvr?: number | null;
  approvalRate?: number | null;
  attributionRate?: number | null;
  refundRate?: number | null;
  estimatedCpc?: number | null;
  scenarioClicks?: number;
}

export interface ProfitAnalystOutput {
  model: {
    commission: number | null;
    commissionType: string | null;
    currency: string;
    expectedCvr: number | null;
    approvalRate: number;
    attributionRate: number;
    refundRate: number;
    scenarios: Scenarios;
    breakEvenCpc: number | null;
    recommendedMaxCpc: number | null;
    dataQuality: DataQuality;
  };
  analysisId: string;
  modelId: string;
}

/** Break-even CPC (§8): commission × CVR × approvalRate × attributionRate. */
export function computeBreakEvenCpc(
  commission: number | null,
  cvrPct: number | null,
  approvalRate: number,
  attributionRate: number
): number | null {
  if (
    commission == null ||
    cvrPct == null ||
    commission <= 0 ||
    cvrPct <= 0 ||
    approvalRate <= 0 ||
    attributionRate <= 0
  ) {
    return null;
  }
  return Math.round(commission * (cvrPct / 100) * approvalRate * attributionRate * 10000) / 10000;
}

export async function profitAnalyst(
  deps: PipelineDeps,
  tenantId: string,
  userId: string | undefined,
  input: ProfitAnalystInput
): Promise<ProfitAnalystOutput> {
  const perf = await getOfferPerformance(deps.prisma, tenantId, input.offerId, 30);
  const hasObservedData = perf.clicks > 0;
  const approvalRate = input.approvalRate ?? 0.9;
  const attributionRate = input.attributionRate ?? 0.95;
  const refundRate =
    input.refundRate ?? (perf.refundRatePct != null ? perf.refundRatePct / 100 : 0);
  const commission = input.commission ?? null;
  const currency = input.currency ?? perf.revenueCurrency ?? "USD";
  const observedCvrPct = hasObservedData ? perf.cvrPct : null;

  const dataQuality: DataQuality = hasObservedData ? "OBSERVED" : "PREDICTED";
  const baseCvrPct = observedCvrPct ?? input.expectedCvr ?? null;
  // CPC is an advertiser-side assumption (PREDICTED until observed separately).
  const baseCpc = input.estimatedCpc ?? null;

  const { scenarios } = buildScenarios({
    commission: commission ?? 0,
    approvalRate,
    attributionRate,
    refundRate,
    baseCvrPct,
    baseCpc,
    clicks: input.scenarioClicks ?? 1000,
  });

  const breakEvenCpc = computeBreakEvenCpc(commission, baseCvrPct, approvalRate, attributionRate);
  const safetyMargin = 0.7;
  const recommendedMaxCpc =
    breakEvenCpc != null ? Math.round(breakEvenCpc * safetyMargin * 10000) / 10000 : null;

  // Reuse existing deterministic profitability helper for the single-point check.
  const profitability = computeProfitability(
    commission,
    currency,
    input.estimatedCpc
  );

  const model = {
    commission,
    commissionType: input.commissionType ?? null,
    currency,
    expectedCvr: baseCvrPct,
    approvalRate,
    attributionRate,
    refundRate,
    scenarios,
    breakEvenCpc,
    recommendedMaxCpc,
    dataQuality,
  };
  const analysisId = await writeAgentAnalysis(
    deps,
    tenantId,
    userId,
    "profit-analyst",
    input.offerId,
    { ...model, profitability, perf }
  );
  const id = randomUUID();
  await deps.prisma.profitModel.create({
    data: {
      id,
      tenantId,
      offerId: input.offerId,
      commission: commission ?? null,
      commissionType: input.commissionType ?? null,
      currency,
      expectedCvr: baseCvrPct,
      approvalRate,
      attributionRate,
      refundRate,
      scenarios: JSON.parse(JSON.stringify(scenarios)) as never,
      breakEvenCpc,
      recommendedMaxCpc,
      dataQuality,
    },
  });
  return { model, analysisId, modelId: id };
}

// ---------------------------------------------------------------------------
// Agent 4 — Traffic Analyst: read-only traffic quality summary.
// No attribution reconstruction, no new tracking behavior.
// ---------------------------------------------------------------------------

export interface TrafficAnalystOutput {
  summary: {
    clicks: number;
    conversions: number;
    cvrPct: number | null;
    epc: number;
    refundRatePct: number | null;
    windowDays: number;
    dataQuality: DataQuality;
  };
  analysisId: string;
}

export async function trafficAnalyst(
  deps: PipelineDeps,
  tenantId: string,
  userId: string | undefined,
  offerId: string
): Promise<TrafficAnalystOutput> {
  const perf = await getOfferPerformance(deps.prisma, tenantId, offerId, 30);
  const summary = {
    clicks: perf.clicks,
    conversions: perf.conversions,
    cvrPct: perf.cvrPct,
    epc: perf.epc,
    refundRatePct: perf.refundRatePct,
    windowDays: 30,
    dataQuality: (perf.clicks > 0 ? "OBSERVED" : "UNKNOWN") as DataQuality,
  };
  const analysisId = await writeAgentAnalysis(
    deps,
    tenantId,
    userId,
    "traffic-analyst",
    offerId,
    summary
  );
  return { summary, analysisId };
}

// Agent 5 — Research Analyst: Phase 4 cloaking-research findings.
//
// Reads the latest CloakingFinding for the offer (tenant-scoped; findings
// are produced via a ResearchTest and carry the offerId directly) and maps
// it onto the Phase 5 orchestrator contract.
// The exported signature is exactly `researchAnalyst(offerId)`; prisma and
// the tenant travel in an AsyncLocalStorage context installed by
// runWithResearchContext (used at the pipeline call site below).
//
// Research data is advisory only: when the research store is unavailable
// or has no finding, the agent returns NO_DATA instead of throwing, so a
// missing Phase 4 migration can never break the offer decision pipeline.
// ---------------------------------------------------------------------------

export type ResearchBand =
  | "NORMAL"
  | "MINOR"
  | "SUSPICIOUS"
  | "HIGH_RISK"
  | "STRONG";

export interface ResearchAnalystResult {
  status: "OK" | "NO_DATA";
  /** 0-100 differentiation score; null when NO_DATA. */
  score: number | null;
  band: ResearchBand | null;
  /** One of the 8 classifier values; null when NO_DATA. */
  classification: string | null;
  /** One-sentence Chinese summary. */
  summary: string;
  findingId?: string;
}

const RESEARCH_NO_DATA_SUMMARY = "暂无研究数据";

interface ResearchContext {
  prisma: PrismaClient;
  tenantId: string;
}

const researchContext = new AsyncLocalStorage<ResearchContext>();

/**
 * Install the prisma + tenant context that `researchAnalyst(offerId)` reads.
 * Safe under concurrent requests (AsyncLocalStorage, no module globals).
 */
export function runWithResearchContext<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: () => T
): T {
  return researchContext.run({ prisma, tenantId }, fn);
}

const RESEARCH_BANDS: ResearchBand[] = [
  "NORMAL",
  "MINOR",
  "SUSPICIOUS",
  "HIGH_RISK",
  "STRONG",
];

function normResearchBand(v: unknown): ResearchBand | null {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return (RESEARCH_BANDS as string[]).includes(s) ? (s as ResearchBand) : null;
}

function normResearchScore(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.round(Math.min(100, Math.max(0, n)) * 100) / 100;
}

/** Structural row of the Phase 4 CloakingFinding model (schema.prisma). */
interface CloakingFindingRow {
  id: string;
  differentialScore: number | null;
  band: string | null;
  classification: string | null;
  aiSummary: string | null;
}

function defaultResearchSummary(
  band: ResearchBand | null,
  score: number | null
): string {
  const bandPart = band ?? "未知分档";
  const scorePart = score == null ? "暂无评分" : `${score}分`;
  return `研究检测完成：${bandPart}，差异化评分${scorePart}。`;
}

export async function researchAnalyst(
  offerId: string
): Promise<ResearchAnalystResult> {
  const ctx = researchContext.getStore();
  if (!ctx) {
    throw new AppError("researchAnalyst called without a research context", {
      code: "RESEARCH_NO_CONTEXT",
      statusCode: 500,
    });
  }
  // Tenant-scoped lookup of the latest finding for this offer. Findings are
  // produced via a ResearchTest (researchTestId) and carry the offerId
  // directly (indexed); ResearchTest itself has no offer column.
  let finding: CloakingFindingRow | null = null;
  try {
    finding = await ctx.prisma.cloakingFinding.findFirst({
      where: { tenantId: ctx.tenantId, offerId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        differentialScore: true,
        band: true,
        classification: true,
        aiSummary: true,
      },
    });
  } catch {
    // Research store unavailable (e.g. Phase 4 migration not applied yet):
    // advisory data must not break the pipeline.
    finding = null;
  }
  if (!finding) {
    return {
      status: "NO_DATA",
      score: null,
      band: null,
      classification: null,
      summary: RESEARCH_NO_DATA_SUMMARY,
    };
  }
  const band = normResearchBand(finding.band);
  const score = normResearchScore(finding.differentialScore);
  const classification =
    typeof finding.classification === "string" &&
    finding.classification.trim() !== ""
      ? finding.classification.trim()
      : null;
  const summary =
    typeof finding.aiSummary === "string" && finding.aiSummary.trim() !== ""
      ? finding.aiSummary.trim()
      : defaultResearchSummary(band, score);
  return {
    status: "OK",
    score,
    band,
    classification,
    summary,
    findingId: finding.id,
  };
}

// ---------------------------------------------------------------------------
// §32 decision synthesis — pure function, lenient-validated below.
// ---------------------------------------------------------------------------

export type OfferDecision =
  | "RUN"
  | "TEST"
  | "MANUAL_REVIEW"
  | "DO_NOT_RUN";

export interface DecisionJson {
  decision: OfferDecision;
  riskScore: number;
  profitScore: number;
  policyScore: number;
  breakEvenCpc: number | null;
  recommendedMaxCpc: number | null;
  trafficMode: TrafficMode;
  directLink: boolean;
  confidence: number;
  reason: string[];
  manualChecks: string[];
  dataQuality: DataQuality;
}

/**
 * Synthesize the §32 decision from agent outputs.
 * Critical hits always force DO_NOT_RUN (deterministic, no LLM override).
 * The AI never claims "definitely allowed" without evidence: unknowns and
 * PREDICTED numbers reduce confidence and push toward MANUAL_REVIEW.
 */
export function synthesizeDecision(args: {
  trafficMode: TrafficMode;
  risk: RiskAnalystOutput;
  profit: ProfitAnalystOutput;
  traffic: TrafficAnalystOutput;
  baseProfitThreshold?: number;
}): DecisionJson {
  const { trafficMode, risk, profit, traffic } = args;
  const m = profit.model;
  const base = m.scenarios.base;

  const policyScore = risk.policyScore ?? 50;
  // Profit score from the base-case outcome: positive profit → up to 100,
  // scaled by margin relative to ad spend; no profit data → 50 (neutral).
  const adSpend = base.clicks * base.cpc;
  const profitScore =
    base.clicks > 0 && base.cpc > 0 && adSpend > 0
      ? Math.max(
          0,
          Math.min(100, Math.round((base.profit / adSpend) * 100 + 50))
        )
      : 50;
  const riskScore = Math.round(risk.riskScore ?? 50);

  const reasons: string[] = [];
  const manualChecks: string[] = [
    "Confirm current affiliate terms on the network page before launch.",
  ];

  if (risk.criticalDecision === "DO_NOT_RUN") {
    return {
      decision: "DO_NOT_RUN",
      riskScore: 100,
      profitScore,
      policyScore: 0,
      breakEvenCpc: m.breakEvenCpc,
      recommendedMaxCpc: m.recommendedMaxCpc,
      trafficMode,
      directLink: trafficMode === "DIRECT_LINK",
      confidence: 0.95,
      reason: risk.criticalHits.map((h) => h.reason),
      manualChecks,
      dataQuality: m.dataQuality,
    };
  }

  for (const f of risk.findings) {
    if (f.severity === "high") {
      reasons.push(f.title);
    }
  }
  if (m.dataQuality === "OBSERVED") {
    reasons.push(
      `Observed CVR ${m.expectedCvr ?? "?"}% over ${traffic.summary.windowDays} days (${traffic.summary.clicks} clicks).`
    );
  } else {
    reasons.push("No observed traffic data — profit estimates are PREDICTED.");
    manualChecks.push("Run a small test budget to observe real CVR before scaling.");
  }
  if (m.breakEvenCpc != null) {
    reasons.push(`Break-even CPC $${m.breakEvenCpc}; recommended max $${m.recommendedMaxCpc}.`);
  }
  if (trafficMode === "DIRECT_LINK") {
    reasons.push("Direct-link mode selected; ensure the offer terms allow it.");
  }

  let decision: OfferDecision;
  let confidence: number;
  if (riskScore >= 81) {
    decision = "DO_NOT_RUN";
    confidence = 0.85;
  } else if (riskScore >= 61 || policyScore <= 30) {
    decision = "MANUAL_REVIEW";
    confidence = 0.7;
  } else if (profitScore < 40 || riskScore >= 41 || m.dataQuality !== "OBSERVED") {
    decision = "TEST";
    confidence = m.dataQuality === "OBSERVED" ? 0.8 : 0.6;
  } else {
    decision = "RUN";
    confidence = 0.85;
  }
  if (policyScore <= 20) {
    decision = "MANUAL_REVIEW";
    confidence = Math.min(confidence, 0.65);
  }

  return {
    decision,
    riskScore,
    profitScore,
    policyScore: Math.round(policyScore),
    breakEvenCpc: m.breakEvenCpc,
    recommendedMaxCpc: m.recommendedMaxCpc,
    trafficMode,
    directLink: trafficMode === "DIRECT_LINK",
    confidence,
    reason: reasons.length > 0 ? reasons : ["No blocking restrictions found."],
    manualChecks,
    dataQuality: m.dataQuality,
  };
}

// ---------------------------------------------------------------------------
// §32 JSON validation — lenient like validateTermsShape (no zod dependency):
// case-insensitive enums, numeric strings coerced, error names the field.
// ---------------------------------------------------------------------------

function normDecision(v: unknown): OfferDecision {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  if (s === "RUN") return "RUN";
  if (s === "TEST") return "TEST";
  if (s === "MANUAL_REVIEW" || s === "MANUAL REVIEW" || s === "REVIEW") return "MANUAL_REVIEW";
  if (s === "DO_NOT_RUN" || s === "DO NOT RUN" || s === "DO-NOT-RUN" || s === "STOP") {
    return "DO_NOT_RUN";
  }
  throw new AiError("LLM returned an unexpected response shape (decision)");
}

function normScore(v: unknown, field: string, max: number): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > max) {
    throw new AiError(`LLM returned an unexpected response shape (${field})`);
  }
  return Math.round(n * 100) / 100;
}

function normOptNum(v: unknown, field: string): number | null {
  if (v === null || v === undefined) return null;
  return normScore(v, field, Number.MAX_SAFE_INTEGER);
}

function normStrArray(v: unknown, field: string): string[] {
  if (!Array.isArray(v)) {
    throw new AiError(`LLM returned an unexpected response shape (${field})`);
  }
  return (v as unknown[]).map((x, i) => {
    if (typeof x !== "string" || !x.trim()) {
      throw new AiError(`LLM returned an unexpected response shape (${field}[${i}])`);
    }
    return x.trim();
  });
}

function normTrafficMode(v: unknown): TrafficMode {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  if (s === "LANDING_PAGE") return "LANDING_PAGE";
  if (s === "DIRECT_LINK") return "DIRECT_LINK";
  throw new AiError("LLM returned an unexpected response shape (trafficMode)");
}

function normDataQuality(v: unknown): DataQuality {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  if (s === "OBSERVED" || s === "PREDICTED" || s === "UNKNOWN") return s;
  throw new AiError("LLM returned an unexpected response shape (dataQuality)");
}

/** Validate an object against the §32 decision contract (§28 evidence rule). */
export function validateDecisionShape(obj: unknown): DecisionJson {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new AiError("LLM returned an unexpected response shape (root)");
  }
  const o = obj as Record<string, unknown>;
  return {
    decision: normDecision(o.decision),
    riskScore: normScore(o.riskScore, "riskScore", 100),
    profitScore: normScore(o.profitScore, "profitScore", 100),
    policyScore: normScore(o.policyScore, "policyScore", 100),
    breakEvenCpc: normOptNum(o.breakEvenCpc, "breakEvenCpc"),
    recommendedMaxCpc: normOptNum(o.recommendedMaxCpc, "recommendedMaxCpc"),
    trafficMode: normTrafficMode(o.trafficMode),
    directLink:
      typeof o.directLink === "boolean"
        ? o.directLink
        : o.directLink === "true"
          ? true
          : o.directLink === "false"
            ? false
            : (() => {
                throw new AiError("LLM returned an unexpected response shape (directLink)");
              })(),
    confidence: normScore(o.confidence, "confidence", 1),
    reason: normStrArray(o.reason, "reason"),
    manualChecks: normStrArray(o.manualChecks, "manualChecks"),
    dataQuality: normDataQuality(o.dataQuality),
  };
}

// ---------------------------------------------------------------------------
// Full pipeline: agent1 → agent4 → synthesize → persist OfferRiskScore.
// ---------------------------------------------------------------------------

export interface PipelineInput {
  termsText: string;
  language: AnalysisLanguage;
  trafficMode: TrafficMode;
  geo: string[];
  pageText?: string;
  commission?: number | null;
  commissionType?: string | null;
  currency?: string | null;
  expectedCvr?: number | null;
  approvalRate?: number | null;
  attributionRate?: number | null;
  refundRate?: number | null;
  estimatedCpc?: number | null;
  scenarioClicks?: number;
}

export async function runOfferPipeline(
  deps: PipelineDeps,
  tenantId: string,
  userId: string | undefined,
  offerId: string,
  input: PipelineInput
): Promise<DecisionJson> {
  const { terms } = await offerAnalyst(deps, tenantId, userId, {
    text: input.termsText,
    language: input.language,
  });

  // Persist the structured policy result + evidence rows (from real text).
  const policyId = randomUUID();
  await deps.prisma.offerPolicy.create({
    data: {
      id: policyId,
      tenantId,
      offerId,
      retrievedAt: new Date(),
      rawTerms: input.termsText.slice(0, 60_000),
      rules: JSON.parse(JSON.stringify(termsToRuleVerdicts(terms))) as never,
    },
  });
  for (const flag of terms.redFlags) {
    await deps.prisma.policyEvidence.create({
      data: {
        id: randomUUID(),
        tenantId,
        offerPolicyId: policyId,
        rule: flag.severity,
        matchedText: flag.detail,
        confidence: flag.severity === "high" ? 0.95 : 0.7,
        sourceExcerpt: flag.title,
      },
    });
  }

  const risk = await riskAnalyst(deps, tenantId, userId, {
    offerId,
    terms,
    trafficMode: input.trafficMode,
    geo: input.geo,
    pageText: input.pageText,
    language: input.language,
  });
  const profit = await profitAnalyst(deps, tenantId, userId, {
    offerId,
    commission: input.commission,
    commissionType: input.commissionType,
    currency: input.currency,
    expectedCvr: input.expectedCvr,
    approvalRate: input.approvalRate,
    attributionRate: input.attributionRate,
    refundRate: input.refundRate,
    estimatedCpc: input.estimatedCpc,
    scenarioClicks: input.scenarioClicks,
  });
  const traffic = await trafficAnalyst(deps, tenantId, userId, offerId);
  // Agent 5 (advisory): reads the latest Phase 4 research finding, if any.
  await runWithResearchContext(deps.prisma, tenantId, () =>
    researchAnalyst(offerId)
  );

  const decision = synthesizeDecision({
    trafficMode: input.trafficMode,
    risk,
    profit,
    traffic,
  });
  await deps.prisma.offerRiskScore.create({
    data: {
      id: randomUUID(),
      tenantId,
      offerId,
      overallScore: decision.riskScore,
      policyScore: decision.policyScore,
      profitScore: decision.profitScore,
      merchantScore: risk.merchantScore,
      trackingScore: null,
      decision: decision.decision,
      evaluatedAt: new Date(),
    },
  });
  return decision;
}
