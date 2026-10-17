/**
 * 功能2 — 自动化广告 API（输入终链 URL → AI 生成广告计划 → Script 建广告）。
 *
 * - POST /api/v1/ads/auto-create          生成预览计划（plan 存内存，2h TTL）
 * - POST /api/v1/ads/auto-create/confirm  确认 → 创建 ScriptSyncTarget
 *                                          任务（类型 create-campaign）+ AuditLog
 * - GET  /api/v1/ads/auto-create/:planId/copy-pack
 *                                         纯文本：Amazon/手动投放用，需手动创建
 * - GET  /api/v1/ads/auto-create/:planId/script
 *                                         create-campaign Google Ads Script 源码
 *
 * Session auth only (one tenant per user). Requires LLM configured
 * (same AI settings as /api/v1/ai/*). Never logs URLs beyond the plan or keys.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import {
  assertAiSettingsPepperConfigured,
  decryptSecret,
} from "../ai/crypto.js";
import { AiError, chatJson, chatJsonValidated } from "../ai/llm.js";
import { fetchPage } from "../ai/fetch-page.js";
import {
  MAX_URLS_PER_PLAN,
  MIN_DAILY_BUDGET,
  MAX_DAILY_BUDGET,
  PAGE_TEXT_LIMIT,
  adPlanStore,
  buildAdPlanPrompt,
  buildCopyPack,
  createPlanStore,
  finalizeAdPlan,
  normalizeCopyStyle,
  normalizeUserKeywords,
  validateAdPlanUrlDraft,
  type AdPlan,
  type AdPlanUrlDraft,
  type PlanStore,
  type SerpReferenceAd,
} from "../ai/ad-generator.js";
import type { AnalysisLanguage } from "../ai/prompts.js";
import { fetchSerpAds } from "../ai/serp-ads.js";
import {
  assertPlanCurrencyMatches,
  convertPlanCurrency,
} from "../ai/plan-currency.js";
import { readEncryptedTrafficSetting } from "../traffic/settings.js";
import {
  DATAFORSEO_LOGIN_SETTING,
  DATAFORSEO_PASSWORD_SETTING,
} from "../traffic/dataforseo.js";
import { buildCreateCampaignScript, COUNTRY_LOCATION_IDS } from "../services/script-create-campaign.js";
import {
  buildRotationScript,
  validateRotationScriptInput,
  ROTATION_SCRIPT_VERSION,
} from "../services/script-rotation.js";
import {
  buildClickMonitorScript,
  validateClickMonitorScriptInput,
  CLICK_MONITOR_SCRIPT_VERSION,
} from "../services/script-click-monitor.js";
import { buildAutoArchiveData } from "./launch-archives.js";

export interface AdsAutoRouteDeps {
  prisma: PrismaClient;
  /** Injectable for tests. */
  chatJsonImpl?: typeof chatJson;
  /** Injectable for tests. */
  fetchPageImpl?: typeof fetchPage;
  /** Injectable for tests; defaults to the process-wide singleton. */
  planStore?: PlanStore;
}

/** ScriptSyncTarget "task type" for auto-created campaigns. */
export const CREATE_CAMPAIGN_TASK_TYPE = "create-campaign";

const SETTING_BASE_URL = "llm.baseUrl";
const SETTING_MODEL = "llm.model";
const SETTING_API_KEY_ENC = "llm.apiKeyEnc";

interface LlmSettings {
  baseUrl?: string;
  model?: string;
  apiKeyEnc?: string;
}

async function readLlmSettings(prisma: PrismaClient): Promise<LlmSettings> {
  const rows = await prisma.aiSetting.findMany();
  const out: LlmSettings = {};
  for (const r of rows as Array<{ key: string; value: string }>) {
    if (r.key === SETTING_BASE_URL) out.baseUrl = r.value;
    else if (r.key === SETTING_MODEL) out.model = r.value;
    else if (r.key === SETTING_API_KEY_ENC) out.apiKeyEnc = r.value;
  }
  return out;
}

async function requireSession(
  deps: AdsAutoRouteDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) {
    throw new UnauthorizedError("Authentication required");
  }
  return info;
}

function asTrimmedString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asUuid(v: unknown, field: string): string | undefined {
  const s = asTrimmedString(v);
  if (s === undefined) return undefined;
  if (!UUID_RE.test(s)) {
    throw new ValidationError(`${field} must be a UUID`);
  }
  return s;
}

function assertHttpUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ValidationError(`Invalid URL: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError(`Only http(s) URLs are allowed: ${raw}`);
  }
  return parsed.toString();
}

export async function registerAdsAutoRoutes(
  app: FastifyInstance,
  deps: AdsAutoRouteDeps
): Promise<void> {
  const {
    prisma,
    chatJsonImpl = chatJson,
    fetchPageImpl = fetchPage,
    planStore = adPlanStore,
  } = deps;

  function loadPlan(planId: string, tenantId: string): AdPlan {
    const stored = planStore.get(planId);
    if (!stored) {
      // Missing or TTL-expired.
      throw new AppError("Ad plan not found or expired", {
        code: "PLAN_NOT_FOUND",
        statusCode: 410,
      });
    }
    if (stored.plan.tenantId !== tenantId) {
      throw new NotFoundError("AdPlan", planId);
    }
    return stored.plan;
  }

  /**
   * Generate a preview ad plan from offer final URLs.
   * One campaign; one ad group (+RSA) per URL. Stored in-memory for confirm.
   */
  app.post<{
    Body: {
      urls?: unknown;
      offerId?: unknown;
      googleAccountId?: unknown;
      language?: unknown;
      /** 可选：与 urls 一一对应的手动页面文字；提供则跳过抓取（Amazon 等反爬站点用） */
      pageTexts?: unknown;
      /** 可选：用户在投放选词里定好的关键词；提供则广告组用这套词，不再 AI 生成 */
      keywords?: unknown;
      /** 可选：文案口吻 official=官方口吻 / affiliate=联盟安全口吻（默认）/ expert=专家营销口吻 */
      copyStyle?: unknown;
      /** 可选：expert 口吻时，用户选用的插件 SERP 抓取记录 id（Google 搜索结果页） */
      serpCaptureId?: unknown;
      /** 可选：汇率（1 USD = X 目标货币）。计划货币与广告账户货币不一致时必填，用于换算。 */
      fxRate?: unknown;
      /** 可选：用户提供的当前优惠（如 "Up to 30% Off"），写进 RSA；非 string 忽略。 */
      promotion?: unknown;
    };
  }>("/api/v1/ads/auto-create", async (request) => {
    const info = await requireSession(deps, request);
    const body = request.body ?? {};

    if (!Array.isArray(body.urls) || body.urls.length === 0) {
      throw new ValidationError("urls must be a non-empty array");
    }
    if (body.urls.length > MAX_URLS_PER_PLAN) {
      throw new ValidationError(
        `urls must contain at most ${MAX_URLS_PER_PLAN} entries`
      );
    }
    const urls: string[] = body.urls.map((u, i) => {
      if (typeof u !== "string" || !u.trim()) {
        throw new ValidationError(`urls[${i}] must be a non-empty string`);
      }
      return assertHttpUrl(u.trim());
    });
    const offerId = asUuid(body.offerId, "offerId") ?? null;
    const googleAccountId = asUuid(body.googleAccountId, "googleAccountId") ?? null;
    const language: AnalysisLanguage = body.language === "en" ? "en" : "zh";
    // 汇率（可选）：1 USD = X 目标货币。提供时必须为正数，否则报错。
    let fxRate: number | null = null;
    if (body.fxRate !== undefined && body.fxRate !== null && body.fxRate !== "") {
      const n = Number(body.fxRate);
      if (!Number.isFinite(n) || n <= 0) {
        throw new ValidationError("fxRate 必须是正数（1 USD = X 目标货币）");
      }
      fxRate = n;
    }
    // 手动页面文字：与 urls 一一对应，提供则跳过抓取（Amazon 等反爬站点用）
    const pageTexts: Array<string | null> = Array.isArray(body.pageTexts)
      ? body.pageTexts.map((t) =>
          typeof t === "string" && t.trim() ? t.trim().slice(0, PAGE_TEXT_LIMIT) : null
        )
      : [];
    // 用户在投放选词里定好的关键词：有则各广告组统一用这套，不再 AI 生成
    const userKeywords = normalizeUserKeywords(body.keywords);
    const copyStyle = normalizeCopyStyle(body.copyStyle);
    // 用户提供的当前优惠：真实来源，写进 RSA；截断到 200 字符；非 string 忽略。
    const promotion =
      typeof body.promotion === "string" && body.promotion.trim()
        ? body.promotion.trim().slice(0, 200)
        : undefined;

    const settings = await readLlmSettings(prisma);
    if (!(settings.baseUrl && settings.model && settings.apiKeyEnc)) {
      throw new AppError("AI is not configured", {
        code: "AI_NOT_CONFIGURED",
        statusCode: 400,
      });
    }
    const pepper = assertAiSettingsPepperConfigured();
    // apiKey lives only in this local; never logged.
    const apiKey = decryptSecret(settings.apiKeyEnc, pepper);

    // 专家营销口吻：先取参考成功广告（插件 SERP 抓取优先，否则 DataForSEO 自动搜）。
    // 非 expert 时 serpCaptureId 忽略，现有行为不变。
    let referenceAds: SerpReferenceAd[] = [];
    let serpPageText = "";
    if (copyStyle === "expert") {
      const serpCaptureId = asUuid(body.serpCaptureId, "serpCaptureId") ?? null;
      if (serpCaptureId) {
        const capture = await prisma.offerCapture.findFirst({
          where: { id: serpCaptureId, tenantId: info.tenantId },
          select: { url: true, pageText: true },
        });
        if (!capture) {
          throw new ValidationError("所选 SERP 抓取记录不存在");
        }
        const captureUrl = capture.url ?? "";
        if (!captureUrl.includes("/search") || !captureUrl.includes("google.")) {
          throw new ValidationError(
            "所选抓取不是搜索结果页，请抓取 Google 搜索结果页"
          );
        }
        serpPageText = (capture.pageText ?? "").slice(0, 8000);
        if (!serpPageText.trim()) {
          throw new ValidationError("所选 SERP 抓取记录没有页面文字，请重新抓取");
        }
      } else {
        const login = await readEncryptedTrafficSetting(
          prisma,
          DATAFORSEO_LOGIN_SETTING
        );
        const password = await readEncryptedTrafficSetting(
          prisma,
          DATAFORSEO_PASSWORD_SETTING
        );
        if (!login || !password) {
          throw new ValidationError(
            "专家模式需要 DataForSEO 凭证，请到 AI 设置 → 流量信号凭证填写，或用插件抓取一条搜索结果页"
          );
        }
        // 查询词：用户在投放选词里定的第一个关键词，没有则用首个 URL 的域名兜底。
        const serpQuery =
          userKeywords[0]?.text?.trim() ||
          (() => {
            try {
              return new URL(urls[0]!).hostname;
            } catch {
              return urls[0]!;
            }
          })();
        referenceAds = await fetchSerpAds(serpQuery, { login, password });
        if (referenceAds.length === 0) {
          throw new ValidationError(
            `DataForSEO 未搜到“${serpQuery}”的相关广告，请换个关键词重试，或用插件抓取一条搜索结果页`
          );
        }
      }
    }

    const drafts: AdPlanUrlDraft[] = [];
    const finalUrls: string[] = [];
    // Sequential per URL: keeps page-fetch + LLM load predictable.
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      let pageText: string;
      let finalUrl: string;
      const manualText = pageTexts[i];
      if (manualText) {
        // 用户手动粘贴的页面文字：跳过抓取（Amazon 等反爬站点）
        pageText = manualText;
        finalUrl = url;
      } else {
        try {
          const fetched = await fetchPageImpl(url);
          pageText = fetched.text.slice(0, PAGE_TEXT_LIMIT);
          finalUrl = fetched.finalUrl;
        } catch (e) {
          if (e instanceof AiError) throw e;
          throw new AiError("Failed to fetch offer page");
        }
      }
      let draft: AdPlanUrlDraft;
      try {
        draft = await chatJsonValidated(
          {
            baseUrl: settings.baseUrl as string,
            model: settings.model as string,
            apiKey,
            ...buildAdPlanPrompt({
              url: finalUrl,
              pageText,
              language,
              copyStyle,
              // 专家模式参考材料（非 expert 时为空，prompt 不渲染参考段落）。
              referenceAds: referenceAds.length > 0 ? referenceAds : undefined,
              serpPageText: serpPageText || undefined,
              // 用户提供的当前优惠（没提供时不渲染 promotion 段落）。
              promotion,
            }),
          },
          validateAdPlanUrlDraft,
          chatJsonImpl
        );
      } catch (e) {
        if (e instanceof AiError) throw e;
        // 不要吞掉真实原因：裸 "LLM request failed" 没法定位（网络/超时/解析/配置）
        throw new AiError(
          `LLM request failed: ${e instanceof Error ? e.message : "unknown error"}`
        );
      }
      // 用户自带关键词：覆盖 AI 生成的词（品牌冲突过滤仍在 finalize 里做）
      if (userKeywords.length > 0) {
        draft.keywords = userKeywords;
        draft.keywordsSource = "user";
      }
      drafts.push(draft);
      finalUrls.push(finalUrl);
    }

    const plan = finalizeAdPlan(drafts, {
      planId: randomUUID(),
      tenantId: info.tenantId,
      language,
      offerId,
      googleAccountId,
      copyStyle,
      finalUrls,
    });

    // 按广告账户结算货币换算计划金额：计划按 USD 生成，账户为 CNY 时必须换算，
    // 否则 Script 会把 USD 数值当成账户货币推出去（差一个汇率）。账户找不到时不换算。
    if (googleAccountId) {
      const account = await prisma.googleAccount.findFirst({
        where: { id: googleAccountId, tenantId: info.tenantId },
        select: { currency: true },
      });
      const accountCurrency = account?.currency?.trim().toUpperCase() || "";
      const planCurrency = plan.campaign.dailyBudget.currency.trim().toUpperCase();
      if (accountCurrency && accountCurrency !== planCurrency) {
        if (fxRate === null) {
          throw new ValidationError(
            `计划货币 ${planCurrency} 与广告账户货币 ${accountCurrency} 不一致，请提供汇率 fxRate（1 USD = X ${accountCurrency}）以换算`
          );
        }
        // 计划货币既非 USD 也非账户货币时 convertPlanCurrency 抛不支持的货币对。
        convertPlanCurrency(plan, accountCurrency, fxRate);
      }
    }

    planStore.put(plan);

    return {
      planId: plan.planId,
      plan,
      expiresInSeconds: 2 * 60 * 60,
    };
  });

  /**
   * Confirm a preview plan: queue a `create-campaign` ScriptSyncTarget task
   * and write an AuditLog entry. Idempotent per planId.
   */
  app.post<{
    Body: { planId?: unknown };
  }>("/api/v1/ads/auto-create/confirm", async (request) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as {
      planId?: unknown;
      maxCpc?: unknown;
      dailyBudget?: unknown;
      dailyBudgetCurrency?: unknown;
      maxCpcCurrency?: unknown;
      geoTargets?: unknown;
    };
    const planId = asTrimmedString(body.planId);
    if (!planId || !UUID_RE.test(planId)) {
      throw new ValidationError("planId must be a UUID");
    }
    const maxCpcOverride =
      body.maxCpc !== undefined && body.maxCpc !== null && body.maxCpc !== ""
        ? Number(body.maxCpc)
        : null;
    if (maxCpcOverride !== null && (!Number.isFinite(maxCpcOverride) || maxCpcOverride <= 0)) {
      throw new ValidationError("maxCpc must be a positive number");
    }
    // Preview edits: daily budget + geo targets set by the user in the
    // preview (overriding the AI suggestion). Same override pattern as maxCpc.
    const dailyBudgetOverride =
      body.dailyBudget !== undefined && body.dailyBudget !== null && body.dailyBudget !== ""
        ? Number(body.dailyBudget)
        : null;
    if (
      dailyBudgetOverride !== null &&
      (!Number.isFinite(dailyBudgetOverride) || dailyBudgetOverride <= 0)
    ) {
      throw new ValidationError("dailyBudget must be a positive number");
    }
    // Currency overrides (CNY / USD / …): 3-letter codes only. Applied to the
    // plan so the Script and copy-pack carry the currency the user picked
    // (it must match the Google Ads account currency to spend as expected).
    const asCurrency = (v: unknown, field: string): string | null => {
      if (v === undefined || v === null || v === "") return null;
      const c = String(v).trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(c)) {
        throw new ValidationError(`${field} must be a 3-letter currency code`);
      }
      return c;
    };
    const dailyBudgetCurrencyOverride = asCurrency(
      body.dailyBudgetCurrency,
      "dailyBudgetCurrency",
    );
    const maxCpcCurrencyOverride = asCurrency(body.maxCpcCurrency, "maxCpcCurrency");
    let geoTargetsOverride: string[] | null = null;
    if (body.geoTargets !== undefined && body.geoTargets !== null) {
      if (
        !Array.isArray(body.geoTargets) ||
        body.geoTargets.length === 0 ||
        body.geoTargets.length > 5
      ) {
        throw new ValidationError("geoTargets must contain 1-5 country codes");
      }
      const cleaned = [
        ...new Set(
          body.geoTargets.map((g) => String(g).trim().toUpperCase()).filter(Boolean)
        ),
      ];
      if (cleaned.length === 0 || cleaned.length > 5) {
        throw new ValidationError("geoTargets must contain 1-5 country codes");
      }
      const bad = cleaned.find((g) => !(g in COUNTRY_LOCATION_IDS));
      if (bad) {
        throw new ValidationError(
          `geoTargets contains unsupported country code: ${bad}`
        );
      }
      geoTargetsOverride = cleaned;
    }
    const plan = loadPlan(planId, info.tenantId);

    // 防贴标签：货币只能换算、不能只改标签。只改货币、不改金额时拒绝——
    // 金额还是旧货币的数、标签却变了。货币 + 金额一起改时放行（调用方已按
    // 新货币换算过金额，如自动化广告页切换货币时同时换算预算/出价）。
    const originalCurrency = plan.campaign.dailyBudget.currency.trim().toUpperCase();
    if (
      dailyBudgetCurrencyOverride !== null &&
      dailyBudgetCurrencyOverride !== originalCurrency &&
      dailyBudgetOverride === null
    ) {
      throw new ValidationError(
        `预算货币已变更（${originalCurrency} → ${dailyBudgetCurrencyOverride}）但金额未改，请重新生成计划（生成时按广告账户货币换算），不要只改货币标签`
      );
    }
    if (
      maxCpcCurrencyOverride !== null &&
      maxCpcCurrencyOverride !== originalCurrency &&
      maxCpcOverride === null
    ) {
      throw new ValidationError(
        `出价货币已变更（${originalCurrency} → ${maxCpcCurrencyOverride}）但金额未改，请重新生成计划（生成时按广告账户货币换算），不要只改货币标签`
      );
    }

    // Budget currency first: the maxCpc override below falls back to the
    // (possibly just-updated) budget currency when no explicit maxCpc
    // currency was sent.
    if (dailyBudgetCurrencyOverride !== null) {
      plan.campaign.dailyBudget.currency = dailyBudgetCurrencyOverride;
    }

    // Apply bid override to all ad groups if provided.
    if (maxCpcOverride !== null) {
      for (const g of plan.adGroups) {
        g.group.maxCpc = {
          amount: maxCpcOverride,
          currency:
            maxCpcCurrencyOverride ??
            g.group.maxCpc?.currency ??
            plan.campaign.dailyBudget.currency,
          dataQuality: "PREDICTED",
        };
      }
    }

    // Apply preview budget / geo overrides (clamped to the same sane range
    // as AI-generated budgets).
    if (dailyBudgetOverride !== null) {
      plan.campaign.dailyBudget.amount = Math.min(
        MAX_DAILY_BUDGET,
        Math.max(MIN_DAILY_BUDGET, dailyBudgetOverride)
      );
    }
    if (geoTargetsOverride !== null) {
      plan.campaign.geoTargets = geoTargetsOverride;
    }

    // Resolve the Script integration that will execute the task.
    const integrationWhere: Record<string, unknown> = {
      tenantId: info.tenantId,
      status: "ACTIVE",
    };
    if (plan.googleAccountId) {
      integrationWhere.googleAccountId = plan.googleAccountId;
    }
    const integration = await prisma.googleAdsScriptIntegration.findFirst({
      where: integrationWhere,
    });
    if (!integration) {
      throw new ValidationError(
        "No active Google Ads Script integration found for this tenant" +
          (plan.googleAccountId ? " and Google account" : "") +
          ". Set up a Script integration first."
      );
    }

    // 校验拦截：计划货币必须 == 广告账户结算货币，否则拒绝（防止错货币的
    // 计划推到 Google Ads）。账户查不到时跳过；integration 没有 googleAccountId
    // 时跳过校验（保持旧行为）。
    if (integration.googleAccountId) {
      const account = await prisma.googleAccount.findFirst({
        where: { id: integration.googleAccountId, tenantId: info.tenantId },
        select: { currency: true },
      });
      if (account?.currency?.trim()) {
        assertPlanCurrencyMatches(plan, account.currency);
      }
    }

    // Idempotent: confirming the same plan twice returns the existing target.
    const existing = await prisma.scriptSyncTarget.findFirst({
      where: {
        tenantId: info.tenantId,
        integrationId: integration.id,
        entityType: "CAMPAIGN",
        entityId: plan.planId,
      },
    });
    if (existing) {
      return {
        planId: plan.planId,
        targetId: existing.id,
        taskType: CREATE_CAMPAIGN_TASK_TYPE,
        status: "QUEUED",
        alreadyQueued: true,
        // 重复确认不新建档案（首次确认时已建），故 archiveId 为 null。
        archiveId: null as string | null,
      };
    }

    const target = await prisma.scriptSyncTarget.create({
      data: {
        id: randomUUID(),
        tenantId: info.tenantId,
        integrationId: integration.id,
        entityType: "CAMPAIGN",
        // Polymorphic reference: the in-memory plan id (UUID).
        entityId: plan.planId,
        desiredVersion: 1,
      },
    });

    await prisma.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId: info.tenantId,
        actorId: info.id,
        action: "ADS_AUTO_CREATE_CONFIRMED",
        entityType: "ScriptSyncTarget",
        entityId: target.id,
        // Deep-clone to plain JSON for the Prisma Json field.
        after: JSON.parse(
          JSON.stringify({
            taskType: CREATE_CAMPAIGN_TASK_TYPE,
            planId: plan.planId,
            integrationId: integration.id,
            campaignName: plan.campaign.name,
            adGroupCount: plan.adGroups.length,
            dailyBudget: plan.campaign.dailyBudget,
          })
        ) as never,
      },
    });

    // 自动建档（投放档案）：失败静默（只记 log），绝不让确认失败。
    let archiveId: string | null = null;
    try {
      const offer = plan.offerId
        ? await prisma.offer.findFirst({
            where: { id: plan.offerId, tenantId: info.tenantId },
            select: {
              name: true,
              network: true,
              destinationUrl: true,
              commissionType: true,
              commissionValue: true,
              avgPrice: true,
            },
          })
        : null;
      let plannerSnapshot: Record<string, unknown> | null = null;
      try {
        const ws = await prisma.workState.findFirst({
          where: {
            tenantId: info.tenantId,
            page: "traffic-planner",
            offerId: plan.offerId,
          },
          orderBy: { updatedAt: "desc" },
          select: { state: true },
        });
        if (ws?.state && typeof ws.state === "object" && !Array.isArray(ws.state)) {
          plannerSnapshot = ws.state as Record<string, unknown>;
        }
      } catch {
        // 快照读不到就按无快照建档（payout/CVR 为 null）。
      }
      const archiveData = buildAutoArchiveData({
        plan: {
          planId: plan.planId,
          offerId: plan.offerId,
          campaignName: plan.campaign.name,
          dailyBudgetAmount: plan.campaign.dailyBudget.amount,
          dailyBudgetCurrency: plan.campaign.dailyBudget.currency,
          campaignMaxCpc: plan.campaign.bidding.maxCpc?.amount ?? null,
          firstAdGroupMaxCpc: plan.adGroups[0]?.group.maxCpc?.amount ?? null,
          keywords: plan.adGroups.flatMap((g) =>
            g.group.keywords.map((k) => k.text)
          ),
          headlines: plan.adGroups[0]?.rsa.headlines ?? [],
          descriptions: plan.adGroups[0]?.rsa.descriptions ?? [],
          finalUrl: plan.adGroups[0]?.group.finalUrl ?? null,
        },
        offer: offer
          ? {
              name: offer.name,
              network: offer.network,
              destinationUrl: offer.destinationUrl,
              commissionType: offer.commissionType,
              commissionValue:
                offer.commissionValue !== null
                  ? Number(offer.commissionValue)
                  : null,
              avgPrice:
                offer.avgPrice !== null ? Number(offer.avgPrice) : null,
            }
          : null,
        plannerSnapshot,
      });
      const archive = await prisma.launchArchive.create({
        data: {
          id: randomUUID(),
          tenantId: info.tenantId,
          ...archiveData,
        },
      });
      archiveId = archive.id;
    } catch (e) {
      console.error("[launch-archive] auto-create failed", e);
    }

    return {
      planId: plan.planId,
      targetId: target.id,
      taskType: CREATE_CAMPAIGN_TASK_TYPE,
      status: "QUEUED",
      alreadyQueued: false,
      integrationId: integration.id,
      scriptUrl: `/api/v1/ads/auto-create/${plan.planId}/script`,
      copyPackUrl: `/api/v1/ads/auto-create/${plan.planId}/copy-pack`,
      archiveId,
    };
  });

  /**
   * Copy pack for Amazon / manual placement. Plain text, explicitly marked
   * "Amazon/手动投放用，需手动创建" — Amazon has no Script mechanism.
   */
  app.get<{
    Params: { planId: string };
  }>("/api/v1/ads/auto-create/:planId/copy-pack", async (request, reply) => {
    const info = await requireSession(deps, request);
    const plan = loadPlan(request.params.planId, info.tenantId);
    const text = buildCopyPack(plan);
    return reply
      .header("content-type", "text/plain; charset=utf-8")
      .header(
        "content-disposition",
        `attachment; filename="adlinklab-copy-pack-${plan.planId.slice(0, 8)}.txt"`
      )
      .send(text);
  });

  /**
   * The `create-campaign` Google Ads Script source for this plan.
   * Paste into Google Ads Scripts and run once.
   */
  app.get<{
    Params: { planId: string };
  }>("/api/v1/ads/auto-create/:planId/script", async (request) => {
    const info = await requireSession(deps, request);
    const plan = loadPlan(request.params.planId, info.tenantId);
    return {
      planId: plan.planId,
      fileName: `adlinklab-create-campaign-${plan.planId.slice(0, 8)}.js`,
      templateVersion: "1.0.0",
      source: buildCreateCampaignScript(plan),
    };
  });

  /**
   * 方案 B — 直链轮换 Script 生成。
   * 输入标签名，返回可直接粘贴到 Google Ads 脚本的 JS 代码。
   */
  app.post<{
    Body: { label?: unknown };
  }>("/api/v1/ads/rotation-script", async (request) => {
    await requireSession(deps, request);
    const label =
      typeof request.body?.label === "string"
        ? request.body.label.trim()
        : "";
    const errors = validateRotationScriptInput({ label });
    if (errors.length > 0) {
      throw new ValidationError(errors.join("; "));
    }
    const safeLabel = label.replace(/["\\]/g, "");
    return {
      fileName: `adlinklab-rotation-${safeLabel}.js`,
      templateVersion: ROTATION_SCRIPT_VERSION,
      source: buildRotationScript({ label: safeLabel }),
    };
  });

  /**
   * 点击次数监测 Script 生成。
   * 输入标签名 + 累计点击上限，返回可直接粘贴到 Google Ads 脚本的 JS 代码。
   * 累计点击达到上限的广告会被暂停；不传上限则不需要本脚本（广告一直运行）。
   */
  app.post<{
    Body: { label?: unknown; maxClicks?: unknown };
  }>("/api/v1/ads/click-monitor-script", async (request) => {
    await requireSession(deps, request);
    const label =
      typeof request.body?.label === "string"
        ? request.body.label.trim()
        : "";
    const maxClicks = request.body?.maxClicks;
    const errors = validateClickMonitorScriptInput({ label, maxClicks });
    if (errors.length > 0) {
      throw new ValidationError(errors.join("; "));
    }
    const safeLabel = label.replace(/["\\]/g, "");
    return {
      fileName: `adlinklab-click-monitor-${safeLabel}.js`,
      templateVersion: CLICK_MONITOR_SCRIPT_VERSION,
      source: buildClickMonitorScript({
        label: safeLabel,
        maxClicks: maxClicks as number,
      }),
    };
  });
}

/** Re-exported for tests that want an isolated store. */
export { createPlanStore };
