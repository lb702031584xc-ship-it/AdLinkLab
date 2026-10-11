/**
 * Network API framework — Awin adapter (stub).
 *
 * Credential format (stored encrypted, combined): `apiToken`
 * Auth: Bearer token in Authorization header.
 * Publisher API: https://api.awin.com/publishers/{publisherId}/programmes
 *
 * Status: STUB — interface reserved. Full implementation needs:
 * 1. Awin publisher account + API token (from api.awin.com)
 * 2. Publisher ID for the endpoint path
 * 3. Response mapping for programme list
 */
import type {
  AdapterContext,
  NetworkAdapter,
  NetworkOffer,
} from "./types.js";
import { NetworkAdapterError } from "./impact-adapter.js";

export const AWIN_DEFAULT_BASE_URL = "https://api.awin.com";
export const AWIN_DEFAULT_TIMEOUT_MS = 15_000;

export function parseAwinCredentials(apiKey: string): { apiToken: string } {
  const token = apiKey.trim();
  if (!token) {
    throw new NetworkAdapterError("BAD_CREDENTIALS", "Awin API token must not be empty");
  }
  return { apiToken: token };
}

export class AwinAdapter implements NetworkAdapter {
  readonly kind = "awin";
  readonly displayName = "Awin";
  readonly defaultBaseUrl = AWIN_DEFAULT_BASE_URL;

  async pullOffers(ctx: AdapterContext): Promise<NetworkOffer[]> {
    void ctx;
    // TODO: Implement when credentials are available.
    // GET {baseUrl}/publishers/{publisherId}/programmes
    // Headers: Authorization: Bearer {apiToken}
    throw new NetworkAdapterError(
      "NOT_IMPLEMENTED",
      "Awin adapter is a stub — implement listOffers when API credentials are available"
    );
  }

}
