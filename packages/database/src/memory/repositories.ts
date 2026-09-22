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
  UnitOfWork,
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
  GoogleAdsScriptIntegrationRepository,
  ScriptSyncTargetRepository,
  ScriptSyncLogRepository,
  GoogleAdsScriptIntegration,
  ScriptSyncTarget,
  ScriptSyncLog,
} from "@adlinklab/domain";
import { ConflictError, NotFoundError, type PaginationInput } from "@adlinklab/shared";
import { buildFixtureDataset } from "../fixtures/index.js";
import { paginateArray } from "../utils.js";
import {
  InMemoryUnitOfWork,
  type InMemoryTransactionalStores,
} from "./unit-of-work.js";
import {
  InMemoryGoogleAdsScriptIntegrationRepository,
  InMemoryScriptSyncLogRepository,
  InMemoryScriptSyncTargetRepository,
} from "./script-integration-repositories.js";
import {
  InMemoryScriptSyncTransactionRunner,
  type ScriptSyncTransactionRunner,
} from "../script-sync-transaction.js";

export {
  InMemoryGoogleAdsScriptIntegrationRepository,
  InMemoryScriptSyncLogRepository,
  InMemoryScriptSyncTargetRepository,
} from "./script-integration-repositories.js";

function stamp(): { createdAt: Date; updatedAt: Date } {
  const now = new Date();
  return { createdAt: now, updatedAt: now };
}

function assertUnique<T>(
  items: Iterable<T>,
  predicate: (item: T) => boolean,
  message: string,
  details?: Record<string, unknown>
): void {
  if ([...items].some(predicate)) {
    throw new ConflictError(message, details);
  }
}

function findByIdForTenant<T extends { tenantId?: string }>(
  store: Map<string, T>,
  tenantId: string,
  id: string
): T | null {
  const entity = store.get(id);
  if (!entity || entity.tenantId !== tenantId) return null;
  return entity;
}

function findByScopedIdempotencyKey<
  T extends { tenantId?: string; idempotencyScope?: string; idempotencyKey?: string },
>(
  store: Map<string, T>,
  tenantId: string,
  scope: string,
  idempotencyKey: string
): T | null {
  return (
    [...store.values()].find(
      (item) =>
        item.tenantId === tenantId &&
        item.idempotencyScope === scope &&
        item.idempotencyKey === idempotencyKey
    ) ?? null
  );
}

function filterByTenantId<T extends { tenantId?: string }>(
  items: T[],
  tenantId?: string
): T[] {
  return tenantId ? items.filter((item) => item.tenantId === tenantId) : items;
}

function assertSingleActiveUrlVersion(
  store: Map<string, UrlVersion>,
  tenantId: string,
  entityType: UrlEntityType,
  entityId: string,
  excludeId?: string
): void {
  assertUnique(
    store.values(),
    (v) =>
      v.tenantId === tenantId &&
      v.entityType === entityType &&
      v.entityId === entityId &&
      v.status === "ACTIVE" &&
      v.id !== excludeId,
    `Active UrlVersion already exists for tenant ${tenantId} / ${entityType}/${entityId}`,
    { tenantId, entityType, entityId }
  );
}

function normalizeGoogleAccount(
  data: Partial<Omit<GoogleAccount, "createdAt" | "updatedAt">>
): Omit<GoogleAccount, "createdAt" | "updatedAt"> {
  const customerId = data.customerId ?? data.googleCustomerId ?? "";
  const name = data.name ?? data.descriptiveName ?? "";
  const currency = data.currency ?? data.currencyCode ?? "";
  const timezone = data.timezone ?? data.timeZone ?? "";
  return {
    id: data.id!,
    tenantId: data.tenantId!,
    userId: data.userId!,
    customerId,
    googleCustomerId: customerId,
    managerCustomerId: data.managerCustomerId,
    name,
    descriptiveName: name,
    currency,
    currencyCode: currency,
    timezone,
    timeZone: timezone,
    oauthCredentialRef: data.oauthCredentialRef,
    status: data.status!,
    archivedAt: data.archivedAt,
    deletedAt: data.deletedAt,
  };
}

function normalizeAdGroupCriterion(
  data: Omit<AdGroupCriterion, "createdAt" | "updatedAt">
): Omit<AdGroupCriterion, "createdAt" | "updatedAt"> {
  const keyword = data.keyword ?? data.keywordText;
  return {
    ...data,
    keyword,
    keywordText: keyword,
  };
}

function normalizeAuditLog(
  data: Omit<AuditLog, "createdAt"> & { createdAt?: Date }
): AuditLog {
  const entityType = data.entityType ?? data.resourceType ?? "Unknown";
  const entityId = data.entityId ?? data.resourceId;
  return {
    id: data.id,
    tenantId: data.tenantId,
    actorId: data.actorId,
    action: data.action,
    entityType,
    entityId,
    before: data.before,
    after: data.after,
    requestId: data.requestId,
    jobId: data.jobId,
    createdAt: data.createdAt ?? new Date(),
    resourceType: data.resourceType ?? entityType,
    resourceId: data.resourceId ?? entityId,
    metadata: data.metadata ?? data.after,
  };
}

export class InMemoryTenantRepository implements TenantRepository {
  constructor(private readonly store: Map<string, Tenant>) {}

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findBySlug(slug: string) {
    return [...this.store.values()].find((t) => t.slug === slug) ?? null;
  }
  async list(input?: PaginationInput) {
    return paginateArray([...this.store.values()], input);
  }
  async create(data: Omit<Tenant, "createdAt" | "updatedAt">) {
    assertUnique(
      this.store.values(),
      (t) => t.slug === data.slug,
      `Tenant slug already exists: ${data.slug}`,
      { slug: data.slug }
    );
    const entity = { ...data, ...stamp() };
    this.store.set(entity.id, entity);
    return entity;
  }
  async update(id: string, data: Partial<Omit<Tenant, "id" | "createdAt">>) {
    const existing = this.store.get(id);
    if (!existing) throw new NotFoundError("Tenant", id);
    if (data.slug && data.slug !== existing.slug) {
      assertUnique(
        this.store.values(),
        (t) => t.slug === data.slug && t.id !== id,
        `Tenant slug already exists: ${data.slug}`,
        { slug: data.slug }
      );
    }
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
}

export class InMemoryUserRepository implements UserRepository {
  constructor(private readonly store: Map<string, User>) {}

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    return findByIdForTenant(this.store, tenantId, id);
  }
  async findByEmail(email: string) {
    return [...this.store.values()].find((u) => u.email === email) ?? null;
  }
  async list(input?: PaginationInput & { tenantId?: string }) {
    return paginateArray(filterByTenantId([...this.store.values()], input?.tenantId), input);
  }
  async create(data: Omit<User, "createdAt" | "updatedAt">) {
    const entity = { ...data, ...stamp() };
    this.store.set(entity.id, entity);
    return entity;
  }
  async update(id: string, data: Partial<Omit<User, "id" | "createdAt">>) {
    const existing = this.store.get(id);
    if (!existing) throw new NotFoundError("User", id);
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
}

export class InMemoryGoogleAccountRepository implements GoogleAccountRepository {
  constructor(private readonly store: Map<string, GoogleAccount>) {}

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    return findByIdForTenant(this.store, tenantId, id);
  }
  async findByGoogleCustomerId(googleCustomerId: string) {
    return (
      [...this.store.values()].find(
        (a) => a.customerId === googleCustomerId || a.googleCustomerId === googleCustomerId
      ) ?? null
    );
  }
  async findByCustomerId(customerId: string) {
    return this.findByGoogleCustomerId(customerId);
  }
  async list(input?: PaginationInput & { tenantId?: string }) {
    return paginateArray(filterByTenantId([...this.store.values()], input?.tenantId), input);
  }
  async create(data: Omit<GoogleAccount, "createdAt" | "updatedAt">) {
    const normalized = normalizeGoogleAccount(data);
    assertUnique(
      this.store.values(),
      (a) => a.customerId === normalized.customerId,
      `GoogleAccount customerId already exists: ${normalized.customerId}`,
      { customerId: normalized.customerId }
    );
    const entity = { ...normalized, ...stamp() };
    this.store.set(entity.id, entity);
    return entity;
  }
  async update(id: string, data: Partial<Omit<GoogleAccount, "id" | "createdAt">>) {
    const existing = this.store.get(id);
    if (!existing) throw new NotFoundError("GoogleAccount", id);
    const merged = normalizeGoogleAccount({ ...existing, ...data, id, tenantId: existing.tenantId, userId: existing.userId, status: data.status ?? existing.status });
    if (merged.customerId !== existing.customerId) {
      assertUnique(
        this.store.values(),
        (a) => a.customerId === merged.customerId && a.id !== id,
        `GoogleAccount customerId already exists: ${merged.customerId}`,
        { customerId: merged.customerId }
      );
    }
    const updated = { ...merged, createdAt: existing.createdAt, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
}

export class InMemoryCampaignRepository implements CampaignRepository {
  constructor(private readonly store: Map<string, Campaign>) {}

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    return findByIdForTenant(this.store, tenantId, id);
  }
  async findByGoogleCampaignId(googleCampaignId: string) {
    return (
      [...this.store.values()].find((c) => c.googleCampaignId === googleCampaignId) ?? null
    );
  }
  async list(input?: PaginationInput & { googleAccountId?: string; tenantId?: string }) {
    let items = [...this.store.values()];
    if (input?.googleAccountId) {
      items = items.filter((c) => c.googleAccountId === input.googleAccountId);
    }
    items = filterByTenantId(items, input?.tenantId);
    return paginateArray(items, input);
  }
  async create(data: Omit<Campaign, "createdAt" | "updatedAt">) {
    assertUnique(
      this.store.values(),
      (c) =>
        c.googleAccountId === data.googleAccountId &&
        c.googleCampaignId === data.googleCampaignId,
      `Campaign already exists for account ${data.googleAccountId} / ${data.googleCampaignId}`,
      { googleAccountId: data.googleAccountId, googleCampaignId: data.googleCampaignId }
    );
    const entity = { ...data, ...stamp() };
    this.store.set(entity.id, entity);
    return entity;
  }
  async update(id: string, data: Partial<Omit<Campaign, "id" | "createdAt">>) {
    const existing = this.store.get(id);
    if (!existing) throw new NotFoundError("Campaign", id);
    const googleAccountId = data.googleAccountId ?? existing.googleAccountId;
    const googleCampaignId = data.googleCampaignId ?? existing.googleCampaignId;
    if (
      googleAccountId !== existing.googleAccountId ||
      googleCampaignId !== existing.googleCampaignId
    ) {
      assertUnique(
        this.store.values(),
        (c) =>
          c.googleAccountId === googleAccountId &&
          c.googleCampaignId === googleCampaignId &&
          c.id !== id,
        `Campaign already exists for account ${googleAccountId} / ${googleCampaignId}`,
        { googleAccountId, googleCampaignId }
      );
    }
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
  async softDelete(id: string) {
    const existing = this.store.get(id);
    if (!existing) throw new NotFoundError("Campaign", id);
    const now = new Date();
    const updated: Campaign = {
      ...existing,
      status: "ARCHIVED",
      deletedAt: now,
      updatedAt: now,
    };
    this.store.set(id, updated);
    return updated;
  }
}

export class InMemoryAdGroupRepository implements AdGroupRepository {
  constructor(private readonly store: Map<string, AdGroup>) {}

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    return findByIdForTenant(this.store, tenantId, id);
  }
  async findByGoogleAdGroupId(googleAdGroupId: string) {
    return (
      [...this.store.values()].find((g) => g.googleAdGroupId === googleAdGroupId) ?? null
    );
  }
  async list(input?: PaginationInput & { campaignId?: string; tenantId?: string }) {
    let items = [...this.store.values()];
    if (input?.campaignId) items = items.filter((g) => g.campaignId === input.campaignId);
    items = filterByTenantId(items, input?.tenantId);
    return paginateArray(items, input);
  }
  async create(data: Omit<AdGroup, "createdAt" | "updatedAt">) {
    assertUnique(
      this.store.values(),
      (g) => g.campaignId === data.campaignId && g.googleAdGroupId === data.googleAdGroupId,
      `AdGroup already exists for campaign ${data.campaignId} / ${data.googleAdGroupId}`,
      { campaignId: data.campaignId, googleAdGroupId: data.googleAdGroupId }
    );
    const entity = { ...data, ...stamp() };
    this.store.set(entity.id, entity);
    return entity;
  }
  async update(id: string, data: Partial<Omit<AdGroup, "id" | "createdAt">>) {
    const existing = this.store.get(id);
    if (!existing) throw new NotFoundError("AdGroup", id);
    const campaignId = data.campaignId ?? existing.campaignId;
    const googleAdGroupId = data.googleAdGroupId ?? existing.googleAdGroupId;
    if (
      campaignId !== existing.campaignId ||
      googleAdGroupId !== existing.googleAdGroupId
    ) {
      assertUnique(
        this.store.values(),
        (g) =>
          g.campaignId === campaignId &&
          g.googleAdGroupId === googleAdGroupId &&
          g.id !== id,
        `AdGroup already exists for campaign ${campaignId} / ${googleAdGroupId}`,
        { campaignId, googleAdGroupId }
      );
    }
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
}

export class InMemoryAdRepository implements AdRepository {
  constructor(private readonly store: Map<string, Ad>) {}

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    return findByIdForTenant(this.store, tenantId, id);
  }
  async findByGoogleAdId(googleAdId: string) {
    return [...this.store.values()].find((a) => a.googleAdId === googleAdId) ?? null;
  }
  async list(input?: PaginationInput & { adGroupId?: string; tenantId?: string }) {
    let items = [...this.store.values()];
    if (input?.adGroupId) items = items.filter((a) => a.adGroupId === input.adGroupId);
    items = filterByTenantId(items, input?.tenantId);
    return paginateArray(items, input);
  }
  async create(data: Omit<Ad, "createdAt" | "updatedAt">) {
    assertUnique(
      this.store.values(),
      (a) => a.adGroupId === data.adGroupId && a.googleAdId === data.googleAdId,
      `Ad already exists for ad group ${data.adGroupId} / ${data.googleAdId}`,
      { adGroupId: data.adGroupId, googleAdId: data.googleAdId }
    );
    const entity = { ...data, ...stamp() };
    this.store.set(entity.id, entity);
    return entity;
  }
  async update(id: string, data: Partial<Omit<Ad, "id" | "createdAt">>) {
    const existing = this.store.get(id);
    if (!existing) throw new NotFoundError("Ad", id);
    const adGroupId = data.adGroupId ?? existing.adGroupId;
    const googleAdId = data.googleAdId ?? existing.googleAdId;
    if (adGroupId !== existing.adGroupId || googleAdId !== existing.googleAdId) {
      assertUnique(
        this.store.values(),
        (a) => a.adGroupId === adGroupId && a.googleAdId === googleAdId && a.id !== id,
        `Ad already exists for ad group ${adGroupId} / ${googleAdId}`,
        { adGroupId, googleAdId }
      );
    }
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
}

export class InMemoryAdGroupCriterionRepository implements AdGroupCriterionRepository {
  constructor(private readonly store: Map<string, AdGroupCriterion>) {}

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    return findByIdForTenant(this.store, tenantId, id);
  }
  async findByGoogleCriterionId(googleCriterionId: string) {
    return (
      [...this.store.values()].find((c) => c.googleCriterionId === googleCriterionId) ?? null
    );
  }
  async list(input?: PaginationInput & { adGroupId?: string; tenantId?: string }) {
    let items = [...this.store.values()];
    if (input?.adGroupId) {
      items = items.filter((c) => c.adGroupId === input.adGroupId);
    }
    items = filterByTenantId(items, input?.tenantId);
    return paginateArray(items, input);
  }
  async create(data: Omit<AdGroupCriterion, "createdAt" | "updatedAt">) {
    const normalized = normalizeAdGroupCriterion(data);
    assertUnique(
      this.store.values(),
      (c) =>
        c.adGroupId === normalized.adGroupId &&
        c.googleCriterionId === normalized.googleCriterionId,
      `AdGroupCriterion already exists for ad group ${normalized.adGroupId} / ${normalized.googleCriterionId}`,
      {
        adGroupId: normalized.adGroupId,
        googleCriterionId: normalized.googleCriterionId,
      }
    );
    const entity = { ...normalized, ...stamp() };
    this.store.set(entity.id, entity);
    return entity;
  }
  async update(id: string, data: Partial<Omit<AdGroupCriterion, "id" | "createdAt">>) {
    const existing = this.store.get(id);
    if (!existing) throw new NotFoundError("AdGroupCriterion", id);
    const keyword = data.keyword ?? data.keywordText ?? existing.keyword ?? existing.keywordText;
    const merged = {
      ...existing,
      ...data,
      keyword,
      keywordText: keyword,
    };
    const adGroupId = merged.adGroupId;
    const googleCriterionId = merged.googleCriterionId;
    if (
      adGroupId !== existing.adGroupId ||
      googleCriterionId !== existing.googleCriterionId
    ) {
      assertUnique(
        this.store.values(),
        (c) =>
          c.adGroupId === adGroupId &&
          c.googleCriterionId === googleCriterionId &&
          c.id !== id,
        `AdGroupCriterion already exists for ad group ${adGroupId} / ${googleCriterionId}`,
        { adGroupId, googleCriterionId }
      );
    }
    const updated = { ...merged, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
}

export class InMemoryOfferRepository implements OfferRepository {
  constructor(private readonly store: Map<string, Offer>) {}

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    return findByIdForTenant(this.store, tenantId, id);
  }
  async findByIdempotencyKey(
    tenantId: string,
    scope: string,
    idempotencyKey: string
  ) {
    return (
      [...this.store.values()].find(
        (o) =>
          o.tenantId === tenantId &&
          o.idempotencyScope === scope &&
          o.idempotencyKey === idempotencyKey
      ) ?? null
    );
  }
  async list(input?: PaginationInput & { tenantId?: string }) {
    return paginateArray(filterByTenantId([...this.store.values()], input?.tenantId), input);
  }
  async create(data: Omit<Offer, "createdAt" | "updatedAt">) {
    if (data.idempotencyScope && data.idempotencyKey) {
      assertUnique(
        this.store.values(),
        (o) =>
          o.tenantId === data.tenantId &&
          o.idempotencyScope === data.idempotencyScope &&
          o.idempotencyKey === data.idempotencyKey,
        `Offer idempotency key already exists: ${data.idempotencyScope}/${data.idempotencyKey}`,
        {
          tenantId: data.tenantId,
          idempotencyScope: data.idempotencyScope,
          idempotencyKey: data.idempotencyKey,
        }
      );
    }
    const entity = {
      ...data,
      priority: data.priority ?? 100,
      ...stamp(),
    };
    this.store.set(entity.id, entity);
    return entity;
  }
  async update(id: string, data: Partial<Omit<Offer, "id" | "createdAt">>) {
    const existing = this.store.get(id);
    if (!existing) throw new NotFoundError("Offer", id);
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
}

export class InMemoryLandingPageRepository implements LandingPageRepository {
  constructor(private readonly store: Map<string, LandingPage>) {}

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    return findByIdForTenant(this.store, tenantId, id);
  }
  async list(input?: PaginationInput & { tenantId?: string; offerId?: string }) {
    let items = [...this.store.values()];
    if (input?.offerId) {
      items = items.filter((lp) => lp.offerId === input.offerId);
    }
    items = filterByTenantId(items, input?.tenantId);
    return paginateArray(items, input);
  }
  async create(data: Omit<LandingPage, "createdAt" | "updatedAt">) {
    const entity = { ...data, ...stamp() };
    this.store.set(entity.id, entity);
    return entity;
  }
  async update(id: string, data: Partial<Omit<LandingPage, "id" | "createdAt">>) {
    const existing = this.store.get(id);
    if (!existing) throw new NotFoundError("LandingPage", id);
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
}

export class InMemoryTrackingLinkOfferRepository
  implements TrackingLinkOfferRepository
{
  constructor(private readonly store: Map<string, TrackingLinkOffer>) {}

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    return findByIdForTenant(this.store, tenantId, id);
  }
  async findByTrackingLinkForTenant(tenantId: string, trackingLinkId: string) {
    return [...this.store.values()]
      .filter(
        (b) => b.tenantId === tenantId && b.trackingLinkId === trackingLinkId
      )
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.offerId.localeCompare(b.offerId);
      });
  }
  async findBindingForTenant(
    tenantId: string,
    trackingLinkId: string,
    offerId: string
  ) {
    return (
      [...this.store.values()].find(
        (b) =>
          b.tenantId === tenantId &&
          b.trackingLinkId === trackingLinkId &&
          b.offerId === offerId
      ) ?? null
    );
  }
  async findFallbackForTrackingLink(tenantId: string, trackingLinkId: string) {
    return (
      [...this.store.values()].find(
        (b) =>
          b.tenantId === tenantId &&
          b.trackingLinkId === trackingLinkId &&
          b.isFallback
      ) ?? null
    );
  }
  async create(data: Omit<TrackingLinkOffer, "createdAt" | "updatedAt">) {
    assertUnique(
      this.store.values(),
      (b) =>
        b.tenantId === data.tenantId &&
        b.trackingLinkId === data.trackingLinkId &&
        b.offerId === data.offerId,
      `TrackingLinkOffer already exists`,
      {
        tenantId: data.tenantId,
        trackingLinkId: data.trackingLinkId,
        offerId: data.offerId,
      }
    );
    if (data.isFallback) {
      assertUnique(
        this.store.values(),
        (b) =>
          b.tenantId === data.tenantId &&
          b.trackingLinkId === data.trackingLinkId &&
          b.isFallback,
        `TrackingLink already has a fallback Offer`,
        { trackingLinkId: data.trackingLinkId }
      );
    }
    const entity = { ...data, priority: data.priority ?? 100, ...stamp() };
    this.store.set(entity.id, entity);
    return entity;
  }
  async update(
    id: string,
    data: Partial<Omit<TrackingLinkOffer, "id" | "createdAt" | "tenantId">>
  ) {
    const existing = this.store.get(id);
    if (!existing) throw new NotFoundError("TrackingLinkOffer", id);
    const next = { ...existing, ...data, updatedAt: new Date() };
    if (next.isFallback && !existing.isFallback) {
      assertUnique(
        this.store.values(),
        (b) =>
          b.tenantId === next.tenantId &&
          b.trackingLinkId === next.trackingLinkId &&
          b.isFallback &&
          b.id !== id,
        `TrackingLink already has a fallback Offer`,
        { trackingLinkId: next.trackingLinkId }
      );
    }
    this.store.set(id, next);
    return next;
  }
  async delete(id: string) {
    if (!this.store.has(id)) throw new NotFoundError("TrackingLinkOffer", id);
    this.store.delete(id);
  }
}

export class InMemoryTrackingLinkRepository implements TrackingLinkRepository {
  constructor(private readonly store: Map<string, TrackingLink>) {}

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    return findByIdForTenant(this.store, tenantId, id);
  }
  async findByPublicId(publicId: string) {
    return [...this.store.values()].find((t) => t.publicId === publicId) ?? null;
  }
  async findByPublicIdForTenant(tenantId: string, publicId: string) {
    return (
      [...this.store.values()].find(
        (t) => t.tenantId === tenantId && t.publicId === publicId
      ) ?? null
    );
  }
  async list(input?: PaginationInput & { tenantId?: string }) {
    return paginateArray(filterByTenantId([...this.store.values()], input?.tenantId), input);
  }
  async create(data: Omit<TrackingLink, "createdAt" | "updatedAt">) {
    assertUnique(
      this.store.values(),
      (t) => t.publicId === data.publicId,
      `TrackingLink publicId already exists: ${data.publicId}`,
      { publicId: data.publicId }
    );
    const entity = { ...data, ...stamp() };
    this.store.set(entity.id, entity);
    return entity;
  }
  async update(id: string, data: Partial<Omit<TrackingLink, "id" | "createdAt">>) {
    const existing = this.store.get(id);
    if (!existing) throw new NotFoundError("TrackingLink", id);
    if (data.publicId && data.publicId !== existing.publicId) {
      assertUnique(
        this.store.values(),
        (t) => t.publicId === data.publicId && t.id !== id,
        `TrackingLink publicId already exists: ${data.publicId}`,
        { publicId: data.publicId }
      );
    }
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
}

export class InMemoryClickRepository implements ClickRepository {
  constructor(private readonly store: Map<string, Click>) {}

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    return findByIdForTenant(this.store, tenantId, id);
  }
  async findByClickIdForTenant(tenantId: string, clickId: string) {
    return (
      [...this.store.values()].find(
        (c) => c.tenantId === tenantId && c.clickId === clickId
      ) ?? null
    );
  }
  async findByIngestionIdForTenant(tenantId: string, ingestionId: string) {
    return (
      [...this.store.values()].find(
        (c) => c.tenantId === tenantId && c.ingestionId === ingestionId
      ) ?? null
    );
  }
  async list(
    input?: PaginationInput & {
      trackingLinkId?: string;
      tenantId?: string;
      offerId?: string;
      campaignId?: string;
    }
  ) {
    let items = [...this.store.values()];
    if (input?.trackingLinkId) {
      items = items.filter((c) => c.trackingLinkId === input.trackingLinkId);
    }
    if (input?.offerId) {
      items = items.filter((c) => c.offerId === input.offerId);
    }
    if (input?.campaignId) {
      items = items.filter((c) => c.campaignId === input.campaignId);
    }
    items = filterByTenantId(items, input?.tenantId);
    return paginateArray(items, input);
  }
  async create(data: Omit<Click, "createdAt"> & { createdAt?: Date }) {
    const clickId = data.clickId ?? data.id;
    if (data.ingestionId) {
      assertUnique(
        this.store.values(),
        (c) =>
          c.tenantId === data.tenantId && c.ingestionId === data.ingestionId,
        `Click ingestionId already exists: ${data.ingestionId}`,
        { tenantId: data.tenantId, ingestionId: data.ingestionId }
      );
    }
    assertUnique(
      this.store.values(),
      (c) => c.clickId === clickId,
      `Click clickId already exists: ${clickId}`,
      { clickId }
    );
    const entity: Click = {
      ...data,
      clickId,
      occurredAt: data.occurredAt ?? data.createdAt ?? new Date(),
      createdAt: data.createdAt ?? new Date(),
    };
    this.store.set(entity.id, entity);
    return entity;
  }
  async countByTrackingLink(tenantId: string, trackingLinkId: string) {
    return [...this.store.values()].filter(
      (c) => c.tenantId === tenantId && c.trackingLinkId === trackingLinkId
    ).length;
  }
  async countByOffer(tenantId: string, offerId: string) {
    return [...this.store.values()].filter(
      (c) => c.tenantId === tenantId && c.offerId === offerId
    ).length;
  }
  async countByCampaign(tenantId: string, campaignId: string) {
    return [...this.store.values()].filter(
      (c) => c.tenantId === tenantId && c.campaignId === campaignId
    ).length;
  }
}

export class InMemoryConversionRepository implements ConversionRepository {
  constructor(private readonly store: Map<string, Conversion>) {}

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    return findByIdForTenant(this.store, tenantId, id);
  }
  async findByIdempotencyKey(tenantId: string, scope: string, idempotencyKey: string) {
    return findByScopedIdempotencyKey(this.store, tenantId, scope, idempotencyKey);
  }
  async findByConversionId(conversionId: string) {
    return this.findById(conversionId);
  }
  async list(input?: PaginationInput & { tenantId?: string }) {
    return paginateArray(filterByTenantId([...this.store.values()], input?.tenantId), input);
  }
  async create(data: Omit<Conversion, "createdAt" | "updatedAt">) {
    if (data.idempotencyScope && data.idempotencyKey) {
      assertUnique(
        this.store.values(),
        (c) =>
          c.tenantId === data.tenantId &&
          c.idempotencyScope === data.idempotencyScope &&
          c.idempotencyKey === data.idempotencyKey,
        `Conversion idempotency key already exists: ${data.idempotencyScope}/${data.idempotencyKey}`,
        {
          tenantId: data.tenantId,
          idempotencyScope: data.idempotencyScope,
          idempotencyKey: data.idempotencyKey,
        }
      );
    }
    const entity = { ...data, ...stamp() };
    this.store.set(entity.id, entity);
    return entity;
  }
  async update(id: string, data: Partial<Omit<Conversion, "id" | "createdAt">>) {
    const existing = this.store.get(id);
    if (!existing) throw new NotFoundError("Conversion", id);
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
}

export class InMemoryOrderRepository implements OrderRepository {
  constructor(private readonly store: Map<string, Order>) {}

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    return findByIdForTenant(this.store, tenantId, id);
  }
  async findByIdempotencyKey(tenantId: string, scope: string, idempotencyKey: string) {
    return findByScopedIdempotencyKey(this.store, tenantId, scope, idempotencyKey);
  }
  async findByOrderId(orderId: string, tenantId?: string) {
    return (
      [...this.store.values()].find(
        (o) => o.orderId === orderId && (tenantId === undefined || o.tenantId === tenantId)
      ) ?? null
    );
  }
  async list(input?: PaginationInput & { tenantId?: string }) {
    return paginateArray(filterByTenantId([...this.store.values()], input?.tenantId), input);
  }
  async create(data: Omit<Order, "createdAt" | "updatedAt">) {
    assertUnique(
      this.store.values(),
      (o) => o.tenantId === data.tenantId && o.orderId === data.orderId,
      `Order already exists for tenant ${data.tenantId} / ${data.orderId}`,
      { tenantId: data.tenantId, orderId: data.orderId }
    );
    if (data.idempotencyScope && data.idempotencyKey) {
      assertUnique(
        this.store.values(),
        (o) =>
          o.tenantId === data.tenantId &&
          o.idempotencyScope === data.idempotencyScope &&
          o.idempotencyKey === data.idempotencyKey,
        `Order idempotency key already exists: ${data.idempotencyScope}/${data.idempotencyKey}`,
        {
          tenantId: data.tenantId,
          idempotencyScope: data.idempotencyScope,
          idempotencyKey: data.idempotencyKey,
        }
      );
    }
    const entity = { ...data, ...stamp() };
    this.store.set(entity.id, entity);
    return entity;
  }
  async update(id: string, data: Partial<Omit<Order, "id" | "createdAt">>) {
    const existing = this.store.get(id);
    if (!existing) throw new NotFoundError("Order", id);
    const tenantId = data.tenantId ?? existing.tenantId;
    const orderId = data.orderId ?? existing.orderId;
    if (tenantId !== existing.tenantId || orderId !== existing.orderId) {
      assertUnique(
        this.store.values(),
        (o) => o.tenantId === tenantId && o.orderId === orderId && o.id !== id,
        `Order already exists for tenant ${tenantId} / ${orderId}`,
        { tenantId, orderId }
      );
    }
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
}

export class InMemoryUrlVersionRepository implements UrlVersionRepository {
  constructor(private readonly store: Map<string, UrlVersion>) {}

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    return findByIdForTenant(this.store, tenantId, id);
  }
  async listByEntity(entityType: UrlEntityType, entityId: string) {
    return [...this.store.values()]
      .filter((v) => v.entityType === entityType && v.entityId === entityId)
      .sort((a, b) => a.version - b.version);
  }
  async findActiveByEntity(entityType: UrlEntityType, entityId: string) {
    return (
      [...this.store.values()].find(
        (v) =>
          v.entityType === entityType &&
          v.entityId === entityId &&
          v.status === "ACTIVE"
      ) ?? null
    );
  }
  async getNextVersion(entityType: UrlEntityType, entityId: string) {
    const versions = await this.listByEntity(entityType, entityId);
    return versions.length === 0 ? 1 : Math.max(...versions.map((v) => v.version)) + 1;
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
    assertUnique(
      this.store.values(),
      (v) =>
        v.tenantId === data.tenantId &&
        v.entityType === data.entityType &&
        v.entityId === data.entityId &&
        v.version === data.version,
      `UrlVersion already exists for ${data.tenantId}/${data.entityType}/${data.entityId} v${data.version}`,
      {
        tenantId: data.tenantId,
        entityType: data.entityType,
        entityId: data.entityId,
        version: data.version,
      }
    );
    if (data.status === "ACTIVE") {
      assertSingleActiveUrlVersion(
        this.store,
        data.tenantId,
        data.entityType,
        data.entityId
      );
    }
    const entity = {
      ...data,
      adId: data.adId ?? (data.entityType === "AD" ? data.entityId : undefined),
      ...stamp(),
    };
    this.store.set(entity.id, entity);
    return entity;
  }
  async updateStatus(id: string, data: UrlVersionStatusPatch) {
    const existing = this.store.get(id);
    if (!existing) throw new NotFoundError("UrlVersion", id);
    const nextStatus = data.status ?? existing.status;
    if (nextStatus === "ACTIVE" && existing.status !== "ACTIVE") {
      assertSingleActiveUrlVersion(
        this.store,
        existing.tenantId,
        existing.entityType,
        existing.entityId,
        id
      );
    }
    const updated: UrlVersion = {
      ...existing,
      status: nextStatus,
      effectiveAt: data.effectiveAt ?? existing.effectiveAt,
      updatedAt: new Date(),
    };
    this.store.set(id, updated);
    return updated;
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
    let items = [...this.store.values()];
    if (input?.adId) {
      items = items.filter(
        (v) => v.adId === input.adId || (v.entityType === "AD" && v.entityId === input.adId)
      );
    }
    if (input?.entityType) {
      items = items.filter((v) => v.entityType === input.entityType);
    }
    if (input?.entityId) {
      items = items.filter((v) => v.entityId === input.entityId);
    }
    items = filterByTenantId(items, input?.tenantId);
    return paginateArray(items, input);
  }
}

export class InMemoryUrlChangeRequestRepository implements UrlChangeRequestRepository {
  constructor(private readonly store: Map<string, UrlChangeRequest>) {}

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    return findByIdForTenant(this.store, tenantId, id);
  }
  async findByIdempotencyKey(tenantId: string, scope: string, idempotencyKey: string) {
    return findByScopedIdempotencyKey(this.store, tenantId, scope, idempotencyKey);
  }
  async list(input?: PaginationInput & { tenantId?: string }) {
    return paginateArray(filterByTenantId([...this.store.values()], input?.tenantId), input);
  }
  async create(data: Omit<UrlChangeRequest, "createdAt" | "updatedAt">) {
    assertUnique(
      this.store.values(),
      (r) =>
        r.tenantId === data.tenantId &&
        r.idempotencyScope === data.idempotencyScope &&
        r.idempotencyKey === data.idempotencyKey,
      `UrlChangeRequest idempotency key already exists: ${data.idempotencyScope}/${data.idempotencyKey}`,
      {
        tenantId: data.tenantId,
        idempotencyScope: data.idempotencyScope,
        idempotencyKey: data.idempotencyKey,
      }
    );
    const entity = { ...data, ...stamp() };
    this.store.set(entity.id, entity);
    return entity;
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
    const existing = this.store.get(id);
    if (!existing) throw new NotFoundError("UrlChangeRequest", id);
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
}

export class InMemorySyncJobRepository implements SyncJobRepository {
  constructor(private readonly store: Map<string, SyncJob>) {}

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByIdForTenant(tenantId: string, id: string) {
    return findByIdForTenant(this.store, tenantId, id);
  }
  async findByJobId(jobId: string) {
    return [...this.store.values()].find((j) => j.jobId === jobId) ?? null;
  }
  async findByIdempotencyKey(tenantId: string, scope: string, idempotencyKey: string) {
    return findByScopedIdempotencyKey(this.store, tenantId, scope, idempotencyKey);
  }
  async list(input?: PaginationInput & { tenantId?: string }) {
    return paginateArray(filterByTenantId([...this.store.values()], input?.tenantId), input);
  }
  async create(data: Omit<SyncJob, "createdAt" | "updatedAt">) {
    assertUnique(
      this.store.values(),
      (j) =>
        j.tenantId === data.tenantId &&
        j.idempotencyScope === data.idempotencyScope &&
        j.idempotencyKey === data.idempotencyKey,
      `SyncJob idempotency key already exists: ${data.idempotencyScope}/${data.idempotencyKey}`,
      {
        tenantId: data.tenantId,
        idempotencyScope: data.idempotencyScope,
        idempotencyKey: data.idempotencyKey,
      }
    );
    const error = data.error ?? data.errorMessage;
    const entity: SyncJob = {
      ...data,
      error,
      errorMessage: error,
      ...stamp(),
    };
    this.store.set(entity.id, entity);
    return entity;
  }
  async update(id: string, data: Partial<Omit<SyncJob, "id" | "createdAt">>) {
    const existing = this.store.get(id);
    if (!existing) throw new NotFoundError("SyncJob", id);
    const error = data.error ?? data.errorMessage ?? existing.error ?? existing.errorMessage;
    const updated: SyncJob = {
      ...existing,
      ...data,
      error,
      errorMessage: error,
      updatedAt: new Date(),
    };
    this.store.set(id, updated);
    return updated;
  }
}

export class InMemoryAuditLogRepository implements AuditLogRepository {
  constructor(private readonly store: Map<string, AuditLog>) {}

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async list(input?: PaginationInput & { tenantId?: string }) {
    let items = [...this.store.values()];
    if (input?.tenantId) {
      items = items.filter((log) => log.tenantId === input.tenantId);
    }
    return paginateArray(items, input);
  }
  async create(data: Omit<AuditLog, "createdAt"> & { createdAt?: Date }) {
    const entity = normalizeAuditLog(data);
    this.store.set(entity.id, entity);
    return entity;
  }
}

export interface MemoryRepositories {
  tenants: TenantRepository;
  users: UserRepository;
  googleAccounts: GoogleAccountRepository;
  campaigns: CampaignRepository;
  adGroups: AdGroupRepository;
  ads: AdRepository;
  adGroupCriteria: AdGroupCriterionRepository;
  offers: OfferRepository;
  landingPages: LandingPageRepository;
  trackingLinkOffers: TrackingLinkOfferRepository;
  trackingLinks: TrackingLinkRepository;
  clicks: ClickRepository;
  conversions: ConversionRepository;
  orders: OrderRepository;
  urlVersions: UrlVersionRepository;
  urlChangeRequests: UrlChangeRequestRepository;
  syncJobs: SyncJobRepository;
  auditLogs: AuditLogRepository;
  scriptIntegrations: GoogleAdsScriptIntegrationRepository;
  scriptSyncTargets: ScriptSyncTargetRepository;
  scriptSyncLogs: ScriptSyncLogRepository;
  unitOfWork: UnitOfWork;
  stores?: InMemoryTransactionalStores;
  scriptSyncRunner: ScriptSyncTransactionRunner;
}

export function createSeededMemoryRepositories(): MemoryRepositories {
  const ds = buildFixtureDataset();

  const toMap = <T extends { id: string }>(items: T[]) =>
    new Map(items.map((item) => [item.id, item]));

  const tenants = toMap(ds.tenants);
  const users = toMap(ds.users);
  const googleAccounts = toMap(ds.googleAccounts);
  const campaigns = toMap(ds.campaigns);
  const adGroups = toMap(ds.adGroups);
  const ads = toMap(ds.ads);
  const adGroupCriteria = toMap(ds.adGroupCriteria);
  const offers = toMap(ds.offers);
  const landingPages = toMap(ds.landingPages);
  const trackingLinkOffers = toMap(ds.trackingLinkOffers);
  const trackingLinks = toMap(ds.trackingLinks);
  const clicks = toMap(ds.clicks);
  const conversions = toMap(ds.conversions);
  const orders = toMap(ds.orders);
  const urlVersions = toMap(ds.urlVersions);
  const urlChangeRequests = toMap(ds.urlChangeRequests);
  const syncJobs = toMap(ds.syncJobs);
  const auditLogs = toMap(ds.auditLogs);
  const scriptIntegrations = new Map<string, GoogleAdsScriptIntegration>();
  const scriptSyncTargets = new Map<string, ScriptSyncTarget>();
  const scriptSyncLogs = new Map<string, ScriptSyncLog>();

  const transactionalStores: InMemoryTransactionalStores = {
    urlVersions,
    urlChangeRequests,
    syncJobs,
    conversions,
    orders,
    auditLogs,
    campaigns,
    adGroups,
    ads,
    adGroupCriteria,
    trackingLinks,
    offers,
    landingPages,
    trackingLinkOffers,
    clicks,
  };

  return {
    tenants: new InMemoryTenantRepository(tenants),
    users: new InMemoryUserRepository(users),
    googleAccounts: new InMemoryGoogleAccountRepository(googleAccounts),
    campaigns: new InMemoryCampaignRepository(campaigns),
    adGroups: new InMemoryAdGroupRepository(adGroups),
    ads: new InMemoryAdRepository(ads),
    adGroupCriteria: new InMemoryAdGroupCriterionRepository(adGroupCriteria),
    offers: new InMemoryOfferRepository(offers),
    landingPages: new InMemoryLandingPageRepository(landingPages),
    trackingLinkOffers: new InMemoryTrackingLinkOfferRepository(trackingLinkOffers),
    trackingLinks: new InMemoryTrackingLinkRepository(trackingLinks),
    clicks: new InMemoryClickRepository(clicks),
    conversions: new InMemoryConversionRepository(conversions),
    orders: new InMemoryOrderRepository(orders),
    urlVersions: new InMemoryUrlVersionRepository(urlVersions),
    urlChangeRequests: new InMemoryUrlChangeRequestRepository(urlChangeRequests),
    syncJobs: new InMemorySyncJobRepository(syncJobs),
    auditLogs: new InMemoryAuditLogRepository(auditLogs),
    scriptIntegrations: new InMemoryGoogleAdsScriptIntegrationRepository(
      scriptIntegrations,
      googleAccounts
    ),
    scriptSyncTargets: new InMemoryScriptSyncTargetRepository(
      scriptSyncTargets,
      scriptIntegrations,
      ads,
      adGroups,
      campaigns
    ),
    scriptSyncLogs: new InMemoryScriptSyncLogRepository(scriptSyncLogs),
    unitOfWork: new InMemoryUnitOfWork(transactionalStores),
    stores: transactionalStores,
    scriptSyncRunner: new InMemoryScriptSyncTransactionRunner({
      scriptSyncTargets,
      scriptSyncLogs,
      scriptIntegrations,
      ads,
      adGroups,
      campaigns,
      urlVersions,
    }),
  };
}
