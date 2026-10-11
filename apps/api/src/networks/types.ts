/**
 * Network API framework — adapter contracts (2026-10-07).
 *
 * Each affiliate network (Impact, Rakuten, …) implements `NetworkAdapter` and
 * registers itself in `./index.ts`. Adding a network = implement the interface
 * + register it; no other code changes.
 *
 * Security rules:
 * - Plaintext API keys are never logged, never returned to the web layer.
 * - Outbound HTTP must pass an SSRF check (adapters use `assertApiUrlSafe`).
 */
export interface NetworkOffer {
  /** Network-side offer/campaign ID (dedupe key together with tenant+network). */
  externalId: string;
  name: string;
  /** Payout amount in `currency`; null when the network doesn't disclose it. */
  payout?: number | null;
  currency?: string | null;
  /** Concatenated program terms for the Phase 1 policy scanner. */
  termsText?: string | null;
  /** Landing / tracking URL when the network exposes one. */
  url?: string | null;
  /** Full raw API object for debugging / future field extraction. */
  rawData: Record<string, unknown>;
}

export interface AdapterContext {
  /** Decrypted API key. For Impact: `AccountSID:AuthToken`. */
  apiKey: string;
  /** Base URL override (defaults to the adapter's production endpoint). */
  apiBaseUrl: string;
  tenantId: string;
  /** Injectable fetch (unit tests use a mock). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /**
   * SSRF guard override (unit tests inject a no-op to avoid real DNS).
   * Defaults to the real check in impact-adapter.ts.
   */
  ssrfCheck?: (url: string) => Promise<void>;
  /** Request timeout per HTTP call, ms. */
  timeoutMs?: number;
}

/**
 * Adapter that pulls the full offer catalog from a network.
 * Implementations must be credential-format aware (see ImpactAdapter docs).
 */
export interface NetworkAdapter {
  /** Adapter kind, matches `AffiliateNetwork.kind` (e.g. "impact"). */
  readonly kind: string;
  /** Human label for the web UI. */
  readonly displayName: string;
  /** Production API base URL used when the user leaves apiBaseUrl empty. */
  readonly defaultBaseUrl: string;
  pullOffers(ctx: AdapterContext): Promise<NetworkOffer[]>;
}
