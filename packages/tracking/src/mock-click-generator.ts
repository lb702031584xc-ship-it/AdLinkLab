import type { RequestMetadataInput } from "@adlinklab/domain";

export interface SyntheticClickRequest {
  trackingLinkPublicId: string;
  tenantId: string;
  requestMetadata: RequestMetadataInput;
  ingestionId?: string;
}

/**
 * Test-only synthetic click factory.
 * Uses RFC 5737 TEST-NET IPs and clearly synthetic UA/Referer.
 * Not production traffic. No proxy, IP rotation, or anti-detection.
 */
export class MockClickGenerator {
  constructor(
    private readonly defaults: {
      tenantId: string;
      trackingLinkPublicId: string;
    }
  ) {}

  generate(overrides: Partial<SyntheticClickRequest> = {}): SyntheticClickRequest {
    const octet = 10 + Math.floor(Math.random() * 40);
    return {
      tenantId: overrides.tenantId ?? this.defaults.tenantId,
      trackingLinkPublicId:
        overrides.trackingLinkPublicId ?? this.defaults.trackingLinkPublicId,
      ingestionId: overrides.ingestionId,
      requestMetadata: {
        ipAddress: `203.0.113.${octet}`,
        userAgent: "AdLinkLab/MockClickGenerator (synthetic; test-only)",
        referer: "https://example.test/synthetic-referer",
        queryParameters: {
          gclid: "synthetic-gclid-test-only",
          utm_source: "mock",
          utm_medium: "test",
          utm_campaign: "phase4",
          ...(overrides.requestMetadata?.queryParameters ?? {}),
        },
        ...overrides.requestMetadata,
      },
    };
  }

  generateMany(
    count: number,
    overrides: Partial<SyntheticClickRequest> = {}
  ): SyntheticClickRequest[] {
    return Array.from({ length: count }, (_, i) =>
      this.generate({
        ...overrides,
        ingestionId: overrides.ingestionId
          ? `${overrides.ingestionId}-${i}`
          : undefined,
        requestMetadata: {
          ...overrides.requestMetadata,
          ipAddress: `203.0.113.${(10 + i) % 250}`,
        },
      })
    );
  }
}
