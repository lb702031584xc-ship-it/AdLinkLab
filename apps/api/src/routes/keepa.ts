/**
 * Keepa 自动筛选（Day5 Keepa 验证的自动化）。
 *
 * - POST /api/v1/keepa/validate
 *   body: { asins: string[]（1–20 个）, domain?: number（Keepa domainId，默认 1=US） }
 *   串行请求 Keepa 官方 API（付费 key，token 珍贵），逐个判 pass/kill/unknown。
 *   同一 tenant 10 次/分钟限流（Redis；不可用时 fail-open）。
 *   失败降级：token 不足/429/无数据 → verdict=unknown，绝不抛 500。
 *   无 key → 400 并提示去"AI 设置 → Keepa API Key"配置。
 * - POST /api/v1/keepa/vision-judge
 *   multipart：price（价格历史截图，≤5MB）、rank（排名截图，≤5MB）、asin（可选）。
 *   走 vision LLM 看图判断（OCR 读不出曲线趋势）。无 LLM 配置 → 400；
 *   模型不支持 vision → 400 明确指引；失败不抛 500。
 * - GET /api/v1/keepa/vision-status → { llmConfigured }（供前端禁用按钮）。
 */
import { Redis } from "ioredis";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import {
  AppError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import { decryptSecret, assertAiSettingsPepperConfigured } from "../ai/crypto.js";
import { AiError, chatJsonVision } from "../ai/llm.js";
import {
  fetchKeepaProduct,
  keepaDomainId,
} from "../keepa/client.js";
import {
  evaluateKeepa,
  parseManualNumbers,
  evaluateManualNumbers,
  type KeepaEvaluation,
} from "../keepa/rules.js";
import {
  judgeKeepaScreenshots,
  isVisionUnsupportedError,
  type KeepaVisionImage,
  type VisionLlmConfig,
} from "../keepa/vision.js";

const SETTING_KEEPA_API_KEY_ENC = "keepa.apiKeyEnc";

interface Deps {
  prisma: PrismaClient;
  /** 注入式 Redis（测试用）；生产缺省时按需懒建共享连接。 */
  redis?: RateLimitRedis;
  /** Injectable for tests. */
  fetchKeepaImpl?: typeof fetchKeepaProduct;
  /** Vision LLM impl（测试用注入）。 */
  visionImpl?: typeof chatJsonVision;
}

export interface RateLimitRedis {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

async function requireSession(
  deps: Deps,
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

let sharedRedis: Redis | null = null;
let sharedRedisBroken = false;

function getSharedRedis(): Redis | null {
  if (sharedRedisBroken) return null;
  if (sharedRedis) return sharedRedis;
  try {
    const client = new Redis(
      process.env.REDIS_URL ?? "redis://localhost:6379",
      {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
      }
    );
    client.on("error", () => undefined);
    sharedRedis = client;
    return client;
  } catch {
    sharedRedisBroken = true;
    return null;
  }
}

const RATE_LIMIT_PER_MINUTE = 10;

function minuteStamp(now: Date = new Date()): string {
  return now.toISOString().slice(0, 16).replace(/[-T:]/g, "");
}

async function checkRateLimit(
  redis: RateLimitRedis | undefined,
  tenantId: string
): Promise<boolean> {
  const client = redis ?? getSharedRedis();
  if (!client) return true;
  try {
    const key = `keepa:ratelimit:${tenantId}:${minuteStamp()}`;
    const count = await client.incr(key);
    if (count === 1) {
      try {
        await client.expire(key, 120);
      } catch {
        // 忽略
      }
    }
    return count <= RATE_LIMIT_PER_MINUTE;
  } catch {
    return true; // Redis 不可用时 fail-open
  }
}

async function readKeepaApiKey(prisma: PrismaClient): Promise<string | null> {
  const row = await prisma.aiSetting.findUnique({
    where: { key: SETTING_KEEPA_API_KEY_ENC },
    select: { value: true },
  });
  if (!row?.value) return null;
  try {
    const pepper = assertAiSettingsPepperConfigured();
    const key = decryptSecret(row.value, pepper);
    return key.trim() ? key.trim() : null;
  } catch {
    return null;
  }
}

const ASIN_RE = /^[A-Z0-9]{10}$/i;

/** vision-judge 单图上限 5MB（jpeg/png/webp）。 */
const VISION_MAX_BYTES = 5 * 1024 * 1024;

const VISION_MIMETYPES = ["image/jpeg", "image/png", "image/webp"];

/** 读取 LLM 配置（AI 设置）；未配置返回 null（调用方转 400 指引）。 */
async function readLlmConfig(prisma: PrismaClient): Promise<VisionLlmConfig | null> {
  const rows = (await prisma.aiSetting.findMany({
    select: { key: true, value: true },
  })) as Array<{ key: string; value: string }>;
  let baseUrl: string | undefined;
  let model: string | undefined;
  let apiKeyEnc: string | undefined;
  for (const r of rows) {
    if (r.key === "llm.baseUrl") baseUrl = r.value;
    else if (r.key === "llm.model") model = r.value;
    else if (r.key === "llm.apiKeyEnc") apiKeyEnc = r.value;
  }
  if (!baseUrl || !model || !apiKeyEnc) return null;
  try {
    const pepper = assertAiSettingsPepperConfigured();
    const apiKey = decryptSecret(apiKeyEnc, pepper).trim();
    if (!apiKey) return null;
    return { baseUrl, model, apiKey };
  } catch {
    return null;
  }
}

interface VisionUpload {
  buf: Buffer;
  mimetype: string;
}

interface VisionUploads {
  price?: VisionUpload;
  rank?: VisionUpload;
  asin: string;
}

/** 读取 vision-judge 的 multipart：price/rank 图片 + 可选 asin。图片只在内存处理。 */
async function readVisionUploads(request: FastifyRequest): Promise<VisionUploads> {
  const out: VisionUploads = { asin: "" };
  try {
    for await (const part of request.parts()) {      if (part.type === "file") {
        const field = part.fieldname;
        if (field !== "price" && field !== "rank") {
          // 不相干的文件：直接消费丢弃，避免挂起。
          part.file.resume();
          continue;
        }
        const mimetype = (part.mimetype ?? "").toLowerCase();
        if (!VISION_MIMETYPES.includes(mimetype)) {
          throw new ValidationError(
            `只接受 jpeg/png/webp 图片，${field} 收到：${part.mimetype || "未知类型"}`
          );
        }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of part.file) {
          size += (chunk as Buffer).length;
          if (size > VISION_MAX_BYTES) {
            throw new ValidationError(`图片超过 5MB 上限（${field}）`);
          }
          chunks.push(chunk as Buffer);
        }
        const buf = Buffer.concat(chunks);
        if (buf.length === 0) {
          throw new ValidationError(`${field} 图片为空`);
        }
        out[field] = { buf, mimetype };
      } else if (part.fieldname === "asin" && typeof part.value === "string") {
        out.asin = part.value.trim().toUpperCase().slice(0, 10);
      }
    }
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    // @fastify/multipart 超限抛 FastifyError("request file too large")
    if (e instanceof Error && /too large/i.test(e.message)) {
      throw new ValidationError("图片超过 5MB 上限");
    }
    throw new ValidationError("图片上传失败，请重试");
  }
  return out;
}

function toDataUrl(u: VisionUpload): string {
  return `data:${u.mimetype};base64,${u.buf.toString("base64")}`;
}

export interface KeepaValidateResult {
  asin: string;
  verdict: KeepaEvaluation["verdict"];
  reasons: Array<{ code: string; detail: string }>;
  metrics: KeepaEvaluation["metrics"];
}

export function registerKeepaRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { prisma } = deps;
  const fetchKeepaImpl = deps.fetchKeepaImpl ?? fetchKeepaProduct;
  const visionImpl = deps.visionImpl ?? chatJsonVision;

  return (async () => {
  // multipart 已在 routes/index.ts 统一注册一次（重复注册会导致启动崩溃）。
  // 上传大小由 readVisionUploads 内部流式校验（VISION_MAX_BYTES），不依赖插件层 limits。

  /** Keepa API Key 是否已配置（只返回布尔值）。 */
  app.get("/api/v1/keepa/status", async (request) => {
    await requireSession(deps, request);
    const apiKey = await readKeepaApiKey(prisma);
    return { hasKey: !!apiKey };
  });

  app.post<{
    Body: { asins?: unknown; domain?: unknown; country?: unknown };
  }>("/api/v1/keepa/validate", async (request) => {
    const session = await requireSession(deps, request);

    const ok = await checkRateLimit(deps.redis, session.tenantId);
    if (!ok) {
      throw new AppError("Keepa 验证频率超限（10 次/分钟），请稍后再试", {
        statusCode: 429,
      });
    }

    const apiKey = await readKeepaApiKey(prisma);
    if (!apiKey) {
      throw new ValidationError(
        "未配置 Keepa API Key。请前往 管理 → AI 设置 → Keepa API Key 配置（keepa.com 申请付费 key）"
      );
    }

    const rawAsins = (request.body ?? {}).asins;
    if (!Array.isArray(rawAsins) || rawAsins.length === 0 || rawAsins.length > 20) {
      throw new ValidationError("asins 必须为 1–20 个 ASIN 数组");
    }
    const asins: string[] = [];
    for (const a of rawAsins) {
      if (typeof a !== "string" || !ASIN_RE.test(a.trim())) {
        throw new ValidationError(`ASIN 格式非法：${String(a).slice(0, 20)}`);
      }
      const norm = a.trim().toUpperCase();
      if (!asins.includes(norm)) asins.push(norm);
    }

    const body = request.body ?? {};
    let domain = 1;
    if (typeof body.domain === "number" && Number.isInteger(body.domain) && body.domain > 0) {
      domain = body.domain;
    } else if (typeof body.country === "string" && body.country.trim()) {
      domain = keepaDomainId(body.country.trim());
    }

    // 串行请求：Keepa token 按次消耗，避免并发烧 token。
    const results: KeepaValidateResult[] = [];
    for (const asin of asins) {
      const fetched = await fetchKeepaImpl(apiKey, asin, domain);
      if (fetched.error === "invalid_key") {
        throw new ValidationError(
          "Keepa API Key 无效（401/403），请检查 管理 → AI 设置 中的 Keepa API Key"
        );
      }
      const mappedError: "rate_limited" | "tokens_exhausted" | "no_data" | "fetch_failed" | null =
        fetched.error === "rate_limited"
          ? "rate_limited"
          : fetched.error === "tokens_exhausted"
            ? "tokens_exhausted"
            : fetched.error === "no_data"
              ? "no_data"
              : fetched.error === "network"
                ? "fetch_failed"
                : null;
      const ev = evaluateKeepa(
        fetched.product ? fetched.product.csv : null,
        fetched.product ? null : mappedError
      );
      results.push({
        asin,
        verdict: ev.verdict,
        reasons: ev.reasons,
        metrics: ev.metrics,
      });
      // token 见底就停，不再烧后面的请求
      if (fetched.error === "tokens_exhausted") break;
    }

    return { results };
  });

  /** Vision LLM 是否可用（只返回布尔值，供前端禁用"AI 看图"按钮）。 */
  app.get("/api/v1/keepa/vision-status", async (request) => {
    await requireSession(deps, request);
    const llm = await readLlmConfig(prisma);
    return { llmConfigured: !!llm };
  });

  /**
   * 手动输入数字判定（"AI 看图"弹窗的手动模式）。
   * body：价格组/排名组/评论组数字（reviews90dAgo 可选）。纯计算，无外部调用。
   * 非法输入 → 400；同一 tenant 10 次/分钟限流。
   */
  app.post<{ Body: Record<string, unknown> }>(
    "/api/v1/keepa/manual-judge",
    async (request) => {
      const session = await requireSession(deps, request);

      const allowed = await checkRateLimit(deps.redis, session.tenantId);
      if (!allowed) {
        throw new AppError("手动判断频率超限（10 次/分钟），请稍后再试", {
          code: "RATE_LIMITED",
          statusCode: 429,
        });
      }

      const input = parseManualNumbers(request.body ?? {});
      return evaluateManualNumbers(input);
    }
  );

  /**
   * Keepa 截图 AI 看图判断。
   * multipart：price（价格历史截图）、rank（排名截图）、asin（可选），
   * 每图 ≤5MB、仅 jpeg/png/webp。图片只在内存处理，不落盘、不存库。
   * 无 LLM 配置 → 400；模型不支持 vision → 400 明确指引；其他失败不抛 500。
   */
  app.post("/api/v1/keepa/vision-judge", async (request) => {
    const session = await requireSession(deps, request);

    const allowed = await checkRateLimit(deps.redis, session.tenantId);
    if (!allowed) {
      throw new AppError("AI 看图频率超限（10 次/分钟），请稍后再试", {
        code: "RATE_LIMITED",
        statusCode: 429,
      });
    }

    const llm = await readLlmConfig(prisma);
    if (!llm) {
      throw new ValidationError(
        "未配置 LLM（管理 → AI 设置），无法使用 AI 看图"
      );
    }

    const uploads = await readVisionUploads(request);
    const images: KeepaVisionImage[] = [];
    if (uploads.price) images.push({ kind: "price", dataUrl: toDataUrl(uploads.price) });
    if (uploads.rank) images.push({ kind: "rank", dataUrl: toDataUrl(uploads.rank) });
    if (images.length === 0) {
      throw new ValidationError("请至少上传一张截图（价格历史或排名）");
    }

    try {
      const judgment = await judgeKeepaScreenshots(
        images,
        llm,
        uploads.asin ? { asin: uploads.asin, impl: visionImpl } : { impl: visionImpl }
      );
      return { asin: uploads.asin || null, ...judgment };
    } catch (e) {
      if (e instanceof AiError && isVisionUnsupportedError(e)) {
        throw new ValidationError(
          "当前模型不支持图片识别，请更换支持 vision 的模型（管理 → AI 设置）"
        );
      }
      throw e;
    }
  });
  })();
}
