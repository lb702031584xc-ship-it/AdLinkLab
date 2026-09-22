/**
 * Phase 8.4.8 — Mock Utilities (Google Ads Scripts Utilities API).
 * TEST_ONLY — deterministic UUID sequence; sleep is a no-op.
 */

import { assertTestRuntime } from "./assert-test-runtime.js";

export interface MockUtilitiesOptions {
  /** Deterministic UUID sequence. Cycles if exhausted. */
  uuidSequence?: string[];
  /** Fixed clock for sleep accounting (ms). Default 0. */
  clockMs?: number;
}

export class MockUtilities {
  private uuidIndex = 0;
  private readonly uuidSequence: string[];
  readonly sleepCalls: number[] = [];
  private clockMs: number;

  constructor(options: MockUtilitiesOptions = {}) {
    assertTestRuntime();
    this.uuidSequence = options.uuidSequence?.length
      ? [...options.uuidSequence]
      : ["00000000-0000-4000-8000-0000000000e1"];
    this.clockMs = options.clockMs ?? 0;
  }

  getUuid(): string {
    const id = this.uuidSequence[this.uuidIndex % this.uuidSequence.length]!;
    this.uuidIndex += 1;
    return id;
  }

  /** No-op sleep — records requested delay only. */
  sleep(ms: number): void {
    this.sleepCalls.push(ms);
    this.clockMs += ms;
  }

  nowMs(): number {
    return this.clockMs;
  }

  reset(): void {
    this.uuidIndex = 0;
    this.sleepCalls.length = 0;
  }
}
