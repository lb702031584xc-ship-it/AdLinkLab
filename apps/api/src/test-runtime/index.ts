/**
 * Phase 8.4.8 — Script Runtime Simulator exports (TEST_ONLY).
 * Do not import from production routes / workers / app bootstrap.
 */

export {
  assertTestRuntime,
  SCRIPT_RUNTIME_SIMULATOR_MARKER,
} from "./assert-test-runtime.js";
export { MockAdsApp } from "./mock-ads-app.js";
export type {
  MockAdMutation,
  MockAdRecord,
  MockAdUrlOperation,
  MockAdUrlsState,
} from "./mock-ads-app.js";
export { MockLogger } from "./mock-logger.js";
export { MockUtilities } from "./mock-utilities.js";
export {
  MockUrlFetchApp,
  installNetworkGuard,
} from "./mock-url-fetch-app.js";
export type {
  MockFetchCall,
  MockFetchOptions,
  MockHttpResponse,
  MockUrlFetchHandler,
} from "./mock-url-fetch-app.js";
export { runScriptRuntimeAdapter } from "./script-runtime-adapter.js";
export { ScriptRuntimeSimulator } from "./script-runtime-simulator.js";
export type {
  ScriptRuntimeSimulatorDeps,
  ScriptRuntimeSimulatorRunOptions,
} from "./script-runtime-simulator.js";
export {
  SIM_BASE,
  SIM_CONFIG,
  SIM_SYNC,
  buildScenario,
} from "./scenarios.js";
export { SCRIPT_RUNTIME_SCENARIO_NAMES } from "./types.js";
export type {
  ScriptRuntimeApplyBehavior,
  ScriptRuntimeResult,
  ScriptRuntimeScenario,
  ScriptRuntimeScenarioName,
  ScriptRuntimeSyncBehavior,
  ScriptRuntimeTargetResult,
  ScriptRuntimeTargetStatus,
} from "./types.js";
