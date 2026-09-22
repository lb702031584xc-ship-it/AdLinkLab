/**
 * Phase 8.4.8 — Scenario helpers (TEST_ONLY).
 */

import { randomUUID } from "node:crypto";
import type { ScriptRuntimeScenario } from "./types.js";

export const SIM_BASE = "https://simulator.adlinklab.test";
export const SIM_CONFIG = `${SIM_BASE}/api/v1/script/config`;
export const SIM_SYNC = `${SIM_BASE}/api/v1/script/sync-result`;

export function buildScenario(
  partial: Partial<ScriptRuntimeScenario> &
    Pick<ScriptRuntimeScenario, "integrationId" | "token" | "ads">
): ScriptRuntimeScenario {
  return {
    executionId: partial.executionId ?? randomUUID(),
    configEndpoint: partial.configEndpoint ?? SIM_CONFIG,
    syncResultEndpoint: partial.syncResultEndpoint ?? SIM_SYNC,
    applyBehavior: partial.applyBehavior ?? "normal",
    syncBehavior: partial.syncBehavior ?? "normal",
    startedAt: partial.startedAt,
    completedAt: partial.completedAt,
    afterConfigHook: partial.afterConfigHook,
    integrationId: partial.integrationId,
    token: partial.token,
    ads: partial.ads,
  };
}
