/**
 * 商品库黑白名单服务（2026-10-18）。
 *
 * 统一模块，实体类型 = 商家(merchant) / 账号(network_account) / 商品(product) / Offer(offer)，
 * 渠道 = 返利网(cashback) / 联盟(affiliate) / 亚马逊(amazon)，三渠道各自独立。
 *
 * 黑名单：被封/下架/拒登/不付钱/扣量嫌疑/跑不正的实体。同步引擎与建 Offer 时自动跳过，
 * 不再浪费请求与精力。黑名单不设自动过期（被封是事实）；删除为软删除
 * （status="removed"），保留审计链；移除后进入观察期，观察期内中性对待
 * （不拉黑、不加白，数据重新累计，不直接恢复白名单）。
 *
 * 白名单：业务白名单（与 B6 审批白名单是两套，不要混）。手动管理为主；
 * 同步引擎对"连续 3 期正常出现"的商品只生成 suggested 建议，需用户确认。
 *
 * 每次自动进黑名单都写 adminGrantAudit（CATALOG_BLACKLIST_AUTO_ADDED，
 * 商家维度用 MERCHANT_BLACKLIST_AUTO_ADDED）。绝不记录任何凭证/session 明文。
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import { ValidationError } from "@adlinklab/shared";

/** 渠道：三渠道各自独立。 */
export const CATALOG_CHANNELS = ["cashback", "affiliate", "amazon"] as const;
export type CatalogChannel = (typeof CATALOG_CHANNELS)[number];

export function isCatalogChannel(v: unknown): v is CatalogChannel {
  return (
    typeof v === "string" &&
    (CATALOG_CHANNELS as readonly string[]).includes(v)
  );
}

/**
 * 联盟 kind → 渠道映射（账号黑名单用）。
 * amazon → amazon；其余联盟 kind（impact/awin/cj/…/partnerboost/yeahpromos）→ affiliate。
 * 返利网相关账号目前无独立 kind，如有 → cashback（TODO：kind 确认后补映射）。
 */
export function networkKindToChannel(kind: string): CatalogChannel {
  const k = kind.trim().toLowerCase();
  if (k === "amazon") return "amazon";
  return "affiliate";
}

/** 黑名单实体类型。 */
export const BLACKLIST_ENTITY_TYPES = [
  "merchant",
  "network_account",
  "product",
  "offer",
] as const;
export type BlacklistEntityType = (typeof BLACKLIST_ENTITY_TYPES)[number];

/** 白名单实体类型。 */
export const WHITELIST_ENTITY_TYPES = [
  "merchant",
  "network_account",
  "product",
] as const;
export type WhitelistEntityType = (typeof WHITELIST_ENTITY_TYPES)[number];

export function isBlacklistEntityType(v: unknown): v is BlacklistEntityType {
  return (
    typeof v === "string" &&
    (BLACKLIST_ENTITY_TYPES as readonly string[]).includes(v)
  );
}

export function isWhitelistEntityType(v: unknown): v is WhitelistEntityType {
  return (
    typeof v === "string" &&
    (WHITELIST_ENTITY_TYPES as readonly string[]).includes(v)
  );
}

/** 商品库审计写入（admin-grants.ts 的 writeAudit 未导出，照抄形状）。 */
export async function writeCatalogAudit(
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

export interface BlacklistRow {
  id: string;
  tenantId: string;
  channel: string;
  entityType: string;
  entityId: string;
  networkKind: string | null;
  reason: string;
  firstSeenAt: Date;
  lastConfirmedAt: Date;
  source: string;
  createdBy: string | null;
  status: string;
  removedAt: Date | null;
  removedBy: string | null;
  removeReason: string | null;
  observationUntil: Date | null;
}

function blacklistWhere(
  tenantId: string,
  channel: string,
  entityType: string,
  entityId: string
) {
  return {
    tenantId_channel_entityType_entityId: {
      tenantId,
      channel,
      entityType,
      entityId,
    },
  };
}

/** 是否在黑名单中（仅 status="active" 的算）。 */
export async function isBlacklisted(
  prisma: PrismaClient,
  tenantId: string,
  channel: string,
  entityType: string,
  entityId: string
): Promise<boolean> {
  const row = (await prisma.catalogBlacklist.findUnique({
    where: blacklistWhere(tenantId, channel, entityType, entityId),
  })) as BlacklistRow | null;
  return row !== null && row.status === "active";
}

/** 取 active 黑名单条目（含原因），不存在 → null。 */
export async function getBlacklistEntry(
  prisma: PrismaClient,
  tenantId: string,
  channel: string,
  entityType: string,
  entityId: string
): Promise<BlacklistRow | null> {
  const row = (await prisma.catalogBlacklist.findUnique({
    where: blacklistWhere(tenantId, channel, entityType, entityId),
  })) as BlacklistRow | null;
  return row && row.status === "active" ? row : null;
}

/**
 * 加入黑名单（幂等：同一实体只保留一条 active；已存在 removed → 改回 active 并更新原因/时间；
 * 已 active → 更新 lastConfirmedAt + reason）。每次自动加入都记审计。
 */
export async function addToBlacklist(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    channel: CatalogChannel;
    entityType: BlacklistEntityType;
    entityId: string;
    networkKind?: string | null;
    reason: string;
    source: "auto" | "manual";
    createdBy?: string | null;
    grantId?: string | null;
    /** 审计 action 覆盖（商家维度用 MERCHANT_BLACKLIST_AUTO_ADDED）。 */
    auditAction?: string;
    /** 证据摘要（如 status code、周期数字），绝不含凭证/session 明文。 */
    evidence?: Record<string, unknown>;
  }
): Promise<BlacklistRow> {
  const now = new Date();
  const row = (await prisma.catalogBlacklist.upsert({
    where: blacklistWhere(
      input.tenantId,
      input.channel,
      input.entityType,
      input.entityId
    ),
    create: {
      id: randomUUID(),
      tenantId: input.tenantId,
      channel: input.channel,
      entityType: input.entityType,
      entityId: input.entityId,
      networkKind: input.networkKind ?? null,
      reason: input.reason,
      firstSeenAt: now,
      lastConfirmedAt: now,
      source: input.source,
      createdBy: input.createdBy ?? null,
      status: "active",
    },
    update: {
      channel: input.channel,
      reason: input.reason,
      lastConfirmedAt: now,
      networkKind: input.networkKind ?? null,
      source: input.source,
      // 复拉黑：旧行改回 active，清除移除标记。
      status: "active",
      removedAt: null,
      removedBy: null,
      removeReason: null,
      observationUntil: null,
    },
  })) as BlacklistRow;
  const action =
    input.auditAction ??
    (input.source === "auto"
      ? "CATALOG_BLACKLIST_AUTO_ADDED"
      : "CATALOG_BLACKLIST_ADDED");
  await writeCatalogAudit(prisma, {
    tenantId: input.tenantId,
    grantId: input.grantId ?? null,
    // 系统自动：actor 记租户（无个人操作者）；手动：记操作人。
    actorId:
      input.source === "auto" ? input.tenantId : (input.createdBy ?? input.tenantId),
    action,
    detail: {
      channel: input.channel,
      entityType: input.entityType,
      entityId: input.entityId,
      networkKind: input.networkKind ?? null,
      reason: input.reason,
      evidence: input.evidence ?? {},
    },
  });
  return row;
}

/**
 * Google Ads 政策拒登 / Preflight 明确 blocked（政策原因）→ Offer 进黑名单的接入点。
 *
 * 现状：preflight 路由是只读检查（verdict ready/degraded/blocked），没有统一的
 * "拒登写入"位置；Google Ads 侧拒登目前也无回写链路。所以本函数作为文档化的
 * 接入点：任何未来记录"政策拒登"的流程（定时拉取 Google Ads 政策状态、
 * 人工标记拒登等）都应调用本函数。调用方只需传 tenantId + offerId + reason。
 * Offer 的 channel 按其 source 映射（affiliate/amazon/cashback）。
 */
export async function blacklistOfferForPolicyViolation(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    offerId: string;
    offerSource?: string | null;
    reason: string;
    networkKind?: string | null;
    grantId?: string | null;
    evidence?: Record<string, unknown>;
  }
): Promise<BlacklistRow> {
  const channel: CatalogChannel =
    input.offerSource === "cashback"
      ? "cashback"
      : input.offerSource === "amazon"
        ? "amazon"
        : "affiliate";
  return addToBlacklist(prisma, {
    tenantId: input.tenantId,
    channel,
    entityType: "offer",
    entityId: input.offerId,
    networkKind: input.networkKind ?? null,
    reason: input.reason,
    source: "auto",
    grantId: input.grantId ?? null,
    evidence: input.evidence,
  });
}

/**
 * 观察期判断：存在 status="removed" 且 observationUntil > now 的行 → 观察期内。
 * 观察期实体：中性对待（不拉黑、不加白，数据重新累计，不直接恢复白名单）；
 * 商品推荐排序时观察期商家的商品不置顶。
 */
export async function isMerchantObserved(
  prisma: PrismaClient,
  tenantId: string,
  channel: string,
  entityType: string,
  entityId: string,
  now = new Date()
): Promise<boolean> {
  const row = (await prisma.catalogBlacklist.findUnique({
    where: blacklistWhere(tenantId, channel, entityType, entityId),
  })) as BlacklistRow | null;
  return (
    row !== null &&
    row.status === "removed" &&
    row.observationUntil !== null &&
    row.observationUntil > now
  );
}

/**
 * 移除黑名单（软删除；路由层要求 requireAdmin + reason 必填）。
 * status="removed"，observationUntil = now + policy.observationDays。
 */
export async function removeFromBlacklist(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    id: string;
    actorId: string;
    reason: string;
    observationDays: number;
  }
): Promise<BlacklistRow> {
  if (!input.reason?.trim()) {
    throw new ValidationError("移除原因（reason）必填");
  }
  const row = (await prisma.catalogBlacklist.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  })) as BlacklistRow | null;
  if (!row) throw new ValidationError("黑名单条目不存在");
  const now = new Date();
  const updated = (await prisma.catalogBlacklist.update({
    where: { id: row.id },
    data: {
      status: "removed",
      removedAt: now,
      removedBy: input.actorId,
      removeReason: input.reason.trim(),
      observationUntil: new Date(
        now.getTime() + input.observationDays * 86400 * 1000
      ),
    },
  })) as BlacklistRow;
  await writeCatalogAudit(prisma, {
    tenantId: input.tenantId,
    actorId: input.actorId,
    action: "CATALOG_BLACKLIST_REMOVED",
    detail: {
      channel: row.channel,
      entityType: row.entityType,
      entityId: row.entityId,
      reason: input.reason.trim(),
      observationUntil: updated.observationUntil?.toISOString() ?? null,
    },
  });
  return updated;
}

/* ── 白名单 ── */

export interface WhitelistRow {
  id: string;
  tenantId: string;
  channel: string;
  entityType: string;
  entityId: string;
  note: string | null;
  source: string;
  suggestedAt: Date | null;
  confirmedAt: Date | null;
}

function whitelistWhere(
  tenantId: string,
  channel: string,
  entityType: string,
  entityId: string
) {
  return {
    tenantId_channel_entityType_entityId: {
      tenantId,
      channel,
      entityType,
      entityId,
    },
  };
}

export async function isWhitelisted(
  prisma: PrismaClient,
  tenantId: string,
  channel: string,
  entityType: string,
  entityId: string
): Promise<boolean> {
  const row = await prisma.catalogWhitelist.findUnique({
    where: whitelistWhere(tenantId, channel, entityType, entityId),
  });
  return row !== null;
}

/**
 * 白名单自动建议：只建议，不自动加入。已存在（任何 source）→ 跳过，返回 null。
 * 有出单数据的以后再接（TODO）。
 */
export async function suggestWhitelistEntry(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    channel: CatalogChannel;
    entityType: WhitelistEntityType;
    entityId: string;
    note?: string | null;
  }
): Promise<WhitelistRow | null> {
  const existing = await prisma.catalogWhitelist.findUnique({
    where: whitelistWhere(
      input.tenantId,
      input.channel,
      input.entityType,
      input.entityId
    ),
  });
  if (existing) return null;
  const now = new Date();
  const row = (await prisma.catalogWhitelist.create({
    data: {
      id: randomUUID(),
      tenantId: input.tenantId,
      channel: input.channel,
      entityType: input.entityType,
      entityId: input.entityId,
      note: input.note ?? null,
      source: "suggested",
      suggestedAt: now,
    },
  })) as WhitelistRow;
  await writeCatalogAudit(prisma, {
    tenantId: input.tenantId,
    actorId: input.tenantId,
    action: "CATALOG_WHITELIST_SUGGESTED",
    detail: {
      channel: input.channel,
      entityType: input.entityType,
      entityId: input.entityId,
      note: input.note ?? null,
    },
  });
  return row;
}

/** 手动添加白名单（source=manual）。 */
export async function addWhitelistEntry(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    channel: CatalogChannel;
    entityType: WhitelistEntityType;
    entityId: string;
    note?: string | null;
    actorId: string;
  }
): Promise<WhitelistRow> {
  if (!isWhitelistEntityType(input.entityType)) {
    throw new ValidationError("entityType 非法");
  }
  const now = new Date();
  const row = (await prisma.catalogWhitelist.upsert({
    where: whitelistWhere(
      input.tenantId,
      input.channel,
      input.entityType,
      input.entityId
    ),
    create: {
      id: randomUUID(),
      tenantId: input.tenantId,
      channel: input.channel,
      entityType: input.entityType,
      entityId: input.entityId,
      note: input.note ?? null,
      source: "manual",
      confirmedAt: now,
    },
    update: {
      note: input.note ?? null,
      source: "manual",
      confirmedAt: now,
    },
  })) as WhitelistRow;
  await writeCatalogAudit(prisma, {
    tenantId: input.tenantId,
    actorId: input.actorId,
    action: "CATALOG_WHITELIST_ADDED",
    detail: {
      channel: input.channel,
      entityType: input.entityType,
      entityId: input.entityId,
    },
  });
  return row;
}

/** 确认建议 → 转为 manual（只建议不自动加入：必须经本接口确认）。 */
export async function confirmWhitelistEntry(
  prisma: PrismaClient,
  input: { tenantId: string; id: string; actorId: string }
): Promise<WhitelistRow> {
  const row = (await prisma.catalogWhitelist.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  })) as WhitelistRow | null;
  if (!row) throw new ValidationError("白名单条目不存在");
  const updated = (await prisma.catalogWhitelist.update({
    where: { id: row.id },
    data: { source: "manual", confirmedAt: new Date() },
  })) as WhitelistRow;
  await writeCatalogAudit(prisma, {
    tenantId: input.tenantId,
    actorId: input.actorId,
    action: "CATALOG_WHITELIST_CONFIRMED",
    detail: {
      channel: row.channel,
      entityType: row.entityType,
      entityId: row.entityId,
    },
  });
  return updated;
}

/** 移除白名单条目。 */
export async function removeWhitelistEntry(
  prisma: PrismaClient,
  input: { tenantId: string; id: string; actorId: string }
): Promise<void> {
  const row = await prisma.catalogWhitelist.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  });
  if (!row) throw new ValidationError("白名单条目不存在");
  await prisma.catalogWhitelist.delete({ where: { id: row.id } });
  await writeCatalogAudit(prisma, {
    tenantId: input.tenantId,
    actorId: input.actorId,
    action: "CATALOG_WHITELIST_REMOVED",
    detail: {
      channel: (row as WhitelistRow).channel,
      entityType: (row as WhitelistRow).entityType,
      entityId: (row as WhitelistRow).entityId,
    },
  });
}
