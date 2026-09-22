/**
 * Phase 8.4.1 — In-memory repositories for Script Integration models.
 * Kept in a dedicated module to avoid further growth of repositories.ts.
 */
import type {
  Ad,
  AdGroup,
  Campaign,
  GoogleAccount,
  GoogleAdsScriptIntegration,
  GoogleAdsScriptIntegrationRepository,
  ScriptSyncLog,
  ScriptSyncLogRepository,
  ScriptSyncTarget,
  ScriptSyncTargetRepository,
  UrlEntityType,
} from "@adlinklab/domain";
import {
  assertGoogleAccountBelongsToTenant,
  assertScriptSyncTargetAdOnly,
} from "@adlinklab/domain";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type PaginationInput,
} from "@adlinklab/shared";
import { paginateArray } from "../utils.js";

function stamp(): { createdAt: Date; updatedAt: Date } {
  const now = new Date();
  return { createdAt: now, updatedAt: now };
}

function assertUnique<T>(
  items: Iterable<T>,
  predicate: (item: T) => boolean,
  message: string,
  details?: Record<string, unknown>
): void {
  if ([...items].some(predicate)) {
    throw new ConflictError(message, details);
  }
}

function findByIdForTenant<T extends { tenantId?: string }>(
  store: Map<string, T>,
  tenantId: string,
  id: string
): T | null {
  const entity = store.get(id);
  if (!entity || entity.tenantId !== tenantId) return null;
  return entity;
}

export class InMemoryGoogleAdsScriptIntegrationRepository
  implements GoogleAdsScriptIntegrationRepository
{
  constructor(
    private readonly store: Map<string, GoogleAdsScriptIntegration>,
    private readonly googleAccounts: Map<string, GoogleAccount>
  ) {}

  async create(
    data: Omit<GoogleAdsScriptIntegration, "createdAt" | "updatedAt">
  ): Promise<GoogleAdsScriptIntegration> {
    const account = this.googleAccounts.get(data.googleAccountId);
    assertGoogleAccountBelongsToTenant(
      account,
      data.tenantId,
      data.googleAccountId
    );
    assertUnique(
      this.store.values(),
      (i) => i.tokenHash === data.tokenHash,
      `Script Integration tokenHash already exists`,
      { tokenKeyId: data.tokenKeyId }
    );
    const entity: GoogleAdsScriptIntegration = {
      ...data,
      configGeneration: data.configGeneration ?? 0,
      ...stamp(),
    };
    this.store.set(entity.id, entity);
    return entity;
  }

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }

  async findByIdForTenant(tenantId: string, id: string) {
    return findByIdForTenant(this.store, tenantId, id);
  }

  async findByTenant(tenantId: string, input?: PaginationInput) {
    const items = [...this.store.values()].filter((i) => i.tenantId === tenantId);
    return paginateArray(items, input);
  }

  async findByTokenHash(tokenHash: string) {
    return (
      [...this.store.values()].find((i) => i.tokenHash === tokenHash) ?? null
    );
  }

  async update(
    id: string,
    data: Partial<
      Omit<
        GoogleAdsScriptIntegration,
        "id" | "createdAt" | "tenantId" | "tokenHash" | "tokenKeyId" | "tokenPrefix"
      >
    >
  ) {
    const existing = this.store.get(id);
    if (!existing) throw new NotFoundError("GoogleAdsScriptIntegration", id);
    if (data.googleAccountId && data.googleAccountId !== existing.googleAccountId) {
      const account = this.googleAccounts.get(data.googleAccountId);
      assertGoogleAccountBelongsToTenant(
        account,
        existing.tenantId,
        data.googleAccountId
      );
    }
    const updated: GoogleAdsScriptIntegration = {
      ...existing,
      ...data,
      updatedAt: new Date(),
    };
    this.store.set(id, updated);
    return updated;
  }

  async replaceTokenCredentials(
    id: string,
    data: {
      tokenKeyId: string;
      tokenPrefix: string;
      tokenHash: string;
    }
  ) {
    const existing = this.store.get(id);
    if (!existing) throw new NotFoundError("GoogleAdsScriptIntegration", id);
    assertUnique(
      this.store.values(),
      (i) => i.tokenHash === data.tokenHash && i.id !== id,
      `Script Integration tokenHash already exists`,
      { tokenKeyId: data.tokenKeyId }
    );
    const updated: GoogleAdsScriptIntegration = {
      ...existing,
      tokenKeyId: data.tokenKeyId,
      tokenPrefix: data.tokenPrefix,
      tokenHash: data.tokenHash,
      updatedAt: new Date(),
    };
    this.store.set(id, updated);
    return updated;
  }

  async softDelete(id: string) {
    const existing = this.store.get(id);
    if (!existing) throw new NotFoundError("GoogleAdsScriptIntegration", id);
    const now = new Date();
    const updated: GoogleAdsScriptIntegration = {
      ...existing,
      status: existing.status === "REVOKED" ? "REVOKED" : "DISABLED",
      deletedAt: now,
      updatedAt: now,
    };
    this.store.set(id, updated);
    return updated;
  }
}

export class InMemoryScriptSyncTargetRepository
  implements ScriptSyncTargetRepository
{
  constructor(
    private readonly store: Map<string, ScriptSyncTarget>,
    private readonly integrations: Map<string, GoogleAdsScriptIntegration>,
    private readonly ads: Map<string, Ad>,
    private readonly adGroups: Map<string, AdGroup>,
    private readonly campaigns: Map<string, Campaign>
  ) {}

  private resolveAdAuthority(
    tenantId: string,
    entityType: UrlEntityType,
    entityId: string,
    denormalized: {
      googleAdId?: string;
      campaignId?: string;
      adGroupId?: string;
    }
  ): {
    googleAdId?: string;
    campaignId?: string;
    adGroupId?: string;
  } {
    assertScriptSyncTargetAdOnly(entityType);
    const ad = this.ads.get(entityId);
    if (!ad || ad.tenantId !== tenantId) {
      throw new ValidationError("Ad not found for ScriptSyncTarget", {
        entityId,
        tenantId,
      });
    }
    const adGroup = this.adGroups.get(ad.adGroupId);
    const campaign =
      adGroup !== undefined ? this.campaigns.get(adGroup.campaignId) : undefined;
    return {
      googleAdId: denormalized.googleAdId ?? ad.googleAdId,
      adGroupId: denormalized.adGroupId ?? ad.adGroupId,
      campaignId: denormalized.campaignId ?? campaign?.id,
    };
  }

  async create(
    data: Omit<ScriptSyncTarget, "createdAt" | "updatedAt">
  ): Promise<ScriptSyncTarget> {
    const integration = this.integrations.get(data.integrationId);
    if (!integration || integration.tenantId !== data.tenantId) {
      throw new ValidationError(
        "Integration not found for ScriptSyncTarget tenant",
        { integrationId: data.integrationId, tenantId: data.tenantId }
      );
    }
    const resolved = this.resolveAdAuthority(
      data.tenantId,
      data.entityType,
      data.entityId,
      {
        googleAdId: data.googleAdId,
        campaignId: data.campaignId,
        adGroupId: data.adGroupId,
      }
    );
    assertUnique(
      this.store.values(),
      (t) =>
        t.tenantId === data.tenantId &&
        t.integrationId === data.integrationId &&
        t.entityType === data.entityType &&
        t.entityId === data.entityId,
      `ScriptSyncTarget already exists for integration/entity`,
      {
        tenantId: data.tenantId,
        integrationId: data.integrationId,
        entityType: data.entityType,
        entityId: data.entityId,
      }
    );
    const entity: ScriptSyncTarget = {
      ...data,
      ...resolved,
      syncState: data.syncState ?? "NEVER_APPLIED",
      connectionHealth: data.connectionHealth ?? "STALE",
      ...stamp(),
    };
    this.store.set(entity.id, entity);
    return entity;
  }

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }

  async findByIdForTenant(tenantId: string, id: string) {
    return findByIdForTenant(this.store, tenantId, id);
  }

  async findByIntegration(
    tenantId: string,
    integrationId: string,
    input?: PaginationInput
  ) {
    const items = [...this.store.values()].filter(
      (t) => t.tenantId === tenantId && t.integrationId === integrationId
    );
    return paginateArray(items, input);
  }

  async findByIntegrationAndEntity(
    tenantId: string,
    integrationId: string,
    entityType: UrlEntityType,
    entityId: string
  ) {
    return (
      [...this.store.values()].find(
        (t) =>
          t.tenantId === tenantId &&
          t.integrationId === integrationId &&
          t.entityType === entityType &&
          t.entityId === entityId
      ) ?? null
    );
  }

  async findByIdForIntegration(
    tenantId: string,
    integrationId: string,
    targetId: string
  ) {
    const target = this.store.get(targetId);
    if (
      !target ||
      target.tenantId !== tenantId ||
      target.integrationId !== integrationId ||
      target.deletedAt ||
      target.archivedAt
    ) {
      return null;
    }
    return target;
  }

  async compareAndSetAppliedVersion(input: {
    tenantId: string;
    integrationId: string;
    targetId: string;
    desiredVersion: number;
    lastExecution: ScriptSyncTarget["lastExecution"];
    syncState: ScriptSyncTarget["syncState"];
    lastSyncAt: Date;
    lastSuccessAt?: Date;
  }) {
    const existing = await this.findByIdForIntegration(
      input.tenantId,
      input.integrationId,
      input.targetId
    );
    if (!existing) throw new NotFoundError("ScriptSyncTarget", input.targetId);

    const current = existing.appliedVersion;
    if (current === input.desiredVersion) {
      const updated: ScriptSyncTarget = {
        ...existing,
        lastExecution: input.lastExecution,
        syncState: input.syncState,
        lastSyncAt: input.lastSyncAt,
        lastSuccessAt: input.lastSuccessAt ?? existing.lastSuccessAt,
        updatedAt: new Date(),
      };
      this.store.set(existing.id, updated);
      return { target: updated, updated: false };
    }

    if (current !== undefined && current > input.desiredVersion) {
      throw new ConflictError(
        "Applied version cannot move backward",
        {
          appliedVersion: current,
          desiredVersion: input.desiredVersion,
        }
      );
    }

    const updated: ScriptSyncTarget = {
      ...existing,
      appliedVersion: input.desiredVersion,
      lastExecution: input.lastExecution,
      syncState: input.syncState,
      lastSyncAt: input.lastSyncAt,
      lastSuccessAt: input.lastSuccessAt ?? existing.lastSuccessAt,
      updatedAt: new Date(),
    };
    this.store.set(existing.id, updated);
    return { target: updated, updated: true };
  }

  async update(
    id: string,
    data: Partial<
      Omit<ScriptSyncTarget, "id" | "createdAt" | "tenantId" | "integrationId">
    >
  ) {
    const existing = this.store.get(id);
    if (!existing) throw new NotFoundError("ScriptSyncTarget", id);
    if (data.entityType !== undefined || data.entityId !== undefined) {
      const entityType = data.entityType ?? existing.entityType;
      const entityId = data.entityId ?? existing.entityId;
      this.resolveAdAuthority(existing.tenantId, entityType, entityId, {
        googleAdId: data.googleAdId ?? existing.googleAdId,
        campaignId: data.campaignId ?? existing.campaignId,
        adGroupId: data.adGroupId ?? existing.adGroupId,
      });
    }
    // Phase 9.5 — desiredVersion is non-authority; updates cannot change Desired State.
    const { desiredVersion: _ignoredDesired, ...rest } = data;
    void _ignoredDesired;
    const updated: ScriptSyncTarget = {
      ...existing,
      ...rest,
      desiredVersion: existing.desiredVersion,
      updatedAt: new Date(),
    };
    this.store.set(id, updated);
    return updated;
  }
}

export class InMemoryScriptSyncLogRepository implements ScriptSyncLogRepository {
  constructor(private readonly store: Map<string, ScriptSyncLog>) {}

  async create(
    data: Omit<ScriptSyncLog, "createdAt"> & { createdAt?: Date }
  ): Promise<ScriptSyncLog> {
    const scope = data.idempotencyScope ?? "SCRIPT_SYNC_RESULT";
    assertUnique(
      this.store.values(),
      (l) =>
        l.tenantId === data.tenantId &&
        l.idempotencyScope === scope &&
        l.idempotencyKey === data.idempotencyKey,
      `ScriptSyncLog idempotency key already exists`,
      {
        tenantId: data.tenantId,
        idempotencyScope: scope,
        idempotencyKey: data.idempotencyKey,
      }
    );
    const entity: ScriptSyncLog = {
      ...data,
      idempotencyScope: scope,
      createdAt: data.createdAt ?? new Date(),
    };
    this.store.set(entity.id, entity);
    return entity;
  }

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }

  async findByIdForTenant(tenantId: string, id: string) {
    return findByIdForTenant(this.store, tenantId, id);
  }

  async findByIntegration(
    tenantId: string,
    integrationId: string,
    input?: PaginationInput
  ) {
    const items = [...this.store.values()]
      .filter(
        (l) => l.tenantId === tenantId && l.integrationId === integrationId
      )
      .sort((a, b) => {
        const dt = b.createdAt.getTime() - a.createdAt.getTime();
        if (dt !== 0) return dt;
        return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
      });
    return paginateArray(items, input);
  }

  async findByTarget(
    tenantId: string,
    targetId: string,
    input?: PaginationInput
  ) {
    const items = [...this.store.values()]
      .filter((l) => l.tenantId === tenantId && l.targetId === targetId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return paginateArray(items, input);
  }

  async findByIdempotencyKey(
    tenantId: string,
    scope: string,
    idempotencyKey: string
  ) {
    return (
      [...this.store.values()].find(
        (l) =>
          l.tenantId === tenantId &&
          l.idempotencyScope === scope &&
          l.idempotencyKey === idempotencyKey
      ) ?? null
    );
  }
}
