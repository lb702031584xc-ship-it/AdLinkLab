/**
 * P1 — traffic monitor scan service.
 *
 * For each enabled AlertRule, evaluates every ACTIVE tracking link of the
 * rule's tenant: compares a recent window against a baseline window with the
 * pure checker, then (on breach) dedupes, creates an Alert, and optionally
 * auto-pauses the link.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import { notifyAlert } from "../services/notify-alert.js";
import {
  checkBreach,
  type MonitorAggregates,
  type MonitorMetric,
} from "./checker.js";

export interface MonitorScanOptions {
  /** Restrict to one tenant (manual run). Omit for all tenants (schedule). */
  tenantId?: string;
  /** Max ACTIVE links evaluated per tenant. */
  linkLimit?: number;
  triggeredBy: "schedule" | "manual";
}

export interface MonitorScanResult {
  checked: number;
  alertsCreated: number;
}

export const DEFAULT_RULE_SPECS: ReadonlyArray<{
  name: string;
  metric: MonitorMetric;
  thresholdPct: number;
  windowHours: number;
  baselineHours: number;
  minClicks: number;
  autoPause: boolean;
}> = [
  {
    name: "CVR drop guard",
    metric: "cvr_drop",
    thresholdPct: 50,
    windowHours: 24,
    baselineHours: 168,
    minClicks: 50,
    autoPause: false,
  },
  {
    name: "Refund spike guard",
    metric: "refund_spike",
    thresholdPct: 5,
    windowHours: 24,
    baselineHours: 168,
    minClicks: 50,
    autoPause: false,
  },
  {
    name: "Geo shift guard",
    metric: "geo_shift",
    thresholdPct: 30,
    windowHours: 24,
    baselineHours: 168,
    minClicks: 50,
    autoPause: false,
  },
  {
    name: "Duplicate clicks guard",
    metric: "duplicate_clicks",
    thresholdPct: 5,
    windowHours: 24,
    baselineHours: 168,
    minClicks: 50,
    autoPause: false,
  },
  {
    name: "Click burst guard",
    metric: "click_burst",
    thresholdPct: 300,
    windowHours: 24,
    baselineHours: 168,
    minClicks: 50,
    autoPause: false,
  },
  {
    name: "CTR anomaly guard",
    metric: "ctr_anomaly",
    thresholdPct: 50,
    windowHours: 24,
    baselineHours: 168,
    minClicks: 50,
    autoPause: false,
  },
  {
    name: "Device anomaly guard",
    metric: "device_anomaly",
    thresholdPct: 30,
    windowHours: 24,
    baselineHours: 168,
    minClicks: 50,
    autoPause: false,
  },
];

const DEDUPE_WINDOW_MS = 24 * 3600 * 1000;

/** Cap on raw click rows fetched for duplicate-click detection. */
const CLICK_ROWS_CAP = 5000;

async function getLinkAggregates(
  prisma: PrismaClient,
  tenantId: string,
  trackingLinkId: string,
  since: Date,
  until: Date,
  opts: { clickRows?: boolean; deviceShare?: boolean } = {}
): Promise<MonitorAggregates> {
  const occurredAt = { gte: since, lt: until };
  // Test clicks (link-chain verification) never count as real traffic.
  const realClickWhere = { isTest: { not: true } };

  const clicks = await prisma.click.count({
    where: { tenantId, trackingLinkId, occurredAt, ...realClickWhere },
  });

  const conversions = await prisma.conversion.count({
    where: {
      tenantId,
      status: { notIn: ["FAILED", "ARCHIVED"] },
      conversionTime: occurredAt,
      click: { trackingLinkId, ...realClickWhere },
    },
  });

  const orderGroups = await prisma.order.groupBy({
    by: ["status"],
    where: {
      tenantId,
      createdAt: occurredAt,
      click: { trackingLinkId, ...realClickWhere },
    },
    _count: { _all: true },
  });
  let refundedOrders = 0;
  let decidedOrders = 0;
  for (const g of orderGroups) {
    if (g.status === "REFUNDED") refundedOrders += g._count._all;
    if (g.status === "CONFIRMED" || g.status === "REFUNDED") {
      decidedOrders += g._count._all;
    }
  }

  let topCountryShare: number | null = null;
  if (clicks > 0) {
    const countries = await prisma.click.groupBy({
      by: ["country"],
      where: { tenantId, trackingLinkId, occurredAt, ...realClickWhere },
      _count: { _all: true },
    });
    let best = 0;
    for (const c of countries) {
      if (c._count._all > best) best = c._count._all;
    }
    if (best > 0) topCountryShare = best / clicks;
  }

  let topDeviceShare: number | null = null;
  if (opts.deviceShare && clicks > 0) {
    const devices = await prisma.click.groupBy({
      by: ["deviceType"],
      where: { tenantId, trackingLinkId, occurredAt, ...realClickWhere },
      _count: { _all: true },
    });
    let best = 0;
    for (const d of devices) {
      if (d._count._all > best) best = d._count._all;
    }
    if (best > 0) topDeviceShare = best / clicks;
  }

  let clickRows: MonitorAggregates["clickRows"];
  if (opts.clickRows && clicks > 0) {
    const rows = (await prisma.click.findMany({
      where: { tenantId, trackingLinkId, occurredAt, ...realClickWhere },
      select: {
        gclid: true,
        ipAddress: true,
        trackingLinkId: true,
        occurredAt: true,
      },
      orderBy: { occurredAt: "asc" },
      take: CLICK_ROWS_CAP,
    })) as Array<{
      gclid: string | null;
      ipAddress: string | null;
      trackingLinkId: string;
      occurredAt: Date;
    }>;
    clickRows = rows;
  }

  return {
    clicks,
    conversions,
    refundedOrders,
    decidedOrders,
    topCountryShare,
    ...(topDeviceShare !== null ? { topDeviceShare } : {}),
    ...(clickRows !== undefined ? { clickRows } : {}),
  };
}

function describeMetric(metric: MonitorMetric): string {
  switch (metric) {
    case "cvr_drop":
      return "CVR dropped";
    case "refund_spike":
      return "refund rate rose";
    case "geo_shift":
      return "top-country share shifted";
    case "duplicate_clicks":
      return "duplicate click rate rose";
    case "click_burst":
      return "click volume burst";
    case "ctr_anomaly":
      return "CTR deviated from baseline";
    case "device_anomaly":
      return "top-device share shifted";
  }
}

function fmtRate(v: number | null): string {
  return v === null ? "n/a" : `${(v * 100).toFixed(2)}%`;
}

export async function runMonitorScan(
  prisma: PrismaClient,
  opts: MonitorScanOptions
): Promise<MonitorScanResult> {
  const linkLimit = opts.linkLimit ?? 200;
  const now = new Date();

  const rules = (await prisma.alertRule.findMany({
    where: {
      enabled: true,
      ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
    },
    orderBy: { createdAt: "asc" },
  })) as Array<{
    id: string;
    tenantId: string;
    name: string;
    metric: string;
    thresholdPct: number;
    windowHours: number;
    baselineHours: number;
    minClicks: number;
    autoPause: boolean;
  }>;

  const tenantIds = [...new Set(rules.map((r) => r.tenantId))];
  let checked = 0;
  let alertsCreated = 0;

  for (const tenantId of tenantIds) {
    const tenantRules = rules.filter((r) => r.tenantId === tenantId);
    const needsClickRows = tenantRules.some(
      (r) => r.metric === "duplicate_clicks"
    );
    const needsDeviceShare = tenantRules.some(
      (r) => r.metric === "device_anomaly"
    );
    const links = (await prisma.trackingLink.findMany({
      where: { tenantId, status: "ACTIVE", deletedAt: null },
      select: { id: true, publicId: true },
      orderBy: { createdAt: "desc" },
      take: linkLimit,
    })) as Array<{ id: string; publicId: string }>;

    for (const rule of tenantRules) {
      const windowSince = new Date(
        now.getTime() - rule.windowHours * 3600 * 1000
      );
      const baselineSince = new Date(
        windowSince.getTime() - rule.baselineHours * 3600 * 1000
      );

      for (const link of links) {
        checked += 1;
        const [windowAgg, baselineAgg] = await Promise.all([
          getLinkAggregates(prisma, tenantId, link.id, windowSince, now, {
            clickRows: needsClickRows,
            deviceShare: needsDeviceShare,
          }),
          getLinkAggregates(prisma, tenantId, link.id, baselineSince, windowSince, {
            deviceShare: needsDeviceShare,
          }),
        ]);

        const breach = checkBreach(
          {
            metric: rule.metric as MonitorMetric,
            thresholdPct: rule.thresholdPct,
            minClicks: rule.minClicks,
            windowHours: rule.windowHours,
            baselineHours: rule.baselineHours,
          },
          windowAgg,
          baselineAgg
        );
        if (!breach.breached) continue;

        // Dedupe: skip when an open alert for the same rule+link+metric
        // was created within the last 24h.
        const existing = await prisma.alert.findFirst({
          where: {
            tenantId,
            ruleId: rule.id,
            trackingLinkId: link.id,
            metric: rule.metric,
            status: "open",
            createdAt: { gt: new Date(now.getTime() - DEDUPE_WINDOW_MS) },
          },
          select: { id: true },
        });
        if (existing) continue;

        const message =
          `[${rule.metric}] "${rule.name}" breached on link ${link.publicId}: ` +
          `${describeMetric(rule.metric as MonitorMetric)} ${breach.deltaDescription} ` +
          `(window ${fmtRate(breach.windowValue)} vs baseline ${fmtRate(breach.baselineValue)})`;

        let autoPaused = false;
        if (rule.autoPause) {
          await prisma.trackingLink.update({
            where: { id: link.id },
            data: { status: "PAUSED" },
          });
          autoPaused = true;
        }

        const createdAlert = await prisma.alert.create({
          data: {
            id: randomUUID(),
            tenantId,
            ruleId: rule.id,
            trackingLinkId: link.id,
            metric: rule.metric,
            severity: rule.autoPause ? "high" : "medium",
            message,
            // Deep-clone to plain JSON for the Prisma Json field.
            data: JSON.parse(
              JSON.stringify({
                ruleId: rule.id,
                ruleName: rule.name,
                trackingLinkId: link.id,
                publicId: link.publicId,
                thresholdPct: rule.thresholdPct,
                windowHours: rule.windowHours,
                baselineHours: rule.baselineHours,
                window: windowAgg,
                baseline: baselineAgg,
                windowValue: breach.windowValue,
                baselineValue: breach.baselineValue,
                deltaDescription: breach.deltaDescription,
                autoPaused,
                triggeredBy: opts.triggeredBy,
              })
            ),
            status: "open",
          },
        });
        // P1-22：出站通知（Webhook，best-effort，绝不阻塞 Alert 创建）。
        await notifyAlert(prisma, {
          id: createdAlert.id,
          tenantId,
          ruleId: createdAlert.ruleId,
          metric: createdAlert.metric,
          severity: createdAlert.severity,
          message: createdAlert.message,
          createdAt: createdAlert.createdAt,
        });
        alertsCreated += 1;
      }
    }
  }

  return { checked, alertsCreated };
}
