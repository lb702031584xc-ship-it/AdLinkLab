/**
 * Phase 8.4.8 — Mock Logger (Google Ads Scripts Logger API).
 * TEST_ONLY — in-memory logs for assertions.
 */

import { assertTestRuntime } from "./assert-test-runtime.js";

const SECRET_PATTERNS = [
  /Authorization/i,
  /Bearer\s+\S+/i,
  /\btoken\b/i,
  /tokenHash/i,
  /pepper/i,
  /alk_s_/i,
] as const;

export class MockLogger {
  readonly inMemoryLogs: string[] = [];

  constructor() {
    assertTestRuntime();
  }

  log(message: string): void {
    this.inMemoryLogs.push(String(message));
  }

  clear(): void {
    this.inMemoryLogs.length = 0;
  }

  /** Assert no secret-looking substrings entered Logger output. */
  assertNoSecrets(): void {
    for (const line of this.inMemoryLogs) {
      for (const re of SECRET_PATTERNS) {
        if (re.test(line)) {
          throw new Error(
            `MockLogger leaked secret pattern ${re}: ${line.slice(0, 120)}`
          );
        }
      }
    }
  }
}
