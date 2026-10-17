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
  MONITOR_METRICS,
  type MonitorMetric,
} from "../monitoring/checker.js";
import {
  DEFAULT_RULE_SPECS,
  runMonitorScan,
} from "../monitoring/monitor-service.js";

/**
 * P1 — traffic monitor API (one tenant per user; session auth only).
 * Alert rules watch per-link CVR drops, refund spikes, and geo shifts;
 * breaches create alerts and can auto-pause the offending tracking link.
 * Requires Prisma persistence; registered only when services.prisma exists.
 */

export interface MonitoringRouteDeps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: MonitoringRouteDeps,
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

function asTrimmedString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function asPositiveInt(v: unknown, field: string, max: number): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > max) {
    throw new ValidationError(`${field} must be an integer between 1 and ${max}`);
  }
  return n as number;
}

function asThresholdPct(v: unknown): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0 || n > 100) {
    throw new ValidationError("thresholdPct must be a number in (0, 100]");
  }
  return n;
}

function serializeRule(r: {
  id: string;
  name: string;
  metric: string;
  thresholdPct: number;
  windowHours: number;
  baselineHours: number;
  minClicks: number;
  autoPause: boolean;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    name: r.name,
    metric: r.metric,
    thresholdPct: r.thresholdPct,
    windowHours: r.windowHours,
    baselineHours: r.baselineHours,
    minClicks: r.minClicks,
    autoPause: r.autoPause,
    enabled: r.enabled,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function registerMonitoringRoutes(
  app: FastifyInstance,
  deps: MonitoringRouteDeps
): Promise<void> {
  const { prisma } = deps;

  /** List the tenant's alert rules, oldest first. */
  app.get("/api/v1/monitoring/rules", async (request) => {
    const info = await requireSession(deps, request);
    const rows = (await prisma.alertRule.findMany({
      where: { tenantId: info.tenantId },
      orderBy: { createdAt: "asc" },
    })) as Array<Parameters<typeof serializeRule>[0]>;
    return { rules: rows.map(serializeRule) };
  });

  /** Create an alert rule. */
  app.post("/api/v1/monitoring/rules", async (request) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as {
      name?: unknown;
      metric?: unknown;
      thresholdPct?: unknown;
      windowHours?: unknown;
      baselineHours?: unknown;
      minClicks?: unknown;
      autoPause?: unknown;
    };

    const name = asTrimmedString(body.name);
    if (!name) throw new ValidationError("name must be a non-empty string");
    if (typeof body.metric !== "string" || !MONITOR_METRICS.includes(body.metric as MonitorMetric)) {
      throw new ValidationError(
        `metric must be one of: ${MONITOR_METRICS.join(", ")}`
      );
    }
    const thresholdPct = asThresholdPct(body.thresholdPct);
    const windowHours =
      body.windowHours === undefined ? 24 : asPositiveInt(body.windowHours, "windowHours", 720);
    const baselineHours =
      body.baselineHours === undefined
        ? 168
        : asPositiveInt(body.baselineHours, "baselineHours", 2160);
    const minClicks =
      body.minClicks === undefined ? 50 : asPositiveInt(body.minClicks, "minClicks", 100000);
    const autoPause = body.autoPause === undefined ? false : body.autoPause === true;

    const row = (await prisma.alertRule.create({
      data: {
        id: randomUUID(),
        tenantId: info.tenantId,
        name,
        metric: body.metric as string,
        thresholdPct,
        windowHours,
        baselineHours,
        minClicks,
        autoPause,
        enabled: true,
      },
    })) as Parameters<typeof serializeRule>[0];
    return { rule: serializeRule(row) };
  });

  /** Seed the default guards when the tenant has none. */
  app.post("/api/v1/monitoring/rules/defaults", async (request) => {
    const info = await requireSession(deps, request);
    const existing = (await prisma.alertRule.findMany({
      where: { tenantId: info.tenantId },
      orderBy: { createdAt: "asc" },
    })) as Array<Parameters<typeof serializeRule>[0]>;
    if (existing.length > 0) {
      return { created: false, rules: existing.map(serializeRule) };
    }
    const created: Array<Parameters<typeof serializeRule>[0]> = [];
    for (const spec of DEFAULT_RULE_SPECS) {
      const row = (await prisma.alertRule.create({
        data: {
          id: randomUUID(),
          tenantId: info.tenantId,
          name: spec.name,
          metric: spec.metric,
          thresholdPct: spec.thresholdPct,
          windowHours: spec.windowHours,
          baselineHours: spec.baselineHours,
          minClicks: spec.minClicks,
          autoPause: spec.autoPause,
          enabled: true,
        },
      })) as Parameters<typeof serializeRule>[0];
      created.push(row);
    }
    return { created: true, rules: created.map(serializeRule) };
  });

  /** Update an alert rule (tenant-scoped). */
  app.patch("/api/v1/monitoring/rules/:id", async (request) => {
    const info = await requireSession(deps, request);
    const { id } = request.params as { id: string };
    const existing = await prisma.alertRule.findFirst({
      where: { id, tenantId: info.tenantId },
    });
    if (!existing) throw new NotFoundError("AlertRule", id);

    const body = (request.body ?? {}) as {
      name?: unknown;
      thresholdPct?: unknown;
      windowHours?: unknown;
      baselineHours?: unknown;
      minClicks?: unknown;
      autoPause?: unknown;
      enabled?: unknown;
    };
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = asTrimmedString(body.name);
      if (!name) throw new ValidationError("name must be a non-empty string");
      data.name = name;
    }
    if (body.thresholdPct !== undefined) data.thresholdPct = asThresholdPct(body.thresholdPct);
    if (body.windowHours !== undefined)
      data.windowHours = asPositiveInt(body.windowHours, "windowHours", 720);
    if (body.baselineHours !== undefined)
      data.baselineHours = asPositiveInt(body.baselineHours, "baselineHours", 2160);
    if (body.minClicks !== undefined)
      data.minClicks = asPositiveInt(body.minClicks, "minClicks", 100000);
    if (body.autoPause !== undefined) data.autoPause = body.autoPause === true;
    if (body.enabled !== undefined) data.enabled = body.enabled === true;
    if (Object.keys(data).length === 0) {
      throw new ValidationError("No updatable fields provided");
    }

    const row = (await prisma.alertRule.update({
      where: { id },
      data,
    })) as Parameters<typeof serializeRule>[0];
    return { rule: serializeRule(row) };
  });

  /** Delete an alert rule (tenant-scoped). Past alerts keep ruleId = null. */
  app.delete("/api/v1/monitoring/rules/:id", async (request) => {
    const info = await requireSession(deps, request);
    const { id } = request.params as { id: string };
    const existing = await prisma.alertRule.findFirst({
      where: { id, tenantId: info.tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError("AlertRule", id);
    await prisma.alertRule.delete({ where: { id } });
    return { ok: true };
  });

  /** List alerts (tenant-scoped). */
  app.get("/api/v1/monitoring/alerts", async (request) => {
    const info = await requireSession(deps, request);
    const query = (request.query ?? {}) as { status?: unknown };
    const status =
      typeof query.status === "string" ? query.status : "open";
    if (!["open", "acknowledged", "all"].includes(status)) {
      throw new ValidationError("status must be open, acknowledged, or all");
    }
    const rows = (await prisma.alert.findMany({
      where: {
        tenantId: info.tenantId,
        ...(status === "all" ? {} : { status }),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    })) as Array<{
      id: string;
      ruleId: string | null;
      trackingLinkId: string | null;
      metric: string;
      severity: string;
      message: string;
      data: unknown;
      status: string;
      createdAt: Date;
      updatedAt: Date;
    }>;
    return {
      alerts: rows.map((r) => ({
        id: r.id,
        ruleId: r.ruleId,
        trackingLinkId: r.trackingLinkId,
        metric: r.metric,
        severity: r.severity,
        message: r.message,
        data: r.data ?? null,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  });

  /** Acknowledge an alert (tenant-scoped). */
  app.post("/api/v1/monitoring/alerts/:id/ack", async (request) => {
    const info = await requireSession(deps, request);
    const { id } = request.params as { id: string };
    const existing = await prisma.alert.findFirst({
      where: { id, tenantId: info.tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError("Alert", id);
    await prisma.alert.update({
      where: { id },
      data: { status: "acknowledged" },
    });
    return { ok: true };
  });

  /**
   * P0-8 — 近 24h 服务端错误（error_reports，租户隔离，按 lastSeenAt 倒序）。
   * limit 默认 50，上限 200。
   */
  app.get("/api/v1/monitoring/errors", async (request) => {
    const info = await requireSession(deps, request);
    const query = (request.query ?? {}) as { limit?: unknown };
    let limit = 50;
    if (query.limit !== undefined) {
      const n = Number(query.limit);
      if (!Number.isInteger(n) || n < 1 || n > 200) {
        throw new ValidationError("limit must be an integer between 1 and 200");
      }
      limit = n;
    }
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = (await prisma.errorReport.findMany({
      where: { tenantId: info.tenantId, lastSeenAt: { gte: since } },
      orderBy: { lastSeenAt: "desc" },
      take: limit,
    })) as Array<{
      id: string;
      level: string;
      message: string;
      requestId: string | null;
      path: string | null;
      method: string | null;
      statusCode: number | null;
      count: number;
      firstSeenAt: Date;
      lastSeenAt: Date;
    }>;
    return {
      errors: rows.map((r) => ({
        id: r.id,
        level: r.level,
        message: r.message,
        requestId: r.requestId,
        path: r.path,
        method: r.method,
        statusCode: r.statusCode,
        count: r.count,
        firstSeenAt: r.firstSeenAt.toISOString(),
        lastSeenAt: r.lastSeenAt.toISOString(),
      })),
    };
  });

  /** Synchronously run the enabled rules for this tenant now (cap 50 links). */
  app.post("/api/v1/monitoring/run", async (request) => {
    const info = await requireSession(deps, request);
    const result = await runMonitorScan(prisma, {
      tenantId: info.tenantId,
      linkLimit: 50,
      triggeredBy: "manual",
    });
    return result;
  });
}
