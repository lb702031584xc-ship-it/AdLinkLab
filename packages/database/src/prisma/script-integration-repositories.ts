/**
 * Phase 8.4.1 — Prisma repositories for Script Integration models.
 */
import type {
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
  createPaginatedResult,
  type PaginationInput,
} from "@adlinklab/shared";
import type { PrismaClient } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";
import { normalizePagination } from "../utils.js";

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function rethrowUniqueAsConflict(error: unknown, message: string): never {
  if (isUniqueViolation(error)) {
    throw new ConflictError(message, {
      prismaCode: "P2002",
      meta: (error as PrismaNamespace.PrismaClientKnownRequestError).meta,
    });
  }
  throw error;
}

function toIntegration(row: {
  id: string;
  tenantId: string;
  googleAccountId: string;
  name: string;
  status: string;
  tokenKeyId: string;
  tokenPrefix: string;
  tokenHash: string;
  configGeneration: number;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  deletedAt: Date | null;
}): GoogleAdsScriptIntegration {
  return {
    id: row.id,
    tenantId: row.tenantId,
    googleAccountId: row.googleAccountId,
    name: row.name,
    status: row.status as GoogleAdsScriptIntegration["status"],
    tokenKeyId: row.tokenKeyId,
    tokenPrefix: row.tokenPrefix,
    tokenHash: row.tokenHash,
    configGeneration: row.configGeneration,
    lastSeenAt: row.lastSeenAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt ?? undefined,
    deletedAt: row.deletedAt ?? undefined,
  };
}

function toTarget(row: {
  id: string;
  tenantId: string;
  integrationId: string;
  entityType: string;
  entityId: string;
  googleAdId: string | null;
  campaignId: string | null;
  adGroupId: string | null;
  desiredVersion: number | null;
  appliedVersion: number | null;
  lastSyncAt: Date | null;
  lastSuccessAt: Date | null;
  syncState: string;
  connectionHealth: string;
  lastExecution: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  deletedAt: Date | null;
}): ScriptSyncTarget {
  return {
    id: row.id,
    tenantId: row.tenantId,
    integrationId: row.integrationId,
    entityType: row.entityType as UrlEntityType,
    entityId: row.entityId,
    googleAdId: row.googleAdId ?? undefined,
    campaignId: row.campaignId ?? undefined,
    adGroupId: row.adGroupId ?? undefined,
    desiredVersion: row.desiredVersion ?? undefined,
    appliedVersion: row.appliedVersion ?? undefined,
    lastSyncAt: row.lastSyncAt ?? undefined,
    lastSuccessAt: row.lastSuccessAt ?? undefined,
    syncState: row.syncState as ScriptSyncTarget["syncState"],
    connectionHealth: row.connectionHealth as ScriptSyncTarget["connectionHealth"],
    lastExecution: (row.lastExecution ?? undefined) as
      | ScriptSyncTarget["lastExecution"]
      | undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt ?? undefined,
    deletedAt: row.deletedAt ?? undefined,
  };
}

function toLog(row: {
  id: string;
  tenantId: string;
  integrationId: string;
  targetId: string;
  desiredVersion: number;
  reportedAppliedVersion: number | null;
  result: string;
  errorCode: string | null;
  errorMessage: string | null;
  requestId: string | null;
  idempotencyScope: string;
  idempotencyKey: string;
  createdAt: Date;
}): ScriptSyncLog {
  return {
    id: row.id,
    tenantId: row.tenantId,
    integrationId: row.integrationId,
    targetId: row.targetId,
    desiredVersion: row.desiredVersion,
    reportedAppliedVersion: row.reportedAppliedVersion ?? undefined,
    result: row.result as ScriptSyncLog["result"],
    errorCode: row.errorCode ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    requestId: row.requestId ?? undefined,
    idempotencyScope: row.idempotencyScope,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
  };
}

export class PrismaGoogleAdsScriptIntegrationRepository
  implements GoogleAdsScriptIntegrationRepository
{
  constructor(private readonly db: PrismaClient) {}

  async create(
    data: Omit<GoogleAdsScriptIntegration, "createdAt" | "updatedAt">
  ) {
    const account = await this.db.googleAccount.findUnique({
      where: { id: data.googleAccountId },
    });
    assertGoogleAccountBelongsToTenant(
      account ? { id: account.id, tenantId: account.tenantId } : null,
      data.tenantId,
      data.googleAccountId
    );
    try {
      return toIntegration(
        await this.db.googleAdsScriptIntegration.create({
          data: {
            id: data.id,
            tenantId: data.tenantId,
            googleAccountId: data.googleAccountId,
            name: data.name,
            status: data.status,
            tokenKeyId: data.tokenKeyId,
            tokenPrefix: data.tokenPrefix,
            tokenHash: data.tokenHash,
            configGeneration: data.configGeneration ?? 0,
            lastSeenAt: data.lastSeenAt ?? null,
            archivedAt: data.archivedAt ?? null,
            deletedAt: data.deletedAt ?? null,
          },
        })
      );
    } catch (error) {
      rethrowUniqueAsConflict(error, "Script Integration tokenHash already exists");
    }
  }

  async findById(id: string) {
    const row = await this.db.googleAdsScriptIntegration.findUnique({
      where: { id },
    });
    return row ? toIntegration(row) : null;
  }

  async findByIdForTenant(tenantId: string, id: string) {
    const row = await this.db.googleAdsScriptIntegration.findFirst({
      where: { id, tenantId },
    });
    return row ? toIntegration(row) : null;
  }

  async findByTenant(tenantId: string, input?: PaginationInput) {
    const { page, pageSize, skip } = normalizePagination(input);
    const where = { tenantId };
    const [items, total] = await Promise.all([
      this.db.googleAdsScriptIntegration.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
      this.db.googleAdsScriptIntegration.count({ where }),
    ]);
    return createPaginatedResult(items.map(toIntegration), total, page, pageSize);
  }

  async findByTokenHash(tokenHash: string) {
    const row = await this.db.googleAdsScriptIntegration.findUnique({
      where: { tokenHash },
    });
    return row ? toIntegration(row) : null;
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
    const existing = await this.findById(id);
    if (!existing) throw new NotFoundError("GoogleAdsScriptIntegration", id);
    if (data.googleAccountId && data.googleAccountId !== existing.googleAccountId) {
      const account = await this.db.googleAccount.findUnique({
        where: { id: data.googleAccountId },
      });
      assertGoogleAccountBelongsToTenant(
        account ? { id: account.id, tenantId: account.tenantId } : null,
        existing.tenantId,
        data.googleAccountId
      );
    }
    try {
      return toIntegration(
        await this.db.googleAdsScriptIntegration.update({
          where: { id },
          data: {
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.status !== undefined ? { status: data.status } : {}),
            ...(data.googleAccountId !== undefined
              ? { googleAccountId: data.googleAccountId }
              : {}),
            ...(data.configGeneration !== undefined
              ? { configGeneration: data.configGeneration }
              : {}),
            ...(data.lastSeenAt !== undefined
              ? { lastSeenAt: data.lastSeenAt ?? null }
              : {}),
            ...(data.archivedAt !== undefined
              ? { archivedAt: data.archivedAt ?? null }
              : {}),
            ...(data.deletedAt !== undefined
              ? { deletedAt: data.deletedAt ?? null }
              : {}),
          },
        })
      );
    } catch {
      throw new NotFoundError("GoogleAdsScriptIntegration", id);
    }
  }

  async softDelete(id: string) {
    const existing = await this.findById(id);
    if (!existing) throw new NotFoundError("GoogleAdsScriptIntegration", id);
    return toIntegration(
      await this.db.googleAdsScriptIntegration.update({
        where: { id },
        data: {
          status: existing.status === "REVOKED" ? "REVOKED" : "DISABLED",
          deletedAt: new Date(),
        },
      })
    );
  }

  async replaceTokenCredentials(
    id: string,
    data: {
      tokenKeyId: string;
      tokenPrefix: string;
      tokenHash: string;
    }
  ) {
    const existing = await this.findById(id);
    if (!existing) throw new NotFoundError("GoogleAdsScriptIntegration", id);
    try {
      return toIntegration(
        await this.db.googleAdsScriptIntegration.update({
          where: { id },
          data: {
            tokenKeyId: data.tokenKeyId,
            tokenPrefix: data.tokenPrefix,
            tokenHash: data.tokenHash,
          },
        })
      );
    } catch (error) {
      rethrowUniqueAsConflict(error, "Script Integration tokenHash already exists");
    }
  }
}

export class PrismaScriptSyncTargetRepository
  implements ScriptSyncTargetRepository
{
  constructor(private readonly db: PrismaClient) {}

  private async resolveAdAuthority(
    tenantId: string,
    entityType: UrlEntityType,
    entityId: string,
    denormalized: {
      googleAdId?: string;
      campaignId?: string;
      adGroupId?: string;
    }
  ) {
    assertScriptSyncTargetAdOnly(entityType);
    const ad = await this.db.ad.findFirst({ where: { id: entityId, tenantId } });
    if (!ad) {
      throw new ValidationError("Ad not found for ScriptSyncTarget", {
        entityId,
        tenantId,
      });
    }
    const adGroup = await this.db.adGroup.findUnique({
      where: { id: ad.adGroupId },
    });
    return {
      googleAdId: denormalized.googleAdId ?? ad.googleAdId,
      adGroupId: denormalized.adGroupId ?? ad.adGroupId,
      campaignId: denormalized.campaignId ?? adGroup?.campaignId,
    };
  }

  async create(data: Omit<ScriptSyncTarget, "createdAt" | "updatedAt">) {
    const integration = await this.db.googleAdsScriptIntegration.findFirst({
      where: { id: data.integrationId, tenantId: data.tenantId },
    });
    if (!integration) {
      throw new ValidationError(
        "Integration not found for ScriptSyncTarget tenant",
        { integrationId: data.integrationId, tenantId: data.tenantId }
      );
    }
    const resolved = await this.resolveAdAuthority(
      data.tenantId,
      data.entityType,
      data.entityId,
      {
        googleAdId: data.googleAdId,
        campaignId: data.campaignId,
        adGroupId: data.adGroupId,
      }
    );
    try {
      return toTarget(
        await this.db.scriptSyncTarget.create({
          data: {
            id: data.id,
            tenantId: data.tenantId,
            integrationId: data.integrationId,
            entityType: data.entityType,
            entityId: data.entityId,
            googleAdId: resolved.googleAdId ?? null,
            campaignId: resolved.campaignId ?? null,
            adGroupId: resolved.adGroupId ?? null,
            desiredVersion: data.desiredVersion ?? null,
            appliedVersion: data.appliedVersion ?? null,
            lastSyncAt: data.lastSyncAt ?? null,
            lastSuccessAt: data.lastSuccessAt ?? null,
            syncState: data.syncState ?? "NEVER_APPLIED",
            connectionHealth: data.connectionHealth ?? "STALE",
            lastExecution: data.lastExecution ?? null,
            archivedAt: data.archivedAt ?? null,
            deletedAt: data.deletedAt ?? null,
          },
        })
      );
    } catch (error) {
      rethrowUniqueAsConflict(
        error,
        "ScriptSyncTarget already exists for integration/entity"
      );
    }
  }

  async findById(id: string) {
    const row = await this.db.scriptSyncTarget.findUnique({ where: { id } });
    return row ? toTarget(row) : null;
  }

  async findByIdForTenant(tenantId: string, id: string) {
    const row = await this.db.scriptSyncTarget.findFirst({
      where: { id, tenantId },
    });
    return row ? toTarget(row) : null;
  }

  async findByIntegration(
    tenantId: string,
    integrationId: string,
    input?: PaginationInput
  ) {
    const { page, pageSize, skip } = normalizePagination(input);
    const where = { tenantId, integrationId };
    const [items, total] = await Promise.all([
      this.db.scriptSyncTarget.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
      this.db.scriptSyncTarget.count({ where }),
    ]);
    return createPaginatedResult(items.map(toTarget), total, page, pageSize);
  }

  async findByIntegrationAndEntity(
    tenantId: string,
    integrationId: string,
    entityType: UrlEntityType,
    entityId: string
  ) {
    const row = await this.db.scriptSyncTarget.findUnique({
      where: {
        tenantId_integrationId_entityType_entityId: {
          tenantId,
          integrationId,
          entityType,
          entityId,
        },
      },
    });
    return row ? toTarget(row) : null;
  }

  async findByIdForIntegration(
    tenantId: string,
    integrationId: string,
    targetId: string
  ) {
    const row = await this.db.scriptSyncTarget.findFirst({
      where: {
        id: targetId,
        tenantId,
        integrationId,
        deletedAt: null,
        archivedAt: null,
      },
    });
    return row ? toTarget(row) : null;
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

    if (existing.appliedVersion === input.desiredVersion) {
      const target = toTarget(
        await this.db.scriptSyncTarget.update({
          where: { id: input.targetId },
          data: {
            lastExecution: input.lastExecution ?? null,
            syncState: input.syncState,
            lastSyncAt: input.lastSyncAt,
            ...(input.lastSuccessAt !== undefined
              ? { lastSuccessAt: input.lastSuccessAt }
              : {}),
          },
        })
      );
      return { target, updated: false };
    }

    if (
      existing.appliedVersion !== undefined &&
      existing.appliedVersion !== null &&
      existing.appliedVersion > input.desiredVersion
    ) {
      throw new ConflictError("Applied version cannot move backward", {
        appliedVersion: existing.appliedVersion,
        desiredVersion: input.desiredVersion,
      });
    }

    const result = await this.db.scriptSyncTarget.updateMany({
      where: {
        id: input.targetId,
        tenantId: input.tenantId,
        integrationId: input.integrationId,
        entityType: "AD",
        deletedAt: null,
        archivedAt: null,
        OR: [
          { appliedVersion: null },
          { appliedVersion: { lt: input.desiredVersion } },
        ],
      },
      data: {
        appliedVersion: input.desiredVersion,
        lastExecution: input.lastExecution ?? null,
        syncState: input.syncState,
        lastSyncAt: input.lastSyncAt,
        ...(input.lastSuccessAt !== undefined
          ? { lastSuccessAt: input.lastSuccessAt }
          : {}),
      },
    });

    if (result.count === 0) {
      const current = await this.findById(input.targetId);
      if (current?.appliedVersion === input.desiredVersion) {
        return { target: current, updated: false };
      }
      throw new ConflictError("Concurrent ScriptSyncTarget update conflict", {
        targetId: input.targetId,
      });
    }

    const target = await this.findById(input.targetId);
    if (!target) throw new NotFoundError("ScriptSyncTarget", input.targetId);
    return { target, updated: true };
  }

  async update(
    id: string,
    data: Partial<
      Omit<ScriptSyncTarget, "id" | "createdAt" | "tenantId" | "integrationId">
    >
  ) {
    const existing = await this.findById(id);
    if (!existing) throw new NotFoundError("ScriptSyncTarget", id);
    if (data.entityType !== undefined || data.entityId !== undefined) {
      await this.resolveAdAuthority(
        existing.tenantId,
        data.entityType ?? existing.entityType,
        data.entityId ?? existing.entityId,
        {
          googleAdId: data.googleAdId ?? existing.googleAdId,
          campaignId: data.campaignId ?? existing.campaignId,
          adGroupId: data.adGroupId ?? existing.adGroupId,
        }
      );
    }
    try {
      return toTarget(
        await this.db.scriptSyncTarget.update({
          where: { id },
          data: {
            ...(data.entityType !== undefined ? { entityType: data.entityType } : {}),
            ...(data.entityId !== undefined ? { entityId: data.entityId } : {}),
            ...(data.googleAdId !== undefined
              ? { googleAdId: data.googleAdId ?? null }
              : {}),
            ...(data.campaignId !== undefined
              ? { campaignId: data.campaignId ?? null }
              : {}),
            ...(data.adGroupId !== undefined
              ? { adGroupId: data.adGroupId ?? null }
              : {}),
            // Phase 9.5 — desiredVersion column is non-authority; ignore update writes.
            ...(data.appliedVersion !== undefined
              ? { appliedVersion: data.appliedVersion ?? null }
              : {}),
            ...(data.lastSyncAt !== undefined
              ? { lastSyncAt: data.lastSyncAt ?? null }
              : {}),
            ...(data.lastSuccessAt !== undefined
              ? { lastSuccessAt: data.lastSuccessAt ?? null }
              : {}),
            ...(data.syncState !== undefined ? { syncState: data.syncState } : {}),
            ...(data.connectionHealth !== undefined
              ? { connectionHealth: data.connectionHealth }
              : {}),
            ...(data.lastExecution !== undefined
              ? { lastExecution: data.lastExecution ?? null }
              : {}),
            ...(data.archivedAt !== undefined
              ? { archivedAt: data.archivedAt ?? null }
              : {}),
            ...(data.deletedAt !== undefined
              ? { deletedAt: data.deletedAt ?? null }
              : {}),
          },
        })
      );
    } catch {
      throw new NotFoundError("ScriptSyncTarget", id);
    }
  }
}

export class PrismaScriptSyncLogRepository implements ScriptSyncLogRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(data: Omit<ScriptSyncLog, "createdAt"> & { createdAt?: Date }) {
    const scope = data.idempotencyScope ?? "SCRIPT_SYNC_RESULT";
    try {
      return toLog(
        await this.db.scriptSyncLog.create({
          data: {
            id: data.id,
            tenantId: data.tenantId,
            integrationId: data.integrationId,
            targetId: data.targetId,
            desiredVersion: data.desiredVersion,
            reportedAppliedVersion: data.reportedAppliedVersion ?? null,
            result: data.result,
            errorCode: data.errorCode ?? null,
            errorMessage: data.errorMessage ?? null,
            requestId: data.requestId ?? null,
            idempotencyScope: scope,
            idempotencyKey: data.idempotencyKey,
            createdAt: data.createdAt,
          },
        })
      );
    } catch (error) {
      rethrowUniqueAsConflict(
        error,
        "ScriptSyncLog idempotency key already exists"
      );
    }
  }

  async findById(id: string) {
    const row = await this.db.scriptSyncLog.findUnique({ where: { id } });
    return row ? toLog(row) : null;
  }

  async findByIdForTenant(tenantId: string, id: string) {
    const row = await this.db.scriptSyncLog.findFirst({
      where: { id, tenantId },
    });
    return row ? toLog(row) : null;
  }

  async findByIntegration(
    tenantId: string,
    integrationId: string,
    input?: PaginationInput
  ) {
    const { page, pageSize, skip } = normalizePagination(input);
    const where = { tenantId, integrationId };
    const [items, total] = await Promise.all([
      this.db.scriptSyncLog.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      this.db.scriptSyncLog.count({ where }),
    ]);
    return createPaginatedResult(items.map(toLog), total, page, pageSize);
  }

  async findByTarget(
    tenantId: string,
    targetId: string,
    input?: PaginationInput
  ) {
    const { page, pageSize, skip } = normalizePagination(input);
    const where = { tenantId, targetId };
    const [items, total] = await Promise.all([
      this.db.scriptSyncLog.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
      this.db.scriptSyncLog.count({ where }),
    ]);
    return createPaginatedResult(items.map(toLog), total, page, pageSize);
  }

  async findByIdempotencyKey(
    tenantId: string,
    scope: string,
    idempotencyKey: string
  ) {
    const row = await this.db.scriptSyncLog.findUnique({
      where: {
        tenantId_idempotencyScope_idempotencyKey: {
          tenantId,
          idempotencyScope: scope,
          idempotencyKey,
        },
      },
    });
    return row ? toLog(row) : null;
  }
}
