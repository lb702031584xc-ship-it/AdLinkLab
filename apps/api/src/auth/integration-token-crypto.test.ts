/**
 * Phase 8.4.2 — Integration token crypto unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  extractBearerToken,
  generateIntegrationTokenMaterial,
  hashIntegrationToken,
  INTEGRATION_TOKEN_ENTROPY_BYTES,
  resolveIntegrationTokenPepper,
  safeEqualHex,
  TEST_INTEGRATION_TOKEN_PEPPER,
} from "./integration-token-crypto.js";

describe("Phase 8.4.2 integration token crypto", () => {
  it("resolves test pepper when INTEGRATION_TOKEN_PEPPER unset under Vitest", () => {
    expect(resolveIntegrationTokenPepper({ VITEST: "1" })).toBe(
      TEST_INTEGRATION_TOKEN_PEPPER
    );
  });

  it("prefers configured INTEGRATION_TOKEN_PEPPER", () => {
    expect(
      resolveIntegrationTokenPepper({
        VITEST: "1",
        INTEGRATION_TOKEN_PEPPER: "custom-pepper",
      })
    ).toBe("custom-pepper");
  });

  it("same token + pepper → same hash; different token → different hash", () => {
    const pepper = TEST_INTEGRATION_TOKEN_PEPPER;
    const a = hashIntegrationToken("alk_s_token_a", pepper);
    const b = hashIntegrationToken("alk_s_token_a", pepper);
    const c = hashIntegrationToken("alk_s_token_b", pepper);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(64);
  });

  it("timing-safe hex compare", () => {
    const h = hashIntegrationToken("x", TEST_INTEGRATION_TOKEN_PEPPER);
    expect(safeEqualHex(h, h)).toBe(true);
    expect(safeEqualHex(h, "00".repeat(32))).toBe(false);
  });

  it("generates alk_s_ token with sufficient entropy and material fields", () => {
    const material = generateIntegrationTokenMaterial(TEST_INTEGRATION_TOKEN_PEPPER);
    expect(material.token.startsWith("alk_s_")).toBe(true);
    // base64url of 32 bytes ≈ 43 chars + prefix
    expect(material.token.length).toBeGreaterThan(
      6 + Math.floor((INTEGRATION_TOKEN_ENTROPY_BYTES * 4) / 3)
    );
    expect(material.tokenPrefix).toBe(material.token.slice(0, 12));
    expect(material.tokenKeyId.startsWith("itk_")).toBe(true);
    expect(material.tokenHash).toBe(
      hashIntegrationToken(material.token, TEST_INTEGRATION_TOKEN_PEPPER)
    );
    expect(material.tokenKeyId).not.toBe(material.token);
  });

  it("extractBearerToken parses Bearer only (case-insensitive)", () => {
    expect(extractBearerToken("Bearer abc.def")).toBe("abc.def");
    expect(extractBearerToken("bearer  tok  ")).toBe("tok");
    expect(extractBearerToken("Basic abc")).toBeUndefined();
    expect(extractBearerToken("")).toBeUndefined();
    expect(extractBearerToken(undefined)).toBeUndefined();
    expect(extractBearerToken("Bearer")).toBeUndefined();
    expect(extractBearerToken("Bearer ")).toBeUndefined();
  });
});
