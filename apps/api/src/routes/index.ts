import type { FastifyInstance } from "fastify";

/**
 * Offer 指标摘要附带函数（offer-metrics.ts）。
 * 在 prisma 模式的注册块里赋值；memory 模式下保持 undefined。
 */
let attachMetricsSummaries:
  | typeof import("./offer-metrics.js").attachMetricsSummaries
  | undefined;
import type {
  OfferEligibilityService,
  OfferSelectionService,
  TrackingLinkOfferService,
} from "@adlinklab/offers";
import type { OfferStatus } from "@adlinklab/domain";
import { NotFoundError, ValidationError } from "@adlinklab/shared";
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
import { registerDeadLinkRoutes } from "./dead-link.js";
import { registerSearchTermRoutes } from "./search-terms.js";
import { registerPayoutWatchRoutes } from "./payout-watch.js";
import { registerBudgetRuleRoutes } from "./budget-rules.js";
import { registerLpOptimizationRoutes } from "./lp-optimization.js";
import { registerNetworkRoutes } from "./networks.js";
import { registerLpRewriterRoutes } from "./lp-rewriter.js";
import { registerWeeklyReportRoutes } from "./weekly-reports.js";
import { registerAdminScriptIntegrationRoutes } from "./admin-script-integrations.js";
import type {
  WorkerHealth,
  WorkerRuntime,
} from "../queue/runtime.js";
import {
  assertAuthConfigured,
  createAuthContext,
  registerDbApiKeyAuthHook,
  registerSessionAuthHook,
  requireTenant,
  type AuthContext,
} from "../auth/tenant.js";
import { registerIpBanHooks } from "../auth/ip-ban.js";
import { registerAuthRoutes } from "./auth.js";
import { registerApiKeyRoutes } from "./api-keys.js";
import { registerIpBanRoutes } from "./ip-bans.js";
import { registerAiRoutes } from "./ai.js";
import { registerMonitoringRoutes } from "./monitoring.js";
import { registerOfferIntelRoutes } from "./offer-intel.js";
import { registerTrafficIntelRoutes } from "./traffic-intel.js";
import { registerKillSwitchRoutes } from "./kill-switch.js";
import { registerExperimentRoutes } from "./experiments.js";
import { registerBudgetRoutes } from "./budget.js";
import { registerStatsRoutes } from "./stats.js";
import { registerLinkSwapRoutes } from "./link-swap.js";
import { registerLaunchRoutes } from "./launch.js";
import { registerCampaignToggleRoutes } from "./campaign-toggle.js";
import { registerAdsAutoRoutes } from "./ads-auto.js";
import { registerKeywordCheckRoutes } from "./keyword-check.js";
import { registerLaunchArchiveRoutes } from "./launch-archives.js";
import { registerWorkStateRoutes } from "./work-state.js";
import { registerCashbackRoutes } from "./cashback.js";
import { registerCashbackRateWatchRoutes } from "./cashback-rate-watch.js";
import { registerCashbackTermsWatchRoutes } from "./cashback-terms-watch.js";
import { registerCashbackLpScoreRoutes } from "./cashback-lp-score.js";
import { registerCashbackRedirectCheckRoutes } from "./cashback-redirect-check.js";
import { registerCashbackRateCompareRoutes } from "./cashback-rate-compare.js";
import { registerTestClickRoutes } from "./test-click.js";
import { registerResearcherIsolation } from "../auth/researcher.js";
import { registerResearchRoutes } from "./research.js";
import { registerStrategyRoutes } from "./strategy.js";
import { registerLanderIntelRoutes } from "./lander-intel.js";
import {
  businessMetrics,
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
      .send(httpMetrics.renderPrometheus() + businessMetrics.renderPrometheus());
  });

  /** Phase 10 — login sessions ride alongside API-key auth (no-op without prisma). */
  // P0-4 — IP-ban enforcement runs first (reject before any session/DB work).
  // P0-3 — DB API keys resolve after sessions (sessions take precedence).
  if (services.prisma) {
    registerIpBanHooks(app, services.prisma);
  }
  registerSessionAuthHook(app, services.prisma);
  registerDbApiKeyAuthHook(app, services.prisma);
  // P1-20：CSRF（Origin + 会话 Cookie 跨域 → 403），在所有路由注册前挂钩。
  const { registerCsrfHook } = await import("../csrf.js");
  registerCsrfHook(app);
  if (services.prisma) {
    // P1-18：提示词 DB 化 — 启动时播种默认提示词（best-effort，不阻断启动）。
    const { syncDefaultPrompts } = await import("../ai/prompts-store.js");
    await syncDefaultPrompts(services.prisma);
    // P1-18：提示词管理 API（admin/owner）
    const { registerAiPromptsAdminRoutes } = await import("./ai-prompts-admin.js");
    await registerAiPromptsAdminRoutes(app, { prisma: services.prisma });
    // P1-17：幂等键（Idempotency-Key 头）— 必须在三条写路由注册之前挂钩
    // （Fastify onRequest 只对之后注册的路由生效）。
    const { registerIdempotencyHooks } = await import("../idempotency.js");
    registerIdempotencyHooks(app, services.prisma);
    // Phase 4 iron rule: researcher isolation hook must be registered BEFORE
    // all other routes (onRequest only applies to subsequently registered routes).
    registerResearcherIsolation(app, { prisma: services.prisma });
    await registerAuthRoutes(app, { prisma: services.prisma });
    await registerApiKeyRoutes(app, { prisma: services.prisma });
    await registerIpBanRoutes(app, { prisma: services.prisma });
    await registerAiRoutes(app, { prisma: services.prisma });
    // 每租户系统设置（AI 引擎/广告发布/代理/系统偏好；租户级覆盖，不动全局配置）
    const { registerSettingsRoutes } = await import("./settings.js");
    await registerSettingsRoutes(app, { prisma: services.prisma });
    // 创意管理库（RSA 文案资产；CRUD + 从投放档案导入）
    const { registerCreativesRoutes } = await import("./creatives.js");
    await registerCreativesRoutes(app, { prisma: services.prisma });
    // 数据管理：用户自助导出/导入（Offers/Campaigns/Settings，密钥脱敏）
    const { registerDataIoRoutes } = await import("./data-io.js");
    await registerDataIoRoutes(app, { prisma: services.prisma });
    await registerMonitoringRoutes(app, { prisma: services.prisma });
    await registerOfferIntelRoutes(app, { prisma: services.prisma });
    await registerTrafficIntelRoutes(app, { prisma: services.prisma });
    await registerKillSwitchRoutes(app, { prisma: services.prisma });
    await registerExperimentRoutes(app, { prisma: services.prisma });
    await registerBudgetRoutes(app, { prisma: services.prisma });
    await registerResearchRoutes(app, { prisma: services.prisma });
    await registerStrategyRoutes(app, { prisma: services.prisma });
    await registerLanderIntelRoutes(app, { prisma: services.prisma });
    await registerStatsRoutes(app, { prisma: services.prisma });
    await registerLinkSwapRoutes(app, { prisma: services.prisma });
    await registerLaunchRoutes(app, { prisma: services.prisma });
    await registerCampaignToggleRoutes(app, { prisma: services.prisma });
    await registerAdsAutoRoutes(app, { prisma: services.prisma });
    await registerLaunchArchiveRoutes(app, { prisma: services.prisma });
    await registerKeywordCheckRoutes(app, { prisma: services.prisma });
    // P1-6：Offer 自动状态联动（偏好 + 手动检查 + 批量执行）
    const { registerOfferPreferenceRoutes } = await import("./offer-preferences.js");
    await registerOfferPreferenceRoutes(app, { prisma: services.prisma });
    // P1-10：规则生成关键词 ideas（无 LLM，无假搜索量）
    const { registerKeywordIdeasRoutes } = await import("./keywords-ideas.js");
    await registerKeywordIdeasRoutes(app, { prisma: services.prisma });
    // DataForSEO 关键词流水线（实测扩词 → 意图过滤 → 广告测算，/keywords/starter）
    const { registerKeywordDataForSeoRoutes } = await import(
      "./keywords-dataforseo.js"
    );
    await registerKeywordDataForSeoRoutes(app, { prisma: services.prisma });
    // 付费数据网关租户侧：自备 DataForSEO key（BYOK）+ 网关判定预告
    const { registerPaidDataRoutes } = await import("./paid-data.js");
    await registerPaidDataRoutes(app, { prisma: services.prisma });
    // Offer 一键初筛（批量跑初筛阶梯，结论写回 Offer 徽标字段）
    const { registerOfferPrescreenRoutes } = await import(
      "./offer-prescreen.js"
    );
    await registerOfferPrescreenRoutes(app, {
      prisma: services.prisma,
    });
    // P1-11：归因透明化 + 冲突处理
    const { registerAttributionRoutes } = await import("./attribution.js");
    await registerAttributionRoutes(app, { prisma: services.prisma });
    // P1-7 / P1-8：Google 账号双类型 + 健康 + 申诉
    const { registerGoogleAccountsExtraRoutes } = await import(
      "./google-accounts-extra.js"
    );
    await registerGoogleAccountsExtraRoutes(app, {
      prisma: services.prisma,
      googleAccounts: services.googleAccounts,
    });
    // P1-14：Preflight 双类型上线前检查
    const { registerPreflightRoutes } = await import("./preflight.js");
    await registerPreflightRoutes(app, { prisma: services.prisma });
    // P1-16：批量审计 + 回滚
    const { registerAdsOperationsRoutes } = await import("./ads-operations.js");
    await registerAdsOperationsRoutes(app, { prisma: services.prisma });
    // P1-27：导出脱敏 + 受保护 Token
    const { registerDataExchangeRoutes } = await import("./data-exchange.js");
    await registerDataExchangeRoutes(app, {
      prisma: services.prisma,
      offers: services.offers,
    });
    // P1-28：预算总览 + 盈亏平衡点
    const { registerBudgetOverviewRoutes } = await import("./budget-overview.js");
    await registerBudgetOverviewRoutes(app, { prisma: services.prisma });
    // §5：管理员授权机制（申请/审批/吊销/审计）
    const { registerAdminGrantRoutes } = await import("./admin-grants.js");
    await registerAdminGrantRoutes(app, { prisma: services.prisma });
    // 管理控制台：备份状态（admin-only，只读）
    const { registerAdminConsoleRoutes } = await import("./admin-console.js");
    await registerAdminConsoleRoutes(app, { prisma: services.prisma });
    // P2-7：只读解析（B2 强制执行：自有域名 或 有效授权白名单）
    const { registerTrackingLinkResolveRoutes } = await import(
      "./tracking-links-resolve.js"
    );
    await registerTrackingLinkResolveRoutes(app, {
      prisma: services.prisma,
    });
    // 商品库同步（双模式 + 黑白名单；B6 catalog-sync 授权强制执行）
    const { registerCatalogRoutes } = await import("./catalog.js");
    await registerCatalogRoutes(app, {
      prisma: services.prisma,
      offers: services.offers,
    });
    // P1-21：死信队列（DLQ）
    const { registerDeadLetterRoutes } = await import("./dead-letter.js");
    await registerDeadLetterRoutes(app, { prisma: services.prisma });
    await registerWorkStateRoutes(app, { prisma: services.prisma });
    await registerCashbackRoutes(app, { prisma: services.prisma });
    await registerTestClickRoutes(app, { prisma: services.prisma });
    // Automation pack (2026-10-07): per-feature route modules
    // (inside if (services.prisma) so prisma is non-optional here)
    const prismaOnly = { prisma: services.prisma };
    await registerDeadLinkRoutes(app, prismaOnly, auth);
    await registerSearchTermRoutes(app, prismaOnly, auth);
    await registerPayoutWatchRoutes(app, prismaOnly, auth);
    await registerBudgetRuleRoutes(app, prismaOnly, auth);
    await registerLpOptimizationRoutes(app, services, auth);
    await registerNetworkRoutes(app, prismaOnly, auth);
    await registerWeeklyReportRoutes(app, prismaOnly, auth);
    await registerLpRewriterRoutes(app, { prisma: services.prisma, auth });
    // Cashback automation pack (2026-10-08)
    await registerCashbackRateWatchRoutes(app, { prisma: services.prisma });
    await registerCashbackTermsWatchRoutes(app, { prisma: services.prisma });
    await registerCashbackLpScoreRoutes(app, { prisma: services.prisma });
    await registerCashbackRedirectCheckRoutes(app, { prisma: services.prisma });
    await registerCashbackRateCompareRoutes(app, { prisma: services.prisma });
    // Amazon 自动选品 (2026-10-08)
    const { registerAmazonDiscoveryRoutes } = await import(
      "./amazon-discovery.js"
    );
    registerAmazonDiscoveryRoutes(app, { prisma: services.prisma });
    // 流量需求门阈值管理 (2026-10-09)
    const { registerTrafficRoutes } = await import("./traffic.js");
    registerTrafficRoutes(app, { prisma: services.prisma });
    // multipart 只注册一次（Fastify 同一实例重复注册会 FST_ERR_DEC_ALREADY_PRESENT 导致启动崩溃）。
    // 上限取各上传场景的最大值（offer-metrics OCR 8MB / keepa vision 5MB），各 handler 内部仍做流式精确校验。
    const { default: multipart } = await import("@fastify/multipart");
    await app.register(multipart, {
      limits: { files: 3, fileSize: 8 * 1024 * 1024 },
    });
    // Offer 最终链接指标抓取 + 推荐指数 (2026-10-10)
    const offerMetricsModule = await import("./offer-metrics.js");
    attachMetricsSummaries = offerMetricsModule.attachMetricsSummaries;
    await offerMetricsModule.registerOfferMetricsRoutes(app, {
      prisma: services.prisma,
    });
    // 热销日历 (2026-10-10)
    const { registerAmazonTrendsRoutes } = await import("./amazon-trends.js");
    await registerAmazonTrendsRoutes(app, { prisma: services.prisma });
    // 选品流水线 (2026-10-10)
    const { registerAmazonPipelineRoutes } = await import("./amazon-pipeline.js");
    await registerAmazonPipelineRoutes(app, { prisma: services.prisma });
    // 组合测试 (2026-10-10)
    const { registerComboTestRoutes } = await import("./amazon-combo.js");
    await registerComboTestRoutes(app, { prisma: services.prisma });
    // ASIN 需求异动监控 (2026-10-10)
    const { registerAsinWatchRoutes } = await import("./amazon-asin-watch.js");
    await registerAsinWatchRoutes(app, { prisma: services.prisma });
    // 新手任务 (2026-10-10)
    const { registerOnboardRoutes } = await import("./onboard.js");
    await registerOnboardRoutes(app, { prisma: services.prisma });
    // 教练模式 (2026-10-10)
    const { registerCoachRoutes } = await import("./coach.js");
    await registerCoachRoutes(app, { prisma: services.prisma });
    // 首单仪表盘 (2026-10-10)
    const { registerFirstWinRoutes } = await import("./first-win.js");
    await registerFirstWinRoutes(app, { prisma: services.prisma });
    // Keepa 自动筛选 (2026-10-10)
    const { registerKeepaRoutes } = await import("./keepa.js");
    await registerKeepaRoutes(app, { prisma: services.prisma });
  }

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

  // 广告系列卡片统计（真实数据：广告组/追踪链接/点击/转化；只读聚合，不造数）。
  app.get<{
    Headers: { "x-tenant-id"?: string };
    Querystring: { ids?: string };
  }>("/api/v1/campaigns/stats", async (request) => {
    const tenantId = tenantOf(request);
    const ids = (request.query.ids ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 100);
    if (ids.length === 0) return { stats: [] };
    const prisma = services.prisma as PrismaClient;
    const [agRows, tlRows, clickRows, convRows] = await Promise.all([
      prisma.adGroup.groupBy({
        by: ["campaignId"],
        where: { tenantId, campaignId: { in: ids } },
        _count: { _all: true },
      }),
      prisma.trackingLink.groupBy({
        by: ["campaignId"],
        where: { tenantId, campaignId: { in: ids } },
        _count: { _all: true },
      }),
      prisma.click.groupBy({
        by: ["campaignId"],
        where: { tenantId, campaignId: { in: ids } },
        _count: { _all: true },
      }),
      prisma.conversion.findMany({
        where: {
          tenantId,
          deletedAt: null,
          click: { campaignId: { in: ids } },
        },
        select: { value: true, click: { select: { campaignId: true } } },
      }),
    ]);
    const toMap = (rows: Array<{ campaignId: string; _count: { _all: number } }>) =>
      new Map(rows.map((r) => [r.campaignId, r._count._all]));
    const adGroups = toMap(agRows as never);
    const trackingLinks = toMap(tlRows as never);
    const clicks = toMap(clickRows as never);
    const convByCamp = new Map<string, { count: number; value: number }>();
    for (const c of convRows as Array<{
      value: unknown;
      click: { campaignId: string | null };
    }>) {
      const cid = c.click?.campaignId;
      if (!cid) continue;
      const cur = convByCamp.get(cid) ?? { count: 0, value: 0 };
      cur.count += 1;
      cur.value += c.value != null ? Number(c.value) : 0;
      convByCamp.set(cid, cur);
    }
    return {
      stats: ids.map((id) => ({
        campaignId: id,
        adGroups: adGroups.get(id) ?? 0,
        trackingLinks: trackingLinks.get(id) ?? 0,
        clicks: clicks.get(id) ?? 0,
        conversions: convByCamp.get(id)?.count ?? 0,
        conversionValue: convByCamp.get(id)?.value ?? 0,
      })),
    };
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
    Querystring: { page?: string; pageSize?: string; source?: string };
  }>("/api/v1/offers", async (request) => {
    const tenantId = tenantOf(request);
    const source = request.query.source;
    const result = await services.offers.list(
      tenantId,
      request.query.page ? Number(request.query.page) : undefined,
      request.query.pageSize ? Number(request.query.pageSize) : undefined,
      source && ["affiliate", "amazon", "cashback"].includes(source)
        ? source
        : undefined
    );
    // 附带推荐指数摘要（无数据时为 null；memory 模式无 prisma 时跳过）。
    if (!services.prisma || !attachMetricsSummaries) return result;
    // 排除软删除（archivedAt != null）的 offer。
    const visibleItems = result.items.filter(
      (o: { archivedAt?: string | Date | null }) => !o.archivedAt
    );
    const items = await attachMetricsSummaries(
      services.prisma,
      tenantId,
      visibleItems
    );
    return {
      ...result,
      items,
      total: result.total - (result.items.length - visibleItems.length),
    };
  });

  app.get<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
  }>("/api/v1/offers/:id", async (request) => {
    const tenantId = tenantOf(request);
    const offer = await services.offers.getById(tenantId, request.params.id);
    if (!services.prisma || !attachMetricsSummaries)
      return { ...offer, metricsSummary: null };
    const [withSummary] = await attachMetricsSummaries(
      services.prisma,
      tenantId,
      [offer]
    );
    return withSummary ?? { ...offer, metricsSummary: null };
  });

  app.post<{
    Headers: { "x-tenant-id"?: string };
    Body: {
      tenantId?: string;
      name: string;
      network: string;
      source?: string;
      destinationUrl: string;
      affiliateUrl?: string | null;
      status?: OfferStatus;
      priority?: number;
      startsAt?: string;
      endsAt?: string;
      idempotencyKey?: string;
      requestId?: string;
      commissionValue?: number;
      commissionType?: string;
      avgPrice?: number;
      pickedAt?: string;
      brandName?: string;
      brandNameSource?: string;
      brandNameConfidence?: number;
      festivalTheme?: string;
      applicationStatus?: string;
      appliedAt?: string | null;
      applicationNote?: string | null;
      payoutCycleDays?: number | null;
      skuCommissionNote?: string | null;
      conversionFlow?: string | null;
    };
  }>("/api/v1/offers", async (request) => {
    const tenantId = tenantOf(request, request.body?.tenantId);
    return services.offers.create({
      tenantId,
      name: request.body.name,
      network: request.body.network,
      source: request.body.source,
      destinationUrl: request.body.destinationUrl,
      affiliateUrl: request.body.affiliateUrl,
      status: request.body.status,
      priority: request.body.priority,
      startsAt: request.body.startsAt
        ? new Date(request.body.startsAt)
        : undefined,
      endsAt: request.body.endsAt ? new Date(request.body.endsAt) : undefined,
      idempotencyKey: request.body.idempotencyKey,
      requestId: request.body.requestId,
      commissionValue: request.body.commissionValue,
      commissionType: request.body.commissionType,
      avgPrice: request.body.avgPrice,
      pickedAt: request.body.pickedAt ? new Date(request.body.pickedAt) : undefined,
      brandName: request.body.brandName,
      brandNameSource: request.body.brandNameSource,
      brandNameConfidence: request.body.brandNameConfidence,
      festivalTheme: request.body.festivalTheme,
      applicationStatus: request.body.applicationStatus,
      appliedAt:
        request.body.appliedAt === null
          ? null
          : request.body.appliedAt
            ? new Date(request.body.appliedAt)
            : undefined,
      applicationNote: request.body.applicationNote,
      payoutCycleDays: request.body.payoutCycleDays,
      skuCommissionNote: request.body.skuCommissionNote,
      conversionFlow: request.body.conversionFlow,
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
      affiliateUrl?: string | null;
      priority?: number;
      startsAt?: string | null;
      endsAt?: string | null;
      requestId?: string;
      brandName?: string;
      brandNameSource?: string;
      brandNameConfidence?: number;
      festivalTheme?: string;
      applicationStatus?: string;
      appliedAt?: string | null;
      applicationNote?: string | null;
      payoutCycleDays?: number | null;
      skuCommissionNote?: string | null;
      conversionFlow?: string | null;
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
        affiliateUrl: request.body.affiliateUrl,
        priority: request.body.priority,
        brandName: request.body.brandName,
        brandNameSource: request.body.brandNameSource,
        brandNameConfidence: request.body.brandNameConfidence,
        festivalTheme: request.body.festivalTheme,
        applicationStatus: request.body.applicationStatus,
        appliedAt:
          request.body.appliedAt === null
            ? null
            : request.body.appliedAt
              ? new Date(request.body.appliedAt)
              : undefined,
        applicationNote: request.body.applicationNote,
        payoutCycleDays: request.body.payoutCycleDays,
        skuCommissionNote: request.body.skuCommissionNote,
        conversionFlow: request.body.conversionFlow,
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

  app.delete<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
  }>("/api/v1/offers/:id", async (request) => {
    const tenantId = tenantOf(request);
    if (!services.prisma) throw new NotFoundError("Offer", request.params.id);
    // 软删除：置 archivedAt，避免破坏 tracking_links 等关联数据。
    const updated = await services.prisma.offer.updateMany({
      where: { id: request.params.id, tenantId, archivedAt: null },
      data: { archivedAt: new Date(), status: "ARCHIVED" },
    });
    if (updated.count === 0) throw new NotFoundError("Offer", request.params.id);
    return { deleted: true, id: request.params.id };
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
    Querystring: { page?: string; pageSize?: string; accountType?: string; healthStatus?: string };
  }>("/api/v1/google-accounts", async (request) => {
    const tenantId = tenantOf(request);
    const accountType = request.query.accountType;
    const healthStatus = request.query.healthStatus;
    if (accountType !== undefined && accountType !== "MCC" && accountType !== "PERSONAL") {
      throw new ValidationError("accountType must be MCC or PERSONAL");
    }
    if (
      healthStatus !== undefined &&
      !["active", "suspended", "limited"].includes(healthStatus)
    ) {
      throw new ValidationError("healthStatus must be active, suspended or limited");
    }
    return services.googleAccounts.list(
      tenantId,
      request.query.page ? Number(request.query.page) : undefined,
      request.query.pageSize ? Number(request.query.pageSize) : undefined,
      { accountType, healthStatus }
    );
  });

  app.post<{
    Headers: { "x-tenant-id"?: string };
    Body: {
      name?: unknown;
      customerId?: unknown;
      currency?: unknown;
      timezone?: unknown;
      /** P1-7：必填，创建后不可变更。 */
      accountType?: unknown;
      managerCustomerId?: unknown;
    };
  }>("/api/v1/google-accounts", async (request) => {
    const tenantId = tenantOf(request);
    const auth = request.auth;
    const userId =
      auth && "kind" in auth && auth.kind === "session" ? auth.userId : "";
    const body = request.body ?? {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const customerId =
      typeof body.customerId === "string"
        ? body.customerId.replace(/-/g, "").trim()
        : "";
    if (!name) throw new ValidationError("name is required");
    if (!customerId) throw new ValidationError("customerId is required");
    // P1-7：accountType 必填（MCC | PERSONAL），创建后不可变更。
    const accountType =
      typeof body.accountType === "string" ? body.accountType.trim().toUpperCase() : "";
    if (accountType !== "MCC" && accountType !== "PERSONAL") {
      throw new ValidationError("accountType is required and must be MCC or PERSONAL");
    }
    const managerCustomerId =
      typeof body.managerCustomerId === "string" && body.managerCustomerId.trim()
        ? body.managerCustomerId.replace(/-/g, "").trim()
        : undefined;
    const currency =
      typeof body.currency === "string" && body.currency.trim()
        ? body.currency.trim().toUpperCase()
        : "USD";
    const timezone =
      typeof body.timezone === "string" && body.timezone.trim()
        ? body.timezone.trim()
        : "America/Los_Angeles";
    return services.googleAccounts.create({
      tenantId,
      userId,
      name,
      customerId,
      currency,
      timezone,
      accountType,
      managerCustomerId,
    });
  });

  app.patch<{
    Params: { id: string };
    Headers: { "x-tenant-id"?: string };
    Body: { currency?: unknown; accountType?: unknown };
  }>("/api/v1/google-accounts/:id", async (request) => {
    const tenantId = tenantOf(request);
    // P1-7：accountType 创建后不可变更（变更 = 删除 + 重建）。
    if (request.body?.accountType !== undefined && request.body?.accountType !== null) {
      throw new ValidationError(
        "accountType is immutable after creation: delete and recreate the account to change its type"
      );
    }
    const currency =
      typeof request.body?.currency === "string"
        ? request.body.currency.trim().toUpperCase()
        : "";
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new ValidationError("currency must be a 3-letter currency code");
    }
    return services.googleAccounts.updateCurrency({
      tenantId,
      id: request.params.id,
      currency,
    });
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
  await registerDashboardRoutes(app, services, auth);
  await registerAdminScriptIntegrationRoutes(app, services, auth);
}
