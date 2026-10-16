/**
 * 关键词 AI 检查 API：投流前逐词判定相关性与政策风险。
 *
 * - POST /api/v1/ai/check-keywords  给定产品/offer 上下文 + 关键词列表，
 *   逐词返回 relevant | irrelevant | risky + 一句话理由。
 *
 * Session auth only (one tenant per user). Requires LLM configured
 * (same AI settings as /api/v1/ai/*). Global rate limiting applies
 * via the app-level @fastify/rate-limit plugin. Never logs keys.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  AppError,
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
import { chatJson } from "../ai/llm.js";
import {
  KEYWORD_CHECK_MAX_KEYWORDS,
  checkKeywords,
  normalizeCheckKeywords,
} from "../ai/keyword-check.js";
import type { AnalysisLanguage } from "../ai/prompts.js";

export interface KeywordCheckRouteDeps {
  prisma: PrismaClient;
  /** Injectable for tests. */
  chatJsonImpl?: typeof chatJson;
}

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
  deps: KeywordCheckRouteDeps,
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

export async function registerKeywordCheckRoutes(
  app: FastifyInstance,
  deps: KeywordCheckRouteDeps
): Promise<void> {
  const { prisma, chatJsonImpl = chatJson } = deps;

  app.post<{
    Body: {
      productDescription?: unknown;
      offerName?: unknown;
      offerUrl?: unknown;
      keywords?: unknown;
      language?: unknown;
    };
  }>("/api/v1/ai/check-keywords", async (request) => {
    await requireSession(deps, request);
    const body = request.body ?? {};

    const productDescription = asTrimmedString(body.productDescription);
    if (!productDescription) {
      throw new ValidationError("productDescription must be a non-empty string");
    }
    const offerName = asTrimmedString(body.offerName);
    if (!offerName) {
      throw new ValidationError("offerName must be a non-empty string");
    }
    if (!Array.isArray(body.keywords)) {
      throw new ValidationError("keywords must be an array");
    }
    const keywords = normalizeCheckKeywords(body.keywords);
    if (keywords.length > KEYWORD_CHECK_MAX_KEYWORDS) {
      throw new ValidationError(
        `keywords must contain at most ${KEYWORD_CHECK_MAX_KEYWORDS} entries`
      );
    }
    // 空列表直接返回，不调 LLM，也不需要 AI 配置。
    if (keywords.length === 0) {
      return { results: [] };
    }
    const offerUrlRaw = asTrimmedString(body.offerUrl);
    const offerUrl = offerUrlRaw ? assertHttpUrl(offerUrlRaw) : undefined;
    const language: AnalysisLanguage = body.language === "en" ? "en" : "zh";

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

    return checkKeywords(
      { productDescription, offerName, offerUrl, keywords, language },
      {
        baseUrl: settings.baseUrl as string,
        model: settings.model as string,
        apiKey,
      },
      chatJsonImpl
    );
  });
}
