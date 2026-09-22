/**
 * Phase 8.4.7.2 — Dashboard API types (match Phase 8.4.7.1 backend DTOs).
 */

export type ScriptSyncState = "SYNCED" | "OUT_OF_SYNC" | "NEVER_APPLIED";
export type ScriptConnectionHealth = "CONNECTED" | "STALE" | "DISABLED";
export type ScriptExecutionResult =
  | "SUCCESS"
  | "FAILED"
  | "PARTIAL"
  | "NO_CHANGE";

export interface DashboardDesiredUrl {
  finalUrl: string | null;
  finalMobileUrl: string | null;
  finalAppUrl: string | null;
  trackingTemplate: string | null;
  customParameters: Record<string, string>;
  version: number | null;
  effectiveAt: string | null;
}

export interface DashboardIntegrationListItem {
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

export interface DashboardIntegrationDetail {
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

export interface DashboardTarget {
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
  desired: DashboardDesiredUrl;
}

export interface DashboardSyncLog {
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

export interface DashboardSummary {
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
  recentLogs: DashboardSyncLog[];
}

export interface DashboardPagination {
  page: number;
  pageSize: number;
  total: number;
  hasNext: boolean;
}

export interface DashboardLogsPage extends DashboardPagination {
  items: DashboardSyncLog[];
}

export interface DashboardIntegrationsResponse {
  items: DashboardIntegrationListItem[];
}

export interface DashboardTargetsResponse {
  items: DashboardTarget[];
}
