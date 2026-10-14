import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  AppError,
  ForbiddenError,
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
  encryptSecret,
} from "../ai/crypto.js";
import { AiError, chatJson, chatJsonValidated } from "../ai/llm.js";
import {
  buildTrafficPlanPrompt,
  computeKeywordMath,
  getComboProfile,
  type BrandPolicy,
  type TrafficMode,
  type TrafficPlanInput,
} from "../ai/traffic-planner.js";
import { fetchPage, fetchPageHtml } from "../ai/fetch-page.js";
import { ocrImageText, OcrError } from "../offer-metrics/ocr.js";
import { screenshotPage, PageBlockedError, fetchPageTextWithFallback } from "../ai/page-shot.js";
import { checkBrandBidding } from "../ai/brand-bidding.js";
import { parseKeywordCapture } from "../ai/keyword-capture.js";
import { parseEcommerceCapture } from "../ai/ecommerce-capture.js";
import { extractKeywordsWithAi } from "../ai/keyword-capture-ai.js";
import { extractIntelWithAi, isIntelKind } from "../ai/intel-capture-ai.js";
import { extractProductWithAi } from "../ai/product-capture-ai.js";
import {
  checkUrlVerdict,
  detectAffiliateParams,
  isOwnedDomain,
  normalizeOwnedDomain,
  registrableDomain,
} from "../ai/compliance.js";
import {
  buildNegativeKeywords,
  checkBrandConflicts,
} from "../ai/brand-check.js";
import {
  buildAnalysisPrompt,
  buildTermsPrompt,
  validateAnalysisShape,
  validateTermsShape,
  type AnalysisLanguage,
  type TermsShape,
} from "../ai/prompts.js";
import { computeProfitability, analyzeProfit } from "../ai/profitability.js";
import {
  extractOfferMeta,
  generateBlueprint,
  type BlueprintInput,
} from "../ai/blueprint.js";

/**
 * Phase 11 — AI offer risk analysis (one tenant per user; session auth only).
 * Requires Prisma persistence; registered only when services.prisma exists.
 */

export interface AiRouteDeps {
  prisma: PrismaClient;
  /** Injectable for tests. */
  chatJsonImpl?: typeof chatJson;
  /** Injectable for tests. */
  fetchPageImpl?: typeof fetchPage;
}

const SETTING_BASE_URL = "llm.baseUrl";
const SETTING_MODEL = "llm.model";
const SETTING_API_KEY_ENC = "llm.apiKeyEnc";
const SETTING_OWNED_DOMAINS = "compliance.ownedDomains";
const SETTING_AMAZON_PAAPI_ENC = "amazon.paapiEnc";
/** 流量需求门数据源凭证（加密存储）：SimilarWeb / DataForSEO。 */
/** Keepa 自动筛选 API Key（加密存储，keepa.com 申请付费 key）。 */
const SETTING_KEEPA_API_KEY_ENC = "keepa.apiKeyEnc";
const SETTING_TRAFFIC_SIMILARWEB = "traffic.similarwebKey";
const SETTING_TRAFFIC_DATAFORSEO_LOGIN = "traffic.dataforseoLogin";
const SETTING_TRAFFIC_DATAFORSEO_PASSWORD = "traffic.dataforseoPassword";

async function requireSession(
  deps: AiRouteDeps,
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

async function requireAdmin(
  deps: AiRouteDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info = await requireSession(deps, request);
  if (info.role !== "admin") {
    throw new ForbiddenError("Admin access required");
  }
  return info;
}

interface LlmSettings {
  baseUrl?: string;
  model?: string;
  apiKeyEnc?: string;
  /** Advertiser-owned domains for the direct-link compliance checker. */
  ownedDomains?: string[];
  /** Encrypted Amazon PA-API credentials (AccessKey|SecretKey|PartnerTag|Region). */
  amazonPaapiEnc?: string;
  /** Encrypted SimilarWeb API key (traffic gate, paid). */
  trafficSimilarwebEnc?: string;
  /** Encrypted DataForSEO login (traffic gate, paid). */
  trafficDataforseoLoginEnc?: string;
  /** Encrypted DataForSEO password (traffic gate, paid). */
  trafficDataforseoPasswordEnc?: string;
  /** Encrypted Keepa API key (Keepa auto-screening, paid). */
  keepaApiKeyEnc?: string;
}

async function readSettings(prisma: PrismaClient): Promise<LlmSettings> {
  const rows = await prisma.aiSetting.findMany();
  const out: LlmSettings = {};
  for (const r of rows as Array<{ key: string; value: string }>) {
    if (r.key === SETTING_BASE_URL) out.baseUrl = r.value;
    else if (r.key === SETTING_MODEL) out.model = r.value;
    else if (r.key === SETTING_API_KEY_ENC) out.apiKeyEnc = r.value;
    else if (r.key === SETTING_AMAZON_PAAPI_ENC) out.amazonPaapiEnc = r.value;
    else if (r.key === SETTING_TRAFFIC_SIMILARWEB)
      out.trafficSimilarwebEnc = r.value;
    else if (r.key === SETTING_TRAFFIC_DATAFORSEO_LOGIN)
      out.trafficDataforseoLoginEnc = r.value;
    else if (r.key === SETTING_TRAFFIC_DATAFORSEO_PASSWORD)
      out.trafficDataforseoPasswordEnc = r.value;
    else if (r.key === SETTING_KEEPA_API_KEY_ENC) out.keepaApiKeyEnc = r.value;
    else if (r.key === SETTING_OWNED_DOMAINS) {
      out.ownedDomains = r.value
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean);
    }
  }
  return out;
}

function isConfigured(s: LlmSettings): boolean {
  return !!(s.baseUrl && s.model && s.apiKeyEnc);
}

function asTrimmedString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function asFiniteNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export async function registerAiRoutes(
  app: FastifyInstance,
  deps: AiRouteDeps
): Promise<void> {
  const { prisma } = deps;
  const chatJsonImpl = deps.chatJsonImpl ?? chatJson;
  const fetchPageImpl = deps.fetchPageImpl ?? fetchPage;

  /** Admin-only: inspect current LLM configuration (never returns the key). */
  app.get("/api/v1/ai/settings", async (request) => {
    await requireAdmin(deps, request);
    const s = await readSettings(prisma);
    return {
      configured: isConfigured(s),
      provider: "openai-compatible",
      baseUrl: s.baseUrl ?? "",
      model: s.model ?? "",
      hasKey: !!s.apiKeyEnc,
      ownedDomains: s.ownedDomains ?? [],
      hasAmazonPaapi: !!s.amazonPaapiEnc,
      /** 流量数据源凭证是否已配置（只返回布尔值，永不返回明文）。 */
      hasTrafficSimilarweb: !!s.trafficSimilarwebEnc,
      hasTrafficDataforseo: !!(
        s.trafficDataforseoLoginEnc && s.trafficDataforseoPasswordEnc
      ),
      /** Keepa API Key 是否已配置（只返回布尔值，永不返回明文）。 */
      hasKeepa: !!s.keepaApiKeyEnc,
    };
  });

  /** Admin-only: configure the OpenAI-compatible LLM endpoint. */
  app.put("/api/v1/ai/settings", async (request) => {
    await requireAdmin(deps, request);
    const body = (request.body ?? {}) as {
      baseUrl?: unknown;
      model?: unknown;
      apiKey?: unknown;
      ownedDomains?: unknown;
      amazonPaapi?: unknown;
      /** Keepa API Key（非空字符串才加密写入；空表示不修改已有值）。 */
      keepaKey?: unknown;
      /** 流量数据源凭证：{ similarwebKey?, dataforseoLogin?, dataforseoPassword? } */
      traffic?: unknown;
    };

    const updates: Record<string, string> = {};
    if (body.baseUrl !== undefined) {
      const v = asTrimmedString(body.baseUrl);
      if (!v || !/^https?:\/\//i.test(v)) {
        throw new ValidationError("baseUrl must be an http(s) URL");
      }
      updates[SETTING_BASE_URL] = v.replace(/\/+$/, "");
    }
    if (body.model !== undefined) {
      const v = asTrimmedString(body.model);
      if (!v) throw new ValidationError("model must not be empty");
      updates[SETTING_MODEL] = v;
    }
    if (body.apiKey !== undefined) {
      // Empty apiKey keeps the existing key; only non-empty replaces it.
      if (typeof body.apiKey === "string" && body.apiKey.trim().length > 0) {
        const pepper = assertAiSettingsPepperConfigured();
        updates[SETTING_API_KEY_ENC] = encryptSecret(body.apiKey.trim(), pepper);
      }
    }
    if (body.ownedDomains !== undefined) {
      if (!Array.isArray(body.ownedDomains)) {
        throw new ValidationError("ownedDomains must be an array of domains");
      }
      const normalized: string[] = [];
      for (const d of body.ownedDomains as unknown[]) {
        if (typeof d !== "string") {
          throw new ValidationError("ownedDomains must be an array of domains");
        }
        const n = normalizeOwnedDomain(d);
        if (!n) {
          throw new ValidationError(`Invalid domain in ownedDomains: ${d}`);
        }
        if (!normalized.includes(n)) normalized.push(n);
      }
      updates[SETTING_OWNED_DOMAINS] = normalized.join(",");
    }
    if (body.amazonPaapi !== undefined) {
      // Amazon PA-API credentials: { accessKey, secretKey, partnerTag, region }
      // Empty object clears the credentials.
      if (body.amazonPaapi !== null && typeof body.amazonPaapi === "object") {
        const p = body.amazonPaapi as Record<string, unknown>;
        const accessKey = asTrimmedString(p.accessKey);
        const secretKey = asTrimmedString(p.secretKey);
        const partnerTag = asTrimmedString(p.partnerTag);
        const region = asTrimmedString(p.region) || "us-east-1";
        if (accessKey && secretKey && partnerTag) {
          const pepper = assertAiSettingsPepperConfigured();
          const combined = [accessKey, secretKey, partnerTag, region].join("|");
          updates[SETTING_AMAZON_PAAPI_ENC] = encryptSecret(combined, pepper);
        } else if (!accessKey && !secretKey && !partnerTag) {
          // All empty: clear the credentials
          await prisma.aiSetting.deleteMany({ where: { key: SETTING_AMAZON_PAAPI_ENC } });
        } else {
          throw new ValidationError("Amazon PA-API requires accessKey, secretKey, and partnerTag");
        }
      } else {
        throw new ValidationError("amazonPaapi must be an object");
      }
    }
    if (body.keepaKey !== undefined) {
      // Keepa API Key：只有非空字符串才加密写入；空字符串/null/缺失表示不修改已有值。
      if (typeof body.keepaKey !== "string") {
        throw new ValidationError("keepaKey must be a string");
      }
      if (body.keepaKey.trim().length > 0) {
        const pepper = assertAiSettingsPepperConfigured();
        updates[SETTING_KEEPA_API_KEY_ENC] = encryptSecret(
          body.keepaKey.trim(),
          pepper
        );
      }
    }
    let trafficSectionProvided = false;
    if (body.traffic !== undefined) {
      // 流量数据源凭证（SimilarWeb / DataForSEO，付费 key）。
      // 规则：只有非空字符串才加密写入；空字符串/null/缺失表示不修改已有值。
      if (
        body.traffic === null ||
        typeof body.traffic !== "object" ||
        Array.isArray(body.traffic)
      ) {
        throw new ValidationError("traffic must be an object");
      }
      trafficSectionProvided = true;
      const t = body.traffic as Record<string, unknown>;
      const saveTrafficSecret = (
        field: unknown,
        settingKey: string,
        label: string
      ) => {
        if (field === undefined || field === null) return;
        if (typeof field !== "string") {
          throw new ValidationError(`${label} must be a string`);
        }
        if (field.trim().length === 0) return; // 空字符串 → 不覆盖已有值
        const pepper = assertAiSettingsPepperConfigured();
        updates[settingKey] = encryptSecret(field.trim(), pepper);
      };
      saveTrafficSecret(
        t.similarwebKey,
        SETTING_TRAFFIC_SIMILARWEB,
        "traffic.similarwebKey"
      );
      saveTrafficSecret(
        t.dataforseoLogin,
        SETTING_TRAFFIC_DATAFORSEO_LOGIN,
        "traffic.dataforseoLogin"
      );
      saveTrafficSecret(
        t.dataforseoPassword,
        SETTING_TRAFFIC_DATAFORSEO_PASSWORD,
        "traffic.dataforseoPassword"
      );
    }
    if (Object.keys(updates).length === 0 && !trafficSectionProvided) {
      throw new ValidationError("No settings provided");
    }

    for (const [key, value] of Object.entries(updates)) {
      await prisma.aiSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    }
    const s = await readSettings(prisma);
    return {
      ok: true,
      configured: isConfigured(s),
      hasTrafficSimilarweb: !!s.trafficSimilarwebEnc,
      hasTrafficDataforseo: !!(
        s.trafficDataforseoLoginEnc && s.trafficDataforseoPasswordEnc
      ),
      hasKeepa: !!s.keepaApiKeyEnc,
    };
  });

  /**
   * Admin-only: 测试 LLM 连接，一步步定位故障层级。
   * 可传 { baseUrl?, model?, apiKey? } 测试"保存前"的值；不传则用已保存的配置。
   * 返回 { ok, stage, message, latencyMs?, httpStatus? }，stage 之一：
   * config | dns | connect | tls | http | ok
   */
  app.post("/api/v1/ai/test-connection", async (request) => {
    const hostOf = (u: string): string => {
      try {
        return new URL(u).host;
      } catch {
        return u;
      }
    };
    const snippet = async (r: Response): Promise<string> => {
      try {
        return (await r.text()).trim().slice(0, 200).replace(/\s+/g, " ");
      } catch {
        return "";
      }
    };
    await requireAdmin(deps, request);
    const body = (request.body ?? {}) as {
      baseUrl?: unknown;
      model?: unknown;
      apiKey?: unknown;
    };
    const s = await readSettings(prisma);
    const baseUrl =
      (typeof body.baseUrl === "string" && body.baseUrl.trim()) || s.baseUrl || "";
    const model = (typeof body.model === "string" && body.model.trim()) || s.model || "";
    let apiKey: string | null = null;
    if (typeof body.apiKey === "string" && body.apiKey.trim()) {
      apiKey = body.apiKey.trim();
    } else if (s.apiKeyEnc) {
      try {
        apiKey = decryptSecret(s.apiKeyEnc, assertAiSettingsPepperConfigured());
      } catch {
        apiKey = null;
      }
    }

    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
      return {
        ok: false,
        stage: "config",
        message: "baseUrl 未配置或格式不对（应为 http(s):// 开头）",
      };
    }
    if (!apiKey) {
      return {
        ok: false,
        stage: "config",
        message: "API Key 未配置",
      };
    }
    const cleanBase = baseUrl.replace(/\/+$/, "");
    const url = `${cleanBase}/models`;
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      const cause = (e as { cause?: { code?: string } })?.cause;
      const code = cause?.code ?? "";
      const latencyMs = Date.now() - started;
      if (/ENOTFOUND|EAI_AGAIN/i.test(code + msg)) {
        return {
          ok: false,
          stage: "dns",
          latencyMs,
          message: `DNS 解析失败：服务器解析不了 ${hostOf(cleanBase)}。检查服务器 DNS 设置或该域名是否可访问。`,
        };
      }
      if (/CERT|TLS|SSL/i.test(code + msg)) {
        return {
          ok: false,
          stage: "tls",
          latencyMs,
          message: `TLS 握手失败（${code || msg.slice(0, 80)}）。可能是服务器时间不对或中间设备劫持 HTTPS。`,
        };
      }
      if (/ECONNREFUSED/i.test(code + msg)) {
        return {
          ok: false,
          stage: "connect",
          latencyMs,
          message: `连接被拒绝：${hostOf(cleanBase)} 拒绝了连接。检查 baseUrl 是否写错、服务商是否屏蔽了机房 IP。`,
        };
      }
      if (/TimeoutError|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/i.test(code + msg)) {
        return {
          ok: false,
          stage: "connect",
          latencyMs,
          message: `连接超时（15 秒）：服务器连不上 ${hostOf(cleanBase)}。可能是机房网络问题、IPv6 路由不通或被防火墙拦截。`,
        };
      }
      return {
        ok: false,
        stage: "connect",
        latencyMs,
        message: `网络错误：${msg.slice(0, 120)}`,
      };
    }
    const latencyMs = Date.now() - started;
    if (res.status === 401) {
      return {
        ok: false,
        stage: "http",
        httpStatus: 401,
        latencyMs,
        message: "网络通了，但 API Key 无效（401）。请检查 key 是否复制完整、是否被轮换。",
      };
    }
    if (res.status === 404) {
      return {
        ok: false,
        stage: "http",
        httpStatus: 404,
        latencyMs,
        message: `网络通了，但地址不对（404）。检查 baseUrl 是否多了 /v1 或少了路径，当前：${cleanBase}`,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        stage: "http",
        httpStatus: res.status,
        latencyMs,
        message: `网络通了，但服务商返回 ${res.status}。${(await snippet(res)).slice(0, 120)}`,
      };
    }
    return {
      ok: true,
      stage: "ok",
      httpStatus: 200,
      latencyMs,
      message: `连接正常（${latencyMs}ms）。baseUrl 与 key 都没问题${model ? `，model 为 ${model}` : ""}。`,
    };
  });

  /** Analyze an offer (URL or pasted text) with the configured LLM. */
  app.post("/api/v1/ai/analyze", async (request) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as {
      url?: unknown;
      text?: unknown;
      merchant?: unknown;
      network?: unknown;
      payout?: unknown;
      payoutCurrency?: unknown;
      estimatedCpc?: unknown;
      language?: unknown;
    };

    const url = asTrimmedString(body.url);
    const text = asTrimmedString(body.text);
    if (!url && !text) {
      throw new ValidationError("Either url or text is required");
    }

    const settings = await readSettings(prisma);
    if (!isConfigured(settings)) {
      throw new AppError("AI is not configured", {
        code: "AI_NOT_CONFIGURED",
        statusCode: 400,
      });
    }

    let pageText: string;
    let inputKind: "url" | "text";
    let inputRef: string;
    if (url) {
      // 直抓失败自动降级：无头浏览器截图 + OCR（反爬站点也能分析）
      const fetched = await fetchPageTextWithFallback(url, { fetchImpl: fetchPageImpl });
      pageText = fetched.text;
      inputKind = "url";
      inputRef = fetched.finalUrl;
    } else {
      pageText = (text as string).slice(0, 12_000);
      inputKind = "text";
      inputRef = createHash("sha256").update(text as string, "utf8").digest("hex");
    }

    const merchant = asTrimmedString(body.merchant);
    const network = asTrimmedString(body.network);
    const payout = asFiniteNumber(body.payout);
    const payoutCurrency = asTrimmedString(body.payoutCurrency);
    const estimatedCpc = asFiniteNumber(body.estimatedCpc);
    const language: AnalysisLanguage = body.language === "en" ? "en" : "zh";

    const pepper = assertAiSettingsPepperConfigured();
    // apiKey lives only in this local; never logged.
    const apiKey = decryptSecret(settings.apiKeyEnc as string, pepper);
    const { system, user } = buildAnalysisPrompt({
      pageText,
      merchant,
      network,
      payout,
      payoutCurrency,
      language,
    });

    let analysis;
    try {
      analysis = await chatJsonValidated(
        {
          baseUrl: settings.baseUrl as string,
          model: settings.model as string,
          apiKey,
          system,
          user,
        },
        validateAnalysisShape,
        chatJsonImpl,
      );
    } catch (e) {
      if (e instanceof AiError) throw e;
      throw new AiError("LLM request failed");
    }
    const profitability = computeProfitability(payout, payoutCurrency, estimatedCpc);

    const id = randomUUID();
    // Deep-clone to plain JSON for the Prisma Json field.
    const resultJson = JSON.parse(JSON.stringify(analysis)) as unknown;
    await prisma.aiAnalysis.create({
      data: {
        id,
        tenantId: info.tenantId,
        userId: info.id,
        inputKind,
        inputRef,
        merchant: merchant ?? null,
        network: network ?? null,
        payout: payout ?? null,
        payoutCurrency: payoutCurrency ?? null,
        estimatedCpc: estimatedCpc ?? null,
        result: resultJson as never,
      },
    });

    return {
      id,
      merchant: merchant ?? null,
      network: network ?? null,
      language,
      profitability,
      analysis,
      analyzedAt: new Date().toISOString(),
    };
  });

  /**
   * AI 推荐关键词：输入产品/品类，返回关键词思路（不打分）。
   * 评分必须基于用户填入的真实数据（搜索量/竞争度/意图/趋势），由前端按透明公式计算，
   * AI 不得凭空编造分数。
   */
  app.post("/api/v1/ai/recommend-keywords", async (request) => {
    await requireSession(deps, request);
    const body = (request.body ?? {}) as {
      product?: unknown;
      language?: unknown;
      count?: unknown;
    };
    const product = asTrimmedString(body.product);
    if (!product || product.length < 2) {
      throw new ValidationError("product must be at least 2 characters");
    }
    const count = Math.min(Math.max(Number(body.count) || 10, 5), 20);
    const language: AnalysisLanguage = body.language === "en" ? "en" : "zh";

    const settings = await readSettings(prisma);
    if (!isConfigured(settings)) {
      throw new AppError("AI is not configured", {
        code: "AI_NOT_CONFIGURED",
        statusCode: 400,
      });
    }
    const pepper = assertAiSettingsPepperConfigured();
    const apiKey = decryptSecret(settings.apiKeyEnc as string, pepper);

    const system =
      language === "zh"
        ? "你是20年经验的联盟营销投流专家，擅长 Google Ads 关键词策略。用大白话，只返回 JSON。重要：你没有实时搜索量/CPC数据，绝不编造数字评分，只给选词思路。"
        : "You are a 20-year affiliate paid-traffic expert specializing in Google Ads keyword strategy. Return JSON only. Important: you have no live volume/CPC data; never invent numeric scores, only give keyword ideas.";
    const user =
      language === "zh"
        ? `为产品/品类"${product}"推荐 ${count} 个值得去 SEMRUSH/关键词规划师查数据的英文关键词思路。要求：覆盖高购买意图词型（best/review/vs/discount/buy 修饰）、长尾词；避开纯信息类词。每个词给一句话选词理由（说明这个词型为什么值得查，不要编造搜索量或评分）。只返回 JSON：{"keywords":[{"keyword":"...","reason":"..."}]}`
        : `Suggest ${count} English keyword ideas worth checking in SEMRUSH/Keyword Planner for product/niche "${product}". Cover high-intent patterns (best/review/vs/discount/buy modifiers) and long-tail. Avoid informational-only terms. One-line reason per keyword (why this pattern is worth checking; never invent volume or scores). Return JSON only: {"keywords":[{"keyword":"...","reason":"..."}]}`;

    let result: { keywords?: Array<{ keyword?: unknown; reason?: unknown }> };
    try {
      result = (await chatJsonImpl({
        baseUrl: settings.baseUrl as string,
        model: settings.model as string,
        apiKey,
        system: system + '\nReturn JSON: {"keywords":[{"keyword":"...","reason":"..."}]}',
        user,
      })) as typeof result;
    } catch (e) {
      if (e instanceof AiError) throw e;
      throw new AiError("LLM request failed");
    }

    const keywords = (result.keywords ?? [])
      .filter((k) => typeof k.keyword === "string" && (k.keyword as string).trim())
      .slice(0, count)
      .map((k) => ({
        keyword: (k.keyword as string).trim(),
        reason: typeof k.reason === "string" ? k.reason.trim().slice(0, 120) : "",
      }));

    return { product, keywords, analyzedAt: new Date().toISOString() };
  });

  /**
   * P0 anti-ban — parse affiliate offer TERMS into structured restrictions.
   * Conservative by design: the prompt maps ambiguity/silence to "unknown".
   */
  app.post("/api/v1/ai/analyze-terms", async (request) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as {
      text?: unknown;
      language?: unknown;
    };
    const text = asTrimmedString(body.text);
    if (!text || text.length < 50) {
      throw new ValidationError(
        "text must be at least 50 characters of offer terms"
      );
    }
    const settings = await readSettings(prisma);
    if (!isConfigured(settings)) {
      throw new AppError("AI is not configured", {
        code: "AI_NOT_CONFIGURED",
        statusCode: 400,
      });
    }
    const language: AnalysisLanguage = body.language === "en" ? "en" : "zh";
    const pepper = assertAiSettingsPepperConfigured();
    const apiKey = decryptSecret(settings.apiKeyEnc as string, pepper);
    const { system, user } = buildTermsPrompt(text.slice(0, 12_000), language);
    let terms;
    try {
      terms = await chatJsonValidated(
        {
          baseUrl: settings.baseUrl as string,
          model: settings.model as string,
          apiKey,
          system,
          user,
        },
        validateTermsShape,
        chatJsonImpl,
      );
    } catch (e) {
      if (e instanceof AiError) throw e;
      throw new AiError("LLM request failed");
    }
    const id = randomUUID();
    const resultJson = JSON.parse(JSON.stringify(terms)) as unknown;
    await prisma.aiAnalysis.create({
      data: {
        id,
        tenantId: info.tenantId,
        userId: info.id,
        inputKind: "terms",
        inputRef: createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16),
        merchant: null,
        network: null,
        payout: null,
        payoutCurrency: null,
        estimatedCpc: null,
        result: resultJson as never,
      },
    });
    return { id, language, terms, analyzedAt: new Date().toISOString() };
  });

  /**
   * 投流决策分析：2×2 组合（落地页/直链 × 可投品牌词/不可投品牌词），
   * EPC 优先判断，输出五板块中文报告（markdown）。
   */
  app.post("/api/v1/ai/traffic-plan", async (request) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as Record<string, unknown>;

    const mode = body.mode === "direct" ? "direct" : "landing";
    const brandPolicy = body.brandPolicy === "forbidden" ? "forbidden" : "allowed";
    const offerName = asTrimmedString(body.offerName);
    if (!offerName) {
      throw new ValidationError("offerName is required");
    }

    const keywords = Array.isArray(body.keywords)
      ? (body.keywords as Record<string, unknown>[])
          .map((k) => ({
            keyword: asTrimmedString(k.keyword) ?? "",
            volume: asFiniteNumber(k.volume),
            cpc: asFiniteNumber(k.cpc),
            plannerLow: asFiniteNumber(k.plannerLow),
            plannerHigh: asFiniteNumber(k.plannerHigh),
            competition: asTrimmedString(k.competition),
            density: asFiniteNumber(k.density),
            intent: asTrimmedString(k.intent),
          }))
          .filter((k) => k.keyword.length > 0)
          .slice(0, 50)
      : [];
    const negativeKeywords = Array.isArray(body.negativeKeywords)
      ? (body.negativeKeywords as unknown[])
          .map((n) => String(n ?? "").trim())
          .filter(Boolean)
          .slice(0, 200)
      : [];

    const input: TrafficPlanInput = {
      mode: mode as TrafficMode,
      brandPolicy: brandPolicy as BrandPolicy,
      language: body.language === "en" ? "en" : "zh",
      offerName,
      payout: asFiniteNumber(body.payout) ?? undefined,
      network: asTrimmedString(body.network) || undefined,
      cookieDays: asFiniteNumber(body.cookieDays) ?? undefined,
      epc: asFiniteNumber(body.epc) ?? undefined,
      networkCvr: asFiniteNumber(body.networkCvr) ?? undefined,
      refundRate: asFiniteNumber(body.refundRate) ?? undefined,
      bestPayout: asFiniteNumber(body.bestPayout) ?? undefined,
      bestPayoutNetwork: asTrimmedString(body.bestPayoutNetwork) || undefined,
      competitorAds: asTrimmedString(body.competitorAds) || undefined,
      spyfuKeywords: asTrimmedString(body.spyfuKeywords) || undefined,
      spyfuBudgetTrend: asTrimmedString(body.spyfuBudgetTrend) || undefined,
      similarwebNotes: asTrimmedString(body.similarwebNotes) || undefined,
      ecommerceNotes: asTrimmedString(body.ecommerceNotes) || undefined,
      keywords,
      negativeKeywords,
      targetProfitMargin: asFiniteNumber(body.targetProfitMargin) ?? 0.5,
      notes: asTrimmedString(body.notes) || undefined,
    };

    const settings = await readSettings(prisma);
    if (!isConfigured(settings)) {
      throw new AppError("AI is not configured", {
        code: "AI_NOT_CONFIGURED",
        statusCode: 400,
      });
    }

    const pepper = assertAiSettingsPepperConfigured();
    const apiKey = decryptSecret(settings.apiKeyEnc as string, pepper);
    const profile = getComboProfile(input.mode, input.brandPolicy);
    const math = computeKeywordMath(input, profile);
    const { system, user } = buildTrafficPlanPrompt(input);

    let report: string;
    try {
      const raw = (await chatJsonImpl({
        baseUrl: settings.baseUrl as string,
        model: settings.model as string,
        apiKey,
        system: system + "\nReturn JSON: {\"report\": \"<markdown report>\"}",
        user,
      })) as { report?: unknown };
      report = typeof raw?.report === "string" ? raw.report : JSON.stringify(raw);
    } catch (e) {
      if (e instanceof AiError) throw e;
      throw new AiError("LLM request failed");
    }

    const id = randomUUID();
    await prisma.aiAnalysis.create({
      data: {
        id,
        tenantId: info.tenantId,
        userId: info.id,
        inputKind: "traffic-plan",
        inputRef: createHash("sha256").update(offerName, "utf8").digest("hex").slice(0, 16),
        merchant: input.offerName,
        network: input.network ?? null,
        payout: input.payout ?? null,
        payoutCurrency: "USD",
        estimatedCpc: null,
        result: { report, combo: profile.key, math } as never,
      },
    });
    return {
      id,
      language: input.language,
      combo: profile.key,
      report,
      math,
      analyzedAt: new Date().toISOString(),
    };
  });

  /**
   * P0 anti-ban — batch-screen up to 10 offers' terms, ranked go → caution → stop.
   * Sequential LLM calls to avoid rate limits; fail-fast on LLM errors.
   */
  app.post("/api/v1/ai/screen-offers", async (request) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as {
      items?: unknown;
      language?: unknown;
    };
    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw new ValidationError("items must be a non-empty array");
    }
    if (body.items.length > 10) {
      throw new ValidationError("items must contain at most 10 offers");
    }
    const items: Array<{ name: string | null; text: string }> = [];
    for (let i = 0; i < body.items.length; i++) {
      const it = body.items[i] as { name?: unknown; text?: unknown };
      const text = typeof it?.text === "string" ? it.text.trim() : "";
      if (text.length < 50) {
        throw new ValidationError(
          `items[${i}].text must be at least 50 characters of offer terms`
        );
      }
      const name =
        typeof it?.name === "string" && it.name.trim()
          ? it.name.trim().slice(0, 120)
          : null;
      items.push({ name, text });
    }
    const settings = await readSettings(prisma);
    if (!isConfigured(settings)) {
      throw new AppError("AI is not configured", {
        code: "AI_NOT_CONFIGURED",
        statusCode: 400,
      });
    }
    const language: AnalysisLanguage = body.language === "en" ? "en" : "zh";
    const pepper = assertAiSettingsPepperConfigured();
    const apiKey = decryptSecret(settings.apiKeyEnc as string, pepper);

    const analyzed: Array<{ name: string | null; terms: TermsShape }> = [];
    for (const item of items) {
      const { system, user } = buildTermsPrompt(item.text.slice(0, 12_000), language);
      let terms;
      try {
        terms = await chatJsonValidated(
          {
            baseUrl: settings.baseUrl as string,
            model: settings.model as string,
            apiKey,
            system,
            user,
          },
          validateTermsShape,
          chatJsonImpl,
        );
      } catch (e) {
        if (e instanceof AiError) throw e;
        throw new AiError("LLM request failed");
      }
      analyzed.push({ name: item.name, terms });
    }

    const severityRank = { high: 0, medium: 1, low: 2 } as const;
    const verdictRank = { go: 0, caution: 1, stop: 2 } as const;
    const results = analyzed
      .map((a) => {
        const keyRisks = [...a.terms.redFlags]
          .sort((x, y) => severityRank[x.severity] - severityRank[y.severity])
          .slice(0, 3)
          .map((f) => f.title);
        return {
          name: a.name,
          verdict: a.terms.overallVerdict,
          keyRisks,
          summary: a.terms.summary,
        };
      })
      .sort((a, b) => verdictRank[a.verdict] - verdictRank[b.verdict]);

    const id = randomUUID();
    const resultJson = JSON.parse(
      JSON.stringify({
        results: analyzed.map((a) => ({ name: a.name, terms: a.terms })),
        counts: {
          go: results.filter((r) => r.verdict === "go").length,
          caution: results.filter((r) => r.verdict === "caution").length,
          stop: results.filter((r) => r.verdict === "stop").length,
        },
      })
    ) as unknown;
    await prisma.aiAnalysis.create({
      data: {
        id,
        tenantId: info.tenantId,
        userId: info.id,
        inputKind: "screen",
        inputRef: `screen:${Date.now()}`,
        merchant: null,
        network: null,
        payout: null,
        payoutCurrency: null,
        estimatedCpc: null,
        result: resultJson as never,
      },
    });
    return { id, results, analyzedAt: new Date().toISOString() };
  });

  /**
   * P0 anti-ban — direct-link compliance checker: resolve redirect chains
   * (SSRF-safe) and flag raw affiliate/direct links vs owned domains.
   */
  app.post("/api/v1/ai/check-urls", async (request) => {
    await requireSession(deps, request);
    const body = (request.body ?? {}) as {
      urls?: unknown;
      ownedDomains?: unknown;
    };
    if (!Array.isArray(body.urls) || body.urls.length === 0) {
      throw new ValidationError("urls must be a non-empty array");
    }
    if (body.urls.length > 20) {
      throw new ValidationError("urls must contain at most 20 URLs");
    }
    for (const u of body.urls as unknown[]) {
      if (typeof u !== "string" || !u.trim()) {
        throw new ValidationError("urls must be an array of URL strings");
      }
    }
    const urls = (body.urls as string[]).map((u) => u.trim());

    let ownedDomains: string[];
    if (body.ownedDomains !== undefined) {
      if (!Array.isArray(body.ownedDomains)) {
        throw new ValidationError("ownedDomains must be an array of domains");
      }
      ownedDomains = [];
      for (const d of body.ownedDomains as unknown[]) {
        if (typeof d !== "string") {
          throw new ValidationError("ownedDomains must be an array of domains");
        }
        const n = normalizeOwnedDomain(d);
        if (!n) {
          throw new ValidationError(`Invalid domain in ownedDomains: ${d}`);
        }
        if (!ownedDomains.includes(n)) ownedDomains.push(n);
      }
      // Persist for next time.
      await prisma.aiSetting.upsert({
        where: { key: SETTING_OWNED_DOMAINS },
        create: { key: SETTING_OWNED_DOMAINS, value: ownedDomains.join(",") },
        update: { value: ownedDomains.join(",") },
      });
    } else {
      ownedDomains = (await readSettings(prisma)).ownedDomains ?? [];
    }

    const results: Array<{
      inputUrl: string;
      finalUrl: string;
      finalDomain: string | null;
      isOwnedDomain: boolean;
      affiliateParams: string[];
      verdict: "owned" | "affiliate_direct" | "suspicious" | "unknown";
    }> = [];
    for (const inputUrl of urls) {
      let finalUrl = inputUrl;
      let ok = false;
      try {
        const fetched = await fetchPageImpl(inputUrl);
        finalUrl = fetched.finalUrl;
        ok = true;
      } catch {
        // SSRF-blocked or unreachable: report per-item unknown, never 400.
        ok = false;
      }
      let finalHost: string | null = null;
      let affiliateParams: string[] = [];
      try {
        const u = new URL(finalUrl);
        finalHost = u.hostname;
        affiliateParams = detectAffiliateParams(u);
      } catch {
        finalHost = null;
      }
      const redirected = (() => {
        try {
          return (
            new URL(finalUrl).toString() !== new URL(inputUrl).toString()
          );
        } catch {
          return false;
        }
      })();
      const owned =
        finalHost !== null && isOwnedDomain(finalHost, ownedDomains);
      results.push({
        inputUrl,
        finalUrl,
        finalDomain: finalHost ? registrableDomain(finalHost) : null,
        isOwnedDomain: owned,
        affiliateParams,
        verdict: ok
          ? checkUrlVerdict({
              finalHost,
              redirected,
              affiliateParams,
              ownedDomains,
            })
          : "unknown",
      });
    }
    return { results, ownedDomains };
  });

  /** Tenant-scoped analysis history, newest first (limit 50). */
  app.get("/api/v1/ai/analyses", async (request) => {
    const info = await requireSession(deps, request);
    const rows = (await prisma.aiAnalysis.findMany({
      where: { tenantId: info.tenantId },
      orderBy: { createdAt: "desc" },
      take: 50,
    })) as Array<{
      id: string;
      merchant: string | null;
      network: string | null;
      payout: number | null;
      payoutCurrency: string | null;
      result: unknown;
      createdAt: Date;
    }>;
    return {
      items: rows.map((r) => {
        const res = (r.result ?? {}) as {
          overallRisk?: unknown;
          riskLevel?: unknown;
        };
        return {
          id: r.id,
          merchant: r.merchant,
          network: r.network,
          payout: r.payout,
          payoutCurrency: r.payoutCurrency,
          overallRisk:
            typeof res.overallRisk === "number" ? res.overallRisk : null,
          riskLevel:
            typeof res.riskLevel === "string" ? res.riskLevel : null,
          createdAt:
            r.createdAt instanceof Date
              ? r.createdAt.toISOString()
              : String(r.createdAt),
        };
      }),
    };
  });

  /** Tenant-scoped single analysis. */
  app.get("/api/v1/ai/analyses/:id", async (request) => {
    const info = await requireSession(deps, request);
    const { id } = request.params as { id: string };
    const row = (await prisma.aiAnalysis.findFirst({
      where: { id, tenantId: info.tenantId },
    })) as {
      id: string;
      tenantId: string;
      userId: string | null;
      inputKind: string;
      inputRef: string;
      merchant: string | null;
      network: string | null;
      payout: number | null;
      payoutCurrency: string | null;
      estimatedCpc: number | null;
      result: unknown;
      createdAt: Date;
    } | null;
    if (!row) {
      throw new NotFoundError("Analysis", id);
    }
    return {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      inputKind: row.inputKind,
      inputRef: row.inputRef,
      merchant: row.merchant,
      network: row.network,
      payout: row.payout,
      payoutCurrency: row.payoutCurrency,
      estimatedCpc: row.estimatedCpc,
      result: row.result,
      createdAt:
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : String(row.createdAt),
    };
  });

  /**
   * P1 — brand keyword conflict check (no DB, no LLM).
   * Flags keywords containing any brand term as a substring and returns
   * ready-to-paste Google Ads negative lists (exact + phrase).
   */
  app.post("/api/v1/ai/brand-check", async (request) => {
    await requireSession(deps, request);
    const body = (request.body ?? {}) as {
      keywords?: unknown;
      brandTerms?: unknown;
    };
    if (!Array.isArray(body.keywords) || body.keywords.length === 0) {
      throw new ValidationError("keywords must be a non-empty array");
    }
    if (!Array.isArray(body.brandTerms) || body.brandTerms.length === 0) {
      throw new ValidationError("brandTerms must be a non-empty array");
    }
    if (body.keywords.length > 500) {
      throw new ValidationError("keywords must contain at most 500 entries");
    }
    if (body.brandTerms.length > 50) {
      throw new ValidationError("brandTerms must contain at most 50 entries");
    }
    const keywords: string[] = [];
    for (const k of body.keywords as unknown[]) {
      const t = asTrimmedString(k);
      if (!t) throw new ValidationError("keywords must be non-empty strings");
      keywords.push(t);
    }
    const brandTerms: string[] = [];
    for (const t of body.brandTerms as unknown[]) {
      const s = asTrimmedString(t);
      if (!s) throw new ValidationError("brandTerms must be non-empty strings");
      brandTerms.push(s);
    }

    const results = checkBrandConflicts(keywords, brandTerms);
    const negatives = buildNegativeKeywords(results);
    return {
      results,
      negatives,
      stats: {
        total: results.length,
        conflicts: results.filter((r) => r.conflict).length,
      },
    };
  });

  /**
   * Profit analysis with bid suggestions: takes commission (fixed or
   * price × percentage ranges) + assumed CVR, returns commission estimate,
   * three bid suggestions and profit/loss scenarios. Pure math, no LLM.
   */
  app.post<{
    Body: {
      fixedAmount?: unknown;
      priceMin?: unknown;
      priceMax?: unknown;
      commissionPctMin?: unknown;
      commissionPctMax?: unknown;
      currency?: unknown;
      assumedCvrPct?: unknown;
    };
  }>("/api/v1/ai/profit-analysis", async (request) => {
    await requireSession(deps, request);
    const body = (request.body ?? {}) as {
      fixedAmount?: unknown;
      priceMin?: unknown;
      priceMax?: unknown;
      commissionPctMin?: unknown;
      commissionPctMax?: unknown;
      currency?: unknown;
      assumedCvrPct?: unknown;
    };
    const num = (v: unknown): number | null => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const analysis = analyzeProfit(
      {
        fixedAmount: num(body.fixedAmount),
        priceMin: num(body.priceMin),
        priceMax: num(body.priceMax),
        commissionPctMin: num(body.commissionPctMin),
        commissionPctMax: num(body.commissionPctMax),
        currency:
          typeof body.currency === "string" ? body.currency : null,
      },
      num(body.assumedCvrPct) ?? 2
    );
    return { analysis };
  });

  /**
   * 抓取 offer 页面元信息：标题/描述/价格自动提取，用于一键推演报告表单预填。
   * 抓不到（反爬/无价格）就返回 null，前端提示手动填，不编造。
   */
  app.post<{
    Body: { url?: unknown };
  }>("/api/v1/ai/offer-fetch", async (request) => {
    const info = await requireSession(deps, request);
    void info;
    const body = request.body ?? {};
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) throw new ValidationError("url is required");
    // Tier 1：HTML 直抓（快）
    try {
      const page = await fetchPageHtml(url);
      const meta = extractOfferMeta(page.html, page.text);
      return {
        finalUrl: page.finalUrl,
        ...meta,
        /** 广告生成用的正文（前端随 blueprint 请求带回） */
        text: page.text.slice(0, 4000),
        source: "html" as const,
      };
    } catch (e) {
      if (!(e instanceof AiError)) throw e;
      // Tier 2：无头浏览器截图 + OCR（JS 渲染站 / 简单反爬）
      try {
        const shot = await screenshotPage(url);
        const ocr = await ocrImageText(shot.png);
        const text = ocr.text.replace(/\s+/g, " ").trim();
        const meta = extractOfferMeta("", text);
        return {
          finalUrl: shot.finalUrl,
          title: shot.title,
          description: text.slice(0, 300) || null,
          price: meta.price,
          currency: meta.currency,
          text: text.slice(0, 4000),
          source: "screenshot" as const,
        };
      } catch (e2) {
        // 站点明确拦截自动化（验证码/拒绝页）→ 告诉用户手动传截图
        if (e2 instanceof PageBlockedError || e2 instanceof OcrError) throw e2;
        // 截图也失败 → 抛最初的抓取错误（更准确）
        throw e;
      }
    }
  });

  /**
   * 浏览器插件抓取：用户在自己真实浏览器（Chrome 插件）里打开 offer 页
   * （Amazon 等反爬站点也能抓），插件提取渲染后正文 POST 到这里。
   * 插件带网站登录态 cookie（credentials:include），走 session 认证，
   * 无需 API Key。抓取记录存 offer_captures，供一键推演报告选用。
   */
  app.post("/api/v1/ai/offer-capture", async (request) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as {
      url?: unknown;
      title?: unknown;
      text?: unknown;
      html?: unknown;
    };
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) throw new ValidationError("url is required");
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ValidationError("url 无效");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ValidationError("只支持 http(s) 链接");
    }
    const text = typeof body.text === "string" ? body.text.slice(0, 20000) : "";
    if (!text.trim()) throw new ValidationError("页面正文为空，抓取失败");
    const html = typeof body.html === "string" ? body.html.slice(0, 200000) : "";
    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 500) : null;
    const meta = extractOfferMeta(html, text);
    const cleanText = text.replace(/\s+/g, " ").trim();
    const saved = await deps.prisma.offerCapture.create({
      data: {
        tenantId: info.tenantId,
        url: parsed.toString(),
        title,
        description: meta.description ?? cleanText.slice(0, 300) ?? null,
        price: meta.price ?? undefined,
        currency: meta.currency,
        pageText: cleanText.slice(0, 20000),
        pageHtml: html || undefined,
        source: "extension",
      },
    });
    return {
      id: saved.id,
      finalUrl: parsed.toString(),
      title,
      description: meta.description ?? cleanText.slice(0, 300) ?? null,
      price: meta.price,
      currency: meta.currency,
      text: cleanText.slice(0, 4000),
      source: "extension" as const,
    };
  });

  /** 插件抓取记录（本租户最近 10 条），供一键推演报告选用。 */
  app.get("/api/v1/ai/offer-captures", async (request) => {
    const info = await requireSession(deps, request);
    const rows = await deps.prisma.offerCapture.findMany({
      where: { tenantId: info.tenantId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true, url: true, title: true, description: true,
        price: true, currency: true, pageText: true, pageHtml: true, createdAt: true,
      },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        finalUrl: r.url,
        title: r.title,
        description: r.description,
        price: r.price == null ? null : Number(r.price),
        currency: r.currency,
        text: (r.pageText ?? "").slice(0, 4000),
        hasHtml: !!(r.pageHtml && r.pageHtml.length > 0),
        source: "extension" as const,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });

  /**
   * 关键词抓取解析：插件抓到的 SEMrush / Keyword Planner 页面，
   * 启发式解析成关键词表一行。找不到的字段为 null，前端只填解析到的。
   */
  app.post("/api/v1/ai/parse-keyword-capture", async (request) => {
    const info = await requireSession(deps, request);
    void info;
    const body = (request.body ?? {}) as { captureId?: unknown };
    const captureId = typeof body.captureId === "string" ? body.captureId : "";
    if (!captureId) throw new ValidationError("captureId is required");
    const row = await deps.prisma.offerCapture.findFirst({
      where: { id: captureId, tenantId: info.tenantId },
      select: { title: true, pageText: true },
    });
    if (!row) throw new ValidationError("抓取记录不存在");
    return parseKeywordCapture(row.title, row.pageText ?? "");
  });

  /**
   * 情报页抓取 AI 提取：SpyFu / 透明度 / SimilarWeb / 否定词。
   * 以前是把正文前 2000 字硬塞进框——那往往是站内导航菜单，不是情报。
   */
  app.post("/api/v1/ai/parse-intel-capture", async (request) => {
    const info = await requireSession(deps, request);
    void info;
    const body = (request.body ?? {}) as {
      captureId?: unknown;
      kind?: unknown;
      language?: unknown;
    };
    const captureId = typeof body.captureId === "string" ? body.captureId : "";
    if (!captureId) throw new ValidationError("captureId is required");
    if (!isIntelKind(body.kind)) throw new ValidationError("kind is invalid");
    const row = await deps.prisma.offerCapture.findFirst({
      where: { id: captureId, tenantId: info.tenantId },
      select: { pageText: true },
    });
    if (!row) throw new ValidationError("抓取记录不存在");
    const settings = await readSettings(prisma);
    if (!isConfigured(settings)) {
      throw new AppError("AI is not configured", {
        code: "AI_NOT_CONFIGURED",
        statusCode: 400,
      });
    }
    const pepper = assertAiSettingsPepperConfigured();
    const apiKey = decryptSecret(settings.apiKeyEnc as string, pepper);
    return extractIntelWithAi(
      {
        baseUrl: settings.baseUrl as string,
        model: settings.model as string,
        apiKey,
        language: body.language === "en" ? "en" : "zh",
      },
      row.pageText ?? "",
      body.kind
    );
  });

  /**
   * 抓取页面 AI 提取关键词：启发式正则对付排版多变的工具页总会漏/错，
   * 改成把抓取正文交给 LLM 认表格、逐行提取、判断购买意图。
   * AI 未配置/失败时前端回落到启发式解析。
   */
  app.post("/api/v1/ai/parse-keyword-capture-ai", async (request) => {
    const info = await requireSession(deps, request);
    void info;
    const body = (request.body ?? {}) as { captureId?: unknown; language?: unknown };
    const captureId = typeof body.captureId === "string" ? body.captureId : "";
    if (!captureId) throw new ValidationError("captureId is required");
    const row = await deps.prisma.offerCapture.findFirst({
      where: { id: captureId, tenantId: info.tenantId },
      select: { pageText: true },
    });
    if (!row) throw new ValidationError("抓取记录不存在");
    const settings = await readSettings(prisma);
    if (!isConfigured(settings)) {
      throw new AppError("AI is not configured", {
        code: "AI_NOT_CONFIGURED",
        statusCode: 400,
      });
    }
    const pepper = assertAiSettingsPepperConfigured();
    const apiKey = decryptSecret(settings.apiKeyEnc as string, pepper);
    const rows = await extractKeywordsWithAi(
      {
        baseUrl: settings.baseUrl as string,
        model: settings.model as string,
        apiKey,
        language: body.language === "en" ? "en" : "zh",
      },
      row.pageText ?? ""
    );
    return { rows };
  });

  /**
   * 商品页抓取 AI 提取：自动化广告页 Amazon 等反爬页面抓不到时，
   * 插件抓取 + AI 识别商品信息（标题/价格/卖点）填入手动粘贴框。
   */
  app.post("/api/v1/ai/parse-product-capture", async (request) => {
    const info = await requireSession(deps, request);
    void info;
    const body = (request.body ?? {}) as { captureId?: unknown; language?: unknown };
    const captureId = typeof body.captureId === "string" ? body.captureId : "";
    if (!captureId) throw new ValidationError("captureId is required");
    const row = await deps.prisma.offerCapture.findFirst({
      where: { id: captureId, tenantId: info.tenantId },
      select: { pageText: true },
    });
    if (!row) throw new ValidationError("抓取记录不存在");
    const settings = await readSettings(prisma);
    if (!isConfigured(settings)) {
      throw new AppError("AI is not configured", {
        code: "AI_NOT_CONFIGURED",
        statusCode: 400,
      });
    }
    const pepper = assertAiSettingsPepperConfigured();
    const apiKey = decryptSecret(settings.apiKeyEnc as string, pepper);
    return extractProductWithAi(
      {
        baseUrl: settings.baseUrl as string,
        model: settings.model as string,
        apiKey,
        language: body.language === "en" ? "en" : "zh",
      },
      row.pageText ?? ""
    );
  });

  /**
   * 电商页面抓取解析：插件抓到的 Amazon / Keepa / Shopping 页面正文 →
   * 价格/评分/评价数/BSR（找不到为 null，绝不编造）。
   */
  app.post("/api/v1/ai/parse-ecommerce-capture", async (request) => {
    const info = await requireSession(deps, request);
    void info;
    const body = (request.body ?? {}) as { captureId?: unknown };
    const captureId = typeof body.captureId === "string" ? body.captureId : "";
    if (!captureId) throw new ValidationError("captureId is required");
    const row = await deps.prisma.offerCapture.findFirst({
      where: { id: captureId, tenantId: info.tenantId },
      select: { pageText: true },
    });
    if (!row) throw new ValidationError("抓取记录不存在");
    return parseEcommerceCapture(row.pageText ?? "");
  });

  /**
   * 品牌词投流检查：查某品牌词在 Google 上的广告主（官方 vs 非官方），
   * 给出投流评估。数据源 DataForSEO SERP（凭证：AI 设置 → 流量信号凭证）；
   * 无凭证时返回 unavailable + 手动核查指引，绝不编造。
   */
  app.post("/api/v1/ai/brand-bidding", async (request) => {
    const info = await requireSession(deps, request);
    void info;
    const body = (request.body ?? {}) as { brandKeyword?: unknown; officialDomain?: unknown };
    const brandKeyword = typeof body.brandKeyword === "string" ? body.brandKeyword.trim() : "";
    const officialDomain = typeof body.officialDomain === "string" ? body.officialDomain.trim() : "";
    return checkBrandBidding(brandKeyword, officialDomain, { prisma: deps.prisma });
  });

  /** 单条抓取记录详情（含插件发来的真实 HTML，给落地页拆解用）。 */
  app.get("/api/v1/ai/offer-captures/:id", async (request) => {
    const info = await requireSession(deps, request);
    const { id } = request.params as { id: string };
    const row = await deps.prisma.offerCapture.findFirst({
      where: { id, tenantId: info.tenantId },
      select: {
        id: true, url: true, title: true, description: true,
        price: true, currency: true, pageText: true, pageHtml: true, createdAt: true,
      },
    });
    if (!row) throw new ValidationError("抓取记录不存在");
    return {
      id: row.id,
      finalUrl: row.url,
      title: row.title,
      description: row.description,
      price: row.price == null ? null : Number(row.price),
      currency: row.currency,
      text: (row.pageText ?? "").slice(0, 12000),
      html: row.pageHtml ?? null,
      source: "extension" as const,
      createdAt: row.createdAt.toISOString(),
    };
  });

  /**
   * 截图 OCR 兜底：offer 页抓不到（反爬）时，用户上传截图，
   * tesseract 识别全文 → 提取价格 → 返回正文给推演报告用。
   * multipart 单图 ≤8MB；图片只在内存处理，不落盘。
   */
  app.post("/api/v1/ai/offer-ocr", async (request) => {
    const info = await requireSession(deps, request);
    void info;
    let part: Awaited<ReturnType<FastifyRequest["file"]>>;
    try {
      part = await request.file();
    } catch {
      throw new ValidationError("请上传一张 offer 页截图（multipart/form-data）");
    }
    if (!part) throw new ValidationError("请上传一张 offer 页截图");
    const mimetype = part.mimetype ?? "";
    if (!mimetype.startsWith("image/")) {
      throw new ValidationError(`只接受图片文件，收到：${mimetype || "未知类型"}`);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of part.file) {
      size += (chunk as Buffer).length;
      if (size > 8 * 1024 * 1024) throw new ValidationError("图片超过 8MB 上限");
      chunks.push(chunk as Buffer);
    }
    const buf = Buffer.concat(chunks);
    if (buf.length === 0) throw new ValidationError("图片为空，无法识别");
    let ocr: { text: string; confidence: number | null };
    try {
      ocr = await ocrImageText(buf);
    } catch (e) {
      if (e instanceof OcrError) throw e;
      throw new ValidationError("截图识别失败，请换一张更清晰的截图重试");
    }
    const text = ocr.text.replace(/\s+/g, " ").trim();
    const meta = extractOfferMeta("", text);
    return {
      finalUrl: "",
      title: null,
      description: text.slice(0, 300) || null,
      price: meta.price,
      currency: meta.currency,
      text: text.slice(0, 4000),
      confidence: ocr.confidence,
      source: "screenshot" as const,
    };
  });

  /**
   * Offer 一键推演报告：一次调用产出 7 节推演（条款/盈利/关键词/广告/投流/监控/决策）。
   * LLM 板块 fail-soft；盈利测算与监控规则纯代码计算。
   */
  app.post<{
    Body: {
      offerName?: unknown;
      productDescription?: unknown;
      avgPrice?: unknown;
      commissionType?: unknown;
      commissionValue?: unknown;
      currency?: unknown;
      targetMarket?: unknown;
      termsText?: unknown;
      offerUrl?: unknown;
      pageText?: unknown;
      landingMode?: unknown;
      brandPolicy?: unknown;
      language?: unknown;
      keywordCount?: unknown;
      seedKeywords?: unknown;
    };
  }>("/api/v1/ai/offer-blueprint", async (request) => {
    const info = await requireSession(deps, request);
    const body = request.body ?? {};
    const str = (v: unknown): string =>
      typeof v === "string" ? v.trim() : "";
    const num = (v: unknown): number | null => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const offerName = str(body.offerName);
    if (!offerName) throw new ValidationError("offerName is required");
    const productDescription = str(body.productDescription);
    if (!productDescription)
      throw new ValidationError("productDescription is required");
    const commissionValue = num(body.commissionValue);
    if (commissionValue == null || commissionValue <= 0)
      throw new ValidationError("commissionValue must be a positive number");
    const settings = await readSettings(prisma);
    if (!isConfigured(settings)) {
      throw new AppError("AI is not configured", {
        code: "AI_NOT_CONFIGURED",
        statusCode: 400,
      });
    }
    const pepper = assertAiSettingsPepperConfigured();
    const apiKey = decryptSecret(settings.apiKeyEnc as string, pepper);
    const input: BlueprintInput = {
      offerName,
      productDescription,
      avgPrice: num(body.avgPrice),
      commissionType: body.commissionType === "fixed" ? "fixed" : "percentage",
      commissionValue,
      currency: str(body.currency) || "USD",
      targetMarket: str(body.targetMarket) || "US",
      termsText: str(body.termsText) || null,
      offerUrl: str(body.offerUrl) || null,
      pageText: str(body.pageText) || null,
      landingMode: body.landingMode === "direct" ? "direct" : "landing",
      brandPolicy: body.brandPolicy === "forbidden" ? "forbidden" : "allowed",
      language: body.language === "en" ? "en" : "zh",
      keywordCount: num(body.keywordCount) ?? undefined,
      seedKeywords: Array.isArray(body.seedKeywords)
        ? body.seedKeywords
            .filter((x: unknown): x is string => typeof x === "string")
            .map((x: string) => x.trim())
            .filter(Boolean)
            .slice(0, 50)
        : undefined,
    };
    const blueprint = await generateBlueprint(
      {
        prisma,
        tenantId: info.tenantId,
        userId: info.id,
        baseUrl: settings.baseUrl as string,
        model: settings.model as string,
        apiKey,
        chatJsonImpl: deps.chatJsonImpl,
      },
      input
    );
    return { blueprint };
  });
}
