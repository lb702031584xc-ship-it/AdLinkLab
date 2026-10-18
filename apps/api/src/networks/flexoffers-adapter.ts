/**
 * Network API framework — FlexOffers adapter (stub).
 *
 * Credential format (stored encrypted, combined): `apiKey`
 * Auth: API key in header or query param.
 * API: https://api.flexoffers.com/
 *
 * Status: STUB — interface reserved.
 */
import type { AdapterContext, NetworkAdapter, NetworkOffer, SyncMode } from "./types.js";
import { NetworkAdapterError } from "./impact-adapter.js";

export const FLEXOFFERS_DEFAULT_BASE_URL = "https://api.flexoffers.com";

export class FlexOffersAdapter implements NetworkAdapter {
  readonly kind = "flexoffers";
  readonly displayName = "FlexOffers";
  readonly defaultBaseUrl = FLEXOFFERS_DEFAULT_BASE_URL;
  readonly supportsModes: readonly SyncMode[] = ["api", "session"] as const;
  async pullOffers(ctx: AdapterContext): Promise<NetworkOffer[]> {
    void ctx;
    throw new NetworkAdapterError("NOT_IMPLEMENTED", "FlexOffers adapter is a stub");
  }
}
