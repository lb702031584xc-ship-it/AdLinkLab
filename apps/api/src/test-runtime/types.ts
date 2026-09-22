/**
 * Phase 8.4.8 — Script Runtime Simulator types (TEST RESULT only — not DB entities).
 */

export type ScriptRuntimeTargetStatus =
  | "SUCCESS"
  | "FAILED"
  | "SKIPPED"
  | "CONFLICT"
  | "AUTH_FAILED"
  | "TRANSPORT_FAILED";

export interface ScriptRuntimeTargetResult {
  targetId: string;
  desiredVersion: number | null;
  appliedVersionBefore: number | null;
  appliedVersionAfter: number | null;
  status: ScriptRuntimeTargetStatus;
  conflictCode?: string;
  error?: string;
  syncHttpStatus?: number;
  applySucceeded?: boolean;
}

export interface ScriptRuntimeResult {
  executionId: string;
  integrationId: string;
  startedAt: string;
  completedAt: string;
  targetsProcessed: number;
  targetsSucceeded: number;
  targetsFailed: number;
  targetsSkipped: number;
  logs: string[];
  targetResults: ScriptRuntimeTargetResult[];
  /** Always 0 — real Google Ads provider must never be invoked. */
  googleAdsProviderInvocations: number;
  /** Always 0 — real network sockets must never open. */
  realNetworkCalls: number;
}

export type ScriptRuntimeApplyBehavior =
  | "normal"
  | "fail_all"
  | { failAdIds: string[] };

export type ScriptRuntimeSyncBehavior =
  | "normal"
  | {
      /** After server processes sync-result, return this status to the Script once per key. */
      loseResponseStatus?: number;
      loseResponseTimes?: number;
      /** Force HTTP status without calling server (config/sync failure injection). */
      forceSyncStatus?: number;
      forceConfigStatus?: number;
      malformedConfig?: boolean;
    };

export interface ScriptRuntimeScenario {
  integrationId: string;
  executionId: string;
  /** Optional plaintext token for Authorization — memory only. */
  token: string;
  configEndpoint: string;
  syncResultEndpoint: string;
  /** googleAdId → seeded MockAdsApp ad. */
  ads: Array<{ id: string; urls?: Record<string, unknown> }>;
  applyBehavior?: ScriptRuntimeApplyBehavior;
  syncBehavior?: ScriptRuntimeSyncBehavior;
  /** Injected clock ISO strings (deterministic). */
  startedAt?: string;
  completedAt?: string;
  /** Called after config fetch succeeds, before targets are processed. */
  afterConfigHook?: () => Promise<void> | void;
}

export const SCRIPT_RUNTIME_SCENARIO_NAMES = [
  "SUCCESS",
  "NEVER_APPLIED",
  "OUT_OF_SYNC",
  "STALE_DESIRED",
  "VERSION_CONFLICT",
  "IDEMPOTENT_REPLAY",
  "PARTIAL_FAILURE",
  "NO_ACTIVE_VERSION",
  "MULTI_TARGET",
  "CONCURRENT_EXECUTION",
] as const;

export type ScriptRuntimeScenarioName =
  (typeof SCRIPT_RUNTIME_SCENARIO_NAMES)[number];
