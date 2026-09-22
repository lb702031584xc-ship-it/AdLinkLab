import { describe, expect, it } from "vitest";
import { ValidationError } from "@adlinklab/shared";
import {
  assertSafeRedirectUrl,
  extractTrackingParams,
  MockClickGenerator,
  normalizeRequestMetadata,
} from "./index.js";

describe("Phase 4 tracking helpers", () => {
  it("normalizeRequestMetadata freezes output", () => {
    const meta = normalizeRequestMetadata({
      queryParameters: { utm_source: "x" },
    });
    expect(Object.isFrozen(meta)).toBe(true);
    expect(Object.isFrozen(meta.queryParameters)).toBe(true);
  });

  it("extractTrackingParams maps standard keys", () => {
    expect(
      extractTrackingParams({
        gclid: "g1",
        utm_source: "s",
        utm_medium: "m",
      })
    ).toEqual({
      gclid: "g1",
      gbraid: undefined,
      wbraid: undefined,
      utmSource: "s",
      utmMedium: "m",
      utmCampaign: undefined,
      utmTerm: undefined,
      utmContent: undefined,
    });
  });

  it("assertSafeRedirectUrl accepts http/https only", () => {
    expect(assertSafeRedirectUrl("http://example.com")).toContain("http://");
    expect(() => assertSafeRedirectUrl("ftp://example.com")).toThrow(
      ValidationError
    );
  });

  it("MockClickGenerator.generateMany returns distinct TEST-NET IPs", () => {
    const gen = new MockClickGenerator({
      tenantId: "t",
      trackingLinkPublicId: "trk",
    });
    const many = gen.generateMany(3);
    expect(many).toHaveLength(3);
    expect(many.every((m) => m.requestMetadata.ipAddress?.startsWith("203.0.113."))).toBe(
      true
    );
  });
});
