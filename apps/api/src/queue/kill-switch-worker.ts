import type { PrismaClient } from "@adlinklab/database";
import { executeKillSwitch } from "../killswitch/engine.js";
import { businessMetrics } from "../observability/index.js";

/**
 * Phase 3 — kill-switch worker entry (BullMQ Worker calls this on the
 * hourly repeatable schedule). Evaluates every offer that has a
 * KillSwitchConfig row; per-offer failures are logged and never thrown
 * so one bad offer cannot wedge the hourly run.
 */
export async function processKillSwitchJob(input: {
  prisma: PrismaClient;
  triggeredBy: "schedule" | "manual";
  tenantId?: string;
  log?: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
}): Promise<{
  evaluated: number;
  fired: number;
  linksPaused: number;
  alertsCreated: number;
}> {
  const log =
    input.log ??
    ({
      info: (msg: string, meta?: Record<string, unknown>) =>
        console.log(`[kill-switch] ${msg}`, meta ?? ""),
      error: (msg: string, meta?: Record<string, unknown>) =>
        console.error(`[kill-switch] ${msg}`, meta ?? ""),
    } as NonNullable<typeof input.log>);

  const configs = (await input.prisma.killSwitchConfig.findMany({
    where: input.tenantId ? { tenantId: input.tenantId } : {},
    select: { offerId: true, tenantId: true },
    orderBy: { createdAt: "asc" },
  })) as Array<{ offerId: string; tenantId: string }>;

  let evaluated = 0;
  let fired = 0;
  let linksPaused = 0;
  let alertsCreated = 0;
  for (const config of configs) {
    try {
      const result = await executeKillSwitch(input.prisma, config.offerId, {
        triggeredBy: input.triggeredBy,
      });
      evaluated += 1;
      if (result.triggers.length > 0) {
        fired += 1;
        businessMetrics.killSwitchFiredOnce(); // P2-3
        linksPaused += result.linksPaused;
        if (result.alertCreated) alertsCreated += 1;
        log.info("kill-switch fired", {
          offerId: config.offerId,
          tenantId: config.tenantId,
          triggers: result.triggers.map((t) => t.type),
          actionTaken: result.actionTaken,
          linksPaused: result.linksPaused,
          googleAdsPaused: result.googleAdsPaused,
          googleAdsTaskIds: result.googleAdsTaskIds,
        });
      }
    } catch (error) {
      // Never throw: a single failing offer must not break the hourly run.
      log.error("kill-switch evaluation failed", {
        offerId: config.offerId,
        tenantId: config.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  log.info("scan complete", {
    triggeredBy: input.triggeredBy,
    tenantId: input.tenantId ?? "all",
    evaluated,
    fired,
    linksPaused,
    alertsCreated,
  });
  return { evaluated, fired, linksPaused, alertsCreated };
}
