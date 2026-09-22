import type {
  AdGroupCriterionRepository,
  AdGroupRepository,
  AdRepository,
  AuditLogRepository,
  CampaignRepository,
  ClickRepository,
  ConversionRepository,
  GoogleAccountRepository,
  GoogleAdsScriptIntegrationRepository,
  LandingPageRepository,
  OfferRepository,
  OrderRepository,
  ScriptSyncLogRepository,
  ScriptSyncTargetRepository,
  SyncJobRepository,
  TenantRepository,
  TrackingLinkOfferRepository,
  TrackingLinkRepository,
  UnitOfWork,
  UrlChangeRequestRepository,
  UrlVersionRepository,
  UserRepository,
} from "@adlinklab/domain";
import type { PrismaClient } from "@prisma/client";
import { createSeededMemoryRepositories } from "./memory/repositories.js";
import { createPrismaRepositories } from "./prisma/repositories.js";
import { PrismaUnitOfWork } from "./prisma/unit-of-work.js";
import { prisma as sharedPrisma } from "./client.js";
import { PrismaScriptSyncTransactionRunner } from "./script-sync-transaction.js";
import type { ScriptSyncTransactionRunner } from "./script-sync-transaction.js";

export type PersistenceMode = "memory" | "prisma";

/**
 * Unified repository surface for API / worker bootstrap.
 * Memory includes seeded fixtures; Prisma uses the live DATABASE_URL client.
 */
export interface RepositoryBundle {
  persistence: PersistenceMode;
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
  /** Phase 8.4.4 — atomic script sync-result transactions */
  scriptSyncRunner: ScriptSyncTransactionRunner;
  /** Present only for prisma mode — caller must disconnect on shutdown. */
  prisma?: PrismaClient;
}

export function createMemoryRepositoryBundle(): RepositoryBundle {
  const repos = createSeededMemoryRepositories();
  return {
    persistence: "memory",
    tenants: repos.tenants,
    users: repos.users,
    googleAccounts: repos.googleAccounts,
    campaigns: repos.campaigns,
    adGroups: repos.adGroups,
    ads: repos.ads,
    adGroupCriteria: repos.adGroupCriteria,
    offers: repos.offers,
    landingPages: repos.landingPages,
    trackingLinkOffers: repos.trackingLinkOffers,
    trackingLinks: repos.trackingLinks,
    clicks: repos.clicks,
    conversions: repos.conversions,
    orders: repos.orders,
    urlVersions: repos.urlVersions,
    urlChangeRequests: repos.urlChangeRequests,
    syncJobs: repos.syncJobs,
    auditLogs: repos.auditLogs,
    scriptIntegrations: repos.scriptIntegrations,
    scriptSyncTargets: repos.scriptSyncTargets,
    scriptSyncLogs: repos.scriptSyncLogs,
    unitOfWork: repos.unitOfWork,
    scriptSyncRunner: repos.scriptSyncRunner,
  };
}

export function createPrismaRepositoryBundle(
  db: PrismaClient = sharedPrisma
): RepositoryBundle {
  const repos = createPrismaRepositories(db);
  return {
    persistence: "prisma",
    ...repos,
    unitOfWork: new PrismaUnitOfWork(db),
    scriptSyncRunner: new PrismaScriptSyncTransactionRunner(db),
    prisma: db,
  };
}
