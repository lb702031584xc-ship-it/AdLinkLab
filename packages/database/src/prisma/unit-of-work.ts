import type { TransactionContext, UnitOfWork } from "@adlinklab/domain";
import type { PrismaClient } from "@prisma/client";
import {
  PrismaAdGroupCriterionRepository,
  PrismaAdGroupRepository,
  PrismaAdRepository,
  PrismaAuditLogRepository,
  PrismaCampaignRepository,
  PrismaClickRepository,
  PrismaConversionRepository,
  PrismaLandingPageRepository,
  PrismaOfferRepository,
  PrismaOrderRepository,
  PrismaSyncJobRepository,
  PrismaTrackingLinkOfferRepository,
  PrismaTrackingLinkRepository,
  PrismaUrlChangeRequestRepository,
  PrismaUrlVersionRepository,
} from "./repositories.js";

type PrismaTx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends" | "$use"
>;

/**
 * PostgreSQL transactions via prisma.$transaction.
 * Never wrap external Google Ads / network API calls inside this boundary.
 */
export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly db: PrismaClient) {}

  async transaction<T>(
    work: (context: TransactionContext) => Promise<T>
  ): Promise<T> {
    return this.db.$transaction(async (tx: PrismaTx) => {
      const client = tx as PrismaClient;
      const context: TransactionContext = {
        urlVersions: new PrismaUrlVersionRepository(client),
        urlChangeRequests: new PrismaUrlChangeRequestRepository(client),
        syncJobs: new PrismaSyncJobRepository(client),
        conversions: new PrismaConversionRepository(client),
        orders: new PrismaOrderRepository(client),
        auditLogs: new PrismaAuditLogRepository(client),
        campaigns: new PrismaCampaignRepository(client),
        adGroups: new PrismaAdGroupRepository(client),
        ads: new PrismaAdRepository(client),
        adGroupCriteria: new PrismaAdGroupCriterionRepository(client),
        trackingLinks: new PrismaTrackingLinkRepository(client),
        offers: new PrismaOfferRepository(client),
        landingPages: new PrismaLandingPageRepository(client),
        trackingLinkOffers: new PrismaTrackingLinkOfferRepository(client),
        clicks: new PrismaClickRepository(client),
      };
      return work(context);
    });
  }
}
