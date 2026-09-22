import type {
  Ad,
  AdGroup,
  AdGroupCriterion,
  Campaign,
  Click,
  LandingPage,
  Offer,
  TrackingLink,
  TrackingLinkOffer,
} from "./entities.js";
import type {
  AuditLogRepository,
  CampaignRepository,
  AdGroupRepository,
  AdRepository,
  AdGroupCriterionRepository,
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
} from "./repositories.js";

/**
 * Repositories available inside a UnitOfWork transaction.
 * Application services must not call prisma.$transaction directly.
 */
export interface TransactionContext {
  urlVersions: UrlVersionRepository;
  urlChangeRequests: UrlChangeRequestRepository;
  syncJobs: SyncJobRepository;
  conversions: ConversionRepository;
  orders: OrderRepository;
  auditLogs: AuditLogRepository;
  /** Phase 3 — Google Ads hierarchy sync */
  campaigns: CampaignRepository;
  adGroups: AdGroupRepository;
  ads: AdRepository;
  adGroupCriteria: AdGroupCriterionRepository;
  /** Phase 4 — tracking / click attribution */
  trackingLinks: TrackingLinkRepository;
  offers: OfferRepository;
  landingPages: LandingPageRepository;
  clicks: ClickRepository;
  /** Phase 5 — Offer bindings */
  trackingLinkOffers: TrackingLinkOfferRepository;
}

/**
 * Transaction boundary abstraction.
 * Implementations: PrismaUnitOfWork (PostgreSQL), InMemoryUnitOfWork (tests).
 */
export interface UnitOfWork {
  transaction<T>(work: (context: TransactionContext) => Promise<T>): Promise<T>;
}

/** Convenience re-export for sync mappers typing */
export type SyncedCampaign = Campaign;
export type SyncedAdGroup = AdGroup;
export type SyncedAd = Ad;
export type SyncedCriterion = AdGroupCriterion;
export type SyncedClick = Click;
export type SyncedTrackingLink = TrackingLink;
export type SyncedOffer = Offer;
export type SyncedLandingPage = LandingPage;
export type SyncedTrackingLinkOffer = TrackingLinkOffer;
