/**
 * Phase 8.4.3 / 9.5 — Script Config API (READ ONLY).
 * Desired Authority: ACTIVE UrlVersion per Ad (sole source).
 * ScriptSyncTarget.desiredVersion is never read as authority (projection/cache only).
 * Ad is authority for Google external IDs — not Target cache.
 * Config does not write Desired state or mutate UrlVersion / Target / SyncLog.
 */
import type {
  AdGroupRepository,
  AdRepository,
  GoogleAdsScriptIntegrationRepository,
  ScriptSyncTarget,
  ScriptSyncTargetRepository,
  UrlVersionRepository,
} from "@adlinklab/domain";
import {
  assertScriptSyncTargetAdOnly,
  deriveSyncState,
} from "@adlinklab/domain";
import { NotFoundError } from "@adlinklab/shared";
import type { IntegrationAuthContext } from "../auth/integration-auth.js";

export type ScriptConfigTargetState = "CONFIGURED" | "NEVER_CONFIGURED";

export interface ScriptConfigTargetDto {
  targetId: string;
  entityType: "AD";
  entityId: string;
  googleAdId: string;
  campaignId: string;
  adGroupId: string;
  desiredVersion: number | null;
  appliedVersion: number | null;
  configurationState: ScriptConfigTargetState;
  finalUrl: string | null;
  finalMobileUrl: string | null;
  finalAppUrl: string | null;
  trackingTemplate: string | null;
  customParameters: Record<string, string>;
  effectiveAt: string | null;
  syncState: string;
  connectionHealth: string;
  lastExecution: string | null;
}

export interface ScriptConfigResponse {
  integration: {
    id: string;
    configGeneration: number;
  };
  configGeneration: number;
  targets: ScriptConfigTargetDto[];
}

export class ScriptConfigService {
  constructor(
    private readonly scriptIntegrations: GoogleAdsScriptIntegrationRepository,
    private readonly scriptSyncTargets: ScriptSyncTargetRepository,
    private readonly ads: AdRepository,
    private readonly adGroups: AdGroupRepository,
    private readonly urlVersions: UrlVersionRepository
  ) {}

  /**
   * Build read-only config for authenticated Integration.
   * Does not mutate UrlVersion, Target, SyncLog, SyncJob, or UCR.
   */
  async getConfig(ctx: IntegrationAuthContext): Promise<ScriptConfigResponse> {
    const integration = await this.scriptIntegrations.findByIdForTenant(
      ctx.tenantId,
      ctx.integrationId
    );
    if (!integration || integration.googleAccountId !== ctx.googleAccountId) {
      throw new NotFoundError("GoogleAdsScriptIntegration", ctx.integrationId);
    }

    const page = await this.scriptSyncTargets.findByIntegration(
      ctx.tenantId,
      ctx.integrationId,
      { page: 1, pageSize: 500 }
    );

    const eligible = page.items
      .filter(
        (t) =>
          t.integrationId === ctx.integrationId &&
          t.tenantId === ctx.tenantId &&
          !t.deletedAt &&
          t.entityType === "AD"
      )
      .sort((a, b) => a.id.localeCompare(b.id));

    const targets: ScriptConfigTargetDto[] = [];
    for (const target of eligible) {
      try {
        assertScriptSyncTargetAdOnly(target.entityType);
      } catch {
        continue;
      }
      const dto = await this.buildTargetDto(ctx.tenantId, target);
      if (dto) targets.push(dto);
    }

    return {
      integration: {
        id: integration.id,
        configGeneration: integration.configGeneration,
      },
      configGeneration: integration.configGeneration,
      targets,
    };
  }

  private async buildTargetDto(
    tenantId: string,
    target: ScriptSyncTarget
  ): Promise<ScriptConfigTargetDto | null> {
    const ad = await this.ads.findByIdForTenant(tenantId, target.entityId);
    if (!ad) return null;

    const adGroup = await this.adGroups.findByIdForTenant(tenantId, ad.adGroupId);
    if (!adGroup) return null;

    const active = await this.urlVersions.findActiveByEntity("AD", ad.id);
    const activeForTenant =
      active && active.tenantId === tenantId && active.status === "ACTIVE"
        ? active
        : null;

    const appliedVersion = target.appliedVersion ?? null;
    const desiredVersion = activeForTenant?.version ?? null;
    // Phase 9.5 — syncState derived from ACTIVE + applied; never from target shadow desired.
    const syncState = deriveSyncState(appliedVersion, desiredVersion);

    if (activeForTenant) {
      return {
        targetId: target.id,
        entityType: "AD",
        entityId: ad.id,
        googleAdId: ad.googleAdId,
        campaignId: adGroup.campaignId,
        adGroupId: ad.adGroupId,
        desiredVersion,
        appliedVersion,
        configurationState: "CONFIGURED",
        finalUrl: activeForTenant.finalUrl,
        finalMobileUrl: activeForTenant.finalMobileUrl ?? null,
        finalAppUrl: activeForTenant.finalAppUrl ?? null,
        trackingTemplate: activeForTenant.trackingTemplate ?? null,
        customParameters: activeForTenant.customParameters ?? {},
        effectiveAt: activeForTenant.effectiveAt?.toISOString() ?? null,
        syncState,
        connectionHealth: target.connectionHealth,
        lastExecution: target.lastExecution ?? null,
      };
    }

    return {
      targetId: target.id,
      entityType: "AD",
      entityId: ad.id,
      googleAdId: ad.googleAdId,
      campaignId: adGroup.campaignId,
      adGroupId: ad.adGroupId,
      desiredVersion: null,
      appliedVersion,
      configurationState: "NEVER_CONFIGURED",
      finalUrl: null,
      finalMobileUrl: null,
      finalAppUrl: null,
      trackingTemplate: null,
      customParameters: {},
      effectiveAt: null,
      syncState,
      connectionHealth: target.connectionHealth,
      lastExecution: target.lastExecution ?? null,
    };
  }
}
