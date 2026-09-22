/**
 * Phase 8.4.7.1 — Dashboard DTO whitelist mappers (READ ONLY).
 * Never return tokenHash / pepper / oauth / Authorization / raw payloads.
 */
import type {
  GoogleAdsScriptIntegration,
  ScriptSyncLog,
  ScriptSyncTarget,
} from "@adlinklab/domain";
import type {
  ScriptConnectionHealth,
  ScriptExecutionResult,
  ScriptSyncState,
} from "@adlinklab/domain";

export interface DashboardDesiredUrlDto {
  finalUrl: string | null;
  finalMobileUrl: string | null;
  finalAppUrl: string | null;
  trackingTemplate: string | null;
  customParameters: Record<string, string>;
  version: number | null;
  effectiveAt: string | null;
}

export interface DashboardIntegrationListItemDto {
  integrationId: string;
  name: string;
  status: string;
  googleAccountId: string;
  configGeneration: number;
  targetCount: number;
  syncStateSummary: Record<ScriptSyncState, number>;
  connectionHealth: ScriptConnectionHealth;
  lastExecutionSummary: Record<ScriptExecutionResult, number>;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface DashboardIntegrationDetailDto {
  integration: {
    integrationId: string;
    name: string;
    status: string;
    googleAccountId: string;
    configGeneration: number;
    lastSeenAt: string | null;
    createdAt: string;
  };
  health: {
    syncState: ScriptSyncState;
    connectionHealth: ScriptConnectionHealth;
    lastExecution: ScriptExecutionResult | null;
  };
  counts: {
    targets: number;
    synced: number;
    outOfSync: number;
    neverApplied: number;
  };
}

export interface DashboardTargetDto {
  targetId: string;
  entityType: "AD";
  entityId: string;
  googleAdId: string;
  campaignId: string;
  adGroupId: string;
  desiredVersion: number | null;
  appliedVersion: number | null;
  syncState: ScriptSyncState;
  connectionHealth: ScriptConnectionHealth;
  lastExecution: ScriptExecutionResult | null;
  lastAppliedAt: string | null;
  lastAttemptAt: string | null;
  desired: DashboardDesiredUrlDto;
}

export interface DashboardLogDto {
  logId: string;
  targetId: string;
  desiredVersion: number;
  reportedVersion: number | null;
  status: ScriptExecutionResult;
  conflictCode: string | null;
  idempotencyKey: string;
  executionId: string | null;
  appliedVersionBefore: number | null;
  appliedVersionAfter: number | null;
  message: string | null;
  createdAt: string;
}

export interface DashboardSummaryDto {
  integration: {
    integrationId: string;
    name: string;
    status: string;
  };
  targets: {
    total: number;
    synced: number;
    outOfSync: number;
    neverApplied: number;
  };
  health: {
    connection: ScriptConnectionHealth;
    lastExecution: ScriptExecutionResult | null;
  };
  versions: {
    currentDesiredVersion: number | null;
    appliedTargets: number;
    pendingTargets: number;
  };
  recentLogs: DashboardLogDto[];
}

export function emptySyncStateSummary(): Record<ScriptSyncState, number> {
  return { SYNCED: 0, OUT_OF_SYNC: 0, NEVER_APPLIED: 0 };
}

export function emptyExecutionSummary(): Record<ScriptExecutionResult, number> {
  return { SUCCESS: 0, FAILED: 0, PARTIAL: 0, NO_CHANGE: 0 };
}

export function toIso(value: Date | undefined | null): string | null {
  return value ? value.toISOString() : null;
}

export function mapIntegrationCore(integration: GoogleAdsScriptIntegration) {
  return {
    integrationId: integration.id,
    name: integration.name,
    status: integration.status,
    googleAccountId: integration.googleAccountId,
    configGeneration: integration.configGeneration,
    lastSeenAt: toIso(integration.lastSeenAt ?? null),
    createdAt: integration.createdAt.toISOString(),
  };
}

export function mapDashboardLog(log: ScriptSyncLog): DashboardLogDto {
  return {
    logId: log.id,
    targetId: log.targetId,
    desiredVersion: log.desiredVersion,
    reportedVersion: log.reportedAppliedVersion ?? null,
    status: log.result,
    conflictCode: log.errorCode ?? null,
    idempotencyKey: log.idempotencyKey,
    executionId: log.requestId ?? null,
    appliedVersionBefore: null,
    appliedVersionAfter: log.reportedAppliedVersion ?? null,
    message: log.errorMessage ?? null,
    createdAt: log.createdAt.toISOString(),
  };
}

export function aggregateSyncCounts(
  states: ScriptSyncState[]
): {
  summary: Record<ScriptSyncState, number>;
  synced: number;
  outOfSync: number;
  neverApplied: number;
  dominant: ScriptSyncState;
} {
  const summary = emptySyncStateSummary();
  for (const s of states) {
    summary[s] += 1;
  }
  let dominant: ScriptSyncState = "NEVER_APPLIED";
  if (summary.OUT_OF_SYNC > 0) dominant = "OUT_OF_SYNC";
  else if (summary.SYNCED > 0 && summary.NEVER_APPLIED === 0) dominant = "SYNCED";
  else if (summary.SYNCED > 0) dominant = "OUT_OF_SYNC";
  else dominant = "NEVER_APPLIED";
  return {
    summary,
    synced: summary.SYNCED,
    outOfSync: summary.OUT_OF_SYNC,
    neverApplied: summary.NEVER_APPLIED,
    dominant,
  };
}

export function aggregateConnectionHealth(
  targets: Array<Pick<ScriptSyncTarget, "connectionHealth">>,
  integrationStatus: string
): ScriptConnectionHealth {
  if (integrationStatus === "DISABLED" || integrationStatus === "REVOKED") {
    return "DISABLED";
  }
  if (targets.length === 0) return "STALE";
  if (targets.some((t) => t.connectionHealth === "DISABLED")) return "DISABLED";
  if (targets.every((t) => t.connectionHealth === "CONNECTED")) {
    return "CONNECTED";
  }
  return "STALE";
}

export function aggregateLastExecution(
  targets: Array<Pick<ScriptSyncTarget, "lastExecution" | "lastSyncAt">>
): ScriptExecutionResult | null {
  const withExec = targets
    .filter((t) => t.lastExecution)
    .sort(
      (a, b) =>
        (b.lastSyncAt?.getTime() ?? 0) - (a.lastSyncAt?.getTime() ?? 0)
    );
  return withExec[0]?.lastExecution ?? null;
}

export function countLastExecutions(
  targets: Array<Pick<ScriptSyncTarget, "lastExecution">>
): Record<ScriptExecutionResult, number> {
  const summary = emptyExecutionSummary();
  for (const t of targets) {
    if (t.lastExecution) summary[t.lastExecution] += 1;
  }
  return summary;
}
