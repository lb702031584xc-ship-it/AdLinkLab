/**
 * Network API framework — adapter registry.
 *
 * To add a network (e.g. Rakuten): implement `NetworkAdapter` in a new file,
 * then add it to ADAPTERS below. Nothing else changes.
 *
 * Session 模式：各网络的登录态采集适配器（BaseSessionAdapter 子类）注册在
 * SESSION_ADAPTERS（与官方 API 适配器是两条独立线路）；getSessionAdapter(kind)
 * 按 kind 取 session 适配器。PB/YP 为完整实现（含可配置解析），awin/cj/
 * shareasale/rakuten/flexoffers/impact/amazon 为脚手架（待真实账号验证），
 * 详见 docs/catalog-session-mode.md 的"各联盟 session 模式状态表"。
 */
import { ImpactAdapter } from "./impact-adapter.js";
import { AwinAdapter } from "./awin-adapter.js";
import { CJAdapter } from "./cj-adapter.js";
import { ShareASaleAdapter } from "./shareasale-adapter.js";
import { RakutenAdapter } from "./rakuten-adapter.js";
import { FlexOffersAdapter } from "./flexoffers-adapter.js";
import { PartnerBoostAdapter } from "./partnerboost-adapter.js";
import { YeahPromosAdapter } from "./yeahpromos-adapter.js";
import { AmazonAdapter } from "./amazon-adapter.js";
import { PartnerBoostSessionAdapter } from "./partnerboost-session-adapter.js";
import { AwinSessionAdapter } from "./awin-session-adapter.js";
import { CJSessionAdapter } from "./cj-session-adapter.js";
import { ShareASaleSessionAdapter } from "./shareasale-session-adapter.js";
import { RakutenSessionAdapter } from "./rakuten-session-adapter.js";
import { FlexOffersSessionAdapter } from "./flexoffers-session-adapter.js";
import { ImpactSessionAdapter } from "./impact-session-adapter.js";
import { AmazonSessionAdapter } from "./amazon-session-adapter.js";
import type { BaseSessionAdapter } from "./session-adapter.js";
import type { NetworkAdapter } from "./types.js";

export const SUPPORTED_NETWORK_KINDS = [
  "impact",
  "awin",
  "cj",
  "shareasale",
  "rakuten",
  "flexoffers",
  "partnerboost",
  "yeahpromos",
  "amazon",
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
  yeahpromos: new YeahPromosAdapter(),
  amazon: new AmazonAdapter(),
};

/**
 * Session 适配器注册表：kind → BaseSessionAdapter 子类实例。
 * 与 ADAPTERS（官方 API 线路）独立；sessionKind 与官方 kind 一致。
 */
const SESSION_ADAPTERS: Record<string, BaseSessionAdapter> = {
  partnerboost: new PartnerBoostSessionAdapter(),
  yeahpromos: new YeahPromosAdapter(),
  awin: new AwinSessionAdapter(),
  cj: new CJSessionAdapter(),
  shareasale: new ShareASaleSessionAdapter(),
  rakuten: new RakutenSessionAdapter(),
  flexoffers: new FlexOffersSessionAdapter(),
  impact: new ImpactSessionAdapter(),
  amazon: new AmazonSessionAdapter(),
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

/** 取某网络的 session 模式适配器；无 session 线路 → 抛错（调用方转 400）。 */
export function getSessionAdapter(kind: string): BaseSessionAdapter {
  const normalized = kind.trim().toLowerCase();
  const adapter = SESSION_ADAPTERS[normalized];
  if (!adapter) {
    throw new Error(`No session adapter for network kind "${kind}"`);
  }
  return adapter;
}

/** 某网络是否支持 session 模式（sync-mode 切换接口用）。 */
export function isSessionSupported(kind: string): boolean {
  return kind.trim().toLowerCase() in SESSION_ADAPTERS;
}

export { ImpactAdapter } from "./impact-adapter.js";
export { AwinAdapter } from "./awin-adapter.js";
export { CJAdapter } from "./cj-adapter.js";
export { ShareASaleAdapter } from "./shareasale-adapter.js";
export { RakutenAdapter } from "./rakuten-adapter.js";
export { FlexOffersAdapter } from "./flexoffers-adapter.js";
export { PartnerBoostAdapter } from "./partnerboost-adapter.js";
export { PartnerBoostSessionAdapter } from "./partnerboost-session-adapter.js";
export { YeahPromosAdapter } from "./yeahpromos-adapter.js";
export { AmazonAdapter } from "./amazon-adapter.js";
export { AwinSessionAdapter } from "./awin-session-adapter.js";
export { CJSessionAdapter } from "./cj-session-adapter.js";
export { ShareASaleSessionAdapter } from "./shareasale-session-adapter.js";
export { RakutenSessionAdapter } from "./rakuten-session-adapter.js";
export { FlexOffersSessionAdapter } from "./flexoffers-session-adapter.js";
export { ImpactSessionAdapter } from "./impact-session-adapter.js";
export { AmazonSessionAdapter } from "./amazon-session-adapter.js";
export {
  BaseSessionAdapter,
  TemplateSessionAdapter,
  SessionExpiredError,
  SessionRateLimitedError,
  SessionTemplateError,
  SessionParseError,
  SessionHttpError,
  assertSessionUrlSafe,
} from "./session-adapter.js";
export type {
  AdapterContext,
  NetworkAdapter,
  NetworkOffer,
  SyncMode,
} from "./types.js";
export { SYNC_MODES, isSyncMode } from "./types.js";
