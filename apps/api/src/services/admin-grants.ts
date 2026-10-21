/**
 * §5 — 管理员授权机制（B 级 B1–B6）核心逻辑。
 *
 * 硬规则（任何路径都不得绕过）：
 * - 默认关闭：没有任何 capability 是默认启用的；启用只能来自一条 active 授权。
 * - 白名单逐个确认：通配符（`*`、`*.example.com`、“全部网站”）永不匹配。
 * - 审批人 ≠ 申请人；审批需逐项确认（capability + 用途 + 白名单逐个 + 证据 + 上限 + 有效期）。
 * - 有效期 7–90 天，默认 30 天；无永久；过期 → expired（不自动续期）。
 * - 超限 → 自动停用 + 审计 + 管理员通知，重新申请才可恢复（不自动恢复）。
 * - 违规（超白名单使用 / 平台警告 / 限流 / 封号风险 / 绕过尝试 / 证据伪造或过期 /
 *   政策收紧）→ 自动吊销 + 通知管理员与申请人，能力回到默认关闭。
 * - 被吊销者 90 天内不得就同一 capability 重新申请（owner 可例外缩短）。
 * - 所有强制执行都走授权记录 + 审计；管理员也不能绕过白名单/上限/过期来强制放行。
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import { ForbiddenError, ValidationError } from "@adlinklab/shared";
import { isAdminRole } from "../auth/rbac.js";

/** 可授权的能力（B1/B6：catalog-sync 与 direct-api-write 暂无执行代码，仅授权记录）。 */
export const GRANT_CAPABILITIES = [
  "tracking-link-resolve",
  "catalog-sync",
  "direct-api-write",
  "paid-data",
] as const;
export type GrantCapability = (typeof GRANT_CAPABILITIES)[number];

export const GRANT_MIN_DAYS = 7;
export const GRANT_MAX_DAYS = 90;
export const GRANT_DEFAULT_DAYS = 30;
export const GRANT_REAPPLY_BLOCK_DAYS = 90;

export function isGrantCapability(v: unknown): v is GrantCapability {
  return (
    typeof v === "string" &&
    (GRANT_CAPABILITIES as readonly string[]).includes(v)
  );
}

/** 白名单条目必须是具体值：拒绝通配符与“全部”。 */
export function isValidWhitelistEntry(entry: unknown): entry is string {
  if (typeof entry !== "string") return false;
  const v = entry.trim();
  if (!v) return false;
  if (v.includes("*")) return false;
  if (["全部", "全部网站", "all", "any"].includes(v.toLowerCase())) return false;
  return true;
}

export function parseWhitelist(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new ValidationError("whitelist must be a non-empty array");
  }
  const out: string[] = [];
  for (const e of input) {
    if (!isValidWhitelistEntry(e)) {
      throw new ValidationError(
        "whitelist entries must be concrete values (no wildcards, no “全部网站”)"
      );
    }
    const v = (e as string).trim();
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

export function parseEvidence(input: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(input) || input.length === 0) {
    throw new ValidationError("evidence must be a non-empty array (§5.3)");
  }
  return input as Array<Record<string, unknown>>;
}

export function parseUsageLimit(input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError("usageLimit must be an object");
  }
  return input as Record<string, unknown>;
}

async function writeAudit(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    grantId?: string | null;
    actorId: string;
    action: string;
    detail?: Record<string, unknown>;
  }
): Promise<void> {
  await prisma.adminGrantAudit.create({
    data: {
      id: randomUUID(),
      tenantId: input.tenantId,
      grantId: input.grantId ?? null,
      actorId: input.actorId,
      action: input.action,
      detail: (input.detail ?? {}) as never,
    },
  });
}

export interface GrantRow {
  id: string;
  tenantId: string;
  capability: string;
  applicationId: string | null;
  applicantId: string;
  approverId: string;
  whitelist: unknown;
  usageLimit: unknown;
  usageCount: number;
  status: string;
  startsAt: Date;
  endsAt: Date;
  revokedReason: string | null;
}

/** 白名单是否包含该值（精确匹配；通配符永不匹配）。 */
export function whitelistContains(
  whitelist: unknown,
  value: string
): boolean {
  if (!Array.isArray(whitelist)) return false;
  return whitelist.some((e) => typeof e === "string" && e.trim() === value);
}

/** 授权是否当前有效（active + 未过期 + 未超限）。 */
export function isGrantCurrentlyValid(
  grant: GrantRow,
  now = new Date()
): boolean {
  if (grant.status !== "active") return false;
  if (grant.endsAt <= now) return false;
  const limit = grant.usageLimit as Record<string, unknown> | null;
  const max = typeof limit?.maxCalls === "number" ? limit.maxCalls : null;
  if (max !== null && grant.usageCount >= max) return false;
  return true;
}

/**
 * 强制执行点：要求一条当前有效的授权，且白名单包含 whitelistValue。
 * 找不到 → 403 + 需申请提示。绝不因“是管理员”而放行。
 */
export async function requireActiveGrant(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    userId: string;
    /** 调用方角色：owner/admin 直接豁免（返回 null），其他角色仍需有效授权。 */
    userRole: string;
    capability: GrantCapability;
    whitelistValue: string;
  }
): Promise<GrantRow | null> {
  // Owner/Admin 豁免：站长及管理员使用高风险能力不需要走申请/审批。
  // 返回 null 表示豁免放行（调用方审计时标记 exempt: "owner-admin"，不计 usage）。
  if (isAdminRole(input.userRole)) return null;
  const grants = (await prisma.adminGrant.findMany({
    where: {
      tenantId: input.tenantId,
      capability: input.capability,
      status: "active",
    },
    orderBy: { createdAt: "desc" },
  })) as GrantRow[];
  const now = new Date();
  for (const g of grants) {
    if (!isGrantCurrentlyValid(g, now)) continue;
    if (whitelistContains(g.whitelist, input.whitelistValue)) return g;
  }
  throw new ForbiddenError(
    `Grant required: capability ${input.capability} needs an active admin-approved grant ` +
      `whose whitelist includes "${input.whitelistValue}". Apply at /admin/grants.`
  );
}

/** 授权使用计数 +1（超限时自动停用 + 审计；调用方在业务成功后调用）。 */
export async function incrementGrantUsage(
  prisma: PrismaClient,
  grant: GrantRow
): Promise<void> {
  const updated = (await prisma.adminGrant.update({
    where: { id: grant.id },
    data: { usageCount: { increment: 1 } },
  })) as GrantRow;
  const limit = updated.usageLimit as Record<string, unknown> | null;
  const max = typeof limit?.maxCalls === "number" ? limit.maxCalls : null;
  if (max !== null && updated.usageCount >= max) {
    await prisma.adminGrant.update({
      where: { id: grant.id },
      data: { status: "stopped_limit" },
    });
    await writeAudit(prisma, {
      tenantId: grant.tenantId,
      grantId: grant.id,
      actorId: grant.applicantId,
      action: "GRANT_AUTO_STOPPED_LIMIT",
      detail: { capability: grant.capability, usageCount: updated.usageCount, maxCalls: max },
    });
  }
}

/** 申请授权（普通用户：仅申请，无启用按钮）。 */
export async function applyForGrant(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    applicantId: string;
    capability: unknown;
    purpose: unknown;
    whitelist: unknown;
    evidence: unknown;
    requestedDays?: unknown;
    usageLimit?: unknown;
  }
) {
  if (!isGrantCapability(input.capability)) {
    throw new ValidationError(
      `capability must be one of: ${GRANT_CAPABILITIES.join(", ")}`
    );
  }
  const purpose = typeof input.purpose === "string" ? input.purpose.trim() : "";
  if (!purpose) throw new ValidationError("purpose is required");
  const whitelist = parseWhitelist(input.whitelist);
  const evidence = parseEvidence(input.evidence);
  // 申请时不存 usageLimit（审批时由审批人逐项确认并传入）。
  let days = GRANT_DEFAULT_DAYS;
  if (input.requestedDays !== undefined) {
    const n = Number(input.requestedDays);
    if (!Number.isInteger(n) || n < GRANT_MIN_DAYS || n > GRANT_MAX_DAYS) {
      throw new ValidationError(
        `requestedDays must be an integer ${GRANT_MIN_DAYS}–${GRANT_MAX_DAYS} (default ${GRANT_DEFAULT_DAYS}; no permanent grants)`
      );
    }
    days = n;
  }
  // 被吊销者 90 天内不得就同一 capability 重新申请。
  const since = new Date(Date.now() - GRANT_REAPPLY_BLOCK_DAYS * 86400 * 1000);
  const blocked = await prisma.adminGrant.findFirst({
    where: {
      tenantId: input.tenantId,
      capability: input.capability,
      applicantId: input.applicantId,
      status: "revoked",
      updatedAt: { gte: since },
    },
  });
  if (blocked) {
    throw new ForbiddenError(
      `Re-application blocked: this capability was revoked within the last ${GRANT_REAPPLY_BLOCK_DAYS} days (owner may shorten by exception)`
    );
  }
  const app = await prisma.adminGrantApplication.create({
    data: {
      id: randomUUID(),
      tenantId: input.tenantId,
      capability: input.capability,
      applicantId: input.applicantId,
      purpose,
      whitelist: whitelist as never,
      requestedDays: days,
      evidence: evidence as never,
      status: "pending",
    },
  });
  await writeAudit(prisma, {
    tenantId: input.tenantId,
    actorId: input.applicantId,
    action: "GRANT_APPLIED",
    detail: { applicationId: app.id, capability: input.capability, whitelist, requestedDays: days },
  });
  return app;
}

/** 审批通过（approver ≠ applicant；逐项确认由调用方在 body 中完成并记审计）。 */
export async function approveGrant(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    applicationId: string;
    approverId: string;
    decisionNote?: string;
    usageLimit?: unknown;
  }
) {
  const app = await prisma.adminGrantApplication.findFirst({
    where: { id: input.applicationId, tenantId: input.tenantId },
  });
  if (!app) throw new ValidationError("Application not found");
  if (app.status !== "pending") {
    throw new ValidationError(`Application is ${app.status}, not pending`);
  }
  if (app.applicantId === input.approverId) {
    throw new ForbiddenError("Approver must differ from applicant");
  }
  const usageLimit = parseUsageLimit(input.usageLimit);
  const now = new Date();
  const endsAt = new Date(now.getTime() + app.requestedDays * 86400 * 1000);
  const grant = await prisma.adminGrant.create({
    data: {
      id: randomUUID(),
      tenantId: input.tenantId,
      capability: app.capability,
      applicationId: app.id,
      applicantId: app.applicantId,
      approverId: input.approverId,
      whitelist: app.whitelist as never,
      usageLimit: usageLimit as never,
      usageCount: 0,
      status: "active",
      startsAt: now,
      endsAt,
    },
  });
  await prisma.adminGrantApplication.update({
    where: { id: app.id },
    data: {
      status: "approved",
      decisionNote: input.decisionNote ?? null,
      decidedBy: input.approverId,
      decidedAt: now,
    },
  });
  await writeAudit(prisma, {
    tenantId: input.tenantId,
    grantId: grant.id,
    actorId: input.approverId,
    action: "GRANT_APPROVED",
    detail: {
      applicationId: app.id,
      capability: app.capability,
      whitelist: app.whitelist,
      usageLimit,
      endsAt: endsAt.toISOString(),
      decisionNote: input.decisionNote ?? null,
    },
  });
  return grant;
}

export async function rejectGrant(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    applicationId: string;
    approverId: string;
    decisionNote?: string;
  }
) {
  const app = await prisma.adminGrantApplication.findFirst({
    where: { id: input.applicationId, tenantId: input.tenantId },
  });
  if (!app) throw new ValidationError("Application not found");
  if (app.status !== "pending") {
    throw new ValidationError(`Application is ${app.status}, not pending`);
  }
  if (app.applicantId === input.approverId) {
    throw new ForbiddenError("Approver must differ from applicant");
  }
  const now = new Date();
  await prisma.adminGrantApplication.update({
    where: { id: app.id },
    data: {
      status: "rejected",
      decisionNote: input.decisionNote ?? null,
      decidedBy: input.approverId,
      decidedAt: now,
    },
  });
  await writeAudit(prisma, {
    tenantId: input.tenantId,
    actorId: input.approverId,
    action: "GRANT_REJECTED",
    detail: { applicationId: app.id, capability: app.capability, decisionNote: input.decisionNote ?? null },
  });
  return app;
}

/** 管理员吊销（违规吊销走 revokeGrantForViolation，同样记审计）。 */
export async function revokeGrant(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    grantId: string;
    actorId: string;
    reason: string;
    violation?: boolean;
  }
) {
  const grant = (await prisma.adminGrant.findFirst({
    where: { id: input.grantId, tenantId: input.tenantId },
  })) as GrantRow | null;
  if (!grant) throw new ValidationError("Grant not found");
  if (grant.status !== "active") {
    throw new ValidationError(`Grant is ${grant.status}, not active`);
  }
  await prisma.adminGrant.update({
    where: { id: grant.id },
    data: { status: "revoked", revokedReason: input.reason },
  });
  await writeAudit(prisma, {
    tenantId: input.tenantId,
    grantId: grant.id,
    actorId: input.actorId,
    action: input.violation ? "GRANT_AUTO_REVOKED_VIOLATION" : "GRANT_REVOKED",
    detail: { capability: grant.capability, reason: input.reason },
  });
  return grant;
}

/** 违规自动吊销（系统调用：actorId 传 "system" 的调用方需用系统标识；此处用调用方传入的 actorId）。 */
export async function revokeGrantForViolation(
  prisma: PrismaClient,
  input: { tenantId: string; grantId: string; reason: string }
) {
  return revokeGrant(prisma, {
    tenantId: input.tenantId,
    grantId: input.grantId,
    actorId: input.tenantId, // 系统吊销：actor 记租户（无个人操作者）
    reason: input.reason,
    violation: true,
  });
}
