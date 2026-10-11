/**
 * Network API framework — ShareASale adapter (stub).
 *
 * Credential format (stored encrypted, combined): `affiliateId:apiToken:apiSecret`
 * Auth: Custom headers (x-ShareASale-Token, x-ShareASale-Date, etc.)
 * API: https://api.shareasale.com/
 *
 * Status: STUB — interface reserved.
 */
import type { AdapterContext, NetworkAdapter, NetworkOffer } from "./types.js";
import { NetworkAdapterError } from "./impact-adapter.js";

export const SHAREASALE_DEFAULT_BASE_URL = "https://api.shareasale.com";

export class ShareASaleAdapter implements NetworkAdapter {
  readonly kind = "shareasale";
  readonly displayName = "ShareASale";
  readonly defaultBaseUrl = SHAREASALE_DEFAULT_BASE_URL;
  async pullOffers(ctx: AdapterContext): Promise<NetworkOffer[]> {
    void ctx;
    throw new NetworkAdapterError("NOT_IMPLEMENTED", "ShareASale adapter is a stub");
  }
}
