/**
 * Offer 最终链接指标抓取 + 推荐指数（第三批）。
 *
 * - POST /api/v1/offers/:id/fetch-metrics
 *   抓取该 Offer 最终落地页（destinationUrl，跟随跳转后的最终 URL）的真实指标，
 *   算出 0-100 推荐指数，落库 offer_metrics（upsert），返回 metrics + score。
 *   同一 tenant 10 次/分钟限流（Redis；不可用时 fail-open）。
 *   抓取失败绝不抛 500：失败信息记在 metrics.failures 里，score 为 null。
 *
 * - 列表/详情附带：在 routes/index.ts 的 offers list/detail 处理器里
 *   用 attachMetricsSummaries() 追加 metricsSummary { score, grade, fetchedAt }。
 */
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import { scrapeOfferMetrics, type OfferMetrics } from "../offer-metrics/scrape.js";
import { scoreOfferMetrics } from "../offer-metrics/score.js";
import { ocrImageMetrics } from "../offer-metrics/ocr.js";

interface Deps {
  prisma: PrismaClient;
  /** 注入式 Redis（测试用）；生产缺省时按需懒建共享连接。 */
  redis?: RateLimitRedis;
  /** Injectable for tests. */
  scrapeImpl?: typeof scrapeOfferMetrics;
  /** Injectable for tests. */
  ocrImpl?: typeof ocrImageMetrics;
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

/** OCR 上传上限：8MB。 */
const OCR_MAX_BYTES = 8 * 1024 * 1024;

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
    const key = `offer-metrics:ratelimit:${tenantId}:${minuteStamp()}`;
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
    return true; // fail-open
  }
}

/* ------------------------------------------------------------------ */
/* 列表/详情附带 metricsSummary                                          */
/* ------------------------------------------------------------------ */

export interface MetricsSummary {
  score: number | null;
  grade: string | null;
  fetchedAt: string;
}

/**
 * 给 Offer 列表项追加 metricsSummary（无数据时为 null）。
 * 批量一次查询，不产生 N+1。
 */
export async function attachMetricsSummaries<T extends { id: string }>(
  prisma: PrismaClient,
  tenantId: string,
  items: T[]
): Promise<Array<T & { metricsSummary: MetricsSummary | null }>> {
  if (items.length === 0) return [];
  const rows = await prisma.offerMetrics.findMany({
    where: { tenantId, offerId: { in: items.map((i) => i.id) } },
    select: { offerId: true, score: true, grade: true, fetchedAt: true },
  });
  const byOffer = new Map(
    rows.map((r) => [
      r.offerId,
      {
        score: r.score,
        grade: r.grade,
        fetchedAt: r.fetchedAt.toISOString(),
      } as MetricsSummary,
    ])
  );
  return items.map((i) => ({ ...i, metricsSummary: byOffer.get(i.id) ?? null }));
}

/* ------------------------------------------------------------------ */
/* 路由注册                                                             */
/* ------------------------------------------------------------------ */

export async function registerOfferMetricsRoutes(
  app: FastifyInstance,
  deps: Deps
): Promise<void> {
  const { prisma } = deps;

  // multipart 已在 routes/index.ts 统一注册一次（重复注册会导致启动崩溃）。
  // 上传大小由本 handler 内部流式校验（OCR_MAX_BYTES），不依赖插件层 limits。

  app.post<{
    Params: { id: string };
  }>("/api/v1/offers/:id/fetch-metrics", async (request) => {
    const info = await requireSession(deps, request);

    const allowed = await checkRateLimit(deps.redis, info.tenantId);
    if (!allowed) {
      throw new AppError("指标抓取频率超限（10 次/分钟），请稍后再试", {
        code: "RATE_LIMITED",
        statusCode: 429,
      });
    }

    const offer = await prisma.offer.findFirst({
      where: { id: request.params.id, tenantId: info.tenantId },
      select: { id: true, destinationUrl: true },
    });
    if (!offer) {
      throw new NotFoundError("Offer", request.params.id);
    }

    // 抓取永不抛错：失败信息记在 metrics.failures 里。
    const scrape = deps.scrapeImpl ?? scrapeOfferMetrics;
    const metrics: OfferMetrics = await scrape(offer.destinationUrl);
    const scored = scoreOfferMetrics(metrics);

    const fetchedAt = new Date(metrics.fetchedAt);
    const row = await prisma.offerMetrics.upsert({
      where: { offerId: offer.id },
      create: {
        id: randomUUID(),
        offerId: offer.id,
        tenantId: info.tenantId,
        metrics: metrics as unknown as object,
        score: scored.score,
        grade: scored.grade,
        fetchedAt,
      },
      update: {
        metrics: metrics as unknown as object,
        score: scored.score,
        grade: scored.grade,
        fetchedAt,
      },
      select: { score: true, grade: true, fetchedAt: true },
    });

    return {
      offerId: offer.id,
      metrics,
      score: scored.score,
      grade: scored.grade,
      breakdown: scored.breakdown,
      metricsSummary: {
        score: row.score,
        grade: row.grade,
        fetchedAt: row.fetchedAt.toISOString(),
      } satisfies MetricsSummary,
    };
  });

  /**
   * 截图 OCR 识别指标（第四批）。
   * multipart 单图，≤8MB；非图片直接 400。
   * 图片只在内存里处理，不落盘、不存库。
   * 识别失败 → 422 + 明确文案（OcrError），绝不 500。
   * 与 fetch-metrics 共用同一 tenant 限流（10 次/分钟）。
   */
  app.post("/api/v1/offer-metrics/ocr", async (request) => {
    const info = await requireSession(deps, request);

    const allowed = await checkRateLimit(deps.redis, info.tenantId);
    if (!allowed) {
      throw new AppError("截图识别频率超限（10 次/分钟），请稍后再试", {
        code: "RATE_LIMITED",
        statusCode: 429,
      });
    }

    let part: Awaited<ReturnType<FastifyRequest["file"]>>;
    try {
      part = await request.file();
    } catch {
      throw new ValidationError("请上传一张截图（multipart/form-data，字段名任意）");
    }
    if (!part) {
      throw new ValidationError("请上传一张截图");
    }
    const mimetype = part.mimetype ?? "";
    if (!mimetype.startsWith("image/")) {
      throw new ValidationError(`只接受图片文件，收到：${mimetype || "未知类型"}`);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of part.file) {
      size += (chunk as Buffer).length;
      if (size > OCR_MAX_BYTES) {
        throw new ValidationError("图片超过 8MB 上限");
      }
      chunks.push(chunk as Buffer);
    }
    const buf = Buffer.concat(chunks);
    if (buf.length === 0) {
      throw new ValidationError("图片为空，无法识别");
    }

    const ocr = deps.ocrImpl ?? ocrImageMetrics;
    return await ocr(buf);
  });
}
