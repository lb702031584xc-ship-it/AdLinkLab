/**
 * Network API framework — CJ Affiliate (Commission Junction) adapter (stub).
 *
 * Credential format (stored encrypted): `apiKey` (Personal Access Token)
 * Auth: Bearer token in Authorization header.
 * API: https://advertiser-lookup.api.cj.com/v3/advertiser-lookup
 *
 * Status: STUB — interface reserved. Full implementation needs:
 * 1. CJ publisher account + Personal Access Token (from cj.com API settings)
 * 2. Response mapping for advertiser/offer list
 */
import type {
  AdapterContext,
  NetworkAdapter,
  NetworkOffer,
  SyncMode,
} from "./types.js";
import { NetworkAdapterError } from "./impact-adapter.js";

export const CJ_DEFAULT_BASE_URL = "https://api.cj.com";
export const CJ_DEFAULT_TIMEOUT_MS = 15_000;

export class CJAdapter implements NetworkAdapter {
  readonly kind = "cj";
  readonly displayName = "CJ Affiliate";
  readonly defaultBaseUrl = CJ_DEFAULT_BASE_URL;
  readonly supportsModes: readonly SyncMode[] = ["api", "session"] as const;

  async pullOffers(ctx: AdapterContext): Promise<NetworkOffer[]> {
    void ctx;
    throw new NetworkAdapterError(
      "NOT_IMPLEMENTED",
      "CJ adapter is a stub — implement listOffers when API credentials are available"
    );
  }

}
