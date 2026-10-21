/**
 * 每租户系统设置（对标 autoads 系统设置 /settings）。
 *
 * 存储：tenant_settings(key-value)，value 为 JSON 字符串。
 * - ai：AI 引擎（服务商 / 模型 / 端点 / API Key 加密）
 * - ads：广告发布（MCC 连接列表；脚本发布 = 当前主线，Google Ads API 待对接）
 * - proxies：代理 URL 列表（每条加密存储；第一条 = 默认兜底）
 * - system：系统偏好（默认货币 / 链接检查开关与时间）
 *
 * 密钥类字段（API Key、代理 URL）入库前走 AES-256-GCM（ai/crypto.ts），
 * 接口只返回「已配置」布尔与个数，永不回显明文。
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import { AppError } from "@adlinklab/shared";
import {
  assertAiSettingsPepperConfigured,
  encryptSecret,
} from "../ai/crypto.js";

export type TenantSettingKey = "ai" | "ads" | "proxies" | "system" | "dataforseo";

export type AiProvider = "deepseek" | "gemini" | "relay";

export interface TenantAiSetting {
  provider: AiProvider;
  model: string;
  /** 仅 relay（第三方中转）时存；官方服务商端点由 provider 派生。 */
  endpoint?: string;
  apiKeyEnc?: string;
}

export interface MccConnection {
  id: string;
  name: string;
  customerId: string;
  mode: "script" | "api";
}

export interface TenantAdsSetting {
  mccs: MccConnection[];
}

export interface TenantProxiesSetting {
  /** 每条都是 AES-256-GCM 密文。 */
  urls: string[];
}

export interface TenantSystemSetting {
  defaultCurrency: string;
  linkCheckEnabled: boolean;
  linkCheckHour: number;
  linkCheckMinute: number;
}

export const AI_PROVIDERS: AiProvider[] = ["deepseek", "gemini", "relay"];

/** 官方服务商的 OpenAI 兼容端点（系统自动计算，不可手动改，对标 autoads）。 */
export const AI_PROVIDER_ENDPOINTS: Record<Exclude<AiProvider, "relay">, string> = {
  deepseek: "https://api.deepseek.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
};

export const AI_PROVIDER_MODELS: Record<AiProvider, Array<{ id: string; label: string }>> = {
  deepseek: [
    { id: "deepseek-flash", label: "DeepSeek Flash（支持图片）" },
    { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro（纯文本）" },
  ],
  gemini: [
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  ],
  relay: [],
};

export function deriveAiEndpoint(s: TenantAiSetting): string {
  if (s.provider === "relay") return (s.endpoint ?? "").trim();
  return AI_PROVIDER_ENDPOINTS[s.provider];
}

export const SYSTEM_CURRENCIES = ["CNY", "USD", "EUR", "JPY"] as const;

export const DEFAULT_SYSTEM_SETTING: TenantSystemSetting = {
  defaultCurrency: "USD",
  linkCheckEnabled: true,
  linkCheckHour: 2,
  linkCheckMinute: 0,
};

// ---------------------------------------------------------------------------
// Raw KV access
// ---------------------------------------------------------------------------

export async function getTenantSettingValue<T>(
  prisma: PrismaClient,
  tenantId: string,
  key: TenantSettingKey
): Promise<T | null> {
  const row = await prisma.tenantSetting.findUnique({
    where: { tenant_settings_tenant_key_unique: { tenantId, key } },
  });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export async function setTenantSettingValue(
  prisma: PrismaClient,
  tenantId: string,
  key: TenantSettingKey,
  value: unknown
): Promise<void> {
  const serialized = JSON.stringify(value);
  await prisma.tenantSetting.upsert({
    where: { tenant_settings_tenant_key_unique: { tenantId, key } },
    create: { id: randomUUID(), tenantId, key, value: serialized },
    update: { value: serialized },
  });
}

export async function deleteTenantSetting(
  prisma: PrismaClient,
  tenantId: string,
  key: TenantSettingKey
): Promise<void> {
  await prisma.tenantSetting.deleteMany({ where: { tenantId, key } });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function badRequest(message: string): AppError {
  return new AppError(message, { code: "VALIDATION_ERROR", statusCode: 400 });
}

export function validateAiInput(body: {
  provider?: unknown;
  model?: unknown;
  endpoint?: unknown;
}): { provider: AiProvider; model: string; endpoint?: string } {
  const provider = body.provider;
  if (provider !== "deepseek" && provider !== "gemini" && provider !== "relay") {
    throw badRequest("provider must be one of: deepseek, gemini, relay");
  }
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model || model.length > 120) {
    throw badRequest("model is required (max 120 chars)");
  }
  let endpoint: string | undefined;
  if (provider === "relay") {
    endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
    if (!/^https?:\/\/[^\s]+$/.test(endpoint) || endpoint.length > 300) {
      throw badRequest("relay provider requires a valid http(s) endpoint URL");
    }
  }
  return { provider, model, endpoint };
}

export function validateMccList(input: unknown): MccConnection[] {
  if (!Array.isArray(input) || input.length > 20) {
    throw badRequest("mccs must be an array of at most 20 connections");
  }
  const out: MccConnection[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) {
      throw badRequest("each MCC connection must be an object");
    }
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const customerId = typeof r.customerId === "string" ? r.customerId.trim() : "";
    const mode = r.mode;
    if (!name || name.length > 80) throw badRequest("MCC name is required (max 80 chars)");
    // autoads 占位格式 123-456-7890；也接受 10 位纯数字。
    if (!/^\d{3}-\d{3}-\d{4}$/.test(customerId) && !/^\d{10}$/.test(customerId)) {
      throw badRequest("MCC Customer ID must look like 123-456-7890");
    }
    if (mode !== "script" && mode !== "api") {
      throw badRequest("MCC mode must be 'script' or 'api'");
    }
    out.push({
      id:
        typeof r.id === "string" && r.id.trim() ? r.id.trim() : randomUUID(),
      name,
      customerId,
      mode,
    });
  }
  return out;
}

/** 代理 URL 格式校验（对标 autoads 的 8 种格式，直连 + IPRocket API）。 */
export function parseProxyUrl(raw: string): { kind: "direct" | "api"; error?: string } {
  const v = (raw ?? "").trim();
  if (!v) return { kind: "direct", error: "代理 URL 不能为空" };
  if (v.length > 2000) return { kind: "direct", error: "代理 URL 过长" };
  if (/^https?:\/\/api\.iprocket\.io\//i.test(v)) return { kind: "api" };
  // scheme://user:pass@host:port
  const withScheme = v.match(/^(https?|socks5):\/\/([^:\/@]+):([^@]*)@([^:\/]+):(\d{2,5})$/i);
  if (withScheme) return { kind: "direct" };
  // user:pass@host:port
  const atForm = v.match(/^([^:\/@]+):([^@]*)@([^:\/]+):(\d{2,5})$/);
  if (atForm) return { kind: "direct" };
  // host:port:user:pass（Tnb / Kookeey / 711 / Cliproxy 直连式；pass 可含 : 但首个 : 分隔 port 与 user）
  const colonForm = v.match(/^([^:\s]+):(\d{2,5}):([^:\s]+):(.+)$/);
  if (colonForm) return { kind: "direct" };
  return {
    kind: "direct",
    error:
      "格式无法识别。支持 host:port:用户名:密码、用户名:密码@host:port、scheme://用户名:密码@host:port、IPRocket API 地址",
  };
}

export function validateSystemInput(body: {
  defaultCurrency?: unknown;
  linkCheckEnabled?: unknown;
  linkCheckHour?: unknown;
  linkCheckMinute?: unknown;
}): TenantSystemSetting {
  const currency = body.defaultCurrency;
  if (typeof currency !== "string" || !(SYSTEM_CURRENCIES as readonly string[]).includes(currency)) {
    throw badRequest("defaultCurrency must be one of: CNY, USD, EUR, JPY");
  }
  const hour = Number(body.linkCheckHour);
  const minute = Number(body.linkCheckMinute);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw badRequest("linkCheckHour must be an integer 0-23");
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw badRequest("linkCheckMinute must be an integer 0-59");
  }
  return {
    defaultCurrency: currency,
    linkCheckEnabled: body.linkCheckEnabled === true,
    linkCheckHour: hour,
    linkCheckMinute: minute,
  };
}

// ---------------------------------------------------------------------------
// Masked serialization（永不回显明文）
// ---------------------------------------------------------------------------

export function maskAi(s: TenantAiSetting | null) {
  if (!s) {
    return { provider: null as AiProvider | null, model: "", endpoint: "", apiKeyConfigured: false };
  }
  return {
    provider: s.provider,
    model: s.model,
    endpoint: deriveAiEndpoint(s),
    apiKeyConfigured: Boolean(s.apiKeyEnc),
  };
}

export function maskAds(s: TenantAdsSetting | null) {
  return { mccs: s?.mccs ?? [] };
}

export function maskProxies(s: TenantProxiesSetting | null) {
  return { count: s?.urls.length ?? 0 };
}

// ---------------------------------------------------------------------------
// 消费端：AI 配置解析（租户覆盖全局）
// ---------------------------------------------------------------------------

/**
 * 租户 AI 设置 → LLM 配置三元组（与 ai.ts/pipeline.ts 的 LlmSettings 同构）。
 * 未完整配置（缺服务商/模型/密钥）时返回 null，调用方回退全局 AiSetting。
 */
export async function resolveTenantLlmOverride(
  prisma: PrismaClient,
  tenantId: string
): Promise<{ baseUrl: string; model: string; apiKeyEnc: string } | null> {
  const s = await getTenantSettingValue<TenantAiSetting>(prisma, tenantId, "ai");
  if (!s || !s.apiKeyEnc || !s.model) return null;
  const baseUrl = deriveAiEndpoint(s);
  if (!baseUrl) return null;
  return { baseUrl, model: s.model, apiKeyEnc: s.apiKeyEnc };
}

// ---------------------------------------------------------------------------
// 写入端（密钥加密）
// ---------------------------------------------------------------------------

export async function saveTenantAi(
  prisma: PrismaClient,
  tenantId: string,
  input: { provider: AiProvider; model: string; endpoint?: string },
  apiKeyPlain?: string
): Promise<TenantAiSetting> {
  const existing = await getTenantSettingValue<TenantAiSetting>(prisma, tenantId, "ai");
  const next: TenantAiSetting = {
    provider: input.provider,
    model: input.model,
    endpoint: input.endpoint,
    apiKeyEnc: existing?.apiKeyEnc,
  };
  if (apiKeyPlain !== undefined) {
    const pepper = assertAiSettingsPepperConfigured();
    next.apiKeyEnc = encryptSecret(apiKeyPlain, pepper);
  }
  await setTenantSettingValue(prisma, tenantId, "ai", next);
  return next;
}

export async function saveTenantProxies(
  prisma: PrismaClient,
  tenantId: string,
  plainUrls: string[]
): Promise<number> {
  if (plainUrls.length > 50) {
    throw badRequest("at most 50 proxy URLs");
  }
  const pepper = assertAiSettingsPepperConfigured();
  const urls: string[] = [];
  for (const raw of plainUrls) {
    const check = parseProxyUrl(raw);
    if (check.error) throw badRequest(check.error);
    urls.push(encryptSecret(raw.trim(), pepper));
  }
  await setTenantSettingValue(prisma, tenantId, "proxies", { urls } satisfies TenantProxiesSetting);
  return urls.length;
}
