/**
 * Phase 8.4.7.1 / 9.5 — Dashboard Query Service (READ ONLY).
 * desiredVersion = ACTIVE UrlVersion.version (sole Desired Authority).
 * appliedVersion = ScriptSyncTarget.appliedVersion (integration-specific).
 * syncState = deriveSyncState(applied, ACTIVE) — never from target.desiredVersion shadow.
 * No create/update/delete/activate/apply/enqueue.
 */
import type {
  AdGroupRepository,
  AdRepository,
  GoogleAdsScriptIntegrationRepository,
  ScriptSyncLogRepository,
  ScriptSyncTargetRepository,
  UrlVersionRepository,
} from "@adlinklab/domain";
import { deriveSyncState } from "@adlinklab/domain";
import { ForbiddenError, NotFoundError, ValidationError } from "@adlinklab/shared";
import type { IntegrationAuthContext } from "../auth/integration-auth.js";
import {
  aggregateConnectionHealth,
  aggregateLastExecution,
  aggregateSyncCounts,
  countLastExecutions,
  mapDashboardLog,
  mapIntegrationCore,
  type DashboardDesiredUrlDto,
  type DashboardIntegrationDetailDto,
  type DashboardIntegrationListItemDto,
  type DashboardLogDto,
  type DashboardSummaryDto,
  type DashboardTargetDto,
} from "./dashboard-dto.js";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const RECENT_LOGS_MAX = 10;
const TARGET_FETCH_PAGE_SIZE = 500;

export interface DashboardLogsPage {
  items: DashboardLogDto[];
  page: number;
  pageSize: number;
  total: number;
  hasNext: boolean;
}

export function parseDashboardPagination(query: {
  page?: string | number;
  pageSize?: string | number;
}): { page: number; pageSize: number } {
  const pageRaw = query.page;
  const sizeRaw = query.pageSize;

  const page =
    pageRaw === undefined || pageRaw === null || pageRaw === ""
      ? DEFAULT_PAGE
      : typeof pageRaw === "number"
        ? pageRaw
        : Number(pageRaw);
  const pageSize =
    sizeRaw === undefined || sizeRaw === null || sizeRaw === ""
      ? DEFAULT_PAGE_SIZE
      : typeof sizeRaw === "number"
        ? sizeRaw
        : Number(sizeRaw);

  if (!Number.isInteger(page) || page < 1) {
    throw new ValidationError("page must be an integer >= 1");
  }
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new ValidationError("pageSize must be an integer >= 1");
  }
  if (pageSize > MAX_PAGE_SIZE) {
    throw new ValidationError(`pageSize must be <= ${MAX_PAGE_SIZE}`);
  }
  return { page, pageSize };
}

export class DashboardQueryService {
  constructor(
    private readonly scriptIntegrations: GoogleAdsScriptIntegrationRepository,
    private readonly scriptSyncTargets: ScriptSyncTargetRepository,
    private readonly scriptSyncLogs: ScriptSyncLogRepository,
    private readonly ads: AdRepository,
    private readonly adGroups: AdGroupRepository,
    private readonly urlVersions: UrlVersionRepository
  ) {}

  /** Path / claim integrationId must match authenticated Integration. */
  assertIntegrationAccess(
    ctx: IntegrationAuthContext,
    integrationId: string
  ): void {
    if (integrationId !== ctx.integrationId) {
      throw new ForbiddenError("integrationId does not match Integration auth");
    }
  }

  async listIntegrations(
    ctx: IntegrationAuthContext
  ): Promise<{ items: DashboardIntegrationListItemDto[] }> {
    const integration = await this.requireIntegration(ctx);
    const targets = await this.loadAllTargets(ctx);
    const states = await this.resolveTargetSyncStates(ctx, targets);
    const counts = aggregateSyncCounts(states);

    return {
      items: [
        {
          ...mapIntegrationCore(integration),
          targetCount: targets.length,
          syncStateSummary: counts.summary,
          connectionHealth: aggregateConnectionHealth(
            targets,
            integration.status
          ),
          lastExecutionSummary: countLastExecutions(targets),
        },
      ],
    };
  }

  async getIntegration(
    ctx: IntegrationAuthContext,
    integrationId: string
  ): Promise<DashboardIntegrationDetailDto> {
    this.assertIntegrationAccess(ctx, integrationId);
    const integration = await this.requireIntegration(ctx);
    const targets = await this.loadAllTargets(ctx);
    const states = await this.resolveTargetSyncStates(ctx, targets);
    const counts = aggregateSyncCounts(states);

    return {
      integration: mapIntegrationCore(integration),
      health: {
        syncState: counts.dominant,
        connectionHealth: aggregateConnectionHealth(
          targets,
          integration.status
        ),
        lastExecution: aggregateLastExecution(targets),
      },
      counts: {
        targets: targets.length,
        synced: counts.synced,
        outOfSync: counts.outOfSync,
        neverApplied: counts.neverApplied,
      },
    };
  }

  async listTargets(
    ctx: IntegrationAuthContext,
    integrationId: string
  ): Promise<{ items: DashboardTargetDto[] }> {
    this.assertIntegrationAccess(ctx, integrationId);
    await this.requireIntegration(ctx);
    const targets = await this.loadAllTargets(ctx);
    const items: DashboardTargetDto[] = [];
    for (const target of targets) {
      const dto = await this.mapTarget(ctx, target);
      if (dto) items.push(dto);
    }
    return { items };
  }

  async listLogs(
    ctx: IntegrationAuthContext,
    integrationId: string,
    query: { page?: string | number; pageSize?: string | number }
  ): Promise<DashboardLogsPage> {
    this.assertIntegrationAccess(ctx, integrationId);
    await this.requireIntegration(ctx);
    const { page, pageSize } = parseDashboardPagination(query);
    const result = await this.scriptSyncLogs.findByIntegration(
      ctx.tenantId,
      ctx.integrationId,
      { page, pageSize }
    );
    return {
      items: result.items.map(mapDashboardLog),
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      hasNext: result.page * result.pageSize < result.total,
    };
  }

  async getSummary(ctx: IntegrationAuthContext): Promise<DashboardSummaryDto> {
    const integration = await this.requireIntegration(ctx);
    const targets = await this.loadAllTargets(ctx);
    const states = await this.resolveTargetSyncStates(ctx, targets);
    const counts = aggregateSyncCounts(states);

    let currentDesiredVersion: number | null = null;
    for (const target of targets) {
      const active = await this.findActiveVersion(ctx.tenantId, target.entityId);
      if (active != null) {
        currentDesiredVersion =
          currentDesiredVersion == null
            ? active
            : Math.max(currentDesiredVersion, active);
      }
    }

    const recent = await this.scriptSyncLogs.findByIntegration(
      ctx.tenantId,
      ctx.integrationId,
      { page: 1, pageSize: RECENT_LOGS_MAX }
    );

    return {
      integration: {
        integrationId: integration.id,
        name: integration.name,
        status: integration.status,
      },
      targets: {
        total: targets.length,
        synced: counts.synced,
        outOfSync: counts.outOfSync,
        neverApplied: counts.neverApplied,
      },
      health: {
        connection: aggregateConnectionHealth(targets, integration.status),
        lastExecution: aggregateLastExecution(targets),
      },
      versions: {
        currentDesiredVersion,
        appliedTargets: counts.synced,
        pendingTargets: counts.outOfSync,
      },
      recentLogs: recent.items.map(mapDashboardLog),
    };
  }

  private async requireIntegration(ctx: IntegrationAuthContext) {
    const integration = await this.scriptIntegrations.findByIdForTenant(
      ctx.tenantId,
      ctx.integrationId
    );
    if (!integration || integration.deletedAt) {
      throw new NotFoundError("GoogleAdsScriptIntegration", ctx.integrationId);
    }
    return integration;
  }

  private async loadAllTargets(ctx: IntegrationAuthContext) {
    const page = await this.scriptSyncTargets.findByIntegration(
      ctx.tenantId,
      ctx.integrationId,
      { page: 1, pageSize: TARGET_FETCH_PAGE_SIZE }
    );
    return page.items.filter((t) => !t.deletedAt);
  }

  private async findActiveVersion(
    tenantId: string,
    entityId: string
  ): Promise<number | null> {
    const active = await this.urlVersions.findActiveByEntity("AD", entityId);
    if (
      !active ||
      active.tenantId !== tenantId ||
      active.status !== "ACTIVE"
    ) {
      return null;
    }
    return active.version;
  }

  private async resolveTargetSyncStates(
    ctx: IntegrationAuthContext,
    targets: Awaited<ReturnType<DashboardQueryService["loadAllTargets"]>>
  ): Promise<import("@adlinklab/domain").ScriptSyncState[]> {
    const states: import("@adlinklab/domain").ScriptSyncState[] = [];
    for (const target of targets) {
      const activeVersion = await this.findActiveVersion(
        ctx.tenantId,
        target.entityId
      );
      states.push(
        deriveSyncState(target.appliedVersion ?? null, activeVersion)
      );
    }
    return states;
  }

  private async mapTarget(
    ctx: IntegrationAuthContext,
    target: Awaited<ReturnType<DashboardQueryService["loadAllTargets"]>>[number]
  ): Promise<DashboardTargetDto | null> {
    if (target.entityType !== "AD") return null;

    const ad = await this.ads.findByIdForTenant(ctx.tenantId, target.entityId);
    if (!ad) return null;
    const adGroup = await this.adGroups.findByIdForTenant(
      ctx.tenantId,
      ad.adGroupId
    );
    if (!adGroup) return null;

    const active = await this.urlVersions.findActiveByEntity("AD", ad.id);
    const activeForTenant =
      active &&
      active.tenantId === ctx.tenantId &&
      active.status === "ACTIVE"
        ? active
        : null;

    const desiredVersion = activeForTenant?.version ?? null;
    const syncState = deriveSyncState(
      target.appliedVersion ?? null,
      desiredVersion
    );

    const desired: DashboardDesiredUrlDto = activeForTenant
      ? {
          finalUrl: activeForTenant.finalUrl,
          finalMobileUrl: activeForTenant.finalMobileUrl ?? null,
          finalAppUrl: activeForTenant.finalAppUrl ?? null,
          trackingTemplate: activeForTenant.trackingTemplate ?? null,
          customParameters: activeForTenant.customParameters ?? {},
          version: activeForTenant.version,
          effectiveAt: activeForTenant.effectiveAt?.toISOString() ?? null,
        }
      : {
          finalUrl: null,
          finalMobileUrl: null,
          finalAppUrl: null,
          trackingTemplate: null,
          customParameters: {},
          version: null,
          effectiveAt: null,
        };

    return {
      targetId: target.id,
      entityType: "AD",
      entityId: ad.id,
      googleAdId: ad.googleAdId,
      campaignId: adGroup.campaignId,
      adGroupId: ad.adGroupId,
      desiredVersion,
      appliedVersion: target.appliedVersion ?? null,
      syncState,
      connectionHealth: target.connectionHealth,
      lastExecution: target.lastExecution ?? null,
      lastAppliedAt: target.lastSuccessAt
        ? target.lastSuccessAt.toISOString()
        : null,
      lastAttemptAt: target.lastSyncAt ? target.lastSyncAt.toISOString() : null,
      desired,
    };
  }
}
