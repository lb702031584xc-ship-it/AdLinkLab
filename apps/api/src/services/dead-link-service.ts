/**
 * Automation pack ① — dead link monitor: business logic.
 *
 * - checkAllActiveLinks: scans every ACTIVE TrackingLink (tenant-isolated),
 *   runs the SSRF-safe checkLinkHealth against its resolved destination URL
 *   (landing page URL preferred, offer destination URL as fallback), writes
 *   a LinkHealthCheck row per link, and on death pauses the link and raises
 *   a DEAD_LINK alert (deduped 24h per tracking link).
 * - getHealthHistory: paginated check history (tenant-isolated).
 *
 * Note: the Alert table has no `type`/`title`/`entityType`/`entityId`
 * columns — DEAD_LINK is carried in `metric`, the tracking link in
 * `trackingLinkId`, and the entity metadata in the `data` JSON column.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import {
  checkLinkHealth,
  type LinkHealthResult,
} from "../ai/link-health-check.js";

/** Alert metric for dead links. */
export const DEAD_LINK_ALERT_METRIC = "DEAD_LINK";

/** Alert dedupe window: one DEAD_LINK alert per tracking link per 24h. */
const ALERT_DEDUPE_WINDOW_MS = 24 * 3600 * 1000;

export interface DeadLinkScanSummary {
  checked: number;
  alive: number;
  dead: number;
  /** Links paused because they were found dead. */
  paused: number;
  alertsCreated: number;
  /** Links skipped because no destination URL could be resolved. */
  skippedNoUrl: number;
}

export interface DeadLinkScanOpts {
  /** Injectable health-check implementation for tests (no network). */
  checkImpl?: typeof checkLinkHealth;
  /**
   * 可选的租户门控：返回 false 的租户其链接本次完全跳过（不计数）。
   * 缺省时行为不变（老链路不受影响）。
   */
  tenantGate?: (tenantId: string) => boolean;
}

interface ScanLinkRow {
  id: string;
  tenantId: string;
  publicId: string;
  offer: { name: string; destinationUrl: string } | null;
  landingPage: { name: string; url: string } | null;
}

function resolveDestinationUrl(link: ScanLinkRow): string | null {
  return link.landingPage?.url ?? link.offer?.destinationUrl ?? null;
}

function linkDisplayName(link: ScanLinkRow): string {
  return link.landingPage?.name ?? link.offer?.name ?? link.publicId;
}

/**
 * Create the DEAD_LINK alert unless one was created for this link in the
 * last 24h. Never throws — alert failures must not break the scan.
 */
async function maybeCreateDeadLinkAlert(
  prisma: PrismaClient,
  link: ScanLinkRow,
  result: LinkHealthResult
): Promise<boolean> {
  try {
    const since = new Date(Date.now() - ALERT_DEDUPE_WINDOW_MS);
    const existing = await prisma.alert.findMany({
      where: {
        tenantId: link.tenantId,
        metric: DEAD_LINK_ALERT_METRIC,
        trackingLinkId: link.id,
        createdAt: { gte: since },
      },
      select: { id: true },
    });
    if (existing.length > 0) return false;

    const cause =
      result.failureReason === "redirected_to_homepage"
        ? "目标页面已跳转到商家首页（疑似过期下架）"
        : result.statusCode != null
          ? `HTTP ${result.statusCode}`
          : (result.failureReason ?? "未知原因");
    await prisma.alert.create({
      data: {
        id: randomUUID(),
        tenantId: link.tenantId,
        ruleId: null,
        trackingLinkId: link.id,
        metric: DEAD_LINK_ALERT_METRIC,
        severity: "high",
        message: `死链告警：跟踪链接「${linkDisplayName(link)}」（${link.publicId}）目标页面已失效（${cause}），已自动暂停该链接。`,
        data: JSON.parse(
          JSON.stringify({
            entityType: "TrackingLink",
            entityId: link.id,
            statusCode: result.statusCode ?? null,
            finalUrl: result.finalUrl,
            failureReason: result.failureReason ?? null,
          })
        ),
        status: "open",
      },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Scan every ACTIVE tracking link for the tenant (or all tenants when
 * `tenantId` is omitted). Never throws: one bad link must not wedge the
 * hourly run — per-link failures are swallowed after best-effort logging.
 */
export async function checkAllActiveLinks(
  prisma: PrismaClient,
  tenantId?: string,
  opts: DeadLinkScanOpts = {}
): Promise<DeadLinkScanSummary> {
  const check = opts.checkImpl ?? checkLinkHealth;
  const summary: DeadLinkScanSummary = {
    checked: 0,
    alive: 0,
    dead: 0,
    paused: 0,
    alertsCreated: 0,
    skippedNoUrl: 0,
  };

  const links = (await prisma.trackingLink.findMany({
    where: {
      status: "ACTIVE",
      deletedAt: null,
      ...(tenantId ? { tenantId } : {}),
    },
    select: {
      id: true,
      tenantId: true,
      publicId: true,
      healthCheckIntervalSec: true,
      linkSource: true,
      offer: { select: { name: true, destinationUrl: true } },
      landingPage: { select: { name: true, url: true } },
      healthChecks: {
        orderBy: { checkedAt: "desc" },
        take: 1,
        select: { checkedAt: true },
      },
    },
    orderBy: { createdAt: "asc" },
  })) as (ScanLinkRow & {
    healthCheckIntervalSec: number;
    linkSource: string;
    healthChecks: { checkedAt: Date }[];
  })[];

  const now = Date.now();
  const MIN_INTERVAL_SEC = 600; // 10min floor to avoid hammering

  for (const link of links) {
    try {
      // 每租户系统设置门控（tenant_settings.system.linkCheckEnabled/Hour）：
      // 未配过设置的老租户不受影响（缺省扫描）。
      if (opts.tenantGate && !opts.tenantGate(link.tenantId)) continue;
      // Per-link interval: skip if checked recently enough.
      const intervalSec = Math.max(link.healthCheckIntervalSec || 3600, MIN_INTERVAL_SEC);
      const lastChecked = link.healthChecks[0]?.checkedAt?.getTime();
      if (lastChecked && now - lastChecked < intervalSec * 1000) {
        summary.skippedNoUrl += 0; // interval-skip, not counted as no-url
        continue;
      }

      const url = resolveDestinationUrl(link);
      if (!url) {
        summary.skippedNoUrl += 1;
        continue;
      }

      const result = await check(url);

      await prisma.linkHealthCheck.create({
        data: {
          id: randomUUID(),
          tenantId: link.tenantId,
          trackingLinkId: link.id,
          statusCode: result.statusCode ?? null,
          finalUrl: result.finalUrl,
          isAlive: result.isAlive,
          failureReason: result.failureReason ?? null,
          responseTimeMs: result.responseTimeMs,
        },
      });

      summary.checked += 1;
      if (result.isAlive) {
        summary.alive += 1;
        continue;
      }

      summary.dead += 1;
      await prisma.trackingLink.update({
        where: { id: link.id },
        data: { status: "PAUSED" },
      });
      summary.paused += 1;

      if (await maybeCreateDeadLinkAlert(prisma, link, result)) {
        summary.alertsCreated += 1;
      }
    } catch (error) {
      // Never throw: one bad link must not wedge the hourly run.
      console.error("[dead-link] scan failed for link", {
        linkId: link.id,
        tenantId: link.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface HealthHistoryQuery {
  trackingLinkId?: string;
  page?: number;
  pageSize?: number;
}

export interface HealthHistoryResult {
  total: number;
  page: number;
  pageSize: number;
  rows: Array<{
    id: string;
    trackingLinkId: string;
    checkedAt: Date;
    statusCode: number | null;
    finalUrl: string | null;
    isAlive: boolean;
    failureReason: string | null;
    responseTimeMs: number | null;
    linkName: string | null;
    linkPublicId: string | null;
  }>;
}

/** Paginated check history, tenant-isolated, newest first. */
export async function getHealthHistory(
  prisma: PrismaClient,
  tenantId: string,
  query: HealthHistoryQuery = {}
): Promise<HealthHistoryResult> {
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(query.pageSize ?? 20)));
  const where = {
    tenantId,
    ...(query.trackingLinkId ? { trackingLinkId: query.trackingLinkId } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.linkHealthCheck.count({ where }),
    prisma.linkHealthCheck.findMany({
      where,
      orderBy: { checkedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  // LinkHealthCheck has no Prisma relation — hydrate names in one query.
  const linkIds = [...new Set(rows.map((r) => r.trackingLinkId))];
  const links =
    linkIds.length > 0
      ? await prisma.trackingLink.findMany({
          where: { id: { in: linkIds }, tenantId },
          select: {
            id: true,
            publicId: true,
            offer: { select: { name: true } },
            landingPage: { select: { name: true } },
          },
        })
      : [];
  const linkById = new Map(
    links.map((l) => [
      l.id,
      {
        publicId: l.publicId,
        name:
          (l.landingPage as { name?: string } | null)?.name ??
          (l.offer as { name?: string } | null)?.name ??
          null,
      },
    ])
  );

  return {
    total,
    page,
    pageSize,
    rows: rows.map((r) => {
      const info = linkById.get(r.trackingLinkId) ?? null;
      return {
        id: r.id,
        trackingLinkId: r.trackingLinkId,
        checkedAt: r.checkedAt,
        statusCode: r.statusCode,
        finalUrl: r.finalUrl,
        isAlive: r.isAlive,
        failureReason: r.failureReason,
        responseTimeMs: r.responseTimeMs,
        linkName: info?.name ?? null,
        linkPublicId: info?.publicId ?? null,
      };
    }),
  };
}
