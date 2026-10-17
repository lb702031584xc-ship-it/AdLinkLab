import type { PrismaClient } from "@adlinklab/database";
import { runMonitorScan } from "../monitoring/monitor-service.js";
import { runAutoStatusCheck } from "../routes/offer-preferences.js";
import { recordDeadLetter } from "./dead-letter.js";

/**
 * P1 — traffic monitor worker entry (BullMQ Worker calls this on the
 * hourly repeatable schedule). The scan is idempotent by construction
 * (alert dedupe on rule+link+metric within 24h), so it does not go through
 * the SyncJob machinery used by mutation workflows.
 */
export async function processTrafficMonitorJob(input: {
  prisma: PrismaClient;
  triggeredBy: "schedule" | "manual";
  tenantId?: string;
  log?: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
}): Promise<{ checked: number; alertsCreated: number; autoStatus: { checked: number; paused: number } | null }> {
  const log =
    input.log ??
    ({
      info: (msg: string, meta?: Record<string, unknown>) =>
        console.log(`[traffic-monitor] ${msg}`, meta ?? ""),
    } as NonNullable<typeof input.log>);
  // P1-21：扫描失败 → 记 DLQ（去重 1h）后继续抛给 BullMQ 重试。
  let result: Awaited<ReturnType<typeof runMonitorScan>>;
  try {
    result = await runMonitorScan(input.prisma, {
      tenantId: input.tenantId,
      triggeredBy: input.triggeredBy,
    });
  } catch (e) {
    if (input.tenantId) {
      await recordDeadLetter(input.prisma, {
        tenantId: input.tenantId,
        jobName: "traffic-monitor",
        payload: { triggeredBy: input.triggeredBy },
        error: e instanceof Error ? e.message : String(e),
      });
    }
    throw e;
  }
  // P1-6：自动状态联动（已开启的 Offer 才执行；失败只记日志，绝不影响扫描结果）。
  let autoStatus: { checked: number; paused: number } | null = null;
  if (input.tenantId) {
    try {
      const results = await runAutoStatusCheck(input.prisma, input.tenantId);
      autoStatus = {
        checked: results.length,
        paused: results.filter((r) => r.paused).length,
      };
    } catch (e) {
      log.error?.("auto-status check failed (scan result unaffected)", {
        error: (e as Error).message,
      });
    }
  }
  log.info("scan complete", {
    triggeredBy: input.triggeredBy,
    tenantId: input.tenantId ?? "all",
    ...result,
    autoStatus,
  });
  return { ...result, autoStatus };
}
