/**
 * Phase 8.4.4 — Domain helpers for Script Sync Result.
 */
import { describe, expect, it } from "vitest";
import {
  assertScriptSyncResultPayload,
  buildScriptSyncIdempotencyKey,
  deriveSyncState,
  logMatchesPayload,
  SCRIPT_SYNC_RESULT_SCOPE,
} from "./script-sync-result.js";
import { ValidationError } from "@adlinklab/shared";

describe("Phase 8.4.4 script-sync-result domain", () => {
  it("scopes idempotency key by integrationId", () => {
    expect(buildScriptSyncIdempotencyKey("int-a", "k")).toBe("int-a:k");
    expect(buildScriptSyncIdempotencyKey("int-b", "k")).toBe("int-b:k");
    expect(SCRIPT_SYNC_RESULT_SCOPE).toBe("SCRIPT_SYNC_RESULT");
  });

  it("validates required payload fields", () => {
    expect(() => assertScriptSyncResultPayload({})).toThrow(ValidationError);
    expect(() =>
      assertScriptSyncResultPayload({
        targetId: "t",
        desiredVersion: 0,
        result: "SUCCESS",
        idempotencyKey: "k",
      })
    ).toThrow(/positive integer/);
    expect(() =>
      assertScriptSyncResultPayload({
        targetId: "t",
        desiredVersion: 1,
        result: "SUCCESS",
        idempotencyKey: "k".repeat(200),
      })
    ).toThrow(/maximum length/);
    expect(() =>
      assertScriptSyncResultPayload({
        targetId: "t",
        desiredVersion: 1,
        result: "NOPE" as "SUCCESS",
        idempotencyKey: "k",
      })
    ).toThrow(/result must be/);
  });

  it("accepts valid payload", () => {
    expect(
      assertScriptSyncResultPayload({
        targetId: "t1",
        desiredVersion: 3,
        result: "SUCCESS",
        idempotencyKey: "abc",
      })
    ).toEqual({
      targetId: "t1",
      desiredVersion: 3,
      result: "SUCCESS",
      idempotencyKey: "abc",
    });
  });

  it("deriveSyncState covers SYNCED / OUT_OF_SYNC / NEVER_APPLIED", () => {
    expect(deriveSyncState(null, 2)).toBe("NEVER_APPLIED");
    expect(deriveSyncState(undefined, 2)).toBe("NEVER_APPLIED");
    expect(deriveSyncState(2, 2)).toBe("SYNCED");
    expect(deriveSyncState(1, 2)).toBe("OUT_OF_SYNC");
    expect(deriveSyncState(1, null)).toBe("OUT_OF_SYNC");
  });

  it("logMatchesPayload compares target/version/result", () => {
    const payload = {
      targetId: "t",
      desiredVersion: 2,
      result: "SUCCESS" as const,
      idempotencyKey: "k",
    };
    expect(
      logMatchesPayload(
        { targetId: "t", desiredVersion: 2, result: "SUCCESS" },
        payload
      )
    ).toBe(true);
    expect(
      logMatchesPayload(
        { targetId: "other", desiredVersion: 2, result: "SUCCESS" },
        payload
      )
    ).toBe(false);
  });
});
