/**
 * BYOK（租户自备 DataForSEO key）存储与脱敏（fake prisma，无 DB）。
 * 锁死口径：入库只有密文（存储串不含明文）、mask 只回 configured /
 * verifiedAt、保存→读取解密回环可用、删除后回落未配置。
 */
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@adlinklab/database";
import {
  deleteTenantDataForSeo,
  getTenantDataForSeoCredentials,
  getTenantDataForSeoSetting,
  maskDataForSeo,
  saveTenantDataForSeo,
} from "./tenant-dataforseo.js";

function makePrisma() {
  const store = new Map<string, string>();
  const prisma = {
    tenantSetting: {
      findUnique: async ({
        where,
      }: {
        where: { tenant_settings_tenant_key_unique: { tenantId: string; key: string } };
      }) => {
        const u = where.tenant_settings_tenant_key_unique;
        const v = store.get(`${u.tenantId}|${u.key}`);
        return v === undefined ? null : { value: v };
      },
      upsert: async (args: {
        where: { tenant_settings_tenant_key_unique: { tenantId: string; key: string } };
        create: { value: string };
        update: { value: string };
      }) => {
        const u = args.where.tenant_settings_tenant_key_unique;
        store.set(`${u.tenantId}|${u.key}`, args.create.value);
        return {};
      },
      deleteMany: async ({
        where,
      }: {
        where: { tenantId: string; key: string };
      }) => {
        store.delete(`${where.tenantId}|${where.key}`);
        return { count: 1 };
      },
    },
  };
  return { prisma: prisma as unknown as PrismaClient, store };
}

describe("tenant-dataforseo BYOK", () => {
  it("保存后存储串不含明文 login/password（只存密文）", async () => {
    const { prisma, store } = makePrisma();
    await saveTenantDataForSeo(prisma, "t1", {
      login: "me@example.com",
      password: "super-secret-pw",
    });
    const raw = [...store.values()].join("\n");
    expect(raw).not.toContain("super-secret-pw");
    expect(raw).not.toContain("me@example.com");
  });

  it("读取回环：解密得到原始凭证；mask 只回 configured/verifiedAt", async () => {
    const { prisma } = makePrisma();
    await saveTenantDataForSeo(prisma, "t1", {
      login: "me@example.com",
      password: "super-secret-pw",
    });
    const creds = await getTenantDataForSeoCredentials(prisma, "t1");
    expect(creds).toEqual({ login: "me@example.com", password: "super-secret-pw" });
    const masked = maskDataForSeo(await getTenantDataForSeoSetting(prisma, "t1"));
    expect(masked.configured).toBe(true);
    expect(masked.verifiedAt).toBeNull();
    const json = JSON.stringify(masked);
    expect(json).not.toContain("super-secret-pw");
    expect(json).not.toContain("me@example.com");
    expect(Object.keys(masked).sort()).toEqual(["configured", "verifiedAt"]);
  });

  it("未配置 → credentials null、mask configured=false", async () => {
    const { prisma } = makePrisma();
    expect(await getTenantDataForSeoCredentials(prisma, "t1")).toBeNull();
    expect(maskDataForSeo(await getTenantDataForSeoSetting(prisma, "t1"))).toEqual({
      configured: false,
      verifiedAt: null,
    });
  });

  it("删除后回落未配置（网关据此回落平台 key 路径）", async () => {
    const { prisma } = makePrisma();
    await saveTenantDataForSeo(prisma, "t1", { login: "a@b.c", password: "pw" });
    await deleteTenantDataForSeo(prisma, "t1");
    expect(await getTenantDataForSeoCredentials(prisma, "t1")).toBeNull();
  });

  it("按租户隔离：t2 读不到 t1 的凭证", async () => {
    const { prisma } = makePrisma();
    await saveTenantDataForSeo(prisma, "t1", { login: "a@b.c", password: "pw" });
    expect(await getTenantDataForSeoCredentials(prisma, "t2")).toBeNull();
  });
});
