/**
 * Network API framework — Rakuten Advertising adapter (stub).
 *
 * Credential format (stored encrypted, combined): `clientId:clientSecret`
 * Auth: OAuth2 client credentials → Bearer token.
 * API: https://api.rakutenadvertising.com/
 *
 * Status: STUB — interface reserved.
 */
import type { AdapterContext, NetworkAdapter, NetworkOffer } from "./types.js";
import { NetworkAdapterError } from "./impact-adapter.js";

export const RAKUTEN_DEFAULT_BASE_URL = "https://api.rakutenadvertising.com";

export class RakutenAdapter implements NetworkAdapter {
  readonly kind = "rakuten";
  readonly displayName = "Rakuten Advertising";
  readonly defaultBaseUrl = RAKUTEN_DEFAULT_BASE_URL;
  async pullOffers(ctx: AdapterContext): Promise<NetworkOffer[]> {
    void ctx;
    throw new NetworkAdapterError("NOT_IMPLEMENTED", "Rakuten adapter is a stub");
  }
}
