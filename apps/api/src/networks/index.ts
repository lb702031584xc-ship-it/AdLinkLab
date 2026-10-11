/**
 * Network API framework — adapter registry.
 *
 * To add a network (e.g. Rakuten): implement `NetworkAdapter` in a new file,
 * then add it to ADAPTERS below. Nothing else changes.
 */
import { ImpactAdapter } from "./impact-adapter.js";
import { AwinAdapter } from "./awin-adapter.js";
import { CJAdapter } from "./cj-adapter.js";
import { ShareASaleAdapter } from "./shareasale-adapter.js";
import { RakutenAdapter } from "./rakuten-adapter.js";
import { FlexOffersAdapter } from "./flexoffers-adapter.js";
import { PartnerBoostAdapter } from "./partnerboost-adapter.js";
import type { NetworkAdapter } from "./types.js";

export const SUPPORTED_NETWORK_KINDS = [
  "impact",
  "awin",
  "cj",
  "shareasale",
  "rakuten",
  "flexoffers",
  "partnerboost",
] as const;
export type SupportedNetworkKind = (typeof SUPPORTED_NETWORK_KINDS)[number];

const ADAPTERS: Record<SupportedNetworkKind, NetworkAdapter> = {
  impact: new ImpactAdapter(),
  awin: new AwinAdapter(),
  cj: new CJAdapter(),
  shareasale: new ShareASaleAdapter(),
  rakuten: new RakutenAdapter(),
  flexoffers: new FlexOffersAdapter(),
  partnerboost: new PartnerBoostAdapter(),
};

export function getAdapter(kind: string): NetworkAdapter {
  const normalized = kind.trim().toLowerCase();
  const adapter = (ADAPTERS as Record<string, NetworkAdapter>)[normalized];
  if (!adapter) {
    throw new Error(
      `Unsupported network kind "${kind}" (supported: ${SUPPORTED_NETWORK_KINDS.join(", ")})`
    );
  }
  return adapter;
}

export function isSupportedNetworkKind(kind: string): boolean {
  return (SUPPORTED_NETWORK_KINDS as readonly string[]).includes(
    kind.trim().toLowerCase()
  );
}

export { ImpactAdapter } from "./impact-adapter.js";
export { AwinAdapter } from "./awin-adapter.js";
export { CJAdapter } from "./cj-adapter.js";
export { ShareASaleAdapter } from "./shareasale-adapter.js";
export { RakutenAdapter } from "./rakuten-adapter.js";
export { FlexOffersAdapter } from "./flexoffers-adapter.js";
export type { AdapterContext, NetworkAdapter, NetworkOffer } from "./types.js";
