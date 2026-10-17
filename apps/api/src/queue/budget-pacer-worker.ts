/**
 * Automation pack 4/5 — budget pacer worker.
 *
 * BullMQ queue name: `budget-pacer`
 * Repeat schedule: every 24h (worker-owned repeatable schedule, like
 * kill-switch / traffic-monitor / competitor-watch).
 * Job name: `budget-pacer-evaluate`
 *
 * NOTE: this queue is NOT yet registered in queue-catalog.ts / jobs.ts —
 * the catalog's WORKER_REGISTRY stays untouched by design (subtask scope).
 * When wiring, add QUEUE_NAMES.budgetPacer = "budget-pacer", a
 * JOB_DEFINITIONS entry, and a WORKER_REGISTRY row pointing at this file's
 * `processBudgetPacerJob` export, with a 24h repeatable schedule in the
 * WorkerRuntime.
 *
 * What it does: calls evaluateRules() from
 * ../services/budget-pacer-service.js, which evaluates every enabled
 * BudgetRule whose `now - lastEvaluatedAt >= checkIntervalDays` and queues
 * budget up/down pushes as SyncJob task records for the Google Ads Script
 * channel. NEVER calls the Google Ads API directly.
 *
 * P0-9: evaluateRules() checks the spend-cap breaker FIRST for each rule
 * (maxSpendCap + autoPauseOnBreach vs cumulative LaunchArchive spend) and
 * queues a campaign-toggle PAUSE before any ROAS logic. See
 * getRuleCumulativeSpend() for the spend口径.
 *
 * Failures never throw out of a single rule (the service records a hold
 * lastAction); a top-level failure here only surfaces as a rejected job so
 * BullMQ retry policy applies.
 */
import type { PrismaClient } from "@adlinklab/database";
import {
  evaluateRules,
  type BudgetPacerLog,
  type EvaluateRulesSummary,
  type PerformanceProvider,
} from "../services/budget-pacer-service.js";

/** BullMQ queue name for the budget pacer (wiring adds it to jobs.ts). */
export const BUDGET_PACER_QUEUE_NAME = "budget-pacer";
/** Job name the repeatable schedule enqueues. */
export const BUDGET_PACER_JOB_NAME = "budget-pacer-evaluate";
/** Repeat cadence for the worker-owned schedule. */
export const BUDGET_PACER_REPEAT_EVERY_MS = 24 * 3600 * 1000;

export interface BudgetPacerJobInput {
  prisma: PrismaClient;
  /** "schedule" for the daily run; "manual" for an operator-triggered run. */
  triggeredBy: "schedule" | "manual";
  /** Scope the run to one tenant when set. */
  tenantId?: string;
  /** Test seam for performance data (real DB aggregation by default). */
  performanceProvider?: PerformanceProvider;
  log?: BudgetPacerLog;
}

/**
 * BullMQ processor entry. Registered as the `budget-pacer-evaluate` job
 * handler on the `budget-pacer` queue with a 24h repeat.
 */
export async function processBudgetPacerJob(
  input: BudgetPacerJobInput
): Promise<EvaluateRulesSummary> {
  const log: BudgetPacerLog =
    input.log ??
    ({
      info: (msg: string, meta?: Record<string, unknown>) =>
        console.log(`[budget-pacer] ${msg}`, meta ?? ""),
      error: (msg: string, meta?: Record<string, unknown>) =>
        console.error(`[budget-pacer] ${msg}`, meta ?? ""),
    } as BudgetPacerLog);

  log.info("budget-pacer job started", {
    triggeredBy: input.triggeredBy,
    tenantId: input.tenantId ?? "all",
  });

  const summary = await evaluateRules(input.prisma, input.tenantId, {
    log,
    performanceProvider: input.performanceProvider,
    actorId: null,
  });

  log.info("budget-pacer job finished", {
    triggeredBy: input.triggeredBy,
    checked: summary.checked,
    adjusted: summary.adjusted,
    held: summary.held,
    alertsCreated: summary.alertsCreated,
    errors: summary.errors,
  });

  return summary;
}
