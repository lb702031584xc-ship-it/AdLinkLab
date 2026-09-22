import type {
  Ad,
  AdGroup,
  AdGroupCriterion,
  AuditLog,
  Campaign,
  Click,
  Conversion,
  GoogleAccount,
  LandingPage,
  Offer,
  Order,
  SyncJob,
  Tenant,
  TrackingLink,
  TrackingLinkOffer,
  UrlChangeRequest,
  UrlEntityType,
  UrlVersion,
  User,
  AdRepository,
  AdGroupCriterionRepository,
  AdGroupRepository,
  AuditLogRepository,
  CampaignRepository,
  ClickRepository,
  ConversionRepository,
  GoogleAccountRepository,
  LandingPageRepository,
  OfferRepository,
  OrderRepository,
  SyncJobRepository,
  TenantRepository,
  TrackingLinkOfferRepository,
  TrackingLinkRepository,
  UrlChangeRequestRepository,
  UrlVersionRepository,
  UrlVersionStatusPatch,
  UserRepository,
} from "@adlinklab/domain";
import {
  createPaginatedResult,
  ConflictError,
  NotFoundError,
  type PaginationInput,
} from "@adlinklab/shared";
import type { Prisma, PrismaClient, SyncJobStatus as PrismaSyncJobStatus } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";
import { asRecord, asUnknownRecord, normalizePagination } from "../utils.js";
import {
  PrismaGoogleAdsScriptIntegrationRepository,
  PrismaScriptSyncLogRepository,
  PrismaScriptSyncTargetRepository,
} from "./script-integration-repositories.js";

export {
  PrismaGoogleAdsScriptIntegrationRepository,
  PrismaScriptSyncLogRepository,
  PrismaScriptSyncTargetRepository,
} from "./script-integration-repositories.js";

type DecimalLike = { toString(): string };

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function rethrowUniqueAsConflict(error: unknown, message: string): never {
  if (isUniqueViolation(error)) {
    throw new ConflictError(message, {
      prismaCode: "P2002",
      meta: (error as PrismaNamespace.PrismaClientKnownRequestError).meta,
    });
  }
  throw error;
}

function decimalToString(value: DecimalLike | null | undefined): string | undefined {
  if (value == null) return undefined;
  return value.toString();
}

function toTenant(row: {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  deletedAt: Date | null;
}): Tenant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status as Tenant["status"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt ?? undefined,
    deletedAt: row.deletedAt ?? undefined,
  };
}

function toUser(row: {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  deletedAt: Date | null;
}): User {
  return {
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    name: row.name,
    status: row.status as User["status"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt ?? undefined,
    deletedAt: row.deletedAt ?? undefined,
  };
}

function toGoogleAccount(row: {
  id: string;
  tenantId: string;
  userId: string;
  customerId: string;
  managerCustomerId: string | null;
  name: string;
  currency: string;
  timezone: string;
  oauthCredentialRef: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  deletedAt: Date | null;
}): GoogleAccount {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    customerId: row.customerId,
    googleCustomerId: row.customerId,
    managerCustomerId: row.managerCustomerId ?? undefined,
    name: row.name,
    descriptiveName: row.name,
    currency: row.currency,
    currencyCode: row.currency,
    timezone: row.timezone,
    timeZone: row.timezone,
    oauthCredentialRef: row.oauthCredentialRef ?? undefined,
    status: row.status as GoogleAccount["status"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt ?? undefined,
    deletedAt: row.deletedAt ?? undefined,
  };
}

function googleAccountCreateData(
  data: Omit<GoogleAccount, "createdAt" | "updatedAt">
): Prisma.GoogleAccountCreateInput {
  return {
    id: data.id,
    tenant: { connect: { id: data.tenantId } },
    user: { connect: { id: data.userId } },
    customerId: data.customerId ?? data.googleCustomerId,
    managerCustomerId: data.managerCustomerId ?? null,
    name: data.name ?? data.descriptiveName,
    currency: data.currency ?? data.currencyCode,
    timezone: data.timezone ?? data.timeZone,
    oauthCredentialRef: data.oauthCredentialRef ?? null,
    status: data.status,
    archivedAt: data.archivedAt ?? null,
    deletedAt: data.deletedAt ?? null,
  };
}

function googleAccountUpdateData(
  data: Partial<Omit<GoogleAccount, "id" | "createdAt">>
): Prisma.GoogleAccountUpdateInput {
  const out: Prisma.GoogleAccountUpdateInput = { ...data };
  if (data.customerId !== undefined || data.googleCustomerId !== undefined) {
    out.customerId = data.customerId ?? data.googleCustomerId;
  }
  if (data.name !== undefined || data.descriptiveName !== undefined) {
    out.name = data.name ?? data.descriptiveName;
  }
  if (data.currency !== undefined || data.currencyCode !== undefined) {
    out.currency = data.currency ?? data.currencyCode;
  }
  if (data.timezone !== undefined || data.timeZone !== undefined) {
    out.timezone = data.timezone ?? data.timeZone;
  }
  delete (out as Record<string, unknown>).googleCustomerId;
  delete (out as Record<string, unknown>).descriptiveName;
  delete (out as Record<string, unknown>).currencyCode;
  delete (out as Record<string, unknown>).timeZone;
  delete (out as Record<string, unknown>).tenantId;
  delete (out as Record<string, unknown>).userId;
  return out;
}

function toCampaign(row: {
  id: string;
  tenantId: string;
  googleAccountId: string;
  googleCampaignId: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  deletedAt: Date | null;
}): Campaign {
  return {
    id: row.id,
    tenantId: row.tenantId,
    googleAccountId: row.googleAccountId,
    googleCampaignId: row.googleCampaignId,
    name: row.name,
    status: row.status as Campaign["status"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt ?? undefined,
    deletedAt: row.deletedAt ?? undefined,
  };
}

function toAdGroup(row: {
  id: string;
  tenantId: string;
  campaignId: string;
  googleAdGroupId: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  deletedAt: Date | null;
}): AdGroup {
  return {
    id: row.id,
    tenantId: row.tenantId,
    campaignId: row.campaignId,
    googleAdGroupId: row.googleAdGroupId,
    name: row.name,
    status: row.status as AdGroup["status"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt ?? undefined,
    deletedAt: row.deletedAt ?? undefined,
  };
}

function toAd(row: {
  id: string;
  tenantId: string;
  adGroupId: string;
  googleAdId: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  deletedAt: Date | null;
}): Ad {
  return {
    id: row.id,
    tenantId: row.tenantId,
    adGroupId: row.adGroupId,
    googleAdId: row.googleAdId,
    name: row.name,
    status: row.status as Ad["status"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt ?? undefined,
    deletedAt: row.deletedAt ?? undefined,
  };
}

function toAdGroupCriterion(row: {
  id: string;
  tenantId: string;
  adGroupId: string;
  googleCriterionId: string;
  keyword: string | null;
  matchType: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  deletedAt: Date | null;
}): AdGroupCriterion {
  const keyword = row.keyword ?? undefined;
  return {
    id: row.id,
    tenantId: row.tenantId,
    adGroupId: row.adGroupId,
    googleCriterionId: row.googleCriterionId,
    keyword,
    keywordText: keyword,
    matchType: row.matchType ?? undefined,
    status: row.status as AdGroupCriterion["status"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt ?? undefined,
    deletedAt: row.deletedAt ?? undefined,
  };
}

function toOffer(row: {
  id: string;
  tenantId: string;
  name: string;
  network: string;
  destinationUrl: string;
  status: string;
  priority: number;
  startsAt: Date | null;
  endsAt: Date | null;
  idempotencyScope: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  deletedAt: Date | null;
}): Offer {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    network: row.network,
    destinationUrl: row.destinationUrl,
    status: row.status as Offer["status"],
    priority: row.priority,
    startsAt: row.startsAt ?? undefined,
    endsAt: row.endsAt ?? undefined,
    idempotencyScope: row.idempotencyScope ?? undefined,
    idempotencyKey: row.idempotencyKey ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt ?? undefined,
    deletedAt: row.deletedAt ?? undefined,
  };
}

function toTrackingLinkOffer(row: {
  id: string;
  tenantId: string;
  trackingLinkId: string;
  offerId: string;
  priority: number;
  isFallback: boolean;
  createdAt: Date;
  updatedAt: Date;
}): TrackingLinkOffer {
  return {
    id: row.id,
    tenantId: row.tenantId,
    trackingLinkId: row.trackingLinkId,
    offerId: row.offerId,
    priority: row.priority,
    isFallback: row.isFallback,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toLandingPage(row: {
  id: string;
  tenantId: string;
  offerId: string;
  name: string;
  url: string;
  domain: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  deletedAt: Date | null;
}): LandingPage {
  return {
    id: row.id,
    tenantId: row.tenantId,
    offerId: row.offerId,
    name: row.name,
    url: row.url,
    domain: row.domain,
    status: row.status as LandingPage["status"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt ?? undefined,
    deletedAt: row.deletedAt ?? undefined,
  };
}

function toTrackingLink(row: {
  id: string;
  tenantId: string;
  publicId: string;
  offerId: string;
  campaignId: string | null;
  adGroupId?: string | null;
  adId: string | null;
  criterionId?: string | null;
  landingPageId: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  deletedAt: Date | null;
}): TrackingLink {
  return {
    id: row.id,
    tenantId: row.tenantId,
    publicId: row.publicId,
    offerId: row.offerId,
    campaignId: row.campaignId ?? undefined,
    adGroupId: row.adGroupId ?? undefined,
    adId: row.adId ?? undefined,
    criterionId: row.criterionId ?? undefined,
    landingPageId: row.landingPageId ?? undefined,
    status: row.status as TrackingLink["status"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt ?? undefined,
    deletedAt: row.deletedAt ?? undefined,
  };
}

function toClick(row: {
  id: string;
  clickId?: string | null;
  tenantId: string;
  trackingLinkId: string;
  offerId?: string | null;
  landingPageId?: string | null;
  campaignId?: string | null;
  adGroupId?: string | null;
  adId?: string | null;
  criterionId?: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  referer: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  deviceType: string | null;
  queryParameters?: unknown;
  ingestionId?: string | null;
  occurredAt?: Date | null;
  createdAt: Date;
}): Click {
  const queryParameters =
    row.queryParameters &&
    typeof row.queryParameters === "object" &&
    !Array.isArray(row.queryParameters)
      ? (row.queryParameters as Record<string, string>)
      : undefined;
  return {
    id: row.id,
    clickId: row.clickId ?? row.id,
    tenantId: row.tenantId,
    trackingLinkId: row.trackingLinkId,
    offerId: row.offerId ?? undefined,
    landingPageId: row.landingPageId ?? undefined,
    campaignId: row.campaignId ?? undefined,
    adGroupId: row.adGroupId ?? undefined,
    adId: row.adId ?? undefined,
    criterionId: row.criterionId ?? undefined,
    gclid: row.gclid ?? undefined,
    gbraid: row.gbraid ?? undefined,
    wbraid: row.wbraid ?? undefined,
    utmSource: row.utmSource ?? undefined,
    utmMedium: row.utmMedium ?? undefined,
    utmCampaign: row.utmCampaign ?? undefined,
    utmTerm: row.utmTerm ?? undefined,
    utmContent: row.utmContent ?? undefined,
    userAgent: row.userAgent ?? undefined,
    ipAddress: row.ipAddress ?? undefined,
    referer: row.referer ?? undefined,
    country: row.country ?? undefined,
    region: row.region ?? undefined,
    city: row.city ?? undefined,
    deviceType: row.deviceType ?? undefined,
    queryParameters,
    ingestionId: row.ingestionId ?? undefined,
    occurredAt: row.occurredAt ?? row.createdAt,
    createdAt: row.createdAt,
  };
}

function toConversion(row: {
  id: string;
  tenantId: string;
  clickId: string;
  conversionAction: string;
  conversionTime: Date;
  value: DecimalLike | null;
  currency: string | null;
  status: string;
  googleUploadStatus: string;
  googleConversionResourceName: string | null;
  idempotencyScope?: string | null;
  idempotencyKey?: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  deletedAt: Date | null;
}): Conversion {
  const valueStr = decimalToString(row.value);
  const currency = row.currency ?? undefined;
  return {
    id: row.id,
    tenantId: row.tenantId,
    clickId: row.clickId,
    conversionAction: row.conversionAction,
    conversionTime: row.conversionTime,
    value: valueStr,
    currency,
    conversionValue: valueStr !== undefined ? Number(valueStr) : undefined,
    currencyCode: currency,
    status: row.status as Conversion["status"],
    googleUploadStatus: row.googleUploadStatus as Conversion["googleUploadStatus"],
    googleConversionResourceName: row.googleConversionResourceName ?? undefined,
    idempotencyScope: row.idempotencyScope ?? undefined,
    idempotencyKey: row.idempotencyKey ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt ?? undefined,
    deletedAt: row.deletedAt ?? undefined,
  };
}

function toOrder(row: {
  id: string;
  tenantId: string;
  orderId: string;
  clickId: string | null;
  conversionId: string | null;
  value: DecimalLike;
  currency: string;
  status: string;
  idempotencyScope?: string | null;
  idempotencyKey?: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  deletedAt: Date | null;
}): Order {
  const valueStr = row.value.toString();
  return {
    id: row.id,
    tenantId: row.tenantId,
    orderId: row.orderId,
    clickId: row.clickId ?? undefined,
    conversionId: row.conversionId ?? undefined,
    value: valueStr,
    currency: row.currency,
    amount: Number(valueStr),
    currencyCode: row.currency,
    status: row.status as Order["status"],
    idempotencyScope: row.idempotencyScope ?? undefined,
    idempotencyKey: row.idempotencyKey ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt ?? undefined,
    deletedAt: row.deletedAt ?? undefined,
  };
}

function toUrlVersion(row: {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  finalUrl: string;
  finalMobileUrl: string | null;
  finalAppUrl: string | null;
  trackingTemplate: string | null;
  customParameters: Prisma.JsonValue;
  version: number;
  status: string;
  effectiveAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}): UrlVersion {
  const entityType = row.entityType as UrlVersion["entityType"];
  return {
    id: row.id,
    tenantId: row.tenantId,
    entityType,
    entityId: row.entityId,
    adId: entityType === "AD" ? row.entityId : undefined,
    finalUrl: row.finalUrl,
    finalMobileUrl: row.finalMobileUrl ?? undefined,
    finalAppUrl: row.finalAppUrl ?? undefined,
    trackingTemplate: row.trackingTemplate ?? undefined,
    customParameters: asRecord(row.customParameters),
    version: row.version,
    status: row.status as UrlVersion["status"],
    effectiveAt: row.effectiveAt ?? undefined,
    createdBy: row.createdBy ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toUrlChangeRequest(row: {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  fromVersionId: string | null;
  toVersionId: string;
  reason: string;
  requestedBy: string;
  status: string;
  idempotencyScope: string;
  idempotencyKey: string;
  scheduledAt: Date | null;
  executedAt: Date | null;
  error: string | null;
  jobId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): UrlChangeRequest {
  return {
    id: row.id,
    tenantId: row.tenantId,
    entityType: row.entityType as UrlChangeRequest["entityType"],
    entityId: row.entityId,
    fromVersionId: row.fromVersionId ?? undefined,
    toVersionId: row.toVersionId,
    reason: row.reason,
    requestedBy: row.requestedBy,
    status: row.status as UrlChangeRequest["status"],
    idempotencyScope: row.idempotencyScope,
    idempotencyKey: row.idempotencyKey,
    scheduledAt: row.scheduledAt ?? undefined,
    executedAt: row.executedAt ?? undefined,
    error: row.error ?? undefined,
    jobId: row.jobId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSyncJob(row: {
  id: string;
  tenantId: string;
  type: string;
  status: string;
  provider: string;
  externalAccountId: string | null;
  idempotencyScope: string;
  idempotencyKey: string;
  jobId: string | null;
  attempts: number;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SyncJob {
  const error = row.error ?? undefined;
  return {
    id: row.id,
    tenantId: row.tenantId,
    type: row.type,
    status: row.status as SyncJob["status"],
    provider: row.provider,
    externalAccountId: row.externalAccountId ?? undefined,
    idempotencyScope: row.idempotencyScope,
    idempotencyKey: row.idempotencyKey,
    jobId: row.jobId ?? undefined,
    attempts: row.attempts,
    startedAt: row.startedAt ?? undefined,
    completedAt: row.completedAt ?? undefined,
    error,
    errorMessage: error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toPrismaSyncJobStatus(status: SyncJob["status"]): PrismaSyncJobStatus {
  const legacy: Record<string, PrismaSyncJobStatus> = {
    pending: "PENDING",
    running: "RUNNING",
    completed: "COMPLETED",
    failed: "FAILED",
    cancelled: "CANCELLED",
  };
  return legacy[status] ?? (status as PrismaSyncJobStatus);
}

function toAuditLog(row: {
  id: string;
  tenantId: string | null;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: Prisma.JsonValue;
  after: Prisma.JsonValue;
  requestId: string | null;
  jobId: string | null;
  createdAt: Date;
}): AuditLog {
  const before = row.before != null ? asUnknownRecord(row.before) : undefined;
  const after = row.after != null ? asUnknownRecord(row.after) : undefined;
  return {
    id: row.id,
    tenantId: row.tenantId ?? undefined,
    actorId: row.actorId ?? undefined,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId ?? undefined,
    before,
    after,
    requestId: row.requestId ?? undefined,
    jobId: row.jobId ?? undefined,
    createdAt: row.createdAt,
    resourceType: row.entityType,
    resourceId: row.entityId ?? undefined,
    metadata: after,
  };
}

export class PrismaTenantRepository implements TenantRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string) {
    const row = await this.db.tenant.findUnique({ where: { id } });
    return row ? toTenant(row) : null;
  }
  async findBySlug(slug: string) {
    const row = await this.db.tenant.findUnique({ where: { slug } });
    return row ? toTenant(row) : null;
  }
  async list(input?: PaginationInput) {
    const { page, pageSize, skip } = normalizePagination(input);
    const [items, total] = await Promise.all([
      this.db.tenant.findMany({ skip, take: pageSize, orderBy: { createdAt: "desc" } }),
      this.db.tenant.count(),
    ]);
    return createPaginatedResult(items.map(toTenant), total, page, pageSize);
  }
  async create(data: Omit<Tenant, "createdAt" | "updatedAt">) {
    return toTenant(await this.db.tenant.create({ data }));
  }
  async update(id: string, data: Partial<Omit<Tenant, "id" | "createdAt">>) {
    try {
      return toTenant(await this.db.tenant.update({ where: { id }, data }));
    } catch {
      throw new NotFoundError("Tenant", id);
    }
  }
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string) {
    const row = await this.db.user.findUnique({ where: { id } });
    return row ? toUser(row) : null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    const row = await this.db.user.findFirst({ where: { id, tenantId } });
    return row ? toUser(row) : null;
  }
  async findByEmail(email: string) {
    const row = await this.db.user.findFirst({ where: { email } });
    return row ? toUser(row) : null;
  }
  async list(input?: PaginationInput & { tenantId?: string }) {
    const { page, pageSize, skip } = normalizePagination(input);
    const where = input?.tenantId ? { tenantId: input.tenantId } : {};
    const [items, total] = await Promise.all([
      this.db.user.findMany({ where, skip, take: pageSize, orderBy: { createdAt: "desc" } }),
      this.db.user.count({ where }),
    ]);
    return createPaginatedResult(items.map(toUser), total, page, pageSize);
  }
  async create(data: Omit<User, "createdAt" | "updatedAt">) {
    return toUser(
      await this.db.user.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          email: data.email,
          name: data.name,
          status: data.status,
          archivedAt: data.archivedAt ?? null,
          deletedAt: data.deletedAt ?? null,
        },
      })
    );
  }
  async update(id: string, data: Partial<Omit<User, "id" | "createdAt">>) {
    try {
      return toUser(await this.db.user.update({ where: { id }, data }));
    } catch {
      throw new NotFoundError("User", id);
    }
  }
}

export class PrismaGoogleAccountRepository implements GoogleAccountRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string) {
    const row = await this.db.googleAccount.findUnique({ where: { id } });
    return row ? toGoogleAccount(row) : null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    const row = await this.db.googleAccount.findFirst({ where: { id, tenantId } });
    return row ? toGoogleAccount(row) : null;
  }
  async findByGoogleCustomerId(googleCustomerId: string) {
    const row = await this.db.googleAccount.findUnique({
      where: { customerId: googleCustomerId },
    });
    return row ? toGoogleAccount(row) : null;
  }
  async findByCustomerId(customerId: string) {
    return this.findByGoogleCustomerId(customerId);
  }
  async list(input?: PaginationInput & { tenantId?: string }) {
    const { page, pageSize, skip } = normalizePagination(input);
    const where = input?.tenantId ? { tenantId: input.tenantId } : {};
    const [items, total] = await Promise.all([
      this.db.googleAccount.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
      this.db.googleAccount.count({ where }),
    ]);
    return createPaginatedResult(items.map(toGoogleAccount), total, page, pageSize);
  }
  async create(data: Omit<GoogleAccount, "createdAt" | "updatedAt">) {
    return toGoogleAccount(
      await this.db.googleAccount.create({ data: googleAccountCreateData(data) })
    );
  }
  async update(id: string, data: Partial<Omit<GoogleAccount, "id" | "createdAt">>) {
    try {
      return toGoogleAccount(
        await this.db.googleAccount.update({
          where: { id },
          data: googleAccountUpdateData(data),
        })
      );
    } catch {
      throw new NotFoundError("GoogleAccount", id);
    }
  }
}

export class PrismaCampaignRepository implements CampaignRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string) {
    const row = await this.db.campaign.findUnique({ where: { id } });
    return row ? toCampaign(row) : null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    const row = await this.db.campaign.findFirst({ where: { id, tenantId } });
    return row ? toCampaign(row) : null;
  }
  async findByGoogleCampaignId(googleCampaignId: string) {
    const row = await this.db.campaign.findFirst({ where: { googleCampaignId } });
    return row ? toCampaign(row) : null;
  }
  async list(input?: PaginationInput & { googleAccountId?: string; tenantId?: string }) {
    const { page, pageSize, skip } = normalizePagination(input);
    const where: Prisma.CampaignWhereInput = {};
    if (input?.googleAccountId) where.googleAccountId = input.googleAccountId;
    if (input?.tenantId) where.tenantId = input.tenantId;
    const [items, total] = await Promise.all([
      this.db.campaign.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
      this.db.campaign.count({ where }),
    ]);
    return createPaginatedResult(items.map(toCampaign), total, page, pageSize);
  }
  async create(data: Omit<Campaign, "createdAt" | "updatedAt">) {
    return toCampaign(
      await this.db.campaign.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          googleAccountId: data.googleAccountId,
          googleCampaignId: data.googleCampaignId,
          name: data.name,
          status: data.status,
          archivedAt: data.archivedAt ?? null,
          deletedAt: data.deletedAt ?? null,
        },
      })
    );
  }
  async update(id: string, data: Partial<Omit<Campaign, "id" | "createdAt">>) {
    try {
      const { biddingStrategy: _biddingStrategy, ...rest } = data;
      return toCampaign(await this.db.campaign.update({ where: { id }, data: rest }));
    } catch {
      throw new NotFoundError("Campaign", id);
    }
  }
  async softDelete(id: string) {
    try {
      return toCampaign(
        await this.db.campaign.update({
          where: { id },
          data: { status: "ARCHIVED", deletedAt: new Date() },
        })
      );
    } catch {
      throw new NotFoundError("Campaign", id);
    }
  }
}

export class PrismaAdGroupRepository implements AdGroupRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string) {
    const row = await this.db.adGroup.findUnique({ where: { id } });
    return row ? toAdGroup(row) : null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    const row = await this.db.adGroup.findFirst({ where: { id, tenantId } });
    return row ? toAdGroup(row) : null;
  }
  async findByGoogleAdGroupId(googleAdGroupId: string) {
    const row = await this.db.adGroup.findFirst({ where: { googleAdGroupId } });
    return row ? toAdGroup(row) : null;
  }
  async list(input?: PaginationInput & { campaignId?: string; tenantId?: string }) {
    const { page, pageSize, skip } = normalizePagination(input);
    const where: Prisma.AdGroupWhereInput = {};
    if (input?.campaignId) where.campaignId = input.campaignId;
    if (input?.tenantId) where.tenantId = input.tenantId;
    const [items, total] = await Promise.all([
      this.db.adGroup.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
      this.db.adGroup.count({ where }),
    ]);
    return createPaginatedResult(items.map(toAdGroup), total, page, pageSize);
  }
  async create(data: Omit<AdGroup, "createdAt" | "updatedAt">) {
    return toAdGroup(await this.db.adGroup.create({ data }));
  }
  async update(id: string, data: Partial<Omit<AdGroup, "id" | "createdAt">>) {
    try {
      return toAdGroup(await this.db.adGroup.update({ where: { id }, data }));
    } catch {
      throw new NotFoundError("AdGroup", id);
    }
  }
}

export class PrismaAdRepository implements AdRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string) {
    const row = await this.db.ad.findUnique({ where: { id } });
    return row ? toAd(row) : null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    const row = await this.db.ad.findFirst({ where: { id, tenantId } });
    return row ? toAd(row) : null;
  }
  async findByGoogleAdId(googleAdId: string) {
    const row = await this.db.ad.findFirst({ where: { googleAdId } });
    return row ? toAd(row) : null;
  }
  async list(input?: PaginationInput & { adGroupId?: string; tenantId?: string }) {
    const { page, pageSize, skip } = normalizePagination(input);
    const where: Prisma.AdWhereInput = {};
    if (input?.adGroupId) where.adGroupId = input.adGroupId;
    if (input?.tenantId) where.tenantId = input.tenantId;
    const [items, total] = await Promise.all([
      this.db.ad.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
      this.db.ad.count({ where }),
    ]);
    return createPaginatedResult(items.map(toAd), total, page, pageSize);
  }
  async create(data: Omit<Ad, "createdAt" | "updatedAt">) {
    return toAd(
      await this.db.ad.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          adGroupId: data.adGroupId,
          googleAdId: data.googleAdId,
          name: data.name,
          status: data.status,
          archivedAt: data.archivedAt ?? null,
          deletedAt: data.deletedAt ?? null,
        },
      })
    );
  }
  async update(id: string, data: Partial<Omit<Ad, "id" | "createdAt">>) {
    try {
      const { finalUrl: _finalUrl, trackingTemplate: _trackingTemplate, ...rest } = data;
      return toAd(await this.db.ad.update({ where: { id }, data: rest }));
    } catch {
      throw new NotFoundError("Ad", id);
    }
  }
}

export class PrismaAdGroupCriterionRepository implements AdGroupCriterionRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string) {
    const row = await this.db.adGroupCriterion.findUnique({ where: { id } });
    return row ? toAdGroupCriterion(row) : null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    const row = await this.db.adGroupCriterion.findFirst({ where: { id, tenantId } });
    return row ? toAdGroupCriterion(row) : null;
  }
  async findByGoogleCriterionId(googleCriterionId: string) {
    const row = await this.db.adGroupCriterion.findFirst({
      where: { googleCriterionId },
    });
    return row ? toAdGroupCriterion(row) : null;
  }
  async list(input?: PaginationInput & { adGroupId?: string; tenantId?: string }) {
    const { page, pageSize, skip } = normalizePagination(input);
    const where: Prisma.AdGroupCriterionWhereInput = {};
    if (input?.adGroupId) where.adGroupId = input.adGroupId;
    if (input?.tenantId) where.tenantId = input.tenantId;
    const [items, total] = await Promise.all([
      this.db.adGroupCriterion.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
      this.db.adGroupCriterion.count({ where }),
    ]);
    return createPaginatedResult(items.map(toAdGroupCriterion), total, page, pageSize);
  }
  async create(data: Omit<AdGroupCriterion, "createdAt" | "updatedAt">) {
    const keyword = data.keyword ?? data.keywordText ?? null;
    return toAdGroupCriterion(
      await this.db.adGroupCriterion.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          adGroupId: data.adGroupId,
          googleCriterionId: data.googleCriterionId,
          keyword,
          matchType: data.matchType ?? null,
          status: data.status,
          archivedAt: data.archivedAt ?? null,
          deletedAt: data.deletedAt ?? null,
        },
      })
    );
  }
  async update(id: string, data: Partial<Omit<AdGroupCriterion, "id" | "createdAt">>) {
    try {
      const keyword =
        data.keyword !== undefined || data.keywordText !== undefined
          ? (data.keyword ?? data.keywordText ?? null)
          : undefined;
      const { keywordText: _keywordText, ...rest } = data;
      return toAdGroupCriterion(
        await this.db.adGroupCriterion.update({
          where: { id },
          data: { ...rest, ...(keyword !== undefined ? { keyword } : {}) },
        })
      );
    } catch {
      throw new NotFoundError("AdGroupCriterion", id);
    }
  }
}

export class PrismaOfferRepository implements OfferRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string) {
    const row = await this.db.offer.findUnique({ where: { id } });
    return row ? toOffer(row) : null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    const row = await this.db.offer.findFirst({ where: { id, tenantId } });
    return row ? toOffer(row) : null;
  }
  async findByIdempotencyKey(tenantId: string, scope: string, idempotencyKey: string) {
    const row = await this.db.offer.findUnique({
      where: {
        tenantId_idempotencyScope_idempotencyKey: {
          tenantId,
          idempotencyScope: scope,
          idempotencyKey,
        },
      } as Prisma.OfferWhereUniqueInput,
    });
    return row ? toOffer(row) : null;
  }
  async list(input?: PaginationInput & { tenantId?: string }) {
    const { page, pageSize, skip } = normalizePagination(input);
    const where = input?.tenantId ? { tenantId: input.tenantId } : {};
    const [items, total] = await Promise.all([
      this.db.offer.findMany({ where, skip, take: pageSize, orderBy: { createdAt: "desc" } }),
      this.db.offer.count({ where }),
    ]);
    return createPaginatedResult(items.map(toOffer), total, page, pageSize);
  }
  async create(data: Omit<Offer, "createdAt" | "updatedAt">) {
    try {
      return toOffer(
        await this.db.offer.create({
          data: {
            id: data.id,
            tenantId: data.tenantId,
            name: data.name,
            network: data.network,
            destinationUrl: data.destinationUrl,
            status: data.status,
            priority: data.priority ?? 100,
            startsAt: data.startsAt ?? null,
            endsAt: data.endsAt ?? null,
            idempotencyScope: data.idempotencyScope ?? null,
            idempotencyKey: data.idempotencyKey ?? null,
            archivedAt: data.archivedAt ?? null,
            deletedAt: data.deletedAt ?? null,
          },
        })
      );
    } catch (error) {
      rethrowUniqueAsConflict(error, "Offer idempotency key already exists");
    }
  }
  async update(id: string, data: Partial<Omit<Offer, "id" | "createdAt">>) {
    try {
      return toOffer(await this.db.offer.update({ where: { id }, data }));
    } catch (error) {
      if (isUniqueViolation(error)) {
        rethrowUniqueAsConflict(error, "Offer idempotency key already exists");
      }
      throw new NotFoundError("Offer", id);
    }
  }
}

export class PrismaLandingPageRepository implements LandingPageRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string) {
    const row = await this.db.landingPage.findUnique({ where: { id } });
    return row ? toLandingPage(row) : null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    const row = await this.db.landingPage.findFirst({ where: { id, tenantId } });
    return row ? toLandingPage(row) : null;
  }
  async list(input?: PaginationInput & { tenantId?: string; offerId?: string }) {
    const { page, pageSize, skip } = normalizePagination(input);
    const where: Prisma.LandingPageWhereInput = {};
    if (input?.tenantId) where.tenantId = input.tenantId;
    if (input?.offerId) where.offerId = input.offerId;
    const [items, total] = await Promise.all([
      this.db.landingPage.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
      this.db.landingPage.count({ where }),
    ]);
    return createPaginatedResult(items.map(toLandingPage), total, page, pageSize);
  }
  async create(data: Omit<LandingPage, "createdAt" | "updatedAt">) {
    return toLandingPage(await this.db.landingPage.create({ data }));
  }
  async update(id: string, data: Partial<Omit<LandingPage, "id" | "createdAt">>) {
    try {
      return toLandingPage(await this.db.landingPage.update({ where: { id }, data }));
    } catch {
      throw new NotFoundError("LandingPage", id);
    }
  }
}

export class PrismaTrackingLinkOfferRepository implements TrackingLinkOfferRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string) {
    const row = await this.db.trackingLinkOffer.findUnique({ where: { id } });
    return row ? toTrackingLinkOffer(row) : null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    const row = await this.db.trackingLinkOffer.findFirst({ where: { id, tenantId } });
    return row ? toTrackingLinkOffer(row) : null;
  }
  async findByTrackingLinkForTenant(tenantId: string, trackingLinkId: string) {
    const rows = await this.db.trackingLinkOffer.findMany({
      where: { tenantId, trackingLinkId },
      orderBy: [{ priority: "asc" }, { offerId: "asc" }],
    });
    return rows.map(toTrackingLinkOffer);
  }
  async findBindingForTenant(tenantId: string, trackingLinkId: string, offerId: string) {
    const row = await this.db.trackingLinkOffer.findUnique({
      where: {
        tenantId_trackingLinkId_offerId: {
          tenantId,
          trackingLinkId,
          offerId,
        },
      } as Prisma.TrackingLinkOfferWhereUniqueInput,
    });
    return row ? toTrackingLinkOffer(row) : null;
  }
  async findFallbackForTrackingLink(tenantId: string, trackingLinkId: string) {
    const row = await this.db.trackingLinkOffer.findFirst({
      where: { tenantId, trackingLinkId, isFallback: true },
    });
    return row ? toTrackingLinkOffer(row) : null;
  }
  async create(data: Omit<TrackingLinkOffer, "createdAt" | "updatedAt">) {
    try {
      return toTrackingLinkOffer(
        await this.db.trackingLinkOffer.create({
          data: {
            id: data.id,
            tenantId: data.tenantId,
            trackingLinkId: data.trackingLinkId,
            offerId: data.offerId,
            priority: data.priority ?? 100,
            isFallback: data.isFallback,
          },
        })
      );
    } catch (error) {
      rethrowUniqueAsConflict(error, "TrackingLinkOffer binding already exists");
    }
  }
  async update(
    id: string,
    data: Partial<Omit<TrackingLinkOffer, "id" | "createdAt" | "tenantId">>
  ) {
    try {
      return toTrackingLinkOffer(
        await this.db.trackingLinkOffer.update({ where: { id }, data })
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        rethrowUniqueAsConflict(error, "TrackingLinkOffer unique constraint violated");
      }
      throw new NotFoundError("TrackingLinkOffer", id);
    }
  }
  async delete(id: string) {
    try {
      await this.db.trackingLinkOffer.delete({ where: { id } });
    } catch {
      throw new NotFoundError("TrackingLinkOffer", id);
    }
  }
}

export class PrismaTrackingLinkRepository implements TrackingLinkRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string) {
    const row = await this.db.trackingLink.findUnique({ where: { id } });
    return row ? toTrackingLink(row) : null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    const row = await this.db.trackingLink.findFirst({ where: { id, tenantId } });
    return row ? toTrackingLink(row) : null;
  }
  async findByPublicId(publicId: string) {
    const row = await this.db.trackingLink.findUnique({ where: { publicId } });
    return row ? toTrackingLink(row) : null;
  }
  async findByPublicIdForTenant(tenantId: string, publicId: string) {
    const row = await this.db.trackingLink.findFirst({
      where: { tenantId, publicId },
    });
    return row ? toTrackingLink(row) : null;
  }
  async list(input?: PaginationInput & { tenantId?: string }) {
    const { page, pageSize, skip } = normalizePagination(input);
    const where = input?.tenantId ? { tenantId: input.tenantId } : {};
    const [items, total] = await Promise.all([
      this.db.trackingLink.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
      this.db.trackingLink.count({ where }),
    ]);
    return createPaginatedResult(items.map(toTrackingLink), total, page, pageSize);
  }
  async create(data: Omit<TrackingLink, "createdAt" | "updatedAt">) {
    return toTrackingLink(
      await this.db.trackingLink.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          publicId: data.publicId,
          offerId: data.offerId,
          campaignId: data.campaignId ?? null,
          adGroupId: data.adGroupId ?? null,
          adId: data.adId ?? null,
          criterionId: data.criterionId ?? null,
          landingPageId: data.landingPageId ?? null,
          status: data.status,
          archivedAt: data.archivedAt ?? null,
          deletedAt: data.deletedAt ?? null,
        },
      })
    );
  }
  async update(id: string, data: Partial<Omit<TrackingLink, "id" | "createdAt">>) {
    try {
      return toTrackingLink(await this.db.trackingLink.update({ where: { id }, data }));
    } catch {
      throw new NotFoundError("TrackingLink", id);
    }
  }
}

export class PrismaClickRepository implements ClickRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string) {
    const row = await this.db.click.findUnique({ where: { id } });
    return row ? toClick(row) : null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    const row = await this.db.click.findFirst({ where: { id, tenantId } });
    return row ? toClick(row) : null;
  }
  async findByClickIdForTenant(tenantId: string, clickId: string) {
    const row = await this.db.click.findFirst({ where: { tenantId, clickId } });
    return row ? toClick(row) : null;
  }
  async findByIngestionIdForTenant(tenantId: string, ingestionId: string) {
    const row = await this.db.click.findFirst({
      where: { tenantId, ingestionId },
    });
    return row ? toClick(row) : null;
  }
  async list(
    input?: PaginationInput & {
      trackingLinkId?: string;
      tenantId?: string;
      offerId?: string;
      campaignId?: string;
    }
  ) {
    const { page, pageSize, skip } = normalizePagination(input);
    const where: Prisma.ClickWhereInput = {};
    if (input?.trackingLinkId) where.trackingLinkId = input.trackingLinkId;
    if (input?.tenantId) where.tenantId = input.tenantId;
    if (input?.offerId) where.offerId = input.offerId;
    if (input?.campaignId) where.campaignId = input.campaignId;
    const [items, total] = await Promise.all([
      this.db.click.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
      this.db.click.count({ where }),
    ]);
    return createPaginatedResult(items.map(toClick), total, page, pageSize);
  }
  async create(data: Omit<Click, "createdAt"> & { createdAt?: Date }) {
    try {
      return toClick(
        await this.db.click.create({
          data: {
            id: data.id,
            clickId: data.clickId ?? data.id,
            tenantId: data.tenantId,
            trackingLinkId: data.trackingLinkId,
            offerId: data.offerId ?? null,
            landingPageId: data.landingPageId ?? null,
            campaignId: data.campaignId ?? null,
            adGroupId: data.adGroupId ?? null,
            adId: data.adId ?? null,
            criterionId: data.criterionId ?? null,
            gclid: data.gclid ?? null,
            gbraid: data.gbraid ?? null,
            wbraid: data.wbraid ?? null,
            utmSource: data.utmSource ?? null,
            utmMedium: data.utmMedium ?? null,
            utmCampaign: data.utmCampaign ?? null,
            utmTerm: data.utmTerm ?? null,
            utmContent: data.utmContent ?? null,
            userAgent: data.userAgent ?? null,
            ipAddress: data.ipAddress ?? null,
            referer: data.referer ?? null,
            country: data.country ?? null,
            region: data.region ?? null,
            city: data.city ?? null,
            deviceType: data.deviceType ?? null,
            queryParameters: data.queryParameters ?? undefined,
            ingestionId: data.ingestionId ?? null,
            occurredAt: data.occurredAt ?? data.createdAt ?? new Date(),
            createdAt: data.createdAt,
          },
        })
      );
    } catch (error) {
      if (
        error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictError("Click unique constraint violated", {
          fields: error.meta?.target,
        });
      }
      throw error;
    }
  }
  async countByTrackingLink(tenantId: string, trackingLinkId: string) {
    return this.db.click.count({ where: { tenantId, trackingLinkId } });
  }
  async countByOffer(tenantId: string, offerId: string) {
    return this.db.click.count({ where: { tenantId, offerId } });
  }
  async countByCampaign(tenantId: string, campaignId: string) {
    return this.db.click.count({ where: { tenantId, campaignId } });
  }
}

export class PrismaConversionRepository implements ConversionRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string) {
    const row = await this.db.conversion.findUnique({ where: { id } });
    return row ? toConversion(row) : null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    const row = await this.db.conversion.findFirst({ where: { id, tenantId } });
    return row ? toConversion(row) : null;
  }
  async findByIdempotencyKey(tenantId: string, scope: string, idempotencyKey: string) {
    const row = await this.db.conversion.findUnique({
      where: {
        tenantId_idempotencyScope_idempotencyKey: {
          tenantId,
          idempotencyScope: scope,
          idempotencyKey,
        },
      } as Prisma.ConversionWhereUniqueInput,
    });
    return row ? toConversion(row) : null;
  }
  async findByConversionId(conversionId: string) {
    return this.findById(conversionId);
  }
  async list(input?: PaginationInput & { tenantId?: string }) {
    const { page, pageSize, skip } = normalizePagination(input);
    const where = input?.tenantId ? { tenantId: input.tenantId } : {};
    const [items, total] = await Promise.all([
      this.db.conversion.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
      this.db.conversion.count({ where }),
    ]);
    return createPaginatedResult(items.map(toConversion), total, page, pageSize);
  }
  async create(data: Omit<Conversion, "createdAt" | "updatedAt">) {
    return toConversion(
      await this.db.conversion.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          clickId: data.clickId,
          conversionAction: data.conversionAction,
          conversionTime: data.conversionTime,
          value: data.value ?? null,
          currency: data.currency ?? data.currencyCode ?? null,
          status: data.status,
          googleUploadStatus: data.googleUploadStatus,
          googleConversionResourceName: data.googleConversionResourceName ?? null,
          idempotencyScope: data.idempotencyScope ?? null,
          idempotencyKey: data.idempotencyKey ?? null,
          archivedAt: data.archivedAt ?? null,
          deletedAt: data.deletedAt ?? null,
        },
      })
    );
  }
  async update(id: string, data: Partial<Omit<Conversion, "id" | "createdAt">>) {
    try {
      const {
        conversionValue: _conversionValue,
        currencyCode,
        value,
        currency,
        orderId: _orderId,
        gclid: _gclid,
        ...rest
      } = data;
      return toConversion(
        await this.db.conversion.update({
          where: { id },
          data: {
            ...rest,
            ...(value !== undefined ? { value } : {}),
            ...(currency !== undefined || currencyCode !== undefined
              ? { currency: currency ?? currencyCode ?? null }
              : {}),
          },
        })
      );
    } catch {
      throw new NotFoundError("Conversion", id);
    }
  }
}

export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string) {
    const row = await this.db.order.findUnique({ where: { id } });
    return row ? toOrder(row) : null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    const row = await this.db.order.findFirst({ where: { id, tenantId } });
    return row ? toOrder(row) : null;
  }
  async findByIdempotencyKey(tenantId: string, scope: string, idempotencyKey: string) {
    const row = await this.db.order.findUnique({
      where: {
        tenantId_idempotencyScope_idempotencyKey: {
          tenantId,
          idempotencyScope: scope,
          idempotencyKey,
        },
      } as Prisma.OrderWhereUniqueInput,
    });
    return row ? toOrder(row) : null;
  }
  async findByOrderId(orderId: string, tenantId?: string) {
    const row =
      tenantId !== undefined
        ? await this.db.order.findUnique({
            where: { tenantId_orderId: { tenantId, orderId } },
          })
        : await this.db.order.findFirst({ where: { orderId } });
    return row ? toOrder(row) : null;
  }
  async list(input?: PaginationInput & { tenantId?: string }) {
    const { page, pageSize, skip } = normalizePagination(input);
    const where = input?.tenantId ? { tenantId: input.tenantId } : {};
    const [items, total] = await Promise.all([
      this.db.order.findMany({ where, skip, take: pageSize, orderBy: { createdAt: "desc" } }),
      this.db.order.count({ where }),
    ]);
    return createPaginatedResult(items.map(toOrder), total, page, pageSize);
  }
  async create(data: Omit<Order, "createdAt" | "updatedAt">) {
    return toOrder(
      await this.db.order.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          orderId: data.orderId,
          clickId: data.clickId ?? null,
          conversionId: data.conversionId ?? null,
          value: data.value,
          currency: data.currency ?? data.currencyCode ?? "USD",
          status: data.status,
          idempotencyScope: data.idempotencyScope ?? null,
          idempotencyKey: data.idempotencyKey ?? null,
          archivedAt: data.archivedAt ?? null,
          deletedAt: data.deletedAt ?? null,
        },
      })
    );
  }
  async update(id: string, data: Partial<Omit<Order, "id" | "createdAt">>) {
    try {
      const { amount: _amount, currencyCode, value, currency, ...rest } = data;
      return toOrder(
        await this.db.order.update({
          where: { id },
          data: {
            ...rest,
            ...(value !== undefined ? { value } : {}),
            ...(currency !== undefined || currencyCode !== undefined
              ? { currency: currency ?? currencyCode }
              : {}),
          },
        })
      );
    } catch {
      throw new NotFoundError("Order", id);
    }
  }
}

export class PrismaUrlVersionRepository implements UrlVersionRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string) {
    const row = await this.db.urlVersion.findUnique({ where: { id } });
    return row ? toUrlVersion(row) : null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    const row = await this.db.urlVersion.findFirst({ where: { id, tenantId } });
    return row ? toUrlVersion(row) : null;
  }
  async listByEntity(entityType: UrlEntityType, entityId: string) {
    const rows = await this.db.urlVersion.findMany({
      where: { entityType, entityId },
      orderBy: { version: "asc" },
    });
    return rows.map(toUrlVersion);
  }
  async findActiveByEntity(entityType: UrlEntityType, entityId: string) {
    const row = await this.db.urlVersion.findFirst({
      where: { entityType, entityId, status: "ACTIVE" },
    });
    return row ? toUrlVersion(row) : null;
  }
  async getNextVersion(entityType: UrlEntityType, entityId: string) {
    const agg = await this.db.urlVersion.aggregate({
      where: { entityType, entityId },
      _max: { version: true },
    });
    return (agg._max.version ?? 0) + 1;
  }
  async listByAdId(adId: string) {
    return this.listByEntity("AD", adId);
  }
  async findActiveByAdId(adId: string) {
    return this.findActiveByEntity("AD", adId);
  }
  async getNextVersionForAd(adId: string) {
    return this.getNextVersion("AD", adId);
  }
  async create(data: Omit<UrlVersion, "createdAt" | "updatedAt">) {
    try {
      return toUrlVersion(
        await this.db.urlVersion.create({
          data: {
            id: data.id,
            tenantId: data.tenantId,
            entityType: data.entityType,
            entityId: data.entityId,
            finalUrl: data.finalUrl,
            finalMobileUrl: data.finalMobileUrl ?? null,
            finalAppUrl: data.finalAppUrl ?? null,
            trackingTemplate: data.trackingTemplate ?? null,
            customParameters: data.customParameters,
            version: data.version,
            status: data.status,
            effectiveAt: data.effectiveAt ?? null,
            createdBy: data.createdBy ?? null,
          },
        })
      );
    } catch (error) {
      rethrowUniqueAsConflict(
        error,
        `UrlVersion unique constraint violated for ${data.entityType}/${data.entityId} v${data.version} status=${data.status}`
      );
    }
  }
  async updateStatus(id: string, data: UrlVersionStatusPatch) {
    try {
      return toUrlVersion(
        await this.db.urlVersion.update({
          where: { id },
          data: {
            status: data.status,
            effectiveAt: data.effectiveAt,
          },
        })
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        rethrowUniqueAsConflict(
          error,
          `UrlVersion ACTIVE unique constraint violated when updating ${id}`
        );
      }
      throw new NotFoundError("UrlVersion", id);
    }
  }
  async update(id: string, data: UrlVersionStatusPatch) {
    return this.updateStatus(id, data);
  }
  async list(
    input?: PaginationInput & {
      adId?: string;
      entityType?: UrlEntityType;
      entityId?: string;
      tenantId?: string;
    }
  ) {
    const { page, pageSize, skip } = normalizePagination(input);
    const where: Prisma.UrlVersionWhereInput = {};
    if (input?.adId) {
      where.OR = [{ entityType: "AD", entityId: input.adId }];
    }
    if (input?.entityType) where.entityType = input.entityType;
    if (input?.entityId) where.entityId = input.entityId;
    if (input?.tenantId) where.tenantId = input.tenantId;
    const [items, total] = await Promise.all([
      this.db.urlVersion.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ entityType: "asc" }, { entityId: "asc" }, { version: "desc" }],
      }),
      this.db.urlVersion.count({ where }),
    ]);
    return createPaginatedResult(items.map(toUrlVersion), total, page, pageSize);
  }
}

export class PrismaUrlChangeRequestRepository implements UrlChangeRequestRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string) {
    const row = await this.db.urlChangeRequest.findUnique({ where: { id } });
    return row ? toUrlChangeRequest(row) : null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    const row = await this.db.urlChangeRequest.findFirst({ where: { id, tenantId } });
    return row ? toUrlChangeRequest(row) : null;
  }
  async findByIdempotencyKey(tenantId: string, scope: string, idempotencyKey: string) {
    const row = await this.db.urlChangeRequest.findUnique({
      where: {
        tenantId_idempotencyScope_idempotencyKey: {
          tenantId,
          idempotencyScope: scope,
          idempotencyKey,
        },
      } as Prisma.UrlChangeRequestWhereUniqueInput,
    });
    return row ? toUrlChangeRequest(row) : null;
  }
  async list(input?: PaginationInput & { tenantId?: string }) {
    const { page, pageSize, skip } = normalizePagination(input);
    const where = input?.tenantId ? { tenantId: input.tenantId } : {};
    const [items, total] = await Promise.all([
      this.db.urlChangeRequest.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
      this.db.urlChangeRequest.count({ where }),
    ]);
    return createPaginatedResult(items.map(toUrlChangeRequest), total, page, pageSize);
  }
  async create(data: Omit<UrlChangeRequest, "createdAt" | "updatedAt">) {
    return toUrlChangeRequest(
      await this.db.urlChangeRequest.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          entityType: data.entityType,
          entityId: data.entityId,
          fromVersionId: data.fromVersionId ?? null,
          toVersionId: data.toVersionId,
          reason: data.reason,
          requestedBy: data.requestedBy,
          status: data.status,
          idempotencyScope: data.idempotencyScope,
          idempotencyKey: data.idempotencyKey,
          scheduledAt: data.scheduledAt ?? null,
          executedAt: data.executedAt ?? null,
          error: data.error ?? null,
          jobId: data.jobId ?? null,
        },
      })
    );
  }
  async update(
    id: string,
    data: Partial<
      Omit<
        UrlChangeRequest,
        "id" | "createdAt" | "idempotencyKey" | "idempotencyScope" | "tenantId"
      >
    >
  ) {
    try {
      return toUrlChangeRequest(
        await this.db.urlChangeRequest.update({ where: { id }, data })
      );
    } catch {
      throw new NotFoundError("UrlChangeRequest", id);
    }
  }
}

export class PrismaSyncJobRepository implements SyncJobRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string) {
    const row = await this.db.syncJob.findUnique({ where: { id } });
    return row ? toSyncJob(row) : null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    const row = await this.db.syncJob.findFirst({ where: { id, tenantId } });
    return row ? toSyncJob(row) : null;
  }
  async findByJobId(jobId: string) {
    const row = await this.db.syncJob.findUnique({ where: { jobId } });
    return row ? toSyncJob(row) : null;
  }
  async findByIdempotencyKey(tenantId: string, scope: string, idempotencyKey: string) {
    const row = await this.db.syncJob.findUnique({
      where: {
        tenantId_idempotencyScope_idempotencyKey: {
          tenantId,
          idempotencyScope: scope,
          idempotencyKey,
        },
      } as Prisma.SyncJobWhereUniqueInput,
    });
    return row ? toSyncJob(row) : null;
  }
  async list(input?: PaginationInput & { tenantId?: string }) {
    const { page, pageSize, skip } = normalizePagination(input);
    const where = input?.tenantId ? { tenantId: input.tenantId } : {};
    const [items, total] = await Promise.all([
      this.db.syncJob.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
      this.db.syncJob.count({ where }),
    ]);
    return createPaginatedResult(items.map(toSyncJob), total, page, pageSize);
  }
  async create(data: Omit<SyncJob, "createdAt" | "updatedAt">) {
    const error = data.error ?? data.errorMessage ?? null;
    return toSyncJob(
      await this.db.syncJob.create({
        data: {
          id: data.id,
          tenantId: data.tenantId!,
          type: data.type,
          status: toPrismaSyncJobStatus(data.status),
          provider: data.provider,
          externalAccountId: data.externalAccountId ?? null,
          idempotencyScope: data.idempotencyScope,
          idempotencyKey: data.idempotencyKey,
          jobId: data.jobId ?? null,
          attempts: data.attempts,
          startedAt: data.startedAt ?? null,
          completedAt: data.completedAt ?? null,
          error,
        },
      })
    );
  }
  async update(id: string, data: Partial<Omit<SyncJob, "id" | "createdAt">>) {
    try {
      const error =
        data.error !== undefined || data.errorMessage !== undefined
          ? (data.error ?? data.errorMessage ?? null)
          : undefined;
      const { errorMessage: _errorMessage, payload: _payload, status, ...rest } = data;
      return toSyncJob(
        await this.db.syncJob.update({
          where: { id },
          data: {
            ...rest,
            ...(status !== undefined ? { status: toPrismaSyncJobStatus(status) } : {}),
            ...(error !== undefined ? { error } : {}),
          },
        })
      );
    } catch {
      throw new NotFoundError("SyncJob", id);
    }
  }
}

export class PrismaAuditLogRepository implements AuditLogRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string) {
    const row = await this.db.auditLog.findUnique({ where: { id } });
    return row ? toAuditLog(row) : null;
  }
  async list(input?: PaginationInput & { tenantId?: string }) {
    const { page, pageSize, skip } = normalizePagination(input);
    const where = input?.tenantId ? { tenantId: input.tenantId } : {};
    const [items, total] = await Promise.all([
      this.db.auditLog.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
      this.db.auditLog.count({ where }),
    ]);
    return createPaginatedResult(items.map(toAuditLog), total, page, pageSize);
  }
  async create(data: Omit<AuditLog, "createdAt"> & { createdAt?: Date }) {
    const entityType = data.entityType ?? data.resourceType ?? "Unknown";
    const entityId = data.entityId ?? data.resourceId ?? null;
    const after = (data.after ?? data.metadata ?? null) as Prisma.InputJsonValue;
    const before = (data.before ?? null) as Prisma.InputJsonValue;
    return toAuditLog(
      await this.db.auditLog.create({
        data: {
          id: data.id,
          tenantId: data.tenantId ?? null,
          actorId: data.actorId ?? null,
          action: data.action,
          entityType,
          entityId,
          before,
          after,
          requestId: data.requestId ?? null,
          jobId: data.jobId ?? null,
          createdAt: data.createdAt,
        },
      })
    );
  }
}

export function createPrismaRepositories(db: PrismaClient) {
  return {
    tenants: new PrismaTenantRepository(db),
    users: new PrismaUserRepository(db),
    googleAccounts: new PrismaGoogleAccountRepository(db),
    campaigns: new PrismaCampaignRepository(db),
    adGroups: new PrismaAdGroupRepository(db),
    ads: new PrismaAdRepository(db),
    adGroupCriteria: new PrismaAdGroupCriterionRepository(db),
    offers: new PrismaOfferRepository(db),
    landingPages: new PrismaLandingPageRepository(db),
    trackingLinkOffers: new PrismaTrackingLinkOfferRepository(db),
    trackingLinks: new PrismaTrackingLinkRepository(db),
    clicks: new PrismaClickRepository(db),
    conversions: new PrismaConversionRepository(db),
    orders: new PrismaOrderRepository(db),
    urlVersions: new PrismaUrlVersionRepository(db),
    urlChangeRequests: new PrismaUrlChangeRequestRepository(db),
    syncJobs: new PrismaSyncJobRepository(db),
    auditLogs: new PrismaAuditLogRepository(db),
    scriptIntegrations: new PrismaGoogleAdsScriptIntegrationRepository(db),
    scriptSyncTargets: new PrismaScriptSyncTargetRepository(db),
    scriptSyncLogs: new PrismaScriptSyncLogRepository(db),
  };
}
