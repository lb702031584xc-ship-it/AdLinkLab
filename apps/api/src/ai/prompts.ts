/**
 * Phase 11 — prompt for the affiliate-offer risk analyst.
 * The LLM must return STRICT JSON only (no markdown fences, no prose).
 */
import { AiError } from "./llm.js";

export type AnalysisLanguage = "zh" | "en";

export interface AnalysisFinding {
  area: "merchant" | "policy" | "network";
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
}

export interface AnalysisShape {
  overallRisk: number;
  riskLevel: "low" | "medium" | "high";
  scores: { merchant: number; policy: number; network: number };
  findings: AnalysisFinding[];
  suggestions: string[];
  keywords: string[];
  adAngles: string[];
}

export interface PromptInput {
  pageText: string;
  merchant?: string;
  network?: string;
  payout?: number;
  payoutCurrency?: string;
  language: AnalysisLanguage;
}

// ---------------------------------------------------------------------------
// Offer TERMS analyst (P0 anti-ban: parse traffic restrictions before running)
// ---------------------------------------------------------------------------

export type TermsRestriction = "allowed" | "forbidden" | "restricted" | "unknown";

export interface TermsRedFlag {
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
}

export interface TermsShape {
  overallVerdict: "go" | "caution" | "stop";
  traffic: {
    search: TermsRestriction;
    display: TermsRestriction;
    email: TermsRestriction;
    social: TermsRestriction;
    incentivized: TermsRestriction;
  };
  brandBidding: TermsRestriction;
  /** How brandBidding=allowed was reached: explicit allowance, or terms silent on it. Null unless verdict is allowed. */
  brandBiddingBasis?: "explicit" | "silence" | null;
  directLinking: TermsRestriction;
  /** How directLinking=allowed was reached: explicit allowance, or terms silent on it. Null unless verdict is allowed. */
  directLinkingBasis?: "explicit" | "silence" | null;
  geoRestrictions: string[];
  caps: string | null;
  payoutTerms: string | null;
  redFlags: TermsRedFlag[];
  summary: string;
}

const TERMS_JSON_SPEC = `{
  "overallVerdict": "go" | "caution" | "stop",
  "traffic": {
    "search": "allowed" | "forbidden" | "restricted" | "unknown",
    "display": "allowed" | "forbidden" | "restricted" | "unknown",
    "email": "allowed" | "forbidden" | "restricted" | "unknown",
    "social": "allowed" | "forbidden" | "restricted" | "unknown",
    "incentivized": "allowed" | "forbidden" | "restricted" | "unknown"
  },
  "brandBidding": "allowed" | "forbidden" | "restricted" | "unknown",
  "brandBiddingBasis": "explicit" | "silence" | null,
  "directLinking": "allowed" | "forbidden" | "restricted" | "unknown",
  "directLinkingBasis": "explicit" | "silence" | null,
  "geoRestrictions": ["<geo or restriction as stated>", "..."],
  "caps": "<cap/limit as stated, or null>",
  "payoutTerms": "<payout terms as stated, or null>",
  "redFlags": [
    { "severity": "high" | "medium" | "low",
      "title": "<short>",
      "detail": "<1-2 sentences>" }
  ],
  "summary": "<2-3 sentence summary>"
}`;

/**
 * Build the system/user prompt for parsing affiliate offer TERMS
 * (restrictions, not the landing page). The advertiser runs Google Ads
 * paid search and may use incentivized/cashback traffic.
 */
export function buildTermsPrompt(
  termsText: string,
  language: AnalysisLanguage
): { system: string; user: string } {
  const langName = language === "en" ? "English" : "Simplified Chinese";

  const system = [
    "You are an affiliate-offer TERMS analyst helping a Google Ads advertiser decide whether an offer's traffic restrictions allow paid search promotion.",
    `Write ALL JSON string values in ${langName}.`,
    "Return STRICT JSON only — no markdown fences, no commentary, no trailing text. It must parse with JSON.parse and match this exact shape:",
    TERMS_JSON_SPEC,
    "",
    "Rules:",
    "- Be CONSERVATIVE: when the terms are ambiguous or silent on a restriction, use \"unknown\" — NEVER invent \"allowed\". EXCEPTION: brandBidding and directLinking ONLY (see below) — for those two, silence means \"allowed\" with basis \"silence\".",
    "- \"restricted\" means allowed with conditions (e.g. prior approval, whitelisted keywords only, capped spend).",
    "- traffic.search covers paid search / PPC / SEM. traffic.incentivized covers cashback, loyalty, reward and any incentivized traffic — assess it EXPLICITLY, because many offers ban it even when other traffic is allowed.",
    "- brandBidding: \"forbidden\" for \"no brand bidding\"; \"restricted\" for \"brand bidding with prior written approval\" or similar conditions; \"allowed\" with basis \"explicit\" when the terms explicitly allow brand bidding; \"allowed\" with basis \"silence\" when the terms say NOTHING about brand bidding at all. Use \"unknown\" (basis null) ONLY when the terms are genuinely self-contradictory on brand bidding and cannot be decided.",
    "- directLinking: \"forbidden\" if the terms require a landing page / pre-lander or forbid sending traffic straight to the merchant URL; \"restricted\" when direct linking needs approval/conditions; \"allowed\" with basis \"explicit\" when the terms explicitly allow sending traffic straight to the merchant URL; \"allowed\" with basis \"silence\" when the terms say NOTHING about direct linking at all. Use \"unknown\" (basis null) ONLY when the terms are genuinely self-contradictory on direct linking and cannot be decided.",
    "- For brandBidding and directLinking ONLY: silence is NOT a red flag, do not emit a medium/low redFlag for their silence.",
    "- When brandBidding or directLinking verdict is \"forbidden\", \"restricted\" or \"unknown\", its basis MUST be null.",
    "- geoRestrictions: list restricted or allowed geos exactly as stated; use an empty array when the terms mention none.",
    "- caps / payoutTerms: quote the stated terms briefly, or null when not stated.",
    "- redFlags: every concrete restriction that could get an ad account or affiliate account banned gets severity \"high\"; notable unknowns get \"medium\" or \"low\".",
    "- overallVerdict calibration: \"stop\" when paid search is forbidden or a high-severity flag directly bans the advertiser's model; \"caution\" when key fields are \"unknown\"/\"restricted\" or medium flags exist; \"go\" ONLY when search is explicitly allowed and no high-severity flags exist. brandBidding / directLinking allowed on silence (basis \"silence\") does NOT count as an unknown and does NOT block \"go\".",
  ].join("\n");

  const user = [
    "Offer terms text (may be truncated):",
    termsText || "(empty)",
  ].join("\n");

  return { system, user };
}

const TERMS_RESTRICTIONS = ["allowed", "forbidden", "restricted", "unknown"] as const;

/**
 * Validate the LLM's JSON against the terms shape.
 * Lenient: normalizes enum casing and numeric strings; the error names the
 * offending field so a bad model response is debuggable without logging it.
 */
export function validateTermsShape(obj: unknown): TermsShape {
  if (!isRecord(obj)) {
    throw new AiError("LLM returned an unexpected response shape (root)");
  }
  const o = obj as Record<string, unknown>;
  const overallVerdict = normEnum(o.overallVerdict, ["go", "caution", "stop"] as const, "overallVerdict");
  if (!isRecord(o.traffic)) {
    throw new AiError("LLM returned an unexpected response shape (traffic)");
  }
  const traffic = o.traffic as Record<string, unknown>;
  const trafficOut = {} as TermsShape["traffic"];
  for (const k of ["search", "display", "email", "social", "incentivized"] as const) {
    trafficOut[k] = normEnum(traffic[k], TERMS_RESTRICTIONS, `traffic.${k}`);
  }
  const brandBidding = normEnum(o.brandBidding, TERMS_RESTRICTIONS, "brandBidding");
  const directLinking = normEnum(o.directLinking, TERMS_RESTRICTIONS, "directLinking");
  // Basis: only meaningful when verdict is "allowed"; missing/invalid → null.
  const normBasis = (
    v: unknown,
    verdict: TermsRestriction
  ): "explicit" | "silence" | null => {
    if (verdict !== "allowed") return null;
    const lv = typeof v === "string" ? v.trim().toLowerCase() : "";
    return lv === "explicit" || lv === "silence" ? lv : null;
  };
  const brandBiddingBasis = normBasis(o.brandBiddingBasis, brandBidding);
  const directLinkingBasis = normBasis(o.directLinkingBasis, directLinking);
  if (
    !Array.isArray(o.geoRestrictions) ||
    !(o.geoRestrictions as unknown[]).every((g) => typeof g === "string")
  ) {
    throw new AiError("LLM returned an unexpected response shape (geoRestrictions)");
  }
  const caps = o.caps === null ? null : normStr(o.caps, "caps", true);
  const payoutTerms = o.payoutTerms === null ? null : normStr(o.payoutTerms, "payoutTerms", true);
  if (!Array.isArray(o.redFlags)) {
    throw new AiError("LLM returned an unexpected response shape (redFlags)");
  }
  const redFlags: TermsRedFlag[] = [];
  (o.redFlags as unknown[]).forEach((f, i) => {
    if (!isRecord(f)) {
      throw new AiError(`LLM returned an unexpected response shape (redFlags[${i}])`);
    }
    const r = f as Record<string, unknown>;
    redFlags.push({
      severity: normEnum(r.severity, ["high", "medium", "low"] as const, `redFlags[${i}].severity`),
      title: normStr(r.title, `redFlags[${i}].title`, false),
      detail: normStr(r.detail, `redFlags[${i}].detail`, true),
    });
  });
  const summary = normStr(o.summary, "summary", false);

  return {
    overallVerdict,
    traffic: trafficOut,
    brandBidding,
    brandBiddingBasis,
    directLinking,
    directLinkingBasis,
    geoRestrictions: (o.geoRestrictions as string[]).map((g) => g.trim()).filter(Boolean),
    caps: caps?.trim() || null,
    payoutTerms: payoutTerms?.trim() || null,
    redFlags,
    summary,
  };
}

const JSON_SPEC = `{
  "overallRisk": <integer 0-100, higher = riskier>,
  "riskLevel": "low" | "medium" | "high",
  "scores": { "merchant": <0-100>, "policy": <0-100>, "network": <0-100> },
  "findings": [
    { "area": "merchant" | "policy" | "network",
      "severity": "high" | "medium" | "low",
      "title": "<short>",
      "detail": "<1-2 sentences>" }
  ],
  "suggestions": ["<actionable fix or next step>", ...],
  "keywords": ["<8-15 keyword ideas>"],
  "adAngles": ["<3-5 ad angle ideas>"]
}`;

function riskBands(): string {
  return "riskLevel MUST be consistent with overallRisk: low for <35, medium for 35-69, high for >=70.";
}

export function buildAnalysisPrompt(input: PromptInput): {
  system: string;
  user: string;
} {
  const langName =
    input.language === "en" ? "English" : "Simplified Chinese";
  const meta: string[] = [];
  if (input.merchant) meta.push(`Merchant (user-provided): ${input.merchant}`);
  if (input.network) meta.push(`Network (user-provided): ${input.network}`);
  if (input.payout !== undefined) {
    meta.push(
      `Payout (user-provided): ${input.payout}${input.payoutCurrency ? ` ${input.payoutCurrency}` : ""}`
    );
  }

  const system = [
    "You are an affiliate-offer risk analyst helping a Google Ads advertiser decide whether an offer is safe and worthwhile to promote.",
    `Write ALL JSON string values in ${langName}.`,
    "Return STRICT JSON only — no markdown fences, no commentary, no trailing text. It must parse with JSON.parse and match this exact shape:",
    JSON_SPEC,
    riskBands(),
    "",
    "Assess three areas:",
    "1) MERCHANT RISK (scores.merchant + findings with area='merchant'): trust signals — contact information, refund/privacy policy, company identity, domain professionalism, exaggerated trust badges. Label every signal as page-based when it comes only from the page text (e.g. 'page shows no contact email').",
    "2) GOOGLE ADS POLICY RISK (scores.policy + findings with area='policy'): misleading or unrealistic claims (income, health, 'guaranteed'), health/finance restricted claims, before/after imagery claims, bridge-page / affiliate-arbitrage signals (thin page whose only purpose is redirecting to the merchant), cloaking or misrepresentation signals.",
    "3) NETWORK RISK (scores.network + findings with area='network'): reputation of the affiliate network from your training knowledge. EXPLICITLY label this as a knowledge-cutoff assessment, not live data. If you do not recognize the network, say so in a finding with severity 'medium' instead of inventing a reputation.",
    "suggestions: concrete, actionable fixes or verification steps, ordered by impact.",
    "keywords: 8-15 keyword ideas a Google Ads advertiser could target for this offer (include a mix of generic and intent-rich phrases).",
    "adAngles: 3-5 distinct ad creative angles.",
    "Be calibrated: a normal legitimate e-commerce offer should score low. Reserve high scores for genuinely risky patterns.",
  ].join("\n");

  const user = [
    meta.length > 0 ? meta.join("\n") : "(no metadata provided)",
    "",
    "Offer page text (may be truncated):",
    input.pageText || "(empty)",
  ].join("\n");

  return { system, user };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNum(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}

/**
 * Lenient enum matching: trims and lowercases before comparing, because models
 * frequently return "Medium" or "ALLOWED" despite the spec asking for lowercase.
 */
function normEnum<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  const lv = typeof v === "string" ? v.trim().toLowerCase() : "";
  if ((allowed as readonly string[]).includes(lv)) return lv as T;
  throw new AiError(`LLM returned an unexpected response shape (${field})`);
}

/** Accept numeric strings ("75") as well as numbers; round and range-check. */
function normNum(v: unknown, min: number, max: number, field: string): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : v;
  if (isNum(n, min, max)) return Math.round(n);
  throw new AiError(`LLM returned an unexpected response shape (${field})`);
}

function normStr(v: unknown, field: string, allowEmpty: boolean): string {
  if (typeof v !== "string") {
    throw new AiError(`LLM returned an unexpected response shape (${field})`);
  }
  const t = v.trim();
  if (!allowEmpty && !t) {
    throw new AiError(`LLM returned an unexpected response shape (${field})`);
  }
  return t;
}

/**
 * Validate the LLM's JSON against the required shape.
 * Lenient: normalizes enum casing and numeric strings; the error names the
 * offending field so a bad model response is debuggable without logging it.
 */
export function validateAnalysisShape(obj: unknown): AnalysisShape {
  if (!isRecord(obj)) {
    throw new AiError("LLM returned an unexpected response shape (root)");
  }
  const o = obj as Record<string, unknown>;
  const overallRisk = normNum(o.overallRisk, 0, 100, "overallRisk");
  const riskLevel = normEnum(o.riskLevel, ["low", "medium", "high"] as const, "riskLevel");
  if (!isRecord(o.scores)) {
    throw new AiError("LLM returned an unexpected response shape (scores)");
  }
  const scores = o.scores as Record<string, unknown>;
  const normScores = {
    merchant: normNum(scores.merchant, 0, 100, "scores.merchant"),
    policy: normNum(scores.policy, 0, 100, "scores.policy"),
    network: normNum(scores.network, 0, 100, "scores.network"),
  };
  if (!Array.isArray(o.findings)) {
    throw new AiError("LLM returned an unexpected response shape (findings)");
  }
  const findings: AnalysisFinding[] = [];
  (o.findings as unknown[]).forEach((f, i) => {
    if (!isRecord(f)) {
      throw new AiError(`LLM returned an unexpected response shape (findings[${i}])`);
    }
    const r = f as Record<string, unknown>;
    findings.push({
      area: normEnum(r.area, ["merchant", "policy", "network"] as const, `findings[${i}].area`),
      severity: normEnum(r.severity, ["high", "medium", "low"] as const, `findings[${i}].severity`),
      title: normStr(r.title, `findings[${i}].title`, false),
      detail: normStr(r.detail, `findings[${i}].detail`, true),
    });
  });
  const strArray = (v: unknown, min: number, max: number, field: string): string[] => {
    if (!Array.isArray(v)) {
      throw new AiError(`LLM returned an unexpected response shape (${field})`);
    }
    const arr = (v as unknown[]).filter(
      (s): s is string => typeof s === "string" && s.trim().length > 0
    );
    if (arr.length < min || arr.length > max) {
      throw new AiError(`LLM returned an unexpected response shape (${field})`);
    }
    return arr.map((s) => s.trim());
  };
  const suggestions = strArray(o.suggestions, 0, 50, "suggestions");
  const keywords = strArray(o.keywords, 1, 30, "keywords");
  const adAngles = strArray(o.adAngles, 1, 10, "adAngles");

  return {
    overallRisk,
    riskLevel,
    scores: normScores,
    findings,
    suggestions,
    keywords,
    adAngles,
  };
}
