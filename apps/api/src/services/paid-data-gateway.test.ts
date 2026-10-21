/**
 * 付费数据网关决策矩阵（fake prisma，无 DB）。
 *
 * 决策顺序写死：owner/admin 直通 → 租户自备 key 免授权 → 平台 key + 有效
 * paid-data 授权。覆盖：owner 豁免回归（无授权无自备 key 也放行）、
 * tenant-own、platform 放行 + remainingCalls、no_grant / expired /
 * cap_exceeded（含 stopped_limit）、白名单不含功能 → no_grant；
 * 记账：台账 upsert、owner 的 exempt:owner 审计、平台授权计数 +1。
 */
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@adlinklab/database";
import { encryptSecret, TEST_AI_SETTINGS_PEPPER } from "../ai/crypto.js";
import {
  PaidDataDeniedError,
  recordPaidDataUsage,
  requirePaidDataAccess,
  resolvePaidDataAccess,
} from "./paid-data-gateway.js";
import type { GrantRow } from "./admin-grants.js";

const TENANT = "t1";
const enc = (s: string) => encryptSecret(s, TEST_AI_SETTINGS_PEPPER);

function grantRow(over: Partial<GrantRow> = {}): GrantRow {
  return {
    id: "g1",
    tenantId: TENANT,
    capability: "paid-data",
    applicationId: null,
    applicantId: "u2",
    approverId: "admin1",
    whitelist: ["catalog-ad-count", "keywords-expand"],
    usageLimit: { maxCalls: 10 },
    usageCount: 3,
    status: "active",
    startsAt: new Date(Date.now() - 86400_000),
    endsAt: new Date(Date.now() + 86400_000),
    revokedReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as GrantRow;
}

interface FakeState {
  usageUpserts: Array<Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
  grantUpdates: Array<Record<string, unknown>>;
}

function makePrisma(opts: {
  tenantCreds?: { login: string; password: string } | null;
  platformCreds?: { login: string; password: string } | null;
  grants?: GrantRow[];
}): { prisma: PrismaClient; state: FakeState } {
  const state: FakeState = { usageUpserts: [], audits: [], grantUpdates: [] };
  const grants = opts.grants ?? [];
  const prisma = {
    tenantSetting: {
      findUnique: async () =>
        opts.tenantCreds
          ? {
              value: JSON.stringify({
                loginEnc: enc(opts.tenantCreds.login),
                passwordEnc: enc(opts.tenantCreds.password),
                verifiedAt: null,
              }),
            }
          : null,
    },
    aiSetting: {
      findUnique: async ({ where }: { where: { key: string } }) => {
        if (!opts.platformCreds) return null;
        if (where.key === "traffic.dataforseoLogin")
          return { value: enc(opts.platformCreds.login) };
        if (where.key === "traffic.dataforseoPassword")
          return { value: enc(opts.platformCreds.password) };
        return null;
      },
    },
    adminGrant: {
      findMany: async () => grants,
      findUnique: async ({ where }: { where: { id: string } }) =>
        grants.find((g) => g.id === where.id) ?? null,
      update: async (args: Record<string, unknown>) => {
        state.grantUpdates.push(args);
        return {};
      },
    },
    adminGrantAudit: {
      create: async (args: { data: Record<string, unknown> }) => {
        state.audits.push(args.data);
        return {};
      },
    },
    paidDataUsage: {
      upsert: async (args: Record<string, unknown>) => {
        state.usageUpserts.push(args);
        return {};
      },
    },
  };
  return { prisma: prisma as unknown as PrismaClient, state };
}

const member = { tenantId: TENANT, userId: "u-member", userRole: "member" };
const FEATURE = "catalog-ad-count" as const;

describe("resolvePaidDataAccess 决策矩阵", () => {
  it("owner 直通：无授权、无自备 key 也放行（豁免回归锁死）", async () => {
    const { prisma } = makePrisma({});
    const r = await resolvePaidDataAccess(prisma, {
      ...member,
      userRole: "owner",
      feature: FEATURE,
    });
    expect(r.allowed).toBe(true);
    if (r.allowed) {
      expect(r.keySource).toBe("owner");
      expect(r.credentials).toBeNull();
      expect(r.grantId).toBeNull();
    }
  });

  it("admin 同 owner 直通；有平台凭证时带回平台凭证", async () => {
    const { prisma } = makePrisma({
      platformCreds: { login: "plat@x.dev", password: "platpw" },
    });
    const r = await resolvePaidDataAccess(prisma, {
      ...member,
      userRole: "admin",
      feature: FEATURE,
    });
    expect(r.allowed).toBe(true);
    if (r.allowed) {
      expect(r.keySource).toBe("owner");
      expect(r.credentials).toEqual({ login: "plat@x.dev", password: "platpw" });
    }
  });

  it("租户自备 key：免授权放行，凭证为租户自己的（优先于平台）", async () => {
    const { prisma } = makePrisma({
      tenantCreds: { login: "mine@x.dev", password: "minepw" },
      platformCreds: { login: "plat@x.dev", password: "platpw" },
      grants: [],
    });
    const r = await resolvePaidDataAccess(prisma, { ...member, feature: FEATURE });
    expect(r.allowed).toBe(true);
    if (r.allowed) {
      expect(r.keySource).toBe("tenant-own");
      expect(r.credentials).toEqual({ login: "mine@x.dev", password: "minepw" });
    }
  });

  it("平台 key + 有效授权 → 放行，remainingCalls = 上限 - 已用", async () => {
    const { prisma } = makePrisma({
      platformCreds: { login: "plat@x.dev", password: "platpw" },
      grants: [grantRow()],
    });
    const r = await resolvePaidDataAccess(prisma, { ...member, feature: FEATURE });
    expect(r.allowed).toBe(true);
    if (r.allowed) {
      expect(r.keySource).toBe("platform");
      expect(r.grantId).toBe("g1");
      expect(r.remainingCalls).toBe(7);
      expect(r.credentials).toEqual({ login: "plat@x.dev", password: "platpw" });
    }
  });

  it("无授权 → no_grant；require 版抛 PaidDataDeniedError(403)", async () => {
    const { prisma } = makePrisma({
      platformCreds: { login: "p", password: "p" },
      grants: [],
    });
    const r = await resolvePaidDataAccess(prisma, { ...member, feature: FEATURE });
    expect(r).toEqual({ allowed: false, feature: FEATURE, reason: "no_grant" });
    await expect(
      requirePaidDataAccess(prisma, { ...member, feature: FEATURE })
    ).rejects.toBeInstanceOf(PaidDataDeniedError);
  });

  it("授权白名单不含该功能 → no_grant（禁通配、逐项确认）", async () => {
    const { prisma } = makePrisma({
      platformCreds: { login: "p", password: "p" },
      grants: [grantRow({ whitelist: ["keywords-expand"] })],
    });
    const r = await resolvePaidDataAccess(prisma, { ...member, feature: FEATURE });
    expect(r).toEqual({ allowed: false, feature: FEATURE, reason: "no_grant" });
  });

  it("授权已过期 → expired", async () => {
    const { prisma } = makePrisma({
      platformCreds: { login: "p", password: "p" },
      grants: [grantRow({ endsAt: new Date(Date.now() - 1000) })],
    });
    const r = await resolvePaidDataAccess(prisma, { ...member, feature: FEATURE });
    expect(r).toEqual({ allowed: false, feature: FEATURE, reason: "expired" });
  });

  it("授权次数用满 → cap_exceeded；stopped_limit 同样归 cap_exceeded", async () => {
    const full = makePrisma({
      platformCreds: { login: "p", password: "p" },
      grants: [grantRow({ usageCount: 10 })],
    });
    expect(
      await resolvePaidDataAccess(full.prisma, { ...member, feature: FEATURE })
    ).toEqual({ allowed: false, feature: FEATURE, reason: "cap_exceeded" });

    const stopped = makePrisma({
      platformCreds: { login: "p", password: "p" },
      grants: [grantRow({ status: "stopped_limit" })],
    });
    expect(
      await resolvePaidDataAccess(stopped.prisma, { ...member, feature: FEATURE })
    ).toEqual({ allowed: false, feature: FEATURE, reason: "cap_exceeded" });
  });
});

describe("recordPaidDataUsage 记账", () => {
  it("owner 路径：写台账 + exempt:owner 审计", async () => {
    const { prisma, state } = makePrisma({});
    await recordPaidDataUsage(prisma, {
      tenantId: TENANT,
      actorId: "u-owner",
      feature: FEATURE,
      keySource: "owner",
      calls: 2,
    });
    expect(state.usageUpserts).toHaveLength(1);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0].action).toBe("PAID_DATA_OWNER_EXEMPT");
    expect((state.audits[0].detail as Record<string, unknown>).exempt).toBe("owner");
  });

  it("platform 路径：写台账 + 授权计数递增（incrementGrantUsage → update）", async () => {
    const { prisma, state } = makePrisma({ grants: [grantRow()] });
    await recordPaidDataUsage(prisma, {
      tenantId: TENANT,
      actorId: "u-member",
      feature: FEATURE,
      keySource: "platform",
      calls: 1,
      grantId: "g1",
    });
    expect(state.usageUpserts).toHaveLength(1);
    expect(state.grantUpdates.length).toBeGreaterThanOrEqual(1);
  });

  it("tenant-own 路径：只写台账，不动授权计数、不写豁免审计", async () => {
    const { prisma, state } = makePrisma({});
    await recordPaidDataUsage(prisma, {
      tenantId: TENANT,
      actorId: "u-member",
      feature: FEATURE,
      keySource: "tenant-own",
      calls: 3,
    });
    expect(state.usageUpserts).toHaveLength(1);
    expect(state.audits).toHaveLength(0);
    expect(state.grantUpdates).toHaveLength(0);
  });
});
