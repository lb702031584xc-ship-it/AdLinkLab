import type { FastifyInstance } from "fastify";
import type {
  OfferEligibilityService,
  OfferSelectionService,
  TrackingLinkOfferService,
} from "@adlinklab/offers";
import type { OfferStatus } from "@adlinklab/domain";
import { ValidationError } from "@adlinklab/shared";
import type {
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
} from "../services/index.js";
import type { OfferService } from "../services/offer-engine.js";
import type {
  ClickIngestionService,
  TrackingLinkManagementService,
} from "../services/click-ingestion.js";
import type { GoogleAdsSyncService } from "../services/google-ads-sync.js";
import type {
  GoogleAdsScriptIntegrationRepository,
  SyncJobRepository,
} from "@adlinklab/domain";
import type { ScriptConfigService } from "../services/script-config-service.js";
import type { ScriptSyncResultService } from "../services/script-sync-result-service.js";
import type { ScriptGeneratorService } from "../services/script-generator-service.js";
import type { DashboardQueryService } from "../services/dashboard-query-service.js";
import type { ScriptIntegrationAdminService } from "../services/script-integration-admin-service.js";
import { registerScriptRoutes } from "./script.js";
import { registerDashboardRoutes } from "./dashboard.js";
import { registerAdminScriptIntegrationRoutes } from "./admin-script-integrations.js";
import type {
  WorkerHealth,
  WorkerRuntime,
} from "../queue/runtime.js";
import {
  assertAuthConfigured,
  createAuthContext,
  requireTenant,
  type AuthContext,
} from "../auth/tenant.js";
import {
  evaluateReadiness,
  httpMetrics,
} from "../observability/index.js";
import { getQueueCatalog } from "../queue/queue-catalog.js";
import type { PrismaClient } from "@adlinklab/database";

export interface AppServices {
  /** Phase 8.1 — memory (tests/default) or prisma (DATABASE_URL / production). */
  persistence: "memory" | "prisma";
  /** Optional Prisma client for readiness (prisma mode only). */
  prisma?: PrismaClient;
  /** Phase 8.3.1 — off (noop) | redis (BullMQ producer). */
  queueMode: "off" | "redis";
  /** Phase 8.3.2 — API process reports stopped; worker.ts enables runtime. */
  worker: WorkerHealth;
  workerRuntime?: WorkerRuntime;
  dispose: () => Promise<void>;
  /** Repository access for Worker authorization (not Prisma direct). */
  syncJobs: SyncJobRepository;
  /** Phase 8.4.2 — Integration token auth (Script Config API). */
  scriptIntegrations: GoogleAdsScriptIntegrationRepository;
  /** Phase 8.4.3 — Script desired configuration (read-only). */
  scriptConfig: ScriptConfigService;
  /** Phase 8.4.4 — Script sync result + applied state. */
  scriptSyncResult: ScriptSyncResultService;
  /** Phase 8.4.6 — Script source generator (read-only). */
  scriptGenerator: ScriptGeneratorService;
  /** Phase 8.4.7.1 — Dashboard read model (read-only). */
  dashboardQuery: DashboardQueryService;
  /** Phase 8.4.9 — Script Integration Admin (Tenant API Key). */
  scriptIntegrationAdmin: ScriptIntegrationAdminService;
  googleAccounts: GoogleAccountService;
  campaigns: CampaignService;
  ads: AdService;
  offers: OfferService;
  offerSelection: OfferSelectionService;
  offerEligibility: OfferEligibilityService;
  trackingLinkOffers: TrackingLinkOfferService;
  tracking: TrackingService;
  trackingLinks: TrackingLinkManagementService;
  clicks: ClickService;
  clickIngestion: ClickIngestionService;
  conversions: OrderConversionService;
  orders: OrderConversionService;
  urlVersions: UrlVersionService;
  urlChangeRequests: UrlChangeRequestService;
  sync: SyncService;
  googleAdsSync: GoogleAdsSyncService;
  audit: AuditService;
}

export async function registerRoutes(
  app: FastifyInstance,
  services: AppServices,
  auth: AuthContext = createAuthContext()
): Promise<void> {
  assertAuthConfigured(auth);
  const tenantOf = (
    request: Parameters<typeof requireTenant>[1],
    bodyTenant?: string
  ) => requireTenant(auth, request, bodyTenant);

  app.get("/health", async () => ({
    status: "ok",
    service: "adlinklab-api",
    phase: "10",
    persistence: services.persistence,
    authMode: auth.mode,
    queueMode: services.queueMode,
    worker: services.worker,
    /** Phase 9.6 — per-queue capability (IMPLEMENTED only when Worker+Processor exist). */
    queues: getQueueCatalog().map((q) => ({
      queueName: q.queueName,
      status: q.status,
      workerRegistered: q.workerRegistered,
    })),
    timestamp: new Date().toISOString(),
  }));

  /** Phase 9.3 — process liveness (no dependency checks). */
  app.get("/health/live", async () => ({
    status: "ok",
  }));

  /** Phase 9.3 — readiness (postgres when prisma; redis when queueMode=redis). */
  app.get("/health/ready", async (_request, reply) => {
    const result = await evaluateReadiness({
      persistence: services.persistence,
      queueMode: services.queueMode,
      prisma: services.prisma,
    });
    if (result.status !== "ok") {
      return reply.status(503).send(result);
    }
    return result;
  });

  /** Phase 9.3 — in-memory Prometheus text metrics. */
  app.get("/metrics", async (_request, reply) => {
    return reply
      .type("text/plain; version=0.0.4; charset=utf-8")
      .send(httpMetrics.renderPrometheus());
  });

  app.get<{
    Headers: { "x-tenant-id"?: string };
    Querystring: { page?: string; pageSize?: string };
  }>("/api/v1/campaigns", async (request) => {
    const tenantId = tenantOf(request);
    return services.campaigns.list(
      tenantId,
      request.query.page ? Number(request.query.page) : undefined,
      request.query.pageSize ? Number(request.query.pageSize) : undefined
    );
  });

  app.get<{
    Headers: { "x-tenant-id"?: string };
    Querystring: { page?: string; pageSize?: string };
  }>("/api/v1/ad-groups", async (request) => {
    const tenantId = tenantOf(request);
    return services.ads.listAdGroups(
      tenantId,
      request.query.page ? Number(request.query.page) : undefined,
      request.query.pageSize ? Number(request.query.pageSize) : undefined
    );
  });

  app.get<{
    Headers: { "x-tenant-id"?: string };
    Querystring: { page?: string; pageSize?: string };
  }>("/api/v1/ads", async (request) => {
    const tenantId = tenantOf(request);
    return services.ads.list(
      tenantId,
      request.query.page ? Number(request.query.page) : undefined,
      request.query.pageSize ? Number(request.query.pageSize) : undefined
    );
  });

  app.get<{
    Headers: { "x-tenant-id"?: string };
    Querystring: { page?: string; pageSize?: string };
  }>("/api/v1/offers", async (request) => {
    const tenantId = tenantOf(request);
    return services.offers.list(
      tenantId,
      request.query.page ? Number(request.query.page) : undefined,
      request.query.pageSize ? Number(request.query.pageSize) : undefined
    );
  });

  app.get<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
  }>("/api/v1/offers/:id", async (request) => {
    const tenantId = tenantOf(request);
    return services.offers.getById(tenantId, request.params.id);
  });

  app.post<{
    Headers: { "x-tenant-id"?: string };
    Body: {
      tenantId?: string;
      name: string;
      network: string;
      destinationUrl: string;
      status?: OfferStatus;
      priority?: number;
      startsAt?: string;
      endsAt?: string;
      idempotencyKey?: string;
      requestId?: string;
    };
  }>("/api/v1/offers", async (request) => {
    const tenantId = tenantOf(request, request.body?.tenantId);
    return services.offers.create({
      tenantId,
      name: request.body.name,
      network: request.body.network,
      destinationUrl: request.body.destinationUrl,
      status: request.body.status,
      priority: request.body.priority,
      startsAt: request.body.startsAt
        ? new Date(request.body.startsAt)
        : undefined,
      endsAt: request.body.endsAt ? new Date(request.body.endsAt) : undefined,
      idempotencyKey: request.body.idempotencyKey,
      requestId: request.body.requestId,
    });
  });

  app.patch<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
    Body: {
      tenantId?: string;
      name?: string;
      network?: string;
      destinationUrl?: string;
      priority?: number;
      startsAt?: string | null;
      endsAt?: string | null;
      requestId?: string;
    };
  }>("/api/v1/offers/:id", async (request) => {
    const tenantId = tenantOf(request, request.body?.tenantId);
    return services.offers.update(
      tenantId,
      request.params.id,
      {
        name: request.body.name,
        network: request.body.network,
        destinationUrl: request.body.destinationUrl,
        priority: request.body.priority,
        startsAt:
          request.body.startsAt === null
            ? null
            : request.body.startsAt
              ? new Date(request.body.startsAt)
              : undefined,
        endsAt:
          request.body.endsAt === null
            ? null
            : request.body.endsAt
              ? new Date(request.body.endsAt)
              : undefined,
      },
      request.body.requestId
    );
  });

  app.post<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
    Body: { tenantId?: string; status: OfferStatus; requestId?: string };
  }>("/api/v1/offers/:id/status", async (request) => {
    const tenantId = tenantOf(request, request.body?.tenantId);
    if (!request.body?.status) {
      throw new ValidationError("status is required");
    }
    return services.offers.changeStatus(
      tenantId,
      request.params.id,
      request.body.status,
      request.body.requestId
    );
  });

  app.get<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
    Querystring: { page?: string; pageSize?: string };
  }>("/api/v1/offers/:id/landing-pages", async (request) => {
    const tenantId = tenantOf(request);
    return services.offers.listLandingPages(
      tenantId,
      request.params.id,
      request.query.page ? Number(request.query.page) : undefined,
      request.query.pageSize ? Number(request.query.pageSize) : undefined
    );
  });

  app.get<{
    Headers: { "x-tenant-id"?: string };
    Querystring: { page?: string; pageSize?: string };
  }>("/api/v1/tracking-links", async (request) => {
    const tenantId = tenantOf(request);
    return services.trackingLinks.list(
      tenantId,
      request.query.page ? Number(request.query.page) : undefined,
      request.query.pageSize ? Number(request.query.pageSize) : undefined
    );
  });

  app.get<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
  }>("/api/v1/tracking-links/:id", async (request) => {
    const tenantId = tenantOf(request);
    return services.trackingLinks.getById(tenantId, request.params.id);
  });

  app.get<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
  }>("/api/v1/tracking-links/:id/offers", async (request) => {
    const tenantId = tenantOf(request);
    return services.trackingLinkOffers.listBindings(
      tenantId,
      request.params.id
    );
  });

  app.put<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
    Body: {
      tenantId?: string;
      requestId?: string;
      bindings: Array<{
        offerId: string;
        priority?: number;
        isFallback?: boolean;
      }>;
    };
  }>("/api/v1/tracking-links/:id/offers", async (request) => {
    const tenantId = tenantOf(request, request.body?.tenantId);
    return services.trackingLinkOffers.replaceBindings({
      tenantId,
      trackingLinkId: request.params.id,
      bindings: request.body?.bindings ?? [],
      requestId: request.body?.requestId,
    });
  });

  app.post<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
    Body: { tenantId?: string; now?: string; requestId?: string };
  }>("/api/v1/tracking-links/:id/select-offer", async (request) => {
    const tenantId = tenantOf(request, request.body?.tenantId);
    // Dry-run / explicit selection — no Google Ads mutation, no UrlChange
    return services.offerSelection.select({
      tenantId,
      trackingLinkId: request.params.id,
      now: request.body?.now ? new Date(request.body.now) : undefined,
    });
  });

  app.get<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
    Querystring: { page?: string; pageSize?: string };
  }>("/api/v1/tracking-links/:id/clicks", async (request) => {
    const tenantId = tenantOf(request);
    return services.clickIngestion.listByTrackingLink(
      tenantId,
      request.params.id,
      request.query.page ? Number(request.query.page) : undefined,
      request.query.pageSize ? Number(request.query.pageSize) : undefined
    );
  });

  app.post<{
    Params: { publicId: string };
    Headers: { "x-tenant-id"?: string; "x-ingestion-id"?: string };
    Body: {
      tenantId?: string;
      ingestionId?: string;
      requestId?: string;
      ipAddress?: string;
      userAgent?: string;
      referer?: string;
      queryParameters?: Record<string, string>;
    };
  }>("/api/v1/tracking-links/:publicId/click", async (request) => {
    const tenantId = tenantOf(request, request.body?.tenantId);
    return services.clickIngestion.recordClick({
      tenantId,
      trackingLinkPublicId: request.params.publicId,
      ingestionId:
        request.body?.ingestionId ?? request.headers["x-ingestion-id"],
      requestId: request.body?.requestId,
      requestMetadata: {
        ipAddress: request.body?.ipAddress,
        userAgent: request.body?.userAgent,
        referer: request.body?.referer,
        queryParameters: request.body?.queryParameters,
      },
    });
  });

  /** Public click → 302 — no auth / no x-tenant-id (Phase 8.2). */
  app.get<{
    Params: { publicId: string };
    Headers: { "x-ingestion-id"?: string };
    Querystring: Record<string, string>;
  }>("/api/v1/t/:publicId", async (request, reply) => {
    const result = await services.clickIngestion.recordClick({
      trackingLinkPublicId: request.params.publicId,
      ingestionId: request.headers["x-ingestion-id"],
      requestMetadata: {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        referer: request.headers.referer,
        queryParameters: request.query,
      },
    });
    return reply.redirect(result.redirectUrl, 302);
  });

  app.post<{
    Headers: { "x-tenant-id"?: string };
    Body: {
      tenantId?: string;
      trackingLinkPublicId: string;
      ingestionId?: string;
      requestId?: string;
      ipAddress?: string;
      userAgent?: string;
      referer?: string;
      queryParameters?: Record<string, string>;
    };
  }>("/api/v1/tracking/click", async (request) => {
    const tenantId = tenantOf(request, request.body?.tenantId);
    if (!request.body?.trackingLinkPublicId) {
      throw new ValidationError("trackingLinkPublicId is required");
    }
    return services.clickIngestion.recordClick({
      tenantId,
      trackingLinkPublicId: request.body.trackingLinkPublicId,
      ingestionId: request.body.ingestionId,
      requestId: request.body.requestId,
      requestMetadata: {
        ipAddress: request.body.ipAddress,
        userAgent: request.body.userAgent,
        referer: request.body.referer,
        queryParameters: request.body.queryParameters,
      },
    });
  });

  app.get<{
    Headers: { "x-tenant-id"?: string };
    Querystring: { page?: string; pageSize?: string };
  }>("/api/v1/clicks", async (request) => {
    const tenantId = tenantOf(request);
    return services.clickIngestion.list(
      tenantId,
      request.query.page ? Number(request.query.page) : undefined,
      request.query.pageSize ? Number(request.query.pageSize) : undefined
    );
  });

  app.get<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
  }>("/api/v1/clicks/:id", async (request) => {
    const tenantId = tenantOf(request);
    return services.clickIngestion.getClick(tenantId, request.params.id);
  });

  app.get<{
    Headers: { "x-tenant-id"?: string };
    Querystring: { page?: string; pageSize?: string };
  }>("/api/v1/conversions", async (request) => {
    const tenantId = tenantOf(request);
    return services.conversions.listConversions(
      tenantId,
      request.query.page ? Number(request.query.page) : undefined,
      request.query.pageSize ? Number(request.query.pageSize) : undefined
    );
  });

  app.post<{
    Headers: { "x-tenant-id"?: string };
    Body: {
      tenantId?: string;
      clickId: string;
      conversionAction: string;
      conversionTime?: string;
      value?: string;
      currency?: string;
      orderUuid?: string;
      idempotencyKey?: string;
      requestId?: string;
    };
  }>("/api/v1/conversions", async (request) => {
    const tenantId = tenantOf(request, request.body?.tenantId);
    const body = request.body;
    if (!body?.clickId) throw new ValidationError("clickId is required");
    if (!body?.conversionAction) {
      throw new ValidationError("conversionAction is required");
    }
    return services.conversions.createConversion({
      tenantId,
      clickId: body.clickId,
      conversionAction: body.conversionAction,
      conversionTime: body.conversionTime
        ? new Date(body.conversionTime)
        : undefined,
      value: body.value,
      currency: body.currency,
      orderUuid: body.orderUuid,
      idempotencyKey: body.idempotencyKey,
      requestId: body.requestId,
    });
  });

  app.post<{
    Headers: { "x-tenant-id"?: string };
    Body: {
      tenantId?: string;
      orderId: string;
      conversionAction: string;
      conversionTime?: string;
      value?: string;
      currency?: string;
      idempotencyKey?: string;
      requestId?: string;
    };
  }>("/api/v1/conversions/from-order", async (request) => {
    const tenantId = tenantOf(request, request.body?.tenantId);
    const body = request.body;
    if (!body?.orderId) throw new ValidationError("orderId is required");
    if (!body?.conversionAction) {
      throw new ValidationError("conversionAction is required");
    }
    return services.conversions.createConversionFromOrder({
      tenantId,
      orderId: body.orderId,
      conversionAction: body.conversionAction,
      conversionTime: body.conversionTime
        ? new Date(body.conversionTime)
        : undefined,
      value: body.value,
      currency: body.currency,
      idempotencyKey: body.idempotencyKey,
      requestId: body.requestId,
    });
  });

  app.get<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
  }>("/api/v1/conversions/:id", async (request) => {
    const tenantId = tenantOf(request);
    return services.conversions.getConversion(tenantId, request.params.id);
  });

  app.post<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
  }>("/api/v1/conversions/:id/queue", async (request) => {
    const tenantId = tenantOf(request);
    return services.conversions.queueUpload(tenantId, request.params.id);
  });

  app.post<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
  }>("/api/v1/conversions/:id/execute", async (request) => {
    const tenantId = tenantOf(request);
    return services.conversions.processQueued(tenantId, request.params.id);
  });

  app.post<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
  }>("/api/v1/conversions/:id/retry", async (request) => {
    const tenantId = tenantOf(request);
    return services.conversions.retryUpload(tenantId, request.params.id);
  });

  app.post<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
  }>("/api/v1/conversions/:id/cancel", async (request) => {
    const tenantId = tenantOf(request);
    return services.conversions.cancelUpload(tenantId, request.params.id);
  });

  app.get<{
    Headers: { "x-tenant-id"?: string };
    Querystring: { page?: string; pageSize?: string };
  }>("/api/v1/orders", async (request) => {
    const tenantId = tenantOf(request);
    return services.orders.listOrders(
      tenantId,
      request.query.page ? Number(request.query.page) : undefined,
      request.query.pageSize ? Number(request.query.pageSize) : undefined
    );
  });

  app.get<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
  }>("/api/v1/orders/:id", async (request) => {
    const tenantId = tenantOf(request);
    return services.orders.getOrder(tenantId, request.params.id);
  });

  app.post<{
    Headers: { "x-tenant-id"?: string };
    Body: {
      tenantId?: string;
      orderId: string;
      clickId: string;
      value: string;
      currency: string;
      status?: "PENDING" | "CONFIRMED" | "CANCELLED" | "REFUNDED" | "ARCHIVED";
      idempotencyKey?: string;
      requestId?: string;
    };
  }>("/api/v1/orders", async (request) => {
    const tenantId = tenantOf(request, request.body?.tenantId);
    const body = request.body;
    if (!body?.orderId) throw new ValidationError("orderId is required");
    if (!body?.clickId) throw new ValidationError("clickId is required");
    if (!body?.value) throw new ValidationError("value is required");
    if (!body?.currency) throw new ValidationError("currency is required");
    return services.orders.createOrder({
      tenantId,
      orderId: body.orderId,
      clickId: body.clickId,
      value: body.value,
      currency: body.currency,
      status: body.status,
      idempotencyKey: body.idempotencyKey,
      requestId: body.requestId,
    });
  });

  app.post<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
    Body: {
      status: "PENDING" | "CONFIRMED" | "CANCELLED" | "REFUNDED" | "ARCHIVED";
    };
  }>("/api/v1/orders/:id/status", async (request) => {
    const tenantId = tenantOf(request);
    if (!request.body?.status) {
      throw new ValidationError("status is required");
    }
    return services.orders.changeOrderStatus(
      tenantId,
      request.params.id,
      request.body.status
    );
  });

  app.get<{
    Headers: { "x-tenant-id"?: string };
    Querystring: { page?: string; pageSize?: string };
  }>("/api/v1/url-versions", async (request) => {
    const tenantId = tenantOf(request);
    return services.urlVersions.list(
      tenantId,
      request.query.page ? Number(request.query.page) : undefined,
      request.query.pageSize ? Number(request.query.pageSize) : undefined
    );
  });

  app.get<{
    Headers: { "x-tenant-id"?: string };
    Querystring: { page?: string; pageSize?: string };
  }>("/api/v1/url-change-requests", async (request) => {
    const tenantId = tenantOf(request);
    return services.urlChangeRequests.list(
      tenantId,
      request.query.page ? Number(request.query.page) : undefined,
      request.query.pageSize ? Number(request.query.pageSize) : undefined
    );
  });

  app.get<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
  }>("/api/v1/url-change-requests/:id", async (request) => {
    const tenantId = tenantOf(request);
    return services.urlChangeRequests.getById(tenantId, request.params.id);
  });

  app.post<{
    Headers: { "x-tenant-id"?: string };
    Body: {
      tenantId?: string;
      entityType: "CUSTOMER" | "CAMPAIGN" | "AD_GROUP" | "AD" | "AD_GROUP_CRITERION";
      entityId: string;
      toVersionId: string;
      reason: string;
      requestedBy: string;
      idempotencyKey?: string;
      scheduledAt?: string;
    };
  }>("/api/v1/url-change-requests", async (request) => {
    const tenantId = tenantOf(request, request.body?.tenantId);
    const body = request.body;
    return services.urlChangeRequests.create({
      tenantId,
      entityType: body.entityType,
      entityId: body.entityId,
      toVersionId: body.toVersionId,
      reason: body.reason,
      requestedBy: body.requestedBy,
      idempotencyKey: body.idempotencyKey,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
    });
  });

  app.post<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
  }>("/api/v1/url-change-requests/:id/validate", async (request) => {
    const tenantId = tenantOf(request);
    return services.urlChangeRequests.validate(tenantId, request.params.id);
  });

  app.post<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
  }>("/api/v1/url-change-requests/:id/preview", async (request) => {
    const tenantId = tenantOf(request);
    return services.urlChangeRequests.preview(tenantId, request.params.id);
  });

  app.post<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
    Body: { jobId?: string };
  }>("/api/v1/url-change-requests/:id/queue", async (request) => {
    const tenantId = tenantOf(request);
    return services.urlChangeRequests.queue(
      tenantId,
      request.params.id,
      request.body?.jobId
    );
  });

  app.post<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
  }>("/api/v1/url-change-requests/:id/execute", async (request) => {
    const tenantId = tenantOf(request);
    return services.urlChangeRequests.processQueued(
      tenantId,
      request.params.id
    );
  });

  app.post<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
  }>("/api/v1/url-change-requests/:id/cancel", async (request) => {
    const tenantId = tenantOf(request);
    return services.urlChangeRequests.cancel(tenantId, request.params.id);
  });

  app.post<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
    Body: {
      requestedBy: string;
      idempotencyKey?: string;
      reason?: string;
    };
  }>("/api/v1/url-change-requests/:id/rollback", async (request) => {
    const tenantId = tenantOf(request);
    return services.urlChangeRequests.rollback(tenantId, request.params.id, {
      requestedBy: request.body.requestedBy,
      idempotencyKey: request.body.idempotencyKey,
      reason: request.body.reason,
    });
  });

  app.get<{
    Headers: { "x-tenant-id"?: string };
    Querystring: { page?: string; pageSize?: string };
  }>("/api/v1/jobs", async (request) => {
    const tenantId = tenantOf(request);
    return services.sync.list(
      tenantId,
      request.query.page ? Number(request.query.page) : undefined,
      request.query.pageSize ? Number(request.query.pageSize) : undefined
    );
  });

  app.get<{
    Headers: { "x-tenant-id"?: string };
    Querystring: { page?: string; pageSize?: string };
  }>("/api/v1/google-accounts", async (request) => {
    const tenantId = tenantOf(request);
    return services.googleAccounts.list(
      tenantId,
      request.query.page ? Number(request.query.page) : undefined,
      request.query.pageSize ? Number(request.query.pageSize) : undefined
    );
  });

  app.get<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
  }>("/api/v1/google-accounts/:id/status", async (request) => {
    const tenantId = tenantOf(request);
    return services.googleAccounts.getStatus({
      id: request.params.id,
      tenantId,
    });
  });

  app.post<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
    Body: {
      tenantId?: string;
      idempotencyKey?: string;
      campaignIds?: string[];
      requestId?: string;
    };
  }>("/api/v1/google-accounts/:id/sync", async (request) => {
    const tenantId = tenantOf(request, request.body?.tenantId);
    const result = await services.googleAdsSync.sync({
      tenantId,
      googleAccountId: request.params.id,
      idempotencyKey: request.body?.idempotencyKey,
      campaignIds: request.body?.campaignIds,
      requestId: request.body?.requestId,
    });
    return {
      job: result.job,
      summary: result.summary,
      created: result.created,
      replayed: result.replayed,
    };
  });

  app.get<{
    Headers: { "x-tenant-id"?: string };
    Querystring: { page?: string; pageSize?: string };
  }>("/api/v1/audit-logs", async (request) => {
    const tenantId = tenantOf(request);
    return services.audit.list(
      tenantId,
      request.query.page ? Number(request.query.page) : undefined,
      request.query.pageSize ? Number(request.query.pageSize) : undefined
    );
  });

  await registerScriptRoutes(app, services);
  await registerDashboardRoutes(app, services);
  await registerAdminScriptIntegrationRoutes(app, services, auth);
}
