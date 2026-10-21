/**
 * 付费数据网关（DataForSEO 计费调用的统一入口）。
 *
 * 一条原则：谁出钱谁定规则。决策顺序写死，任何调用点不得绕过：
 * 1. **先判角色**：owner/admin → 直接放行（keySource="owner"），永不拦截、
 *    永不需要授权；照常记台账，消费时写一条 exempt:owner 审计
 *    （复用 rbac.isAdminRole —— 与 requireActiveGrant 同一 owner 判定，
 *    源于 2026-10-19 单管理员死锁教训，网关不得回退此规矩）。
 * 2. **租户自备 key**：租户已填自己的 DataForSEO 凭证 → 用租户 key，
 *    免授权（keySource="tenant-own"）。
 * 3. **平台 key**：用站级流量信号凭证 → 必须有一条有效的 B 级授权
 *    （capability="paid-data"，白名单 = 功能键，逐项确认；带
 *    usageLimit.maxCalls 上限与到期），否则按结构化原因拒绝：
 *    no_grant（无有效授权）/ expired（已过期）/ cap_exceeded（超限）。
 *
 * 用量两本账：
 * - paid_data_usage 台账：按 tenant × 功能 × 日期 × keySource 记 API 调用
 *   次数（三种路径都记），管理员侧按租户汇总查看。
 * - AdminGrant.usageCount：平台路径的授权计数，按「操作」+1（与
 *   catalog-sync 等既有能力同口径），达上限由 incrementGrantUsage
 *   自动停用 + 审计。
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import { AppError } from "@adlinklab/shared";
import { isAdminRole } from "../auth/rbac.js";
import {
  incrementGrantUsage,
  whitelistContains,
  type GrantRow,
} from "./admin-grants.js";
import {
  DATAFORSEO_LOGIN_SETTING,
  DATAFORSEO_PASSWORD_SETTING,
} from "../traffic/dataforseo.js";
import { readEncryptedTrafficSetting } from "../traffic/settings.js";
import { getTenantDataForSeoCredentials } from "./tenant-dataforseo.js";

export const PAID_DATA_CAPABILITY = "paid-data" as const;

/** 受网关管辖的付费功能键（同时也是 paid-data 授权的白名单值）。 */
export const PAID_DATA_FEATURES = [
  "keywords-expand",
  "keywords-intent",
  "keywords-ad-measure",
  "catalog-ad-count",
  "serp-ads",
  "brand-bidding",
] as const;
export type PaidDataFeature = (typeof PAID_DATA_FEATURES)[number];

export type PaidDataKeySource = "owner" | "tenant-own" | "platform";
export type PaidDataDenyReason = "no_grant" | "expired" | "cap_exceeded";

export interface PaidDataAccess {
  allowed: true;
  feature: PaidDataFeature;
  keySource: PaidDataKeySource;
  /** 实际要用的凭证；null = 三处都没配（调用方走既有「未配置」报错路径）。 */
  credentials: { login: string; password: string } | null;
  grantId: string | null;
  /** 平台授权剩余次数（usageLimit.maxCalls - usageCount）；无上限/非平台 → null。 */
  remainingCalls: number | null;
}

export interface PaidDataDenial {
  allowed: false;
  feature: PaidDataFeature;
  reason: PaidDataDenyReason;
}

export type PaidDataResolution = PaidDataAccess | PaidDataDenial;

export function isPaidDataFeature(v: unknown): v is PaidDataFeature {
  return (
    typeof v === "string" &&
    (PAID_DATA_FEATURES as readonly string[]).includes(v)
  );
}

const DENY_MESSAGES: Record<PaidDataDenyReason, string> = {
  no_grant:
    "付费数据未授权：使用平台 DataForSEO 额度需要管理员授予 paid-data 授权（白名单须包含该功能），或在「设置」里填入你自己的 DataForSEO 账号后免授权使用。",
  expired:
    "付费数据授权已过期：请重新向管理员申请 paid-data 授权，或在「设置」里填入你自己的 DataForSEO 账号后免授权使用。",
  cap_exceeded:
    "付费数据授权次数已用完：请向管理员申请提高上限，或在「设置」里填入你自己的 DataForSEO 账号后免授权使用。",
};

export class PaidDataDeniedError extends AppError {
  readonly reason: PaidDataDenyReason;
  readonly feature: PaidDataFeature;
  constructor(feature: PaidDataFeature, reason: PaidDataDenyReason) {
    super(DENY_MESSAGES[reason], {
      code: "PAID_DATA_DENIED",
      statusCode: 403,
      details: { reason, feature },
    });
    this.name = "PaidDataDeniedError";
    this.reason = reason;
    this.feature = feature;
  }
}

/** 平台（站级）DataForSEO 凭证；未配置 → null。 */
export async function getPlatformDataForSeoCredentials(
  prisma: PrismaClient
): Promise<{ login: string; password: string } | null> {
  const login = await readEncryptedTrafficSetting(
    prisma,
    DATAFORSEO_LOGIN_SETTING
  );
  const password = await readEncryptedTrafficSetting(
    prisma,
    DATAFORSEO_PASSWORD_SETTING
  );
  if (!login || !password) return null;
  return { login, password };
}

function grantMaxCalls(grant: GrantRow): number | null {
  const limit = grant.usageLimit as Record<string, unknown> | null;
  return typeof limit?.maxCalls === "number" ? limit.maxCalls : null;
}

/**
 * 网关决策（不消费、不计数；纯判定 + 凭证选择）。
 * GET /paid-data/access 与各付费调用点共用同一入口，口径一致。
 */
export async function resolvePaidDataAccess(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    userId: string;
    userRole: string;
    feature: PaidDataFeature;
  }
): Promise<PaidDataResolution> {
  const { feature, tenantId } = input;

  // 1) 站长/管理员直通：永不拦截、永不需要授权（凭证优先用本租户自备，其次平台）。
  if (isAdminRole(input.userRole)) {
    const own = await getTenantDataForSeoCredentials(prisma, tenantId);
    const credentials = own ?? (await getPlatformDataForSeoCredentials(prisma));
    return {
      allowed: true,
      feature,
      keySource: "owner",
      credentials,
      grantId: null,
      remainingCalls: null,
    };
  }

  // 2) 租户自备 key：免授权。
  const own = await getTenantDataForSeoCredentials(prisma, tenantId);
  if (own) {
    return {
      allowed: true,
      feature,
      keySource: "tenant-own",
      credentials: own,
      grantId: null,
      remainingCalls: null,
    };
  }

  // 3) 平台 key：必须有一条覆盖该功能、白名单逐项确认的有效授权。
  const grants = (await prisma.adminGrant.findMany({
    where: { tenantId, capability: PAID_DATA_CAPABILITY },
    orderBy: { createdAt: "desc" },
  })) as GrantRow[];
  const now = new Date();
  let sawExpired = false;
  let sawCap = false;
  for (const g of grants) {
    if (!whitelistContains(g.whitelist, feature)) continue;
    if (g.status === "stopped_limit") {
      sawCap = true;
      continue;
    }
    if (g.status !== "active") continue;
    if (g.endsAt <= now) {
      sawExpired = true;
      continue;
    }
    const max = grantMaxCalls(g);
    if (max !== null && g.usageCount >= max) {
      sawCap = true;
      continue;
    }
    return {
      allowed: true,
      feature,
      keySource: "platform",
      credentials: await getPlatformDataForSeoCredentials(prisma),
      grantId: g.id,
      remainingCalls: max !== null ? max - g.usageCount : null,
    };
  }
  return {
    allowed: false,
    feature,
    reason: sawCap ? "cap_exceeded" : sawExpired ? "expired" : "no_grant",
  };
}

/** 决策的抛错版：拒绝时抛结构化 PaidDataDeniedError（403 + reason）。 */
export async function requirePaidDataAccess(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    userId: string;
    userRole: string;
    feature: PaidDataFeature;
  }
): Promise<PaidDataAccess> {
  const r = await resolvePaidDataAccess(prisma, input);
  if (!r.allowed) throw new PaidDataDeniedError(r.feature, r.reason);
  return r;
}

/**
 * 消费记账：付费调用成功后调用。
 * - 台账 paid_data_usage 按（租户 × 功能 × UTC 日期 × key 来源）累加 calls。
 * - 平台路径同步给授权计数 +1（按操作计，与既有能力同口径；达上限
 *   incrementGrantUsage 会自动停用 + 审计）。
 * - 站长路径写一条 exempt:owner 审计（与既有 owner 豁免审计口径一致）。
 * 记账失败不抛错（不许因记账问题回滚已完成的付费调用），但台账写入失败
 * 会静默——调用方日志层另有记录，这里只保证主流程不中断。
 */
export async function recordPaidDataUsage(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    actorId: string;
    feature: PaidDataFeature;
    keySource: PaidDataKeySource;
    /** 本次实际发生的 DataForSEO 调用次数（如广告数按查询组数计）。 */
    calls?: number;
    grantId?: string | null;
  }
): Promise<void> {
  const calls = input.calls ?? 1;
  if (!Number.isFinite(calls) || calls <= 0) return;
  const now = new Date();
  const usageDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  try {
    await prisma.paidDataUsage.upsert({
      where: {
        paid_data_usage_tenant_feature_date_source_unique: {
          tenantId: input.tenantId,
          feature: input.feature,
          usageDate,
          keySource: input.keySource,
        },
      },
      create: {
        id: randomUUID(),
        tenantId: input.tenantId,
        feature: input.feature,
        usageDate,
        keySource: input.keySource,
        calls,
      },
      update: { calls: { increment: calls } },
    });
  } catch {
    // 台账写入失败不阻塞业务（见函数注释）。
  }
  if (input.keySource === "owner") {
    try {
      await prisma.adminGrantAudit.create({
        data: {
          id: randomUUID(),
          tenantId: input.tenantId,
          grantId: null,
          actorId: input.actorId,
          action: "PAID_DATA_OWNER_EXEMPT",
          detail: { exempt: "owner", feature: input.feature, calls } as never,
        },
      });
    } catch {
      // 同上。
    }
  }
  if (input.keySource === "platform" && input.grantId) {
    try {
      const grant = (await prisma.adminGrant.findUnique({
        where: { id: input.grantId },
      })) as GrantRow | null;
      if (grant && grant.status === "active") {
        await incrementGrantUsage(prisma, grant);
      }
    } catch {
      // 同上。
    }
  }
}

/** 管理员用量汇总：近 days 天台账按租户 × 功能 × 来源聚合（JS 聚合，行数有界）。 */
export async function summarizePaidDataUsage(
  prisma: PrismaClient,
  days = 30
): Promise<
  Array<{
    tenantId: string;
    feature: string;
    keySource: string;
    calls: number;
  }>
> {
  const since = new Date(Date.now() - days * 86400 * 1000);
  const rows = (await prisma.paidDataUsage.findMany({
    where: { usageDate: { gte: since } },
    select: { tenantId: true, feature: true, keySource: true, calls: true },
  })) as Array<{
    tenantId: string;
    feature: string;
    keySource: string;
    calls: number;
  }>;
  const agg = new Map<
    string,
    { tenantId: string; feature: string; keySource: string; calls: number }
  >();
  for (const r of rows) {
    const key = `${r.tenantId}|${r.feature}|${r.keySource}`;
    const cur = agg.get(key);
    if (cur) cur.calls += r.calls;
    else agg.set(key, { ...r });
  }
  return [...agg.values()].sort((a, b) => b.calls - a.calls);
}
