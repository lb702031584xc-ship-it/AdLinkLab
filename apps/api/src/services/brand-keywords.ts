/**
 * 清单 #3 — 品牌词分级管理（服务层）。
 *
 * 规则（以 schema 注释为准）：
 * - 新建品牌词默认开启竞价（biddingEnabled=true）、状态 ACTIVE；
 *   不做任何事前禁用或拦截。
 * - 第一次警告即自动降级：status=DOWNGRADED 且 biddingEnabled=false；
 *   后续警告保持降级，warningCount 继续累加。
 * - 人工恢复（reenable）把状态与开关一起还原为 ACTIVE / true，
 *   警告计数与最后一次警告记录保留（审计用，不清零）。
 *
 * 所有查询一律以 tenantId 过滤；跨租户访问一律按“不存在”处理
 * （NotFoundError），不泄露他租户记录的存在性。
 */
import { randomUUID } from "node:crypto";
import { NotFoundError, ValidationError } from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";

export const BRAND_KEYWORD_STATUSES = ["ACTIVE", "DOWNGRADED", "PAUSED"] as const;
export type BrandKeywordStatus = (typeof BRAND_KEYWORD_STATUSES)[number];

export const WARNING_KINDS = [
  "ADVERTISER_REJECT",
  "NETWORK_WARNING",
  "OTHER",
] as const;
export type WarningKind = (typeof WARNING_KINDS)[number];

export interface BrandKeywordRow {
  id: string;
  tenantId: string;
  keyword: string;
  brand: string | null;
  offerId: string | null;
  biddingEnabled: boolean;
  status: string;
  warningCount: number;
  lastWarningKind: string | null;
  lastWarningAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBrandKeywordInput {
  keyword: string;
  brand?: string | null;
  offerId?: string | null;
}

export interface UpdateBrandKeywordPatch {
  biddingEnabled?: boolean;
  status?: BrandKeywordStatus;
  brand?: string | null;
  offerId?: string | null;
}

export function serializeBrandKeyword(row: BrandKeywordRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    keyword: row.keyword,
    brand: row.brand,
    offerId: row.offerId,
    biddingEnabled: row.biddingEnabled,
    status: row.status,
    warningCount: row.warningCount,
    lastWarningKind: row.lastWarningKind,
    lastWarningAt: row.lastWarningAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function assertValidStatus(status: unknown): BrandKeywordStatus {
  if (
    typeof status !== "string" ||
    !(BRAND_KEYWORD_STATUSES as readonly string[]).includes(status)
  ) {
    throw new ValidationError(
      `status must be one of: ${BRAND_KEYWORD_STATUSES.join(", ")}`
    );
  }
  return status as BrandKeywordStatus;
}

export function assertValidWarningKind(kind: unknown): WarningKind {
  if (
    typeof kind !== "string" ||
    !(WARNING_KINDS as readonly string[]).includes(kind)
  ) {
    throw new ValidationError(
      `kind must be one of: ${WARNING_KINDS.join(", ")}`
    );
  }
  return kind as WarningKind;
}

export async function listBrandKeywords(
  prisma: PrismaClient,
  tenantId: string
): Promise<BrandKeywordRow[]> {
  const rows = await prisma.brandKeyword.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });
  return rows as unknown as BrandKeywordRow[];
}

export async function createBrandKeyword(
  prisma: PrismaClient,
  tenantId: string,
  input: CreateBrandKeywordInput
): Promise<BrandKeywordRow> {
  if (!input.keyword || !input.keyword.trim()) {
    throw new ValidationError("keyword is required");
  }
  const row = await prisma.brandKeyword.create({
    data: {
      id: randomUUID(),
      tenantId,
      keyword: input.keyword.trim(),
      brand: input.brand ?? null,
      offerId: input.offerId ?? null,
      biddingEnabled: true,
      status: "ACTIVE",
      warningCount: 0,
    },
  });
  return row as unknown as BrandKeywordRow;
}

export async function getBrandKeywordOr404(
  prisma: PrismaClient,
  tenantId: string,
  id: string
): Promise<BrandKeywordRow> {
  const row = await prisma.brandKeyword.findFirst({
    where: { id, tenantId },
  });
  if (!row) {
    throw new NotFoundError("BrandKeyword", id);
  }
  return row as unknown as BrandKeywordRow;
}

export async function updateBrandKeyword(
  prisma: PrismaClient,
  tenantId: string,
  id: string,
  patch: UpdateBrandKeywordPatch
): Promise<BrandKeywordRow> {
  await getBrandKeywordOr404(prisma, tenantId, id);
  const data: {
    biddingEnabled?: boolean;
    status?: string;
    brand?: string | null;
    offerId?: string | null;
  } = {};
  if (patch.biddingEnabled !== undefined) {
    data.biddingEnabled = patch.biddingEnabled;
  }
  if (patch.status !== undefined) {
    data.status = assertValidStatus(patch.status);
  }
  if (patch.brand !== undefined) {
    data.brand = patch.brand;
  }
  if (patch.offerId !== undefined) {
    data.offerId = patch.offerId;
  }
  const row = await prisma.brandKeyword.update({
    where: { id },
    data,
  });
  return row as unknown as BrandKeywordRow;
}

/**
 * 记录一次警告并自动降级：warningCount+1，记录 kind/at，
 * status=DOWNGRADED 且 biddingEnabled=false。后续警告保持降级，
 * 计数继续累加。
 */
export async function recordBrandKeywordWarning(
  prisma: PrismaClient,
  tenantId: string,
  id: string,
  kind: WarningKind
): Promise<BrandKeywordRow> {
  await getBrandKeywordOr404(prisma, tenantId, id);
  const row = await prisma.brandKeyword.update({
    where: { id },
    data: {
      warningCount: { increment: 1 },
      lastWarningKind: kind,
      lastWarningAt: new Date(),
      status: "DOWNGRADED",
      biddingEnabled: false,
    },
  });
  return row as unknown as BrandKeywordRow;
}

/** 人工恢复：status=ACTIVE 且 biddingEnabled=true（警告历史保留）。 */
export async function reenableBrandKeyword(
  prisma: PrismaClient,
  tenantId: string,
  id: string
): Promise<BrandKeywordRow> {
  await getBrandKeywordOr404(prisma, tenantId, id);
  const row = await prisma.brandKeyword.update({
    where: { id },
    data: { status: "ACTIVE", biddingEnabled: true },
  });
  return row as unknown as BrandKeywordRow;
}
