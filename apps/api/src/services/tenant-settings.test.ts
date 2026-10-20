/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
/**
 * 每租户系统设置服务测试（in-memory fake Prisma）。
 *
 * 覆盖：KV roundtrip；AI 输入校验（relay 需端点）；MCC 列表校验（Customer ID 格式）；
 * 代理 URL 格式（直连 3 式 + IPRocket API；非法拒绝）；代理/密钥入库加密；
 * 租户覆盖解析（配全才生效/缺一不可）；脱敏输出不含明文与密文。
 */
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@adlinklab/database";
import {
  DEFAULT_SYSTEM_SETTING,
  deriveAiEndpoint,
  getTenantSettingValue,
  maskAi,
  maskProxies,
  parseProxyUrl,
  resolveTenantLlmOverride,
  saveTenantAi,
  saveTenantProxies,
  validateAiInput,
  validateMccList,
  validateSystemInput,
  type TenantAiSetting,
} from "./tenant-settings.js";
import { decryptSecret } from "../ai/crypto.js";

const TENANT = "11111111-1111-4111-8111-111111111111";

function makeFakePrisma() {
  const rows = new Map<string, { tenantId: string; key: string; value: string }>();
  const prisma = {
    tenantSetting: {
      findUnique: async ({ where }: any) => {
        const { tenantId, key } = where.tenant_settings_tenant_key_unique;
        const row = rows.get(`${tenantId}:${key}`);
        return row ? { ...row } : null;
      },
      upsert: async ({ where, create, update }: any) => {
        const { tenantId, key } = where.tenant_settings_tenant_key_unique;
        const k = `${tenantId}:${key}`;
        const existing = rows.get(k);
        if (existing) {
          rows.set(k, { ...existing, value: update.value });
        } else {
          rows.set(k, { tenantId: create.tenantId, key: create.key, value: create.value });
        }
        return {};
      },
      deleteMany: async ({ where }: any) => {
        rows.delete(`${where.tenantId}:${where.key}`);
        return { count: 1 };
      },
    },
  };
  return { prisma: prisma as unknown as PrismaClient, rows };
}

describe("tenant-settings service", () => {
  it("KV roundtrip + tenant isolation", async () => {
    const { prisma } = makeFakePrisma();
    await saveTenantAi(prisma, TENANT, { provider: "deepseek", model: "deepseek-flash" }, "sk-test-key");
    const saved = await getTenantSettingValue<TenantAiSetting>(prisma, TENANT, "ai");
    expect(saved?.provider).toBe("deepseek");
    const other = await getTenantSettingValue<TenantAiSetting>(
      prisma,
      "22222222-2222-4222-8222-222222222222",
      "ai"
    );
    expect(other).toBeNull();
  });

  it("API Key 入库加密，解密可还原；脱敏不含密文", async () => {
    const { prisma, rows } = makeFakePrisma();
    const saved = await saveTenantAi(prisma, TENANT, { provider: "gemini", model: "gemini-2.5-flash" }, "AIza-secret");
    expect(saved.apiKeyEnc).toBeTruthy();
    expect(saved.apiKeyEnc).not.toContain("AIza-secret");
    const raw = rows.get(`${TENANT}:ai`)?.value ?? "";
    expect(raw).not.toContain("AIza-secret");
    const masked = maskAi(saved);
    expect(masked.apiKeyConfigured).toBe(true);
    expect(JSON.stringify(masked)).not.toContain(saved.apiKeyEnc);
    // VITEST 环境走 TEST pepper
    const { resolveAiSettingsPepper } = await import("../ai/crypto.js");
    expect(decryptSecret(saved.apiKeyEnc!, resolveAiSettingsPepper())).toBe("AIza-secret");
  });

  it("端点派生：官方自动、relay 用填写值", () => {
    expect(deriveAiEndpoint({ provider: "deepseek", model: "deepseek-flash" })).toBe(
      "https://api.deepseek.com"
    );
    expect(deriveAiEndpoint({ provider: "gemini", model: "gemini-2.5-flash" })).toContain(
      "generativelanguage.googleapis.com"
    );
    expect(
      deriveAiEndpoint({ provider: "relay", model: "x", endpoint: "https://relay.example/v1" })
    ).toBe("https://relay.example/v1");
  });

  it("AI 输入校验：relay 必须给端点；非法服务商拒绝", () => {
    expect(() => validateAiInput({ provider: "relay", model: "m" })).toThrow();
    expect(validateAiInput({ provider: "relay", model: "m", endpoint: "https://r.example" }).endpoint).toBe(
      "https://r.example"
    );
    expect(() => validateAiInput({ provider: "openai", model: "m" })).toThrow();
    expect(() => validateAiInput({ provider: "deepseek", model: "" })).toThrow();
  });

  it("MCC 校验：123-456-7890 与 10 位数字通过，其余拒绝", () => {
    expect(
      validateMccList([{ name: "生产", customerId: "123-456-7890", mode: "script" }])
    ).toHaveLength(1);
    expect(
      validateMccList([{ name: "生产", customerId: "1234567890", mode: "api" }])[0].customerId
    ).toBe("1234567890");
    expect(() =>
      validateMccList([{ name: "x", customerId: "12345", mode: "script" }])
    ).toThrow();
    expect(() =>
      validateMccList([{ name: "x", customerId: "123-456-7890", mode: "auto" }])
    ).toThrow();
  });

  it("代理格式：三种直连式 + IPRocket 通过；垃圾字符串拒绝", () => {
    expect(parseProxyUrl("usdata.adv.tnbproxy.com:4104:user-loc-US:pass").error).toBeUndefined();
    expect(parseProxyUrl("user:pass@pr.oxylabs.io:7777").error).toBeUndefined();
    expect(parseProxyUrl("https://user:pass@pr.oxylabs.io:7777").error).toBeUndefined();
    expect(parseProxyUrl("https://api.iprocket.io/api?username=u&password=p&cc=US").kind).toBe("api");
    expect(parseProxyUrl("not-a-proxy").error).toBeTruthy();
    expect(parseProxyUrl("").error).toBeTruthy();
  });

  it("代理入库：整表加密；非法项整批拒绝", async () => {
    const { prisma, rows } = makeFakePrisma();
    const count = await saveTenantProxies(prisma, TENANT, [
      "h:8080:u:p1",
      "u:p2@h2:9090",
    ]);
    expect(count).toBe(2);
    const raw = rows.get(`${TENANT}:proxies`)?.value ?? "";
    expect(raw).not.toContain("p1");
    expect(raw).not.toContain("p2");
    await expect(saveTenantProxies(prisma, TENANT, ["garbage!!"])).rejects.toThrow();
  });

  it("租户覆盖：配全才生效；缺 key 回退 null", async () => {
    const { prisma } = makeFakePrisma();
    expect(await resolveTenantLlmOverride(prisma, TENANT)).toBeNull();
    await saveTenantAi(prisma, TENANT, { provider: "deepseek", model: "deepseek-flash" }, "sk-x");
    const override = await resolveTenantLlmOverride(prisma, TENANT);
    expect(override).toMatchObject({
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-flash",
    });
    expect(override?.apiKeyEnc).toBeTruthy();
  });

  it("系统偏好校验与默认值", () => {
    expect(
      validateSystemInput({
        defaultCurrency: "CNY",
        linkCheckEnabled: true,
        linkCheckHour: 3,
        linkCheckMinute: 30,
      })
    ).toMatchObject({ defaultCurrency: "CNY", linkCheckHour: 3 });
    expect(() =>
      validateSystemInput({
        defaultCurrency: "BTC",
        linkCheckEnabled: true,
        linkCheckHour: 3,
        linkCheckMinute: 30,
      })
    ).toThrow();
    expect(() =>
      validateSystemInput({
        defaultCurrency: "USD",
        linkCheckEnabled: true,
        linkCheckHour: 24,
        linkCheckMinute: 0,
      })
    ).toThrow();
    expect(DEFAULT_SYSTEM_SETTING.defaultCurrency).toBe("USD");
  });

  it("清空代理后 count=0 脱敏", async () => {
    const { prisma } = makeFakePrisma();
    await saveTenantProxies(prisma, TENANT, []);
    const row = await getTenantSettingValue<{ urls: string[] }>(prisma, TENANT, "proxies");
    expect(maskProxies(row)).toEqual({ count: 0 });
  });
});
