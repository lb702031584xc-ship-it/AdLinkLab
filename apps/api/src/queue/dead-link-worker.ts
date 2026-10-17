/**
 * Automation pack ① — dead link monitor worker.
 *
 * BullMQ worker. WIRING (done by the parent orchestrator, NOT in this file):
 *   - queue name: `dead-link`
 *   - job name:   `dead-link-check`
 *   - repeat:     every 1h
 * Register in queue-catalog.ts with:
 *   queueName: "dead-link",
 *   processorModule: "dead-link-worker.ts",
 *   processorExport: "processDeadLinkJob",
 *
 * The job scans every ACTIVE tracking link (all tenants, or a single tenant
 * when job data carries `tenantId`), runs the SSRF-safe health check, and
 * pauses + alerts on dead links (24h alert dedupe per link). Per-link
 * failures never throw — they are logged and skipped so a bad link cannot
 * wedge the hourly run.
 */
import type { PrismaClient } from "@adlinklab/database";
import {
  checkAllActiveLinks,
  type DeadLinkScanOpts,
  type DeadLinkScanSummary,
} from "../services/dead-link-service.js";
import { recordDeadLetter } from "./dead-letter.js";

export interface DeadLinkLog {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface DeadLinkJobInput {
  prisma: PrismaClient;
  triggeredBy: "schedule" | "manual";
  /** When set, only this tenant is scanned; otherwise all tenants. */
  tenantId?: string;
  checkOpts?: DeadLinkScanOpts;
  log?: DeadLinkLog;
}

/**
 * BullMQ processor for the `dead-link-check` job on the `dead-link` queue.
 * Returns the scan summary for observability. Never throws.
 */
export async function processDeadLinkJob(
  input: DeadLinkJobInput
): Promise<DeadLinkScanSummary> {
  const log: DeadLinkLog =
    input.log ??
    ({
      info: (msg: string, meta?: Record<string, unknown>) =>
        console.log(`[dead-link] ${msg}`, meta ?? ""),
      error: (msg: string, meta?: Record<string, unknown>) =>
        console.error(`[dead-link] ${msg}`, meta ?? ""),
    } as DeadLinkLog);

  let summary: DeadLinkScanSummary;
  try {
    summary = await checkAllActiveLinks(input.prisma, input.tenantId, input.checkOpts);
  } catch (error) {
    // Defensive: the service already swallows per-link errors, but the
    // worker must never fail the repeatable job either.
    log.error("dead-link scan aborted", {
      triggeredBy: input.triggeredBy,
      tenantId: input.tenantId ?? "all",
      error: error instanceof Error ? error.message : String(error),
    });
    // P1-21：整批扫描失败 → 记 DLQ（去重 1h），供 /jobs 页重试/丢弃。
    if (input.tenantId) {
      await recordDeadLetter(input.prisma, {
        tenantId: input.tenantId,
        jobName: "dead-link-check",
        payload: { triggeredBy: input.triggeredBy },
        error: error instanceof Error ? error.message : String(error),
      });
    }
    summary = {
      checked: 0,
      alive: 0,
      dead: 0,
      paused: 0,
      alertsCreated: 0,
      skippedNoUrl: 0,
    };
  }

  log.info("dead-link scan complete", {
    triggeredBy: input.triggeredBy,
    tenantId: input.tenantId ?? "all",
    ...summary,
  });
  return summary;
}
