/**
 * Phase 8.4.8 — Production guard for Script Runtime Simulator.
 * TEST_ONLY — must never run in production runtime.
 */

export const SCRIPT_RUNTIME_SIMULATOR_MARKER = "TEST_ONLY" as const;

/**
 * Throws if invoked under NODE_ENV=production.
 * Simulator modules call this on construction / entry.
 */
export function assertTestRuntime(
  env: NodeJS.ProcessEnv = process.env
): void {
  if (env.NODE_ENV === "production") {
    throw new Error(
      "ScriptRuntimeSimulator is TEST_ONLY and must not run when NODE_ENV=production"
    );
  }
}
