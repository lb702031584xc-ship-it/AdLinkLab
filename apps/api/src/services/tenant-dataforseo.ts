/**
 * 租户自备 DataForSEO 凭证（BYOK）。
 *
 * 存储：tenant_settings key="dataforseo"，value 为 JSON
 * { loginEnc, passwordEnc, verifiedAt }；login/password 入库前走
 * AES-256-GCM（ai/crypto.ts，与 AI 设置/代理同一套 pepper），
 * 任何接口只回「已配置」布尔与验证时间，永不回显明文（与联盟网络
 * 凭证、租户 AI 设置同模式）。
 *
 * 消费端：付费数据网关在「租户自备 key」路径解密取用；解密失败/未配置
 * 一律返回 null（fail-soft，网关据此回落平台 key 路径）。
 */
import type { PrismaClient } from "@adlinklab/database";
import {
  assertAiSettingsPepperConfigured,
  decryptSecret,
  encryptSecret,
} from "../ai/crypto.js";
import {
  dataForSeoErrorMessage,
  readDataForSeoErrorDetail,
} from "../ai/dataforseo-error.js";
import {
  deleteTenantSetting,
  getTenantSettingValue,
  setTenantSettingValue,
} from "./tenant-settings.js";

export interface TenantDataForSeoSetting {
  loginEnc?: string;
  passwordEnc?: string;
  /** 最近一次验证成功时间（ISO）；未验证/保存后重置 → null。 */
  verifiedAt?: string | null;
}

/** DataForSEO 账户信息接口（appendix/user_data）：只读账户资料与余额，官方不计费。 */
export const DATAFORSEO_USER_DATA_URL =
  "https://api.dataforseo.com/v3/appendix/user_data";

export async function getTenantDataForSeoSetting(
  prisma: PrismaClient,
  tenantId: string
): Promise<TenantDataForSeoSetting | null> {
  return getTenantSettingValue<TenantDataForSeoSetting>(
    prisma,
    tenantId,
    "dataforseo"
  );
}

/** 脱敏序列化：只回已配置与验证时间，永不回显明文（测试锁死）。 */
export function maskDataForSeo(s: TenantDataForSeoSetting | null) {
  return {
    configured: Boolean(s?.loginEnc && s?.passwordEnc),
    verifiedAt: s?.verifiedAt ?? null,
  };
}

/** 保存租户自备凭证（两个字段都必填、全量替换；保存后验证状态重置）。 */
export async function saveTenantDataForSeo(
  prisma: PrismaClient,
  tenantId: string,
  input: { login: string; password: string }
): Promise<void> {
  const pepper = assertAiSettingsPepperConfigured();
  const next: TenantDataForSeoSetting = {
    loginEnc: encryptSecret(input.login, pepper),
    passwordEnc: encryptSecret(input.password, pepper),
    verifiedAt: null,
  };
  await setTenantSettingValue(prisma, tenantId, "dataforseo", next);
}

/** 删除租户自备凭证（删后网关自动回落平台 key 路径）。 */
export async function deleteTenantDataForSeo(
  prisma: PrismaClient,
  tenantId: string
): Promise<void> {
  await deleteTenantSetting(prisma, tenantId, "dataforseo");
}

/** 标记验证成功时间（验证接口验活后调用）。 */
export async function markTenantDataForSeoVerified(
  prisma: PrismaClient,
  tenantId: string,
  at: Date = new Date()
): Promise<void> {
  const existing = await getTenantDataForSeoSetting(prisma, tenantId);
  if (!existing?.loginEnc || !existing?.passwordEnc) return;
  await setTenantSettingValue(prisma, tenantId, "dataforseo", {
    ...existing,
    verifiedAt: at.toISOString(),
  });
}

/** 解密取租户自备凭证；未配置/解密失败 → null（fail-soft，绝不抛错）。 */
export async function getTenantDataForSeoCredentials(
  prisma: PrismaClient,
  tenantId: string
): Promise<{ login: string; password: string } | null> {
  try {
    const s = await getTenantDataForSeoSetting(prisma, tenantId);
    if (!s?.loginEnc || !s?.passwordEnc) return null;
    const pepper = assertAiSettingsPepperConfigured();
    const login = decryptSecret(s.loginEnc, pepper);
    const password = decryptSecret(s.passwordEnc, pepper);
    if (!login || !password) return null;
    return { login, password };
  } catch {
    return null;
  }
}

export class DataForSeoVerifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataForSeoVerifyError";
  }
}

/**
 * 验活：GET appendix/user_data（账户信息接口，官方不计费）。
 * 成功 → { login, balance }（balance 缺失 → null，不编造）；
 * 失败 → 抛 DataForSeoVerifyError，消息透出 DataForSEO 原文 status_message。
 */
export async function verifyDataForSeoCredentials(
  creds: { login: string; password: string },
  fetchImpl: typeof fetch = fetch
): Promise<{ login: string | null; balance: number | null }> {
  const auth = Buffer.from(`${creds.login}:${creds.password}`).toString(
    "base64"
  );
  let res: Response;
  try {
    res = await fetchImpl(DATAFORSEO_USER_DATA_URL, {
      method: "GET",
      headers: { Authorization: `Basic ${auth}` },
    });
  } catch {
    throw new DataForSeoVerifyError(
      "DataForSEO 验证失败（网络异常，未收到响应）"
    );
  }
  if (!res.ok) {
    const detail = await readDataForSeoErrorDetail(res);
    throw new DataForSeoVerifyError(dataForSeoErrorMessage(res.status, detail));
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new DataForSeoVerifyError("DataForSEO 验证失败（响应不是合法 JSON）");
  }
  const envelope = (data ?? {}) as {
    tasks?: Array<{
      status_code?: unknown;
      status_message?: unknown;
      result?: Array<{
        login?: unknown;
        money?: { balance?: unknown };
      }>;
    }>;
  };
  const task = envelope.tasks?.[0];
  const code = task?.status_code;
  if (typeof code === "number" && code >= 40000) {
    const msg =
      typeof task?.status_message === "string" ? task.status_message : "";
    throw new DataForSeoVerifyError(
      `DataForSEO 任务异常（status_code=${code}${msg ? `：${msg}` : ""}）`
    );
  }
  const result = task?.result?.[0];
  return {
    login: typeof result?.login === "string" ? result.login : null,
    balance:
      typeof result?.money?.balance === "number" &&
      Number.isFinite(result.money.balance)
        ? result.money.balance
        : null,
  };
}
