import type { GoogleAdsProvider } from "./provider.js";
import { MockGoogleAdsProvider } from "./mock-provider.js";
import { GoogleAdsApiProvider } from "./api-provider.js";
import { EnvGoogleCredentialProvider } from "./credentials.js";

export type GoogleAdsProviderKind = "mock" | "api";

export function createGoogleAdsProvider(
  kind: GoogleAdsProviderKind = "mock",
  options?: { credentialRef?: string }
): GoogleAdsProvider {
  if (kind === "api") {
    return new GoogleAdsApiProvider({
      credentialRef: options?.credentialRef ?? "env:GOOGLE_ADS_*",
      credentialProvider: new EnvGoogleCredentialProvider(),
      developerTokenConfigured: Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN),
    });
  }
  return new MockGoogleAdsProvider();
}

export * from "./provider.js";
export * from "./mock-provider.js";
export * from "./mock-data.js";
export * from "./api-provider.js";
export * from "./errors.js";
export * from "./credentials.js";
