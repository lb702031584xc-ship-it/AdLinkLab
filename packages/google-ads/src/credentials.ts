/**
 * Credential abstraction — domain only stores oauthCredentialRef.
 * Secrets must never appear in domain models, seeds, fixtures, or logs.
 */
export interface GoogleAdsCredentialHandle {
  /** Opaque vault / env reference (e.g. vault:ref:mock-google-ads-oauth-a) */
  credentialRef: string;
  /** True when adapter can attempt authenticated calls (no secret values exposed) */
  isConfigured: boolean;
}

export interface GoogleCredentialProvider {
  resolve(credentialRef: string): Promise<GoogleAdsCredentialHandle>;
}

/**
 * Resolves whether live API env is configured — never returns token values.
 */
export class EnvGoogleCredentialProvider implements GoogleCredentialProvider {
  async resolve(credentialRef: string): Promise<GoogleAdsCredentialHandle> {
    const isConfigured = Boolean(
      process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
        process.env.GOOGLE_ADS_CLIENT_ID &&
        process.env.GOOGLE_ADS_REFRESH_TOKEN
    );
    return { credentialRef, isConfigured };
  }
}

/**
 * Development credential provider for mock refs — always "configured" for mock path.
 */
export class MockGoogleCredentialProvider implements GoogleCredentialProvider {
  async resolve(credentialRef: string): Promise<GoogleAdsCredentialHandle> {
    return {
      credentialRef,
      isConfigured: credentialRef.startsWith("vault:ref:"),
    };
  }
}
