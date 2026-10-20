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
import { fetchPage } from "../ai/fetch-page.js";
import {
  buildScenarios,
  offerAnalyst,
  profitAnalyst,
  runOfferPipeline,
  termsToRuleVerdicts,
  validateDecisionShape,
  type AnalysisLanguage,
  type DecisionJson,
  type TrafficMode,
} from "../ai/pipeline.js";
import { chatJson } from "../ai/llm.js";

/**
 * Phase 1 Offer Intelligence API (one tenant per user; session auth only).
 * Pure addition: new endpoints only, no existing route behavior changed.
 * Contract frozen: response shapes below are consumed by the Web worker —
 * do not rename fields.
 */

export interface OfferIntelRouteDeps {
  prisma: PrismaClient;
  /** Injectable for tests. */
  chatJsonImpl?: typeof chatJson;
  /** Injectable for tests. */
  fetchPageImpl?: typeof fetchPage;
}

async function requireSession(
  deps: OfferIntelRouteDeps,
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asTrimmedString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function asOptionalNumber(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

/**
 * 补强 #1：商家结算率解析。undefined = 未提供（不改）；null = 明确清空；
 * 数值/数字字符串必须在 0–100 内，否则 400。存储走 Decimal(5,2) 列，
 * 这里只传 number（与 commissionValue 的既有写法一致），绝不编造默认値。
 */
function parseSettlementRatePct(v: unknown): { present: boolean; value: number | null } {
  if (v === undefined) return { present: false, value: null };
  if (v === null) return { present: true, value: null };
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100) {
    throw new ValidationError("settlementRatePct must be a number between 0 and 100");
  }
  return { present: true, value: n };
}

/** Decimal/number/string → number|null（API 序列化用；算不出 → null）。 */
function decimalToNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : null;
}

function asTrafficMode(v: unknown): TrafficMode {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  if (s === "DIRECT_LINK" || s === "DIRECT-LINK") return "DIRECT_LINK";
  return "LANDING_PAGE";
}

function asGeoArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim().toUpperCase());
}

/** Minimal CSV parser (headers + quoted fields) for offer import. */
function parseCsv(csv: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (inQuotes) {
      if (c === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      cur.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && csv[i + 1] === "\n") i++;
      cur.push(field);
      field = "";
      if (cur.some((x) => x.trim() !== "")) rows.push(cur);
      cur = [];
    } else {
      field += c;
    }
  }
  cur.push(field);
  if (cur.some((x) => x.trim() !== "")) rows.push(cur);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const out: Record<string, string> = {};
    headers.forEach((h, i) => {
      out[h] = (r[i] ?? "").trim();
    });
    return out;
  });
}

interface ImportItem {
  name?: unknown;
  network?: unknown;
  destinationUrl?: unknown;
  affiliateUrl?: unknown;
  merchantId?: unknown;
  category?: unknown;
  geoAllow?: unknown;
  cookieDays?: unknown;
  commissionValue?: unknown;
  commissionType?: unknown;
}

function normalizeImportItem(
  item: ImportItem
): {
  name: string;
  network: string;
  destinationUrl: string;
  affiliateUrl: string | null;
  merchantId: string | null;
  category: string | null;
  geoAllow: string[];
  cookieDays: number | null;
  commissionValue: number | null;
  commissionType: string | null;
} {
  const name = asTrimmedString(item.name);
  const destinationUrl = asTrimmedString(item.destinationUrl);
  if (!name) throw new ValidationError("item.name is required");
  if (!destinationUrl) throw new ValidationError("item.destinationUrl is required");
  const network = asTrimmedString(item.network) ?? "UNKNOWN";
  const merchantId = asTrimmedString(item.merchantId);
  if (merchantId && !UUID_RE.test(merchantId)) {
    throw new ValidationError("item.merchantId must be a valid UUID");
  }
  const cookieDays = asOptionalNumber(item.cookieDays);
  if (cookieDays !== undefined && (!Number.isInteger(cookieDays) || cookieDays < 0)) {
    throw new ValidationError("item.cookieDays must be a non-negative integer");
  }
  const commissionValue = asOptionalNumber(item.commissionValue);
  return {
    name,
    network,
    destinationUrl,
    affiliateUrl: asTrimmedString(item.affiliateUrl) ?? null,
    merchantId: merchantId ?? null,
    category: asTrimmedString(item.category) ?? null,
    geoAllow: Array.isArray(item.geoAllow)
      ? item.geoAllow.filter((g): g is string => typeof g === "string").map((g) => g.trim()).filter(Boolean)
      : [],
    cookieDays: cookieDays ?? null,
    commissionValue: commissionValue ?? null,
    commissionType: asTrimmedString(item.commissionType) ?? null,
  };
}

function serializePolicy(policy: {
  id: string;
  sourceUrl: string | null;
  retrievedAt: Date | null;
  rules: unknown;
}) {
  return {
    id: policy.id,
    sourceUrl: policy.sourceUrl,
    retrievedAt: policy.retrievedAt ? policy.retrievedAt.toISOString() : null,
    rules: policy.rules,
  };
}

function serializeEvidence(ev: {
  id: string;
  rule: string;
  matchedText: string;
  confidence: number;
  sourceExcerpt: string | null;
}) {
  return {
    id: ev.id,
    rule: ev.rule,
    matchedText: ev.matchedText,
    confidence: ev.confidence,
    sourceExcerpt: ev.sourceExcerpt,
  };
}

function serializeRiskScore(s: {
  overallScore: number;
  policyScore: number | null;
  profitScore: number | null;
  merchantScore: number | null;
  trackingScore: number | null;
  decision: string;
  evaluatedAt: Date;
}) {
  return {
    overallScore: s.overallScore,
    policyScore: s.policyScore,
    profitScore: s.profitScore,
    merchantScore: s.merchantScore,
    trackingScore: s.trackingScore,
    decision: s.decision,
    evaluatedAt: s.evaluatedAt.toISOString(),
  };
}

function serializeProfitModel(m: {
  commission: unknown;
  commissionType: string | null;
  currency: string;
  expectedCvr: number | null;
  approvalRate: number | null;
  attributionRate: number | null;
  refundRate: number | null;
  scenarios: unknown;
  breakEvenCpc: number | null;
  recommendedMaxCpc: number | null;
  dataQuality: string;
}) {
  const commission =
    m.commission === null || m.commission === undefined
      ? null
      : typeof m.commission === "number"
        ? m.commission
        : Number(String(m.commission));
  return {
    commission: Number.isFinite(commission) ? commission : null,
    commissionType: m.commissionType,
    currency: m.currency,
    expectedCvr: m.expectedCvr,
    approvalRate: m.approvalRate ?? 0.9,
    attributionRate: m.attributionRate ?? 0.95,
    refundRate: m.refundRate ?? 0,
    scenarios: m.scenarios,
    breakEvenCpc: m.breakEvenCpc,
    recommendedMaxCpc: m.recommendedMaxCpc,
    dataQuality: m.dataQuality,
  };
}

async function getOfferOr404(
  deps: OfferIntelRouteDeps,
  tenantId: string,
  offerId: string
) {
  const offer = await deps.prisma.offer.findFirst({
    where: { id: offerId, tenantId, deletedAt: null },
  });
  if (!offer) throw new NotFoundError("Offer", offerId);
  return offer;
}

async function latestPolicy(deps: OfferIntelRouteDeps, tenantId: string, offerId: string) {
  return deps.prisma.offerPolicy.findFirst({
    where: { offerId, tenantId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

export async function registerOfferIntelRoutes(
  app: FastifyInstance,
  deps: OfferIntelRouteDeps
): Promise<void> {
  const { prisma } = deps;

  /**
   * Import offers: `{ items: [...] }` or `{ csv: "..." }`.
   * Reuses the same fields as POST /api/v1/offers (additive new fields only).
   */
  app.post<{
    Body: { items?: unknown; csv?: unknown };
  }>("/api/v1/offers/import", async (request) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as { items?: unknown; csv?: unknown };
    let rawItems: ImportItem[] = [];
    if (Array.isArray(body.items)) {
      rawItems = body.items as ImportItem[];
    } else if (typeof body.csv === "string" && body.csv.trim()) {
      const parsed = parseCsv(body.csv);
      rawItems = parsed.map((r) => ({
        name: r.name,
        network: r.network,
        destinationUrl: r.destinationurl ?? r.destination_url ?? r.url,
        affiliateUrl: r.affiliateurl ?? r.affiliate_url,
        merchantId: r.merchantid ?? r.merchant_id,
        category: r.category,
        cookieDays: r.cookiedays ?? r.cookie_days,
        commissionValue: r.commissionvalue ?? r.commission_value,
        commissionType: r.commissiontype ?? r.commission_type,
      }));
    } else {
      throw new ValidationError("items (array) or csv (string) is required");
    }
    if (rawItems.length === 0) {
      throw new ValidationError("no importable offers found");
    }
    if (rawItems.length > 200) {
      throw new ValidationError("items must contain at most 200 offers");
    }
    const created: Array<{ id: string; name: string }> = [];
    for (const raw of rawItems) {
      const it = normalizeImportItem(raw);
      if (it.merchantId) {
        const merchant = await prisma.merchant.findFirst({
          where: { id: it.merchantId, tenantId: info.tenantId, deletedAt: null },
          select: { id: true },
        });
        if (!merchant) {
          throw new NotFoundError("Merchant", it.merchantId);
        }
      }
      const id = randomUUID();
      await prisma.offer.create({
        data: {
          id,
          tenantId: info.tenantId,
          name: it.name,
          network: it.network,
          destinationUrl: it.destinationUrl,
          affiliateUrl: it.affiliateUrl,
          merchantId: it.merchantId,
          category: it.category,
          geoAllow: it.geoAllow,
          cookieDays: it.cookieDays,
          commissionValue: it.commissionValue,
          commissionType: it.commissionType,
        },
      });
      created.push({ id, name: it.name });
    }
    return { created: created.length, offers: created };
  });

  /**
   * Policy Scanner: fetch terms text (explicit or from destination URL),
   * run the Offer Analyst (Agent 1), persist OfferPolicy + PolicyEvidence.
   * Evidence matchedText always comes from the real fetched text.
   */
  app.post<{
    Params: { id: string };
    Body: {
      termsText?: unknown;
      sourceUrl?: unknown;
      language?: unknown;
      trafficMode?: unknown;
    };
  }>("/api/v1/offers/:id/scan", async (request) => {
    const info = await requireSession(deps, request);
    const offer = await getOfferOr404(deps, info.tenantId, request.params.id);
    const body = (request.body ?? {}) as {
      termsText?: unknown;
      sourceUrl?: unknown;
      language?: unknown;
      trafficMode?: unknown;
    };
    const language: AnalysisLanguage = body.language === "en" ? "en" : "zh";
    let termsText = asTrimmedString(body.termsText);
    const sourceUrl = asTrimmedString(body.sourceUrl) ?? offer.destinationUrl;
    if (!termsText) {
      // Default user agent, no cloaking-avoidance headers (compliance.ts is
      // SSRF-safe and uses the default UA).
      const fetched = await (deps.fetchPageImpl ?? fetchPage)(sourceUrl);
      termsText = fetched.text;
    }
    if (!termsText || termsText.length < 50) {
      throw new ValidationError(
        "Could not obtain at least 50 characters of terms text; provide termsText explicitly."
      );
    }
    const { terms } = await offerAnalyst(
      deps,
      info.tenantId,
      info.id,
      { text: termsText, language }
    );
    const rules = termsToRuleVerdicts(terms);
    const policyId = randomUUID();
    await prisma.offerPolicy.create({
      data: {
        id: policyId,
        tenantId: info.tenantId,
        offerId: offer.id,
        sourceUrl,
        retrievedAt: new Date(),
        rawTerms: termsText.slice(0, 60_000),
        rules: JSON.parse(JSON.stringify(rules)) as never,
      },
    });
    let evidenceCount = 0;
    for (const flag of terms.redFlags) {
      await prisma.policyEvidence.create({
        data: {
          id: randomUUID(),
          tenantId: info.tenantId,
          offerPolicyId: policyId,
          rule: flag.severity,
          matchedText: flag.detail,
          confidence: flag.severity === "high" ? 0.95 : 0.7,
          sourceExcerpt: flag.title,
        },
      });
      evidenceCount++;
    }
    const rulesFound = Object.values(rules).filter((v) => v !== "UNKNOWN").length;
    return { policyId, rulesFound, evidenceCount };
  });

  /** Latest structured policy + evidence rows. */
  app.get<{
    Params: { id: string };
  }>("/api/v1/offers/:id/policy", async (request) => {
    const info = await requireSession(deps, request);
    await getOfferOr404(deps, info.tenantId, request.params.id);
    const policy = await latestPolicy(deps, info.tenantId, request.params.id);
    if (!policy) {
      throw new NotFoundError("OfferPolicy", request.params.id);
    }
    const evidence = await prisma.policyEvidence.findMany({
      where: { offerPolicyId: policy.id, tenantId: info.tenantId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
    return {
      policy: {
        ...serializePolicy(policy),
        dataQuality: "OBSERVED" as const,
      },
      evidence: evidence.map(serializeEvidence),
    };
  });

  /**
   * Latest risk score; when none exists and a policy with rawTerms is stored,
   * run the pipeline once and return the fresh score.
   */
  app.get<{
    Params: { id: string };
  }>("/api/v1/offers/:id/risk", async (request) => {
    const info = await requireSession(deps, request);
    await getOfferOr404(deps, info.tenantId, request.params.id);
    let score = await prisma.offerRiskScore.findFirst({
      where: { offerId: request.params.id, tenantId: info.tenantId, deletedAt: null },
      orderBy: { evaluatedAt: "desc" },
    });
    if (!score) {
      const policy = await latestPolicy(deps, info.tenantId, request.params.id);
      if (!policy || !policy.rawTerms) {
        throw new ValidationError(
          "No risk score yet; run POST /api/v1/offers/:id/decision first."
        );
      }
      await runOfferPipeline(
        { prisma, chatJsonImpl: deps.chatJsonImpl, fetchPageImpl: deps.fetchPageImpl },
        info.tenantId,
        info.id,
        request.params.id,
        {
          termsText: policy.rawTerms,
          language: "zh",
          trafficMode: "LANDING_PAGE",
          geo: [],
        }
      );
      score = await prisma.offerRiskScore.findFirst({
        where: { offerId: request.params.id, tenantId: info.tenantId, deletedAt: null },
        orderBy: { evaluatedAt: "desc" },
      });
    }
    if (!score) {
      throw new NotFoundError("OfferRiskScore", request.params.id);
    }
    return { score: { ...serializeRiskScore(score), dataQuality: "OBSERVED" as const } };
  });

  /** Latest profit model; computed on demand when missing (deterministic). */
  app.get<{
    Params: { id: string };
  }>("/api/v1/offers/:id/profit", async (request) => {
    const info = await requireSession(deps, request);
    const offer = await getOfferOr404(deps, info.tenantId, request.params.id);
    let model = await prisma.profitModel.findFirst({
      where: { offerId: offer.id, tenantId: info.tenantId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!model) {
      const commissionRaw =
        (offer as unknown as { commissionValue?: unknown }).commissionValue ?? null;
      const commission =
        typeof commissionRaw === "number"
          ? commissionRaw
          : commissionRaw != null
            ? Number(String(commissionRaw))
            : null;
      const { model: computed } = await profitAnalyst(
        deps,
        info.tenantId,
        info.id,
        {
          offerId: offer.id,
          commission: Number.isFinite(commission) ? (commission as number) : null,
          commissionType: (offer as unknown as { commissionType?: string }).commissionType ?? null,
          currency: "USD",
        }
      );
      return { model: computed };
    }
    return { model: serializeProfitModel(model) };
  });

  /** Deterministic three-scenario simulation from assumed CPC/CVR. */
  app.post<{
    Params: { id: string };
    Body: { cpc?: unknown; cvr?: unknown; clicks?: unknown; commission?: unknown };
  }>("/api/v1/offers/:id/simulate", async (request) => {
    const info = await requireSession(deps, request);
    const offer = await getOfferOr404(deps, info.tenantId, request.params.id);
    const body = (request.body ?? {}) as {
      cpc?: unknown;
      cvr?: unknown;
      clicks?: unknown;
      commission?: unknown;
    };
    const cpc = asOptionalNumber(body.cpc);
    const cvr = asOptionalNumber(body.cvr);
    if (cpc === undefined || cpc <= 0) {
      throw new ValidationError("cpc must be a positive number");
    }
    if (cvr === undefined || cvr <= 0 || cvr > 100) {
      throw new ValidationError("cvr must be a percent in (0, 100]");
    }
    const clicks = asOptionalNumber(body.clicks) ?? 1000;
    if (!Number.isInteger(clicks) || clicks < 1 || clicks > 1_000_000) {
      throw new ValidationError("clicks must be an integer between 1 and 1000000");
    }
    const commissionRaw = asOptionalNumber(body.commission) ?? (() => {
      const raw = (offer as unknown as { commissionValue?: unknown }).commissionValue;
      if (typeof raw === "number") return raw;
      if (raw != null) return Number(String(raw));
      return undefined;
    })();
    if (commissionRaw === undefined || commissionRaw <= 0) {
      throw new ValidationError(
        "commission is required (body.commission or offer.commissionValue)"
      );
    }
    const { scenarios } = buildScenarios({
      commission: commissionRaw,
      approvalRate: 0.9,
      attributionRate: 0.95,
      refundRate: 0,
      baseCvrPct: cvr,
      baseCpc: cpc,
      clicks,
    });
    return { scenarios };
  });

  /** Full pipeline → §32 decision JSON (contract frozen). */
  app.post<{
    Params: { id: string };
    Body: {
      termsText?: unknown;
      language?: unknown;
      trafficMode?: unknown;
      geo?: unknown;
      estimatedCpc?: unknown;
    };
  }>("/api/v1/offers/:id/decision", async (request) => {
    const info = await requireSession(deps, request);
    const offer = await getOfferOr404(deps, info.tenantId, request.params.id);
    const body = (request.body ?? {}) as {
      termsText?: unknown;
      language?: unknown;
      trafficMode?: unknown;
      geo?: unknown;
      estimatedCpc?: unknown;
    };
    const language: AnalysisLanguage = body.language === "en" ? "en" : "zh";
    const trafficMode = asTrafficMode(body.trafficMode);
    const geo = asGeoArray(body.geo);
    let termsText = asTrimmedString(body.termsText);
    if (!termsText) {
      const policy = await latestPolicy(deps, info.tenantId, offer.id);
      termsText = policy?.rawTerms ?? undefined;
    }
    if (!termsText || termsText.length < 50) {
      throw new ValidationError(
        "termsText (≥50 chars) is required; or run /scan first so terms are stored."
      );
    }
    const commissionRaw = (offer as unknown as { commissionValue?: unknown }).commissionValue;
    const commission =
      typeof commissionRaw === "number"
        ? commissionRaw
        : commissionRaw != null
          ? Number(String(commissionRaw))
          : null;
    const decision: DecisionJson = await runOfferPipeline(
      { prisma, chatJsonImpl: deps.chatJsonImpl, fetchPageImpl: deps.fetchPageImpl },
      info.tenantId,
      info.id,
      offer.id,
      {
        termsText,
        language,
        trafficMode,
        geo,
        commission: Number.isFinite(commission) ? (commission as number) : null,
        commissionType: (offer as unknown as { commissionType?: string }).commissionType ?? null,
        currency: "USD",
        estimatedCpc: asOptionalNumber(body.estimatedCpc) ?? null,
      }
    );
    // Frozen contract: validate the exact §32 shape before returning.
    return validateDecisionShape(JSON.parse(JSON.stringify(decision)));
  });

  async function writeOfferAudit(
    info: SessionAuthInfo,
    request: FastifyRequest,
    offerId: string,
    action: string,
    reason: string,
    after: Record<string, unknown>
  ) {
    const before = { id: offerId };
    await prisma.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId: info.tenantId,
        actorId: info.id,
        action,
        entityType: "Offer",
        entityId: offerId,
        before: before as never,
        after: after as never,
        reason,
        ip: request.ip ?? null,
        userAgent: request.headers["user-agent"] ?? null,
      },
    });
  }

  /** Human approval (reason required) → AuditLog. */
  app.post<{
    Params: { id: string };
    Body: { reason?: unknown };
  }>("/api/v1/offers/:id/approve", async (request) => {
    const info = await requireSession(deps, request);
    const offer = await getOfferOr404(deps, info.tenantId, request.params.id);
    const reason = asTrimmedString((request.body ?? {} as { reason?: unknown }).reason);
    if (!reason) {
      throw new ValidationError("reason is required");
    }
    await prisma.offer.update({
      where: { id: offer.id },
      data: { status: "ACTIVE" },
    });
    await writeOfferAudit(info, request, offer.id, "OFFER_APPROVE", reason, {
      status: "ACTIVE",
    });
    return { ok: true };
  });

  /** Human pause (reason required) → AuditLog. */
  app.post<{
    Params: { id: string };
    Body: { reason?: unknown };
  }>("/api/v1/offers/:id/pause", async (request) => {
    const info = await requireSession(deps, request);
    const offer = await getOfferOr404(deps, info.tenantId, request.params.id);
    const reason = asTrimmedString((request.body ?? {} as { reason?: unknown }).reason);
    if (!reason) {
      throw new ValidationError("reason is required");
    }
    await prisma.offer.update({
      where: { id: offer.id },
      data: { status: "PAUSED" },
    });
    await writeOfferAudit(info, request, offer.id, "OFFER_PAUSE", reason, {
      status: "PAUSED",
    });
    return { ok: true };
  });

  /** Merchant list with live offer counts (tenant-scoped). */
  app.get("/api/v1/merchants", async (request) => {
    const info = await requireSession(deps, request);
    const merchants = await prisma.merchant.findMany({
      where: { tenantId: info.tenantId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    const rows = await Promise.all(
      merchants.map(async (m) => ({
        id: m.id,
        name: m.name,
        domain: m.domain ?? null,
        riskScore: m.riskScore ?? null,
        riskLevel: m.riskLevel ?? null,
        // 补强 #1：商家结算率（Decimal → number；未验证 → null）。
        settlementRatePct: decimalToNumberOrNull(
          (m as { settlementRatePct?: unknown }).settlementRatePct
        ),
        offerCount: await prisma.offer.count({
          where: { tenantId: info.tenantId, merchantId: m.id, deletedAt: null },
        }),
      }))
    );
    return { merchants: rows };
  });

  app.post<{
    Body: {
      name?: unknown;
      domain?: unknown;
      networkId?: unknown;
      settlementRatePct?: unknown;
    };
  }>("/api/v1/merchants", async (request) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as {
      name?: unknown;
      domain?: unknown;
      networkId?: unknown;
      settlementRatePct?: unknown;
    };
    const settlement = parseSettlementRatePct(body.settlementRatePct);
    const name = asTrimmedString(body.name);
    if (!name) throw new ValidationError("name is required");
    const networkId = asTrimmedString(body.networkId);
    if (networkId) {
      if (!UUID_RE.test(networkId)) {
        throw new ValidationError("networkId must be a valid UUID");
      }
      const network = await prisma.affiliateNetwork.findFirst({
        where: { id: networkId, tenantId: info.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!network) throw new NotFoundError("AffiliateNetwork", networkId);
    }
    const id = randomUUID();
    const merchant = await prisma.merchant.create({
      data: {
        id,
        tenantId: info.tenantId,
        name,
        domain: asTrimmedString(body.domain) ?? null,
        networkId: networkId ?? null,
        settlementRatePct: settlement.present ? settlement.value : null,
      },
    });
    return {
      merchant: {
        id: merchant.id,
        name: merchant.name,
        domain: merchant.domain,
        networkId: merchant.networkId,
        riskScore: merchant.riskScore,
        riskLevel: merchant.riskLevel,
        status: merchant.status,
        settlementRatePct: decimalToNumberOrNull(
          (merchant as { settlementRatePct?: unknown }).settlementRatePct
        ),
      },
    };
  });

  /**
   * Merchant update（补强 #1）：支持 settlementRatePct（0–100 校验，
   * null = 清空为未验证）及 name/domain/networkId/notes 的局部更新。
   */
  app.patch<{
    Params: { id: string };
    Body: {
      name?: unknown;
      domain?: unknown;
      networkId?: unknown;
      notes?: unknown;
      settlementRatePct?: unknown;
    };
  }>("/api/v1/merchants/:id", async (request) => {
    const info = await requireSession(deps, request);
    const merchantId = request.params.id;
    if (!UUID_RE.test(merchantId)) {
      throw new ValidationError("merchant id must be a valid UUID");
    }
    const existing = await prisma.merchant.findFirst({
      where: { id: merchantId, tenantId: info.tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundError("Merchant", merchantId);
    const body = (request.body ?? {}) as {
      name?: unknown;
      domain?: unknown;
      networkId?: unknown;
      notes?: unknown;
      settlementRatePct?: unknown;
    };
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = asTrimmedString(body.name);
      if (!name) throw new ValidationError("name must be a non-empty string");
      data.name = name;
    }
    if (body.domain !== undefined) {
      data.domain = asTrimmedString(body.domain) ?? null;
    }
    if (body.notes !== undefined) {
      data.notes = asTrimmedString(body.notes) ?? null;
    }
    if (body.networkId !== undefined) {
      const networkId = asTrimmedString(body.networkId);
      if (networkId) {
        if (!UUID_RE.test(networkId)) {
          throw new ValidationError("networkId must be a valid UUID");
        }
        const network = await prisma.affiliateNetwork.findFirst({
          where: { id: networkId, tenantId: info.tenantId, deletedAt: null },
          select: { id: true },
        });
        if (!network) throw new NotFoundError("AffiliateNetwork", networkId);
        data.networkId = networkId;
      } else {
        data.networkId = null;
      }
    }
    const settlement = parseSettlementRatePct(body.settlementRatePct);
    if (settlement.present) data.settlementRatePct = settlement.value;
    if (Object.keys(data).length === 0) {
      throw new ValidationError("no updatable fields provided");
    }
    const merchant = await prisma.merchant.update({
      where: { id: merchantId },
      data: data as never,
    });
    return {
      merchant: {
        id: merchant.id,
        name: merchant.name,
        domain: merchant.domain,
        networkId: merchant.networkId,
        riskScore: merchant.riskScore,
        riskLevel: merchant.riskLevel,
        status: merchant.status,
        settlementRatePct: decimalToNumberOrNull(
          (merchant as { settlementRatePct?: unknown }).settlementRatePct
        ),
      },
    };
  });
}
