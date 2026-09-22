import type {
  Ad,
  AdGroup,
  AdGroupCriterion,
  AuditLog,
  Campaign,
  Click,
  Conversion,
  LandingPage,
  Offer,
  Order,
  SyncJob,
  TrackingLink,
  TrackingLinkOffer,
  TransactionContext,
  UnitOfWork,
  UrlChangeRequest,
  UrlVersion,
  AdGroupCriterionRepository,
  AdGroupRepository,
  AdRepository,
  AuditLogRepository,
  CampaignRepository,
  ClickRepository,
  ConversionRepository,
  LandingPageRepository,
  OfferRepository,
  OrderRepository,
  SyncJobRepository,
  TrackingLinkOfferRepository,
  TrackingLinkRepository,
  UrlChangeRequestRepository,
  UrlVersionRepository,
} from "@adlinklab/domain";
import {
  InMemoryAdGroupCriterionRepository,
  InMemoryAdGroupRepository,
  InMemoryAdRepository,
  InMemoryAuditLogRepository,
  InMemoryCampaignRepository,
  InMemoryClickRepository,
  InMemoryConversionRepository,
  InMemoryLandingPageRepository,
  InMemoryOfferRepository,
  InMemoryOrderRepository,
  InMemorySyncJobRepository,
  InMemoryTrackingLinkOfferRepository,
  InMemoryTrackingLinkRepository,
  InMemoryUrlChangeRequestRepository,
  InMemoryUrlVersionRepository,
} from "./repositories.js";

function cloneMap<V>(source: Map<string, V>): Map<string, V> {
  return new Map(
    [...source.entries()].map(([k, v]) => [k, structuredClone(v)])
  );
}

function restoreMap<V>(target: Map<string, V>, snapshot: Map<string, V>): void {
  target.clear();
  for (const [k, v] of snapshot) {
    target.set(k, v);
  }
}

export interface InMemoryTransactionalStores {
  urlVersions: Map<string, UrlVersion>;
  urlChangeRequests: Map<string, UrlChangeRequest>;
  syncJobs: Map<string, SyncJob>;
  conversions: Map<string, Conversion>;
  orders: Map<string, Order>;
  auditLogs: Map<string, AuditLog>;
  campaigns: Map<string, Campaign>;
  adGroups: Map<string, AdGroup>;
  ads: Map<string, Ad>;
  adGroupCriteria: Map<string, AdGroupCriterion>;
  trackingLinks: Map<string, TrackingLink>;
  offers: Map<string, Offer>;
  landingPages: Map<string, LandingPage>;
  trackingLinkOffers: Map<string, TrackingLinkOffer>;
  clicks: Map<string, Click>;
}

/**
 * Simulates BEGIN/COMMIT/ROLLBACK over shared in-memory maps.
 * Transactions are serialized (mutex) so concurrent sync/activation races
 * behave like PostgreSQL unique conflicts rather than lost updates.
 */
export class InMemoryUnitOfWork implements UnitOfWork {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly stores: InMemoryTransactionalStores) {}

  async transaction<T>(
    work: (context: TransactionContext) => Promise<T>
  ): Promise<T> {
    const run = async (): Promise<T> => {
      const snapshot: InMemoryTransactionalStores = {
        urlVersions: cloneMap(this.stores.urlVersions),
        urlChangeRequests: cloneMap(this.stores.urlChangeRequests),
        syncJobs: cloneMap(this.stores.syncJobs),
        conversions: cloneMap(this.stores.conversions),
        orders: cloneMap(this.stores.orders),
        auditLogs: cloneMap(this.stores.auditLogs),
        campaigns: cloneMap(this.stores.campaigns),
        adGroups: cloneMap(this.stores.adGroups),
        ads: cloneMap(this.stores.ads),
        adGroupCriteria: cloneMap(this.stores.adGroupCriteria),
        trackingLinks: cloneMap(this.stores.trackingLinks),
        offers: cloneMap(this.stores.offers),
        landingPages: cloneMap(this.stores.landingPages),
        trackingLinkOffers: cloneMap(this.stores.trackingLinkOffers),
        clicks: cloneMap(this.stores.clicks),
      };

      const context: TransactionContext = {
        urlVersions: new InMemoryUrlVersionRepository(this.stores.urlVersions),
        urlChangeRequests: new InMemoryUrlChangeRequestRepository(
          this.stores.urlChangeRequests
        ),
        syncJobs: new InMemorySyncJobRepository(this.stores.syncJobs),
        conversions: new InMemoryConversionRepository(this.stores.conversions),
        orders: new InMemoryOrderRepository(this.stores.orders),
        auditLogs: new InMemoryAuditLogRepository(this.stores.auditLogs),
        campaigns: new InMemoryCampaignRepository(this.stores.campaigns),
        adGroups: new InMemoryAdGroupRepository(this.stores.adGroups),
        ads: new InMemoryAdRepository(this.stores.ads),
        adGroupCriteria: new InMemoryAdGroupCriterionRepository(
          this.stores.adGroupCriteria
        ),
        trackingLinks: new InMemoryTrackingLinkRepository(
          this.stores.trackingLinks
        ),
        offers: new InMemoryOfferRepository(this.stores.offers),
        landingPages: new InMemoryLandingPageRepository(
          this.stores.landingPages
        ),
        trackingLinkOffers: new InMemoryTrackingLinkOfferRepository(
          this.stores.trackingLinkOffers
        ),
        clicks: new InMemoryClickRepository(this.stores.clicks),
      };

      try {
        return await work(context);
      } catch (error) {
        restoreMap(this.stores.urlVersions, snapshot.urlVersions);
        restoreMap(this.stores.urlChangeRequests, snapshot.urlChangeRequests);
        restoreMap(this.stores.syncJobs, snapshot.syncJobs);
        restoreMap(this.stores.conversions, snapshot.conversions);
        restoreMap(this.stores.orders, snapshot.orders);
        restoreMap(this.stores.auditLogs, snapshot.auditLogs);
        restoreMap(this.stores.campaigns, snapshot.campaigns);
        restoreMap(this.stores.adGroups, snapshot.adGroups);
        restoreMap(this.stores.ads, snapshot.ads);
        restoreMap(this.stores.adGroupCriteria, snapshot.adGroupCriteria);
        restoreMap(this.stores.trackingLinks, snapshot.trackingLinks);
        restoreMap(this.stores.offers, snapshot.offers);
        restoreMap(this.stores.landingPages, snapshot.landingPages);
        restoreMap(this.stores.trackingLinkOffers, snapshot.trackingLinkOffers);
        restoreMap(this.stores.clicks, snapshot.clicks);
        throw error;
      }
    };

    const next = this.chain.then(run, run);
    this.chain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}

export function createTransactionContextFromRepos(input: {
  urlVersions: UrlVersionRepository;
  urlChangeRequests: UrlChangeRequestRepository;
  syncJobs: SyncJobRepository;
  conversions: ConversionRepository;
  orders: OrderRepository;
  auditLogs: AuditLogRepository;
  campaigns: CampaignRepository;
  adGroups: AdGroupRepository;
  ads: AdRepository;
  adGroupCriteria: AdGroupCriterionRepository;
  trackingLinks: TrackingLinkRepository;
  offers: OfferRepository;
  landingPages: LandingPageRepository;
  trackingLinkOffers: TrackingLinkOfferRepository;
  clicks: ClickRepository;
}): TransactionContext {
  return {
    urlVersions: input.urlVersions,
    urlChangeRequests: input.urlChangeRequests,
    syncJobs: input.syncJobs,
    conversions: input.conversions,
    orders: input.orders,
    auditLogs: input.auditLogs,
    campaigns: input.campaigns,
    adGroups: input.adGroups,
    ads: input.ads,
    adGroupCriteria: input.adGroupCriteria,
    trackingLinks: input.trackingLinks,
    offers: input.offers,
    landingPages: input.landingPages,
    trackingLinkOffers: input.trackingLinkOffers,
    clicks: input.clicks,
  };
}
