import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { createGoogleAdsProvider } from "@adlinklab/google-ads";
import {
  OfferEligibilityService,
  OfferSelectionService,
  TrackingLinkOfferService,
} from "@adlinklab/offers";
import { TrackingLinkResolver } from "@adlinklab/tracking";
import { createTrafficProvider } from "@adlinklab/traffic";
import { registerRoutes, type AppServices } from "./routes/index.js";
import {
  createAppRepositoryBundle,
  type CreateRepositoryBundleOptions,
  type PersistenceMode,
} from "./persistence.js";
import {
  createAuthContext,
  type AuthContext,
} from "./auth/tenant.js";
import {
  registerObservability,
  createObservabilityErrorHandler,
} from "./observability/index.js";
import { resolveCorsOrigin } from "./deploy/cors-config.js";
import {
  isRateLimitExemptPath,
  isScriptApiPath,
  resolveRateLimitThresholds,
} from "./deploy/rate-limit-config.js";
import {
  AdService,
  AuditService,
  CampaignService,
  ClickService,
  GoogleAccountService,
  OrderConversionService,
  SyncService,
  TrackingService,
  UrlChangeRequestService,
  UrlVersionService,
} from "./services/index.js";
import { OfferService } from "./services/offer-engine.js";
import {
  ClickIngestionService,
  TrackingLinkManagementService,
} from "./services/click-ingestion.js";
import { GoogleAdsSyncService } from "./services/google-ads-sync.js";
import { ScriptConfigService } from "./services/script-config-service.js";
import { ScriptSyncResultService } from "./services/script-sync-result-service.js";
import { ScriptGeneratorService } from "./services/script-generator-service.js";
import { DashboardQueryService } from "./services/dashboard-query-service.js";
import { ScriptIntegrationService } from "./services/script-integration-service.js";
import { ScriptIntegrationAdminService } from "./services/script-integration-admin-service.js";
import {
  createJobProducer,
  type JobProducer,
} from "./queue/producer.js";
import {
  createWorkerRuntime,
  stoppedWorkerHealth,
  type WorkerHealth,
  type WorkerRuntime,
} from "./queue/runtime.js";

export interface CreateServicesOptions extends CreateRepositoryBundleOptions {
  jobProducer?: JobProducer;
  /**
   * Phase 8.3.2 — attach WorkerRuntime (not started).
   * API server must leave this false; worker.ts sets true.
   */
  withWorker?: boolean;
  workerRuntime?: WorkerRuntime;
}

export function createServices(
  options: CreateServicesOptions = {}
): AppServices {
  const repos = createAppRepositoryBundle(options);
  const jobProducer = createJobProducer(process.env, {
    producer: options.jobProducer,
  });
  const googleAdsKind =
    process.env.GOOGLE_ADS_PROVIDER === "api" ? "api" : "mock";
  const trafficKind =
    process.env.TRAFFIC_PROVIDER === "mock" ? "mock" : "database";

  const provider = createGoogleAdsProvider(googleAdsKind);
  const traffic = createTrafficProvider(trafficKind, repos.clicks);
  const audit = new AuditService(repos.auditLogs);
  const googleAdsSync = new GoogleAdsSyncService(
    repos.googleAccounts,
    provider,
    repos.unitOfWork
  );
  const trackingResolver = new TrackingLinkResolver(
    repos.trackingLinks,
    repos.offers,
    repos.landingPages
  );
  const clickIngestion = new ClickIngestionService(
    trackingResolver,
    repos.clicks,
    repos.unitOfWork
  );
  const trackingLinks = new TrackingLinkManagementService(
    repos.trackingLinks,
    audit
  );
  const offerEligibility = new OfferEligibilityService(
    repos.offers,
    repos.landingPages
  );
  const offerSelection = new OfferSelectionService(
    repos.trackingLinks,
    repos.offers,
    repos.trackingLinkOffers,
    offerEligibility
  );
  const trackingLinkOffers = new TrackingLinkOfferService(
    repos.trackingLinks,
    repos.offers,
    repos.trackingLinkOffers,
    repos.unitOfWork
  );
  const orderConversions = new OrderConversionService(
    repos.orders,
    repos.conversions,
    repos.clicks,
    repos.googleAccounts,
    provider,
    repos.unitOfWork,
    audit,
    repos.syncJobs,
    jobProducer
  );

  const urlChangeRequests = new UrlChangeRequestService(
    repos.urlChangeRequests,
    repos.urlVersions,
    repos.ads,
    provider,
    audit,
    repos.unitOfWork,
    repos.syncJobs,
    jobProducer
  );

  const workerRuntime =
    options.workerRuntime ??
    (options.withWorker
      ? createWorkerRuntime({
          syncJobs: repos.syncJobs,
          urlChangeRequests,
          orderConversions,
        })
      : undefined);

  const dispose = async () => {
    if (workerRuntime) {
      await workerRuntime.close();
    }
    await jobProducer.close();
    if (repos.prisma) {
      await repos.prisma.$disconnect();
    }
  };

  const workerHealth = (): WorkerHealth =>
    workerRuntime ? workerRuntime.getHealth() : stoppedWorkerHealth();

  const scriptGenerator = new ScriptGeneratorService();
  const scriptIntegrationLifecycle = new ScriptIntegrationService(
    repos.scriptIntegrations,
    repos.googleAccounts,
    audit
  );
  const scriptIntegrationAdmin = new ScriptIntegrationAdminService(
    scriptIntegrationLifecycle,
    repos.scriptIntegrations,
    repos.scriptSyncTargets,
    repos.ads,
    repos.adGroups,
    repos.campaigns,
    repos.urlVersions,
    scriptGenerator,
    audit
  );

  return {
    persistence: repos.persistence,
    prisma: repos.prisma,
    queueMode: jobProducer.mode,
    get worker() {
      return workerHealth();
    },
    workerRuntime,
    dispose,
    syncJobs: repos.syncJobs,
    scriptIntegrations: repos.scriptIntegrations,
    scriptConfig: new ScriptConfigService(
      repos.scriptIntegrations,
      repos.scriptSyncTargets,
      repos.ads,
      repos.adGroups,
      repos.urlVersions
    ),
    scriptSyncResult: new ScriptSyncResultService(repos.scriptSyncRunner, audit),
    scriptGenerator,
    dashboardQuery: new DashboardQueryService(
      repos.scriptIntegrations,
      repos.scriptSyncTargets,
      repos.scriptSyncLogs,
      repos.ads,
      repos.adGroups,
      repos.urlVersions
    ),
    scriptIntegrationAdmin,
    googleAccounts: new GoogleAccountService(repos.googleAccounts, googleAdsKind),
    campaigns: new CampaignService(repos.campaigns, provider),
    ads: new AdService(repos.ads, repos.adGroups),
    offers: new OfferService(
      repos.offers,
      repos.landingPages,
      repos.unitOfWork
    ),
    offerSelection,
    offerEligibility,
    trackingLinkOffers,
    tracking: new TrackingService(repos.trackingLinks),
    trackingLinks,
    clicks: new ClickService(repos.clicks, traffic, clickIngestion),
    clickIngestion,
    conversions: orderConversions,
    orders: orderConversions,
    urlVersions: new UrlVersionService(
      repos.urlVersions,
      repos.ads,
      repos.unitOfWork
    ),
    urlChangeRequests,
    sync: new SyncService(repos.syncJobs),
    googleAdsSync,
    audit,
  };
}

export async function buildApp(
  services?: AppServices,
  auth: AuthContext = createAuthContext()
) {
  const resolvedServices = services ?? createServices();
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: resolveCorsOrigin() });

  const limits = resolveRateLimitThresholds();
  await app.register(rateLimit, {
    global: true,
    timeWindow: limits.timeWindow,
    max: (request) =>
      isScriptApiPath(request.url) ? limits.scriptMax : limits.apiMax,
    allowList: (request) => isRateLimitExemptPath(request.url),
    addHeadersOnExceeding: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
    },
    addHeaders: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
      "retry-after": true,
    },
  });

  await registerObservability(app);
  app.setErrorHandler(createObservabilityErrorHandler());

  app.addHook("onClose", async () => {
    await resolvedServices.dispose();
  });

  await registerRoutes(app, resolvedServices, auth);
  return app;
}

export type { PersistenceMode };
export type { AuthContext };
