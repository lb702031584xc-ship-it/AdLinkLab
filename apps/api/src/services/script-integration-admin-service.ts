/**
 * Phase 8.4.9 — Script Integration Admin service (Tenant API Key auth).
 * Reuses ScriptIntegrationService + existing repos. Never returns plaintext
 * token except create/rotate/generate responses. Never returns tokenHash.
 */
import { randomUUID } from "node:crypto";
import type {
  AdRepository,
  AdGroupRepository,
  CampaignRepository,
  GoogleAdsScriptIntegration,
  GoogleAdsScriptIntegrationRepository,
  ScriptSyncTarget,
  ScriptSyncTargetRepository,
  UrlVersionRepository,
} from "@adlinklab/domain";
import {
  assertScriptSyncTargetAdOnly,
  AuditActions,
  deriveSyncState,
} from "@adlinklab/domain";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@adlinklab/shared";
import {
  assertIntegrationTokenPepperConfigured,
  hashIntegrationToken,
} from "../auth/integration-token-crypto.js";
import type { IntegrationAuthContext } from "../auth/integration-auth.js";
import type { ScriptIntegrationService } from "./script-integration-service.js";
import type { ScriptGeneratorService } from "./script-generator-service.js";
import type { AuditService } from "./index.js";

export interface AdminIntegrationDto {
  integrationId: string;
  name: string;
  status: string;
  googleAccountId: string;
  tokenPrefix: string;
  tokenStatus: "ACTIVE" | "DISABLED" | "REVOKED";
  configGeneration: number;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  targetCount: number;
}

export interface AdminTargetDto {
  targetId: string;
  entityType: "AD";
  entityId: string;
  googleAdId: string | null;
  campaignId: string | null;
  adGroupId: string | null;
  desiredVersion: number | null;
  appliedVersion: number | null;
  syncState: string;
  connectionHealth: string;
  lastExecution: string | null;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  desiredFinalUrl: string | null;
}

function toAdminIntegrationDto(
  integration: GoogleAdsScriptIntegration,
  targetCount: number
): AdminIntegrationDto {
  return {
    integrationId: integration.id,
    name: integration.name,
    status: integration.status,
    googleAccountId: integration.googleAccountId,
    tokenPrefix: integration.tokenPrefix,
    tokenStatus: integration.status,
    configGeneration: integration.configGeneration,
    lastSeenAt: integration.lastSeenAt
      ? integration.lastSeenAt.toISOString()
      : null,
    createdAt: integration.createdAt.toISOString(),
    updatedAt: integration.updatedAt.toISOString(),
    targetCount,
  };
}

export class ScriptIntegrationAdminService {
  constructor(
    private readonly lifecycle: ScriptIntegrationService,
    private readonly scriptIntegrations: GoogleAdsScriptIntegrationRepository,
    private readonly scriptSyncTargets: ScriptSyncTargetRepository,
    private readonly ads: AdRepository,
    private readonly adGroups: AdGroupRepository,
    private readonly campaigns: CampaignRepository,
    private readonly urlVersions: UrlVersionRepository,
    private readonly scriptGenerator: ScriptGeneratorService,
    private readonly audit?: AuditService,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  async list(
    tenantId: string,
    page = 1,
    pageSize = 50
  ): Promise<{ items: AdminIntegrationDto[]; page: number; pageSize: number; total: number }> {
    const result = await this.scriptIntegrations.findByTenant(tenantId, {
      page,
      pageSize,
    });
    const items: AdminIntegrationDto[] = [];
    for (const integration of result.items) {
      if (integration.deletedAt) continue;
      const targets = await this.scriptSyncTargets.findByIntegration(
        tenantId,
        integration.id,
        { page: 1, pageSize: 1 }
      );
      items.push(toAdminIntegrationDto(integration, targets.total));
    }
    return {
      items,
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    };
  }

  async get(
    tenantId: string,
    integrationId: string
  ): Promise<AdminIntegrationDto> {
    const integration = await this.requireIntegration(tenantId, integrationId);
    const targets = await this.scriptSyncTargets.findByIntegration(
      tenantId,
      integration.id,
      { page: 1, pageSize: 1 }
    );
    return toAdminIntegrationDto(integration, targets.total);
  }

  async create(
    tenantId: string,
    input: { name: string; googleAccountId: string }
  ): Promise<{
    integrationId: string;
    name: string;
    status: string;
    googleAccountId: string;
    tokenPrefix: string;
    token: string;
  }> {
    if (!input.name?.trim()) {
      throw new ValidationError("name is required");
    }
    if (!input.googleAccountId?.trim()) {
      throw new ValidationError("googleAccountId is required");
    }
    const { integration, token } = await this.lifecycle.create({
      tenantId,
      name: input.name,
      googleAccountId: input.googleAccountId,
    });
    return {
      integrationId: integration.id,
      name: integration.name,
      status: integration.status,
      googleAccountId: integration.googleAccountId,
      tokenPrefix: integration.tokenPrefix,
      token,
    };
  }

  async rotateToken(
    tenantId: string,
    integrationId: string
  ): Promise<{ integrationId: string; tokenPrefix: string; token: string }> {
    const { integration, token } = await this.lifecycle.rotateToken(
      tenantId,
      integrationId
    );
    return {
      integrationId: integration.id,
      tokenPrefix: integration.tokenPrefix,
      token,
    };
  }

  async revoke(tenantId: string, integrationId: string) {
    const integration = await this.lifecycle.revoke(tenantId, integrationId);
    return toAdminIntegrationDto(integration, 0);
  }

  async disable(tenantId: string, integrationId: string) {
    const integration = await this.lifecycle.disable(tenantId, integrationId);
    const targets = await this.scriptSyncTargets.findByIntegration(
      tenantId,
      integration.id,
      { page: 1, pageSize: 1 }
    );
    return toAdminIntegrationDto(integration, targets.total);
  }

  async enable(tenantId: string, integrationId: string) {
    const integration = await this.lifecycle.enable(tenantId, integrationId);
    const targets = await this.scriptSyncTargets.findByIntegration(
      tenantId,
      integration.id,
      { page: 1, pageSize: 1 }
    );
    return toAdminIntegrationDto(integration, targets.total);
  }

  async listTargets(
    tenantId: string,
    integrationId: string,
    page = 1,
    pageSize = 50
  ): Promise<{
    items: AdminTargetDto[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    await this.requireIntegration(tenantId, integrationId);
    const result = await this.scriptSyncTargets.findByIntegration(
      tenantId,
      integrationId,
      { page, pageSize }
    );
    const items: AdminTargetDto[] = [];
    for (const target of result.items) {
      if (target.deletedAt || target.archivedAt) continue;
      items.push(await this.toAdminTargetDto(tenantId, target));
    }
    return {
      items,
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    };
  }

  async attachTarget(
    tenantId: string,
    integrationId: string,
    input: { entityType: string; entityId: string }
  ): Promise<AdminTargetDto> {
    const integration = await this.requireIntegration(tenantId, integrationId);
    if (integration.status === "REVOKED") {
      throw new ValidationError("Cannot attach targets to REVOKED Integration");
    }
    if (input.entityType !== "AD") {
      throw new ValidationError("ScriptSyncTarget entityType must be AD");
    }
    assertScriptSyncTargetAdOnly("AD");

    const ad = await this.ads.findByIdForTenant(tenantId, input.entityId);
    if (!ad || ad.deletedAt) {
      throw new NotFoundError("Ad", input.entityId);
    }

    const adGroup = await this.adGroups.findByIdForTenant(
      tenantId,
      ad.adGroupId
    );
    if (!adGroup) {
      throw new NotFoundError("AdGroup", ad.adGroupId);
    }
    const campaign = await this.campaigns.findByIdForTenant(
      tenantId,
      adGroup.campaignId
    );
    if (!campaign) {
      throw new NotFoundError("Campaign", adGroup.campaignId);
    }
    if (campaign.googleAccountId !== integration.googleAccountId) {
      throw new ForbiddenError(
        "Ad does not belong to the Integration Google Account",
        {
          integrationGoogleAccountId: integration.googleAccountId,
          adGoogleAccountId: campaign.googleAccountId,
        }
      );
    }

    const existing = await this.scriptSyncTargets.findByIntegrationAndEntity(
      tenantId,
      integrationId,
      "AD",
      ad.id
    );
    if (existing && !existing.deletedAt && !existing.archivedAt) {
      throw new ConflictError("ScriptSyncTarget already attached", {
        targetId: existing.id,
        entityId: ad.id,
      });
    }

    let target: ScriptSyncTarget;
    if (existing && (existing.deletedAt || existing.archivedAt)) {
      target = await this.scriptSyncTargets.update(existing.id, {
        // Clear soft-delete (Prisma accepts null; memory clears via undefined/null)
        deletedAt: null as unknown as undefined,
        archivedAt: null as unknown as undefined,
        googleAdId: ad.googleAdId,
        campaignId: campaign.id,
        adGroupId: adGroup.id,
        syncState:
          existing.appliedVersion == null ? "NEVER_APPLIED" : "OUT_OF_SYNC",
        connectionHealth: "STALE",
      });
    } else {
      target = await this.scriptSyncTargets.create({
        id: randomUUID(),
        tenantId,
        integrationId,
        entityType: "AD",
        entityId: ad.id,
        syncState: "NEVER_APPLIED",
        connectionHealth: "STALE",
      });
    }

    await this.audit?.record({
      action: AuditActions.SCRIPT_SYNC_TARGET_ATTACHED,
      tenantId,
      entityType: "ScriptSyncTarget",
      entityId: target.id,
      after: {
        integrationId,
        entityType: "AD",
        entityId: ad.id,
        googleAdId: target.googleAdId,
      },
    });

    return this.toAdminTargetDto(tenantId, target);
  }

  async detachTarget(
    tenantId: string,
    integrationId: string,
    targetId: string
  ): Promise<{ ok: true; targetId: string }> {
    await this.requireIntegration(tenantId, integrationId);
    const target = await this.scriptSyncTargets.findByIdForIntegration(
      tenantId,
      integrationId,
      targetId
    );
    if (!target) {
      throw new NotFoundError("ScriptSyncTarget", targetId);
    }

    await this.scriptSyncTargets.update(targetId, {
      deletedAt: new Date(),
      connectionHealth: "DISABLED",
    });

    await this.audit?.record({
      action: AuditActions.SCRIPT_SYNC_TARGET_DETACHED,
      tenantId,
      entityType: "ScriptSyncTarget",
      entityId: targetId,
      after: {
        integrationId,
        entityId: target.entityId,
      },
    });

    return { ok: true, targetId };
  }

  /**
   * Generate Script using operator-supplied plaintext token (shown at create/rotate).
   * Validates token hash matches this Integration — does not change Generator semantics.
   */
  async generateScript(
    tenantId: string,
    integrationId: string,
    input: { token: string; baseUrl?: string }
  ) {
    const integration = await this.requireIntegration(tenantId, integrationId);
    if (integration.status !== "ACTIVE") {
      throw new ValidationError(
        "Script can only be generated for ACTIVE Integrations"
      );
    }
    if (!input.token?.trim()) {
      throw new ValidationError("token is required to generate Script source");
    }

    const pepper = assertIntegrationTokenPepperConfigured(this.env);
    const tokenHash = hashIntegrationToken(input.token.trim(), pepper);
    const byHash = await this.scriptIntegrations.findByTokenHash(tokenHash);
    if (
      !byHash ||
      byHash.id !== integration.id ||
      byHash.tenantId !== tenantId
    ) {
      throw new ForbiddenError(
        "token does not match this Integration or is invalid"
      );
    }

    const ctx: IntegrationAuthContext = {
      tenantId: integration.tenantId,
      integrationId: integration.id,
      googleAccountId: integration.googleAccountId,
      tokenKeyId: integration.tokenKeyId,
    };

    return this.scriptGenerator.generate(ctx, input.token.trim(), {
      baseUrl: input.baseUrl,
      token: input.token.trim(),
    });
  }

  private async requireIntegration(
    tenantId: string,
    integrationId: string
  ): Promise<GoogleAdsScriptIntegration> {
    const integration = await this.scriptIntegrations.findByIdForTenant(
      tenantId,
      integrationId
    );
    if (!integration || integration.deletedAt) {
      throw new NotFoundError("GoogleAdsScriptIntegration", integrationId);
    }
    return integration;
  }

  private async toAdminTargetDto(
    tenantId: string,
    target: ScriptSyncTarget
  ): Promise<AdminTargetDto> {
    const active = await this.urlVersions.findActiveByEntity(
      "AD",
      target.entityId
    );
    const activeForTenant =
      active && active.tenantId === tenantId && active.status === "ACTIVE"
        ? active
        : null;
    const desiredVersion = activeForTenant?.version ?? null;
    const appliedVersion = target.appliedVersion ?? null;
    return {
      targetId: target.id,
      entityType: "AD",
      entityId: target.entityId,
      googleAdId: target.googleAdId ?? null,
      campaignId: target.campaignId ?? null,
      adGroupId: target.adGroupId ?? null,
      desiredVersion,
      appliedVersion,
      syncState: deriveSyncState(appliedVersion, desiredVersion),
      connectionHealth: target.connectionHealth,
      lastExecution: target.lastExecution ?? null,
      lastSyncAt: target.lastSyncAt ? target.lastSyncAt.toISOString() : null,
      lastSuccessAt: target.lastSuccessAt
        ? target.lastSuccessAt.toISOString()
        : null,
      desiredFinalUrl: activeForTenant?.finalUrl ?? null,
    };
  }
}
