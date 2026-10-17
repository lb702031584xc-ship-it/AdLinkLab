/**
 * Automation pack 4/5 — budget pacer (预算自动 pacing).
 *
 * Daily worker evaluates every enabled BudgetRule whose
 * `now - lastEvaluatedAt >= checkIntervalDays` and nudges the campaign's
 * daily budget up/down through the Google Ads Script channel:
 *
 *   evaluateRules() -> decideBudgetAction() -> SyncJob (PENDING) +
 *   auditLog snapshot -> Google Ads Script picks it up via
 *   GET /api/v1/script/budget-pacer-tasks and reports back via
 *   POST /api/v1/script/budget-pacer-result.
 *
 * Hard rules (do not bypass):
 * - NEVER call the Google Ads API directly. Budget changes go out ONLY as
 *   SyncJob task records consumed by the user's own Google Ads Script.
 * - NEVER fabricate performance data. The schema has no spend/cost table
 *   (see also apps/api/src/killswitch/engine.ts: "the codebase has no true
 *   spend table"), so spend is honestly reported as 0 / "unavailable" and
 *   the rule HOLDs with reason "no spend data" until a spend source is
 *   wired into getCampaignPerformance().
 * - Revenue comes only from real Conversion.value rows attributed (via
 *   Click.campaignId) to campaigns whose name matches the rule's
 *   campaignName (case-insensitive contains) within the tenant + Google
 *   account. If the rule has campaignId set, the match is exact instead.
 * - The "current budget" is NOT read from Google Ads (no API access).
 *   Source order: lastAction.newBudget from the previous evaluation, or the
 *   initialBudget recorded at rule creation. Unknown -> HOLD with a reason.
 *
 * History: the rule only persists lastAction (no history table by design);
 * getRuleHistory() returns that single entry.
 *
 * P0-9 spend-cap circuit breaker: before any ROAS logic, evaluateRule()
 * checks maxSpendCap + autoPauseOnBreach against the rule's cumulative
 * spend (see getRuleCumulativeSpend() for the spend口径). On breach it
 * queues campaign-toggle PAUSE task(s) via the Script channel, writes the
 * trigger into lastAction + an AuditLog entry, and returns action "paused".
 * The ROAS path is untouched when the breaker does not fire.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import { ValidationError } from "@adlinklab/shared";
import { queueCampaignToggleTask } from "./campaign-toggle-script.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** SyncJob.type for budget-push tasks. Consumed by the Google Ads Script. */
export const BUDGET_PACER_TASK_TYPE = "budget-pacer-set-budget";
/** Idempotency scope for budget-push tasks. */
export const BUDGET_PACER_IDEMPOTENCY_SCOPE = "BUDGET_PACER";
/** SyncJob.provider for budget-push tasks (script channel, never direct API). */
export const BUDGET_PACER_PROVIDER = "google-ads-script";
/** Alert metric for budget changes. */
export const BUDGET_PACER_ALERT_METRIC = "budget_pacer";
/** Audit actions written for budget-push queueing. */
export const BUDGET_PACER_QUEUED_ACTION = "BUDGET_PACER_QUEUED";
export const BUDGET_PACER_RESULT_ACTION = "BUDGET_PACER_RESULT";
/** Payload version so the script can evolve independently. */
export const BUDGET_PACER_PAYLOAD_VERSION = 1;
/** Audit action written when the P0-9 spend-cap breaker fires. */
export const BUDGET_PACER_SPEND_CAP_BREACH_ACTION =
  "BUDGET_PACER_SPEND_CAP_BREACH";

/** Alert dedupe window: one open alert per rule per 24h. */
const ALERT_DEDUPE_WINDOW_MS = 24 * 3600 * 1000;
/** One evaluation covers at most this many days of performance. */
const MAX_LOOKBACK_DAYS = 90;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BudgetPacerAction = "up" | "down" | "hold" | "init" | "paused";

export interface BudgetRuleRow {
  id: string;
  tenantId: string;
  googleAccountId: string;
  campaignName: string;
  campaignId: string | null;
  targetRoas: number;
  minDailyBudget: number;
  maxDailyBudget: number;
  increasePct: number;
  decreasePct: number;
  checkIntervalDays: number;
  enabled: boolean;
  /** P0-9: cumulative-spend circuit-breaker cap (null = disabled). */
  maxSpendCap: number | null;
  /** P0-9: when true, breaching maxSpendCap auto-pauses the campaign. */
  autoPauseOnBreach: boolean;
  lastEvaluatedAt: Date | null;
  lastAction: unknown;
}

export interface CreateBudgetRuleInput {
  googleAccountId: string;
  campaignName: string;
  campaignId?: string | null;
  targetRoas: number;
  minDailyBudget: number;
  maxDailyBudget: number;
  increasePct?: number;
  decreasePct?: number;
  checkIntervalDays?: number;
  enabled?: boolean;
  /**
   * Optional current daily budget (same currency as Google Ads account).
   * Seeded into lastAction as { action: "init" } so the first real
   * evaluation has a baseline to adjust from. Omit when unknown — the
   * rule will HOLD with a reason until one is recorded.
   */
  initialBudget?: number;
  reason?: string;
  /**
   * P0-9: cumulative spend cap (same currency as the Google Ads account).
   * null/undefined = breaker disabled. Requires autoPauseOnBreach to act.
   */
  maxSpendCap?: number | null;
  /** P0-9: pause the campaign via campaign-toggle when maxSpendCap is hit. */
  autoPauseOnBreach?: boolean;
}

export type UpdateBudgetRulePatch = Partial<
  Pick<
    CreateBudgetRuleInput,
    | "campaignName"
    | "campaignId"
    | "targetRoas"
    | "minDailyBudget"
    | "maxDailyBudget"
    | "increasePct"
    | "decreasePct"
    | "checkIntervalDays"
    | "enabled"
    | "maxSpendCap"
    | "autoPauseOnBreach"
  >
>;

export interface LastActionJson {
  action: BudgetPacerAction;
  reason: string;
  at: string;
  oldBudget?: number;
  newBudget?: number;
  roas?: number | null;
  spend?: number;
  revenue?: number;
  taskId?: string;
  /** P0-9: spend-cap breach details (only on action "paused"). */
  spendCap?: number;
  cumulativeSpend?: number;
  taskIds?: string[];
}

/** Performance window for one rule. spend is 0 until a spend source exists. */
export interface CampaignPerformance {
  spend: number;
  spendSource: "unavailable";
  revenue: number;
  clicks: number;
  conversions: number;
  roas: number | null;
  days: number;
  matchedCampaigns: number;
}

export interface BudgetDecisionInput {
  roas: number | null;
  targetRoas: number;
  currentBudget: number | null;
  minDailyBudget: number;
  maxDailyBudget: number;
  increasePct: number;
  decreasePct: number;
}

export interface BudgetDecision {
  action: "up" | "down" | "hold";
  reason: string;
  oldBudget?: number;
  newBudget?: number;
}

export interface BudgetPacerTaskPayload {
  version: number;
  type: typeof BUDGET_PACER_TASK_TYPE;
  taskId: string;
  ruleId: string;
  tenantId: string;
  googleAccountId: string;
  campaignName: string;
  campaignId: string | null;
  oldBudget: number;
  newBudget: number;
  currency: string | null;
  requestedAt: string;
}

export interface EvaluateRuleResult {
  ruleId: string;
  tenantId: string;
  action: BudgetDecision["action"] | "paused";
  reason: string;
  newBudget?: number;
  taskId?: string;
  taskIds?: string[];
  alertCreated?: boolean;
  evaluated: boolean;
}

export interface EvaluateRulesSummary {
  checked: number;
  adjusted: number;
  held: number;
  /** P0-9: rules paused by the spend-cap breaker. */
  paused: number;
  alertsCreated: number;
  errors: number;
  results: EvaluateRuleResult[];
}

export interface BudgetPacerLog {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asTrimmedString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function checkPct(name: string, v: number | undefined, dflt: number): number {
  const n = v ?? dflt;
  if (!(n >= 1 && n <= 100)) {
    throw new ValidationError(`${name} must be between 1 and 100`, {
      [name]: v,
    });
  }
  return n;
}

/**
 * Validate rule parameters. Throws ValidationError on any violation.
 * Returns normalized values with defaults applied.
 */
export function validateBudgetRuleInput(input: CreateBudgetRuleInput): {
  googleAccountId: string;
  campaignName: string;
  campaignId: string | null;
  targetRoas: number;
  minDailyBudget: number;
  maxDailyBudget: number;
  increasePct: number;
  decreasePct: number;
  checkIntervalDays: number;
  enabled: boolean;
  initialBudget?: number;
  maxSpendCap: number | null;
  autoPauseOnBreach: boolean;
} {
  const googleAccountId = asTrimmedString(input.googleAccountId);
  if (!googleAccountId || !UUID_RE.test(googleAccountId)) {
    throw new ValidationError("googleAccountId must be a UUID", {
      googleAccountId: input.googleAccountId,
    });
  }
  const campaignName = asTrimmedString(input.campaignName);
  if (!campaignName) {
    throw new ValidationError("campaignName is required");
  }
  const campaignId = asTrimmedString(input.campaignId ?? null) ?? null;
  if (campaignId && !UUID_RE.test(campaignId)) {
    throw new ValidationError("campaignId must be a UUID when provided", {
      campaignId: input.campaignId,
    });
  }
  const targetRoas = asNumber(input.targetRoas);
  if (targetRoas === undefined || targetRoas <= 0) {
    throw new ValidationError("targetRoas must be > 0", {
      targetRoas: input.targetRoas,
    });
  }
  const minDailyBudget = asNumber(input.minDailyBudget);
  const maxDailyBudget = asNumber(input.maxDailyBudget);
  if (minDailyBudget === undefined || minDailyBudget <= 0) {
    throw new ValidationError("minDailyBudget must be > 0", {
      minDailyBudget: input.minDailyBudget,
    });
  }
  if (maxDailyBudget === undefined || maxDailyBudget <= 0) {
    throw new ValidationError("maxDailyBudget must be > 0", {
      maxDailyBudget: input.maxDailyBudget,
    });
  }
  if (!(minDailyBudget < maxDailyBudget)) {
    throw new ValidationError("minDailyBudget must be < maxDailyBudget", {
      minDailyBudget: input.minDailyBudget,
      maxDailyBudget: input.maxDailyBudget,
    });
  }
  const increasePct = checkPct("increasePct", asNumber(input.increasePct), 20);
  const decreasePct = checkPct("decreasePct", asNumber(input.decreasePct), 20);
  const checkIntervalDays = asNumber(input.checkIntervalDays) ?? 7;
  if (!Number.isInteger(checkIntervalDays) || checkIntervalDays < 1) {
    throw new ValidationError("checkIntervalDays must be an integer >= 1", {
      checkIntervalDays: input.checkIntervalDays,
    });
  }
  const initialBudgetRaw = asNumber(input.initialBudget);
  let initialBudget: number | undefined;
  if (initialBudgetRaw !== undefined) {
    if (initialBudgetRaw < minDailyBudget || initialBudgetRaw > maxDailyBudget) {
      throw new ValidationError(
        "initialBudget must be within [minDailyBudget, maxDailyBudget]",
        { initialBudget: input.initialBudget }
      );
    }
    initialBudget = Math.round(initialBudgetRaw * 100) / 100;
  }
  // P0-9: maxSpendCap null/undefined = breaker disabled; otherwise >= 0.
  let maxSpendCap: number | null = null;
  if (input.maxSpendCap !== undefined && input.maxSpendCap !== null) {
    const cap = asNumber(input.maxSpendCap);
    if (cap === undefined || cap < 0) {
      throw new ValidationError("maxSpendCap must be >= 0 or null", {
        maxSpendCap: input.maxSpendCap,
      });
    }
    maxSpendCap = cap;
  }
  const autoPauseOnBreach = input.autoPauseOnBreach ?? false;
  if (typeof autoPauseOnBreach !== "boolean") {
    throw new ValidationError("autoPauseOnBreach must be a boolean", {
      autoPauseOnBreach: input.autoPauseOnBreach,
    });
  }
  return {
    googleAccountId,
    campaignName,
    campaignId,
    targetRoas,
    minDailyBudget,
    maxDailyBudget,
    increasePct,
    decreasePct,
    checkIntervalDays,
    enabled: input.enabled ?? false,
    initialBudget,
    maxSpendCap,
    autoPauseOnBreach,
  };
}

// ---------------------------------------------------------------------------
// Performance data (real rows only — never fabricated)
// ---------------------------------------------------------------------------

/**
 * Aggregate real performance for a rule's campaign over the last `days`.
 *
 * - Revenue: SUM(Conversion.value) over non-deleted conversions whose click
 *   is attributed (Click.campaignId) to a matching campaign. Excludes test
 *   clicks (isTest). Campaign match: exact campaignId when the rule has one,
 *   otherwise case-insensitive `contains` on Campaign.name scoped to the
 *   tenant + Google account.
 * - Spend: ALWAYS 0 with spendSource "unavailable" — the schema has no
 *   spend/cost table (same limitation documented in killswitch/engine.ts).
 *   Callers must HOLD when spend == 0. When a spend source is wired in the
 *   future, only this function changes.
 */
export async function getCampaignPerformance(
  prisma: PrismaClient,
  tenantId: string,
  opts: { campaignName: string; campaignId?: string | null; googleAccountId: string; days: number }
): Promise<CampaignPerformance> {
  const days = Math.max(1, Math.min(MAX_LOOKBACK_DAYS, Math.floor(opts.days)));
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  let campaignIds: string[];
  if (opts.campaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: opts.campaignId,
        tenantId,
        googleAccountId: opts.googleAccountId,
        deletedAt: null,
      },
      select: { id: true },
    });
    campaignIds = campaign ? [campaign.id as string] : [];
  } else {
    const campaigns = (await prisma.campaign.findMany({
      where: {
        tenantId,
        googleAccountId: opts.googleAccountId,
        name: { contains: opts.campaignName, mode: "insensitive" },
        deletedAt: null,
      },
      select: { id: true },
    })) as Array<{ id: string }>;
    campaignIds = campaigns.map((c) => c.id);
  }

  if (campaignIds.length === 0) {
    return {
      spend: 0,
      spendSource: "unavailable",
      revenue: 0,
      clicks: 0,
      conversions: 0,
      roas: null,
      days,
      matchedCampaigns: 0,
    };
  }

  const clickWhere = {
    tenantId,
    campaignId: { in: campaignIds },
    occurredAt: { gte: since },
    isTest: false,
  };
  const clicks = (await prisma.click.count({ where: clickWhere })) as number;

  const convAgg = (await prisma.conversion.aggregate({
    where: {
      tenantId,
      deletedAt: null,
      conversionTime: { gte: since },
      click: clickWhere,
    },
    _sum: { value: true },
    _count: true,
  })) as { _sum: { value: unknown }; _count: number };
  const revenue =
    convAgg._sum.value == null ? 0 : Number(convAgg._sum.value);

  return {
    spend: 0,
    spendSource: "unavailable",
    revenue: Math.round(revenue * 100) / 100,
    clicks,
    conversions: convAgg._count,
    roas: null,
    days,
    matchedCampaigns: campaignIds.length,
  };
}

/** Current budget: last recorded newBudget (init or previous adjustment). */
export function resolveCurrentBudget(rule: BudgetRuleRow): number | null {
  const last = rule.lastAction as LastActionJson | null | undefined;
  if (
    last &&
    typeof last === "object" &&
    typeof last.newBudget === "number" &&
    Number.isFinite(last.newBudget) &&
    last.newBudget > 0
  ) {
    return last.newBudget;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Decision (pure — fully unit-testable)
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Pure budget decision. `roas == null` means "no spend data" — callers
 * (evaluateRules) check that first; this function also guards it.
 */
export function decideBudgetAction(input: BudgetDecisionInput): BudgetDecision {
  const {
    roas,
    targetRoas,
    currentBudget,
    minDailyBudget,
    maxDailyBudget,
    increasePct,
    decreasePct,
  } = input;

  if (roas == null || !Number.isFinite(roas)) {
    return { action: "hold", reason: "no spend data" };
  }
  if (currentBudget == null || !Number.isFinite(currentBudget)) {
    return {
      action: "hold",
      reason:
        "no current budget recorded — set initialBudget when creating the rule",
    };
  }

  const roasTxt = `roas ${roas.toFixed(2)} vs target ${targetRoas.toFixed(2)}`;

  if (roas >= targetRoas) {
    if (currentBudget >= maxDailyBudget) {
      return {
        action: "hold",
        reason: `${roasTxt}; already at maxDailyBudget ${maxDailyBudget}`,
        oldBudget: currentBudget,
      };
    }
    const newBudget = round2(
      Math.min(currentBudget * (1 + increasePct / 100), maxDailyBudget)
    );
    return {
      action: "up",
      reason: `${roasTxt} — increasing daily budget`,
      oldBudget: currentBudget,
      newBudget,
    };
  }

  if (roas < targetRoas * 0.7) {
    if (currentBudget <= minDailyBudget) {
      return {
        action: "hold",
        reason: `${roasTxt}; already at minDailyBudget ${minDailyBudget}`,
        oldBudget: currentBudget,
      };
    }
    const newBudget = round2(
      Math.max(currentBudget * (1 - decreasePct / 100), minDailyBudget)
    );
    return {
      action: "down",
      reason: `${roasTxt} — decreasing daily budget`,
      oldBudget: currentBudget,
      newBudget,
    };
  }

  return {
    action: "hold",
    reason: `${roasTxt}; within hold band`,
    oldBudget: currentBudget,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function serializeBudgetRule(row: BudgetRuleRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    googleAccountId: row.googleAccountId,
    campaignName: row.campaignName,
    campaignId: row.campaignId,
    targetRoas: row.targetRoas,
    minDailyBudget: row.minDailyBudget,
    maxDailyBudget: row.maxDailyBudget,
    increasePct: row.increasePct,
    decreasePct: row.decreasePct,
    checkIntervalDays: row.checkIntervalDays,
    enabled: row.enabled,
    maxSpendCap: row.maxSpendCap ?? null,
    autoPauseOnBreach: row.autoPauseOnBreach ?? false,
    lastEvaluatedAt: row.lastEvaluatedAt
      ? (row.lastEvaluatedAt as Date).toISOString()
      : null,
    lastAction: (row.lastAction ?? null) as LastActionJson | null,
  };
}

export async function createRule(
  prisma: PrismaClient,
  tenantId: string,
  input: CreateBudgetRuleInput,
  reason?: string
): Promise<ReturnType<typeof serializeBudgetRule>> {
  const v = validateBudgetRuleInput(input);

  // The Google account must belong to this tenant.
  const account = await prisma.googleAccount.findFirst({
    where: { id: v.googleAccountId, tenantId },
    select: { id: true },
  });
  if (!account) {
    throw new ValidationError("GoogleAccount not found for tenant", {
      googleAccountId: v.googleAccountId,
    });
  }
  if (v.campaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: v.campaignId,
        tenantId,
        googleAccountId: v.googleAccountId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!campaign) {
      throw new ValidationError("Campaign not found for tenant/account", {
        campaignId: v.campaignId,
      });
    }
  }

  const now = new Date().toISOString();
  const lastAction: LastActionJson | null =
    v.initialBudget !== undefined
      ? {
          action: "init",
          reason:
            reason ??
            `initial budget recorded at rule creation (${v.initialBudget})`,
          at: now,
          newBudget: v.initialBudget,
        }
      : null;

  const created = (await prisma.budgetRule.create({
    data: {
      id: randomUUID(),
      tenantId,
      googleAccountId: v.googleAccountId,
      campaignName: v.campaignName,
      campaignId: v.campaignId,
      targetRoas: v.targetRoas,
      minDailyBudget: v.minDailyBudget,
      maxDailyBudget: v.maxDailyBudget,
      increasePct: v.increasePct,
      decreasePct: v.decreasePct,
      checkIntervalDays: v.checkIntervalDays,
      enabled: v.enabled,
      maxSpendCap: v.maxSpendCap,
      autoPauseOnBreach: v.autoPauseOnBreach,
      lastAction: lastAction
        ? (JSON.parse(JSON.stringify(lastAction)) as never)
        : undefined,
    },
  })) as unknown as BudgetRuleRow;
  return serializeBudgetRule(created);
}

export async function updateRule(
  prisma: PrismaClient,
  tenantId: string,
  id: string,
  patch: UpdateBudgetRulePatch
): Promise<ReturnType<typeof serializeBudgetRule>> {
  const existing = (await prisma.budgetRule.findFirst({
    where: { id, tenantId },
  })) as unknown as BudgetRuleRow | null;
  if (!existing) {
    throw new ValidationError("BudgetRule not found", { id });
  }

  // Merge patch over existing values, then validate the merged rule.
  const merged: CreateBudgetRuleInput = {
    googleAccountId: existing.googleAccountId,
    campaignName: patch.campaignName ?? existing.campaignName,
    campaignId:
      patch.campaignId !== undefined ? patch.campaignId : existing.campaignId,
    targetRoas: patch.targetRoas ?? existing.targetRoas,
    minDailyBudget: patch.minDailyBudget ?? existing.minDailyBudget,
    maxDailyBudget: patch.maxDailyBudget ?? existing.maxDailyBudget,
    increasePct: patch.increasePct ?? existing.increasePct,
    decreasePct: patch.decreasePct ?? existing.decreasePct,
    checkIntervalDays: patch.checkIntervalDays ?? existing.checkIntervalDays,
    enabled: patch.enabled ?? existing.enabled,
    maxSpendCap:
      patch.maxSpendCap !== undefined
        ? patch.maxSpendCap
        : (existing.maxSpendCap ?? null),
    autoPauseOnBreach:
      patch.autoPauseOnBreach ?? existing.autoPauseOnBreach ?? false,
  };
  const v = validateBudgetRuleInput(merged);

  const updated = (await prisma.budgetRule.update({
    where: { id },
    data: {
      campaignName: v.campaignName,
      campaignId: v.campaignId,
      targetRoas: v.targetRoas,
      minDailyBudget: v.minDailyBudget,
      maxDailyBudget: v.maxDailyBudget,
      increasePct: v.increasePct,
      decreasePct: v.decreasePct,
      checkIntervalDays: v.checkIntervalDays,
      enabled: v.enabled,
      maxSpendCap: v.maxSpendCap,
      autoPauseOnBreach: v.autoPauseOnBreach,
    },
  })) as unknown as BudgetRuleRow;
  return serializeBudgetRule(updated);
}

/**
 * History for one rule. By design only lastAction is persisted (no history
 * table), so the history is that single entry (or empty).
 */
export async function getRuleHistory(
  prisma: PrismaClient,
  tenantId: string,
  id: string
): Promise<{
  rule: ReturnType<typeof serializeBudgetRule>;
  history: LastActionJson[];
}> {
  const row = (await prisma.budgetRule.findFirst({
    where: { id, tenantId },
  })) as unknown as BudgetRuleRow | null;
  if (!row) {
    throw new ValidationError("BudgetRule not found", { id });
  }
  const last = row.lastAction as LastActionJson | null | undefined;
  return {
    rule: serializeBudgetRule(row),
    history: last && typeof last === "object" ? [last] : [],
  };
}

// ---------------------------------------------------------------------------
// Task queueing (SyncJob + audit snapshot — script channel, never direct API)
// ---------------------------------------------------------------------------

export function buildBudgetPacerTaskPayload(input: {
  taskId: string;
  rule: BudgetRuleRow;
  oldBudget: number;
  newBudget: number;
  currency?: string | null;
}): BudgetPacerTaskPayload {
  return {
    version: BUDGET_PACER_PAYLOAD_VERSION,
    type: BUDGET_PACER_TASK_TYPE,
    taskId: input.taskId,
    ruleId: input.rule.id,
    tenantId: input.rule.tenantId,
    googleAccountId: input.rule.googleAccountId,
    campaignName: input.rule.campaignName,
    campaignId: input.rule.campaignId,
    oldBudget: input.oldBudget,
    newBudget: input.newBudget,
    currency: input.currency ?? null,
    requestedAt: new Date().toISOString(),
  };
}

function budgetPacerIdempotencyKey(ruleId: string): string {
  // One push per rule per calendar day (UTC).
  const day = new Date().toISOString().slice(0, 10);
  return `budget-pacer:${ruleId}:${day}`;
}

/**
 * Queue a budget-push task. Idempotent: an already PENDING/RUNNING push for
 * the same rule+day is returned instead of duplicated. The payload lives in
 * the auditLog snapshot (after), which the script fetch endpoint reads —
 * same durable-payload pattern as campaign-toggle.
 */
export async function queueBudgetPush(
  prisma: PrismaClient,
  rule: BudgetRuleRow,
  decision: BudgetDecision,
  opts: { actorId?: string | null; currency?: string | null } = {}
): Promise<{ taskId: string; deduped: boolean }> {
  if (decision.action !== "up" && decision.action !== "down") {
    throw new ValidationError("queueBudgetPush requires an up/down decision", {
      action: decision.action,
    });
  }
  const idempotencyKey = budgetPacerIdempotencyKey(rule.id);
  const existing = (await prisma.syncJob.findUnique({
    where: {
      tenantId_idempotencyScope_idempotencyKey: {
        tenantId: rule.tenantId,
        idempotencyScope: BUDGET_PACER_IDEMPOTENCY_SCOPE,
        idempotencyKey,
      },
    },
  })) as { id: string; status: string; type: string } | null;
  if (
    existing &&
    existing.type === BUDGET_PACER_TASK_TYPE &&
    (existing.status === "PENDING" || existing.status === "RUNNING")
  ) {
    return { taskId: existing.id, deduped: true };
  }

  const taskId = randomUUID();
  const payload = buildBudgetPacerTaskPayload({
    taskId,
    rule,
    oldBudget: decision.oldBudget ?? 0,
    newBudget: decision.newBudget ?? 0,
    currency: opts.currency,
  });
  await prisma.syncJob.create({
    data: {
      id: taskId,
      tenantId: rule.tenantId,
      type: BUDGET_PACER_TASK_TYPE,
      status: "PENDING",
      provider: BUDGET_PACER_PROVIDER,
      externalAccountId: rule.googleAccountId,
      idempotencyScope: BUDGET_PACER_IDEMPOTENCY_SCOPE,
      idempotencyKey,
      attempts: 0,
    },
  });
  await prisma.auditLog.create({
    data: {
      id: randomUUID(),
      tenantId: rule.tenantId,
      actorId: opts.actorId ?? null,
      action: BUDGET_PACER_QUEUED_ACTION,
      entityType: "SyncJob",
      entityId: taskId,
      after: JSON.parse(JSON.stringify(payload)) as never,
      reason: `budget pacer ${decision.action}: ${rule.campaignName} ${decision.oldBudget} -> ${decision.newBudget}`,
    },
  });
  return { taskId, deduped: false };
}

/** Recover the canonical task payload from the queue-time audit snapshot. */
export async function resolveBudgetPacerPayload(
  prisma: PrismaClient,
  tenantId: string,
  taskId: string
): Promise<BudgetPacerTaskPayload | null> {
  const audit = (await prisma.auditLog.findFirst({
    where: {
      tenantId,
      entityType: "SyncJob",
      entityId: taskId,
      action: BUDGET_PACER_QUEUED_ACTION,
    },
    orderBy: { createdAt: "desc" },
  })) as { after?: unknown } | null;
  const after = audit?.after as (BudgetPacerTaskPayload & { taskId?: string }) | null | undefined;
  if (
    after &&
    typeof after === "object" &&
    after.type === BUDGET_PACER_TASK_TYPE &&
    typeof after.ruleId === "string" &&
    typeof after.newBudget === "number"
  ) {
    return { ...after, taskId };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Alerts (24h dedupe per rule)
// ---------------------------------------------------------------------------

async function maybeCreateBudgetAlert(
  prisma: PrismaClient,
  rule: BudgetRuleRow,
  decision: BudgetDecision,
  taskId: string,
  log: BudgetPacerLog
): Promise<boolean> {
  const since = new Date(Date.now() - ALERT_DEDUPE_WINDOW_MS);
  const openAlerts = (await prisma.alert.findMany({
    where: {
      tenantId: rule.tenantId,
      ruleId: null,
      metric: BUDGET_PACER_ALERT_METRIC,
      status: "open",
      createdAt: { gt: since },
    },
    select: { id: true, data: true },
  })) as Array<{ id: string; data: unknown }>;
  const dup = openAlerts.some(
    (a) =>
      typeof a.data === "object" &&
      a.data !== null &&
      (a.data as { ruleId?: unknown }).ruleId === rule.id
  );
  if (dup) {
    log.info("budget-pacer alert deduped (24h)", { ruleId: rule.id });
    return false;
  }
  const dir = decision.action === "up" ? "上调" : "下调";
  await prisma.alert.create({
    data: {
      id: randomUUID(),
      tenantId: rule.tenantId,
      ruleId: null,
      metric: BUDGET_PACER_ALERT_METRIC,
      severity: "medium",
      message: `预算自动调整：广告系列「${rule.campaignName}」日预算${dir} ${decision.oldBudget} → ${decision.newBudget}（${decision.reason}）。任务已排队，等待 Google Ads 脚本执行。`,
      data: JSON.parse(
        JSON.stringify({
          ruleId: rule.id,
          action: decision.action,
          oldBudget: decision.oldBudget,
          newBudget: decision.newBudget,
          reason: decision.reason,
          taskId,
        })
      ),
      status: "open",
    },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export type PerformanceProvider = (
  rule: BudgetRuleRow
) => Promise<CampaignPerformance>;

/** Cumulative-spend provider seam for the P0-9 breaker (tests + overrides). */
export type CumulativeSpendProvider = (
  rule: BudgetRuleRow
) => Promise<number | null>;

export interface RuleCampaign {
  id: string;
  googleCampaignId: string;
  googleAccountId: string;
  status: string;
}

/**
 * Resolve the Campaign rows a rule governs: exact campaignId when set,
 * otherwise the same case-insensitive `contains` name match scoped to the
 * tenant + Google account as getCampaignPerformance().
 */
export async function resolveRuleCampaigns(
  prisma: PrismaClient,
  rule: BudgetRuleRow
): Promise<RuleCampaign[]> {
  if (rule.campaignId) {
    const campaign = (await prisma.campaign.findFirst({
      where: {
        id: rule.campaignId,
        tenantId: rule.tenantId,
        googleAccountId: rule.googleAccountId,
        deletedAt: null,
      },
      select: { id: true, googleCampaignId: true, googleAccountId: true, status: true },
    })) as RuleCampaign | null;
    return campaign ? [campaign] : [];
  }
  const campaigns = (await prisma.campaign.findMany({
    where: {
      tenantId: rule.tenantId,
      googleAccountId: rule.googleAccountId,
      name: { contains: rule.campaignName, mode: "insensitive" },
      deletedAt: null,
    },
    select: { id: true, googleCampaignId: true, googleAccountId: true, status: true },
  })) as RuleCampaign[];
  return campaigns;
}

/**
 * P0-9 cumulative-spend口径（写清口径，不编造）：
 *
 *   SUM(LaunchArchive.spend)
 *   WHERE LaunchArchive.offerId IN (
 *     SELECT TrackingLink.offerId FROM TrackingLink
 *     WHERE TrackingLink.campaignId IN (<rule's campaigns>)
 *   ) AND LaunchArchive.tenantId = <rule tenant>
 *
 * - LaunchArchive.spend 是运营在投放档案报表（/reports/launch）里手动回填的
 *   实际花费，不是估算；Google Ads 同步数据里没有花费表（见
 *   getCampaignPerformance 的 "unavailable" 说明），ManualSpend 是租户级
 *   总数、无法归属到单个广告系列，所以两者都不作为本熔断的口径。
 * - 无档案 / 档案 spend 全为 null → 返回 null（无花费数据），绝不触发熔断。
 * - 货币：档案 spend 与 maxSpendCap 约定为同一货币（档案 budgetCurrency
 *   默认为 USD；跨货币档案求和时不做换算，见 lastAction 审计记录）。
 */
export async function getRuleCumulativeSpend(
  prisma: PrismaClient,
  rule: BudgetRuleRow
): Promise<number | null> {
  const campaigns = await resolveRuleCampaigns(prisma, rule);
  if (campaigns.length === 0) return null;
  const campaignIds = campaigns.map((c) => c.id);
  const links = (await prisma.trackingLink.findMany({
    where: { tenantId: rule.tenantId, campaignId: { in: campaignIds } },
    select: { offerId: true },
  })) as Array<{ offerId: string }>;
  const offerIds = [...new Set(links.map((l) => l.offerId).filter(Boolean))];
  if (offerIds.length === 0) return null;
  const archives = (await prisma.launchArchive.findMany({
    where: { tenantId: rule.tenantId, offerId: { in: offerIds } },
    select: { spend: true },
  })) as Array<{ spend: unknown }>;
  let total = 0;
  let found = false;
  for (const row of archives) {
    const spend = row.spend == null ? null : Number(row.spend);
    if (spend !== null && Number.isFinite(spend)) {
      total += spend;
      found = true;
    }
  }
  return found ? Math.round(total * 100) / 100 : null;
}

/**
 * Queue a campaign-toggle PAUSE task for every still-active campaign the
 * rule governs (already-PAUSED campaigns are skipped — no redundant task).
 * Returns the queued task ids (deduped tasks count as queued: the pending
 * task already represents the pause request).
 */
export async function queueSpendCapPause(
  prisma: PrismaClient,
  rule: BudgetRuleRow,
  opts: { actorId?: string | null } = {}
): Promise<{ taskIds: string[] }> {
  const campaigns = await resolveRuleCampaigns(prisma, rule);
  const taskIds: string[] = [];
  for (const campaign of campaigns) {
    if (campaign.status === "PAUSED") continue;
    const { taskId } = await queueCampaignToggleTask(prisma, {
      tenantId: rule.tenantId,
      campaignId: campaign.id,
      googleCampaignId: campaign.googleCampaignId,
      googleAccountId: campaign.googleAccountId,
      action: "PAUSE",
      requestedBy: opts.actorId ?? undefined,
      reason: `budget pacer spend-cap breach: rule ${rule.id} (${rule.campaignName})`,
    });
    taskIds.push(taskId);
  }
  return { taskIds };
}

function defaultLog(prefix: string): BudgetPacerLog {
  return {
    info: (msg, meta) => console.log(`[${prefix}] ${msg}`, meta ?? ""),
    error: (msg, meta) => console.error(`[${prefix}] ${msg}`, meta ?? ""),
  };
}

/**
 * Evaluate one due rule. Never throws: errors are recorded as a hold
 * lastAction so one bad rule cannot wedge the daily run.
 */
export async function evaluateRule(
  prisma: PrismaClient,
  rule: BudgetRuleRow,
  opts: {
    log?: BudgetPacerLog;
    performanceProvider?: PerformanceProvider;
    cumulativeSpendProvider?: CumulativeSpendProvider;
    actorId?: string | null;
  } = {}
): Promise<EvaluateRuleResult> {
  const log = opts.log ?? defaultLog("budget-pacer");
  const base: EvaluateRuleResult = {
    ruleId: rule.id,
    tenantId: rule.tenantId,
    action: "hold",
    reason: "",
    evaluated: true,
  };
  try {
    // P0-9 spend-cap breaker — runs BEFORE any ROAS logic.
    // Fires only when maxSpendCap is set AND autoPauseOnBreach is true AND
    // cumulative spend (LaunchArchive口径, see getRuleCumulativeSpend) >= cap.
    // Missing spend data (null) never fires. Non-firing rules fall through
    // to the original ROAS path unchanged.
    if (rule.maxSpendCap != null && rule.autoPauseOnBreach) {
      const cumulativeSpend = opts.cumulativeSpendProvider
        ? await opts.cumulativeSpendProvider(rule)
        : await getRuleCumulativeSpend(prisma, rule);
      if (cumulativeSpend != null && cumulativeSpend >= rule.maxSpendCap) {
        const { taskIds } = await queueSpendCapPause(prisma, rule, {
          actorId: opts.actorId,
        });
        const reason =
          `spend-cap breach: cumulative spend ${cumulativeSpend} >= maxSpendCap ${rule.maxSpendCap} — campaign paused via campaign-toggle`;
        const lastAction: LastActionJson = {
          action: "paused",
          reason,
          at: new Date().toISOString(),
          spendCap: rule.maxSpendCap,
          cumulativeSpend,
          taskId: taskIds[0],
          taskIds,
        };
        await prisma.budgetRule.update({
          where: { id: rule.id },
          data: {
            lastEvaluatedAt: new Date(),
            lastAction: JSON.parse(JSON.stringify(lastAction)) as never,
          },
        });
        await prisma.auditLog.create({
          data: {
            id: randomUUID(),
            tenantId: rule.tenantId,
            actorId: opts.actorId ?? null,
            action: BUDGET_PACER_SPEND_CAP_BREACH_ACTION,
            entityType: "BudgetRule",
            entityId: rule.id,
            after: JSON.parse(
              JSON.stringify({
                ruleId: rule.id,
                campaignName: rule.campaignName,
                campaignId: rule.campaignId,
                maxSpendCap: rule.maxSpendCap,
                cumulativeSpend,
                taskIds,
                action: "paused",
              })
            ) as never,
            reason,
          },
        });
        log.info("budget-pacer spend-cap breach — campaign paused", {
          ruleId: rule.id,
          campaignName: rule.campaignName,
          maxSpendCap: rule.maxSpendCap,
          cumulativeSpend,
          taskIds,
        });
        return { ...base, action: "paused", reason, taskId: taskIds[0], taskIds };
      }
    }

    const perf = opts.performanceProvider
      ? await opts.performanceProvider(rule)
      : await getCampaignPerformance(prisma, rule.tenantId, {
          campaignName: rule.campaignName,
          campaignId: rule.campaignId,
          googleAccountId: rule.googleAccountId,
          days: rule.checkIntervalDays,
        });

    let decision: BudgetDecision;
    if (perf.spend <= 0) {
      // No spend source in the schema (documented above) — never fabricate.
      decision = {
        action: "hold",
        reason:
          perf.matchedCampaigns === 0
            ? `no matching campaign for "${rule.campaignName}" (spend unavailable)`
            : `no spend data (spend source unavailable; revenue ${perf.revenue}, ${perf.clicks} clicks, ${perf.conversions} conversions observed)`,
      };
    } else {
      const currentBudget = resolveCurrentBudget(rule);
      decision = decideBudgetAction({
        roas: perf.spend > 0 ? perf.revenue / perf.spend : null,
        targetRoas: rule.targetRoas,
        currentBudget,
        minDailyBudget: rule.minDailyBudget,
        maxDailyBudget: rule.maxDailyBudget,
        increasePct: rule.increasePct,
        decreasePct: rule.decreasePct,
      });
    }

    const lastAction: LastActionJson = {
      action: decision.action,
      reason: decision.reason,
      at: new Date().toISOString(),
      oldBudget: decision.oldBudget,
      newBudget: decision.newBudget,
      roas: perf.spend > 0 ? Math.round((perf.revenue / perf.spend) * 100) / 100 : null,
      spend: perf.spend,
      revenue: perf.revenue,
    };

    let taskId: string | undefined;
    let alertCreated = false;
    if (decision.action === "up" || decision.action === "down") {
      const queued = await queueBudgetPush(prisma, rule, decision, {
        actorId: opts.actorId,
      });
      taskId = queued.taskId;
      lastAction.taskId = taskId;
      if (!queued.deduped) {
        alertCreated = await maybeCreateBudgetAlert(
          prisma,
          rule,
          decision,
          taskId,
          log
        );
      }
      log.info(`budget-pacer ${decision.action}`, {
        ruleId: rule.id,
        campaignName: rule.campaignName,
        oldBudget: decision.oldBudget,
        newBudget: decision.newBudget,
        taskId,
        deduped: queued.deduped,
      });
    }

    await prisma.budgetRule.update({
      where: { id: rule.id },
      data: {
        lastEvaluatedAt: new Date(),
        lastAction: JSON.parse(JSON.stringify(lastAction)) as never,
      },
    });

    return {
      ...base,
      action: decision.action,
      reason: decision.reason,
      newBudget: decision.newBudget,
      taskId,
      alertCreated,
    };
  } catch (error) {
    const reason = `evaluation error: ${
      error instanceof Error ? error.message : String(error)
    }`;
    log.error("budget-pacer rule evaluation failed", {
      ruleId: rule.id,
      error: reason,
    });
    await prisma.budgetRule.update({
      where: { id: rule.id },
      data: {
        lastEvaluatedAt: new Date(),
        lastAction: JSON.parse(
          JSON.stringify({
            action: "hold",
            reason,
            at: new Date().toISOString(),
          })
        ) as never,
      },
    });
    return { ...base, action: "hold", reason };
  }
}

/**
 * Evaluate all due enabled rules. Scoped to one tenant when tenantId is
 * given; the daily worker calls it without a tenant to cover everyone.
 */
export async function evaluateRules(
  prisma: PrismaClient,
  tenantId?: string,
  opts: {
    log?: BudgetPacerLog;
    performanceProvider?: PerformanceProvider;
    cumulativeSpendProvider?: CumulativeSpendProvider;
    actorId?: string | null;
  } = {}
): Promise<EvaluateRulesSummary> {
  const log = opts.log ?? defaultLog("budget-pacer");
  const rules = (await prisma.budgetRule.findMany({
    where: { enabled: true, ...(tenantId ? { tenantId } : {}) },
    orderBy: { createdAt: "asc" },
  })) as unknown as BudgetRuleRow[];

  const now = Date.now();
  const due = rules.filter((r) => {
    if (!r.lastEvaluatedAt) return true;
    const elapsed = now - new Date(r.lastEvaluatedAt).getTime();
    return elapsed >= r.checkIntervalDays * 24 * 3600 * 1000;
  });

  const summary: EvaluateRulesSummary = {
    checked: 0,
    adjusted: 0,
    held: 0,
    paused: 0,
    alertsCreated: 0,
    errors: 0,
    results: [],
  };

  for (const rule of due) {
    const result = await evaluateRule(prisma, rule, opts);
    summary.checked += 1;
    summary.results.push(result);
    if (result.action === "up" || result.action === "down") {
      summary.adjusted += 1;
    } else if (result.action === "paused") {
      summary.paused += 1;
    } else {
      summary.held += 1;
    }
    if (result.alertCreated) summary.alertsCreated += 1;
    if (result.reason.startsWith("evaluation error:")) summary.errors += 1;
  }

  log.info("budget-pacer run complete", {
    tenantId: tenantId ?? "all",
    ...summary,
    results: undefined,
  });
  return summary;
}
