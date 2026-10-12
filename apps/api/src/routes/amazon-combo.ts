/**
 * 组合测试 API（第九批）：以测代选。
 *
 * - POST /api/v1/amazon/combo-tests
 *   body: { items: [{asin?, title, brand?, detailPageUrl?, price?, rating?, reviewCount?}]（5-10 个）,
 *           name?, testDays?（默认3）, targetClicks?（默认200） }
 *   每个品：找或建 Offer → 建 TrackingLink（ACTIVE）→ 用 builtin-listicle 模板渲染榜单 HTML，
 *   每品 CTA 指向各自的 /api/v1/t/:publicId（出站点击可分别统计）。
 *   落库 combo_test_runs。同一 tenant 10 次/分钟限流。
 * - GET /api/v1/amazon/combo-tests — 列表（带实时状态/总点击）
 * - GET /api/v1/amazon/combo-tests/:id — 详情 + 按出站点击排名 + 结论
 *
 * 方法论（一份预算、一个页面、数据排序）写在页面文案里。
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
import {
  getBuiltInTemplate,
  renderTemplate,
} from "../ai/lander-templates.js";

interface Deps {
  prisma: PrismaClient;
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

/* 限流：同一 tenant 10 次/分钟（Redis；不可用时 fail-open） */
async function checkRateLimit(
  _deps: Deps,
  tenantId: string
): Promise<void> {
  const redis = getSharedRedis();
  if (!redis) return;
  const key = `ratelimit:combo-test:${tenantId}`;
  try {
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 60);
    if (n > 10) {
      throw new AppError("操作太频繁，请稍后再试", { statusCode: 429 });
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    // Redis 不可用 → fail-open
  }
}

export interface ComboItemInput {
  asin?: string;
  title: string;
  brand?: string;
  detailPageUrl?: string;
  price?: number | null;
  rating?: number | null;
  reviewCount?: number | null;
}

export interface ComboTestItem extends ComboItemInput {
  offerId: string;
  trackingLinkId: string;
  publicId: string;
  clickUrl: string;
}

function asNonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

function asFiniteNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function validateItems(raw: unknown): ComboItemInput[] {
  if (!Array.isArray(raw) || raw.length < 5 || raw.length > 10) {
    throw new ValidationError("items 需要 5-10 个产品");
  }
  return raw.map((x, i) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const title = asNonEmptyString(o.title);
    if (!title) throw new ValidationError(`items[${i}].title 必填`);
    const asinRaw = asNonEmptyString(o.asin);
    const asin = asinRaw ? asinRaw.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 32) : undefined;
    const url = asNonEmptyString(o.detailPageUrl);
    if (!asin && (!url || !/^https?:\/\//i.test(url))) {
      throw new ValidationError(`items[${i}] 需要 asin 或合法的 detailPageUrl`);
    }
    const price = asFiniteNumber(o.price);
    const rating = asFiniteNumber(o.rating);
    const reviewCount = asFiniteNumber(o.reviewCount);
    return {
      asin,
      title: title.slice(0, 300),
      brand: asNonEmptyString(o.brand)?.slice(0, 128),
      detailPageUrl: url ?? undefined,
      price: price !== null && price > 0 ? price : null,
      rating: rating !== null && rating >= 0 && rating <= 5 ? rating : null,
      reviewCount: reviewCount !== null && reviewCount >= 0 ? Math.round(reviewCount) : null,
    };
  });
}

async function generatePublicId(
  prisma: PrismaClient,
  tenantId: string
): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const publicId = `tl_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const existing = await prisma.trackingLink.findFirst({
      where: { publicId, tenantId },
      select: { id: true },
    });
    if (!existing) return publicId;
  }
  throw new ValidationError("Could not generate a unique tracking link publicId");
}

function clickBaseUrl(): string {
  const raw = (process.env.PUBLIC_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return raw;
}

function buildClickUrl(publicId: string): string {
  const base = clickBaseUrl();
  const path = `/api/v1/t/${publicId}`;
  return base ? `${base}${path}` : path;
}

/* ---------------- 排名（导出供单测） ---------------- */

export interface ComboRankRow {
  asin?: string;
  title: string;
  publicId: string;
  offerId: string;
  clicks: number;
  conversions: number;
  /** 点击份额 %（总点击为 0 时为 0） */
  sharePct: number;
  rank: number;
}

export function rankComboItems(
  items: Array<{ asin?: string; title: string; publicId: string; offerId: string; trackingLinkId: string }>,
  clicksByLink: Record<string, number>,
  conversionsByOffer: Record<string, number>
): ComboRankRow[] {
  const rows = items.map((it) => {
    const clicks = clicksByLink[it.trackingLinkId] ?? 0;
    return {
      asin: it.asin,
      title: it.title,
      publicId: it.publicId,
      offerId: it.offerId,
      clicks,
      conversions: conversionsByOffer[it.offerId] ?? 0,
      sharePct: 0,
      rank: 0,
    };
  });
  const total = rows.reduce((s, r) => s + r.clicks, 0);
  rows.sort((a, b) => b.clicks - a.clicks || b.conversions - a.conversions);
  rows.forEach((r, i) => {
    r.rank = i + 1;
    r.sharePct = total > 0 ? Math.round((r.clicks / total) * 1000) / 10 : 0;
  });
  return rows;
}

export function buildComboConclusion(
  ranking: ComboRankRow[],
  totalClicks: number,
  lang: "zh" | "en" = "zh"
): string | null {
  if (ranking.length === 0) return null;
  const top = ranking[0]!;
  if (totalClicks === 0) {
    return lang === "en"
      ? "No clicks during the test window — check your traffic source."
      : "测试期内无点击，请检查流量来源是否把用户带到了榜单页。";
  }
  return lang === "en"
    ? `"${top.title}" got the most clicks (${top.clicks}, ${top.sharePct}% share) — worth testing on its own.`
    : `“${top.title}”点击最高（${top.clicks} 次，占 ${top.sharePct}%），值得单独深入测试。`;
}

/* ---------------- 路由 ---------------- */

export function registerComboTestRoutes(
  app: FastifyInstance,
  deps: Deps
): void {
  const { prisma } = deps;

  /** POST /api/v1/amazon/combo-tests — 生成组合测试页 */
  app.post<{
    Body: {
      items?: unknown;
      name?: unknown;
      testDays?: unknown;
      targetClicks?: unknown;
    };
  }>("/api/v1/amazon/combo-tests", async (request) => {
    const info = await requireSession(deps, request);
    await checkRateLimit(deps, info.tenantId);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const items = validateItems(body.items);
    const name =
      asNonEmptyString(body.name)?.slice(0, 200) ??
      `组合测试 ${new Date().toISOString().slice(0, 10)}`;
    const testDaysRaw = asFiniteNumber(body.testDays);
    const testDays =
      testDaysRaw !== null && Number.isInteger(testDaysRaw)
        ? Math.min(30, Math.max(1, testDaysRaw))
        : 3;
    const targetRaw = asFiniteNumber(body.targetClicks);
    const targetClicks =
      targetRaw !== null && Number.isInteger(targetRaw)
        ? Math.min(10000, Math.max(10, targetRaw))
        : 200;

    // 每品：找或建 Offer → 建 TrackingLink
    const comboItems: ComboTestItem[] = [];
    for (const it of items) {
      const destinationUrl =
        it.detailPageUrl ?? `https://www.amazon.com/dp/${it.asin}`;
      let offer = (await prisma.offer.findFirst({
        where: { tenantId: info.tenantId, destinationUrl, deletedAt: null },
        select: { id: true },
      })) as { id: string } | null;
      if (!offer) {
        offer = (await prisma.offer.create({
          data: {
            id: randomUUID(),
            tenantId: info.tenantId,
            name: it.title.slice(0, 200),
            network: "Amazon",
            source: "amazon",
            destinationUrl,
            status: "ACTIVE",
          },
          select: { id: true },
        })) as { id: string };
      }
      const publicId = await generatePublicId(prisma, info.tenantId);
      const link = (await prisma.trackingLink.create({
        data: {
          id: randomUUID(),
          tenantId: info.tenantId,
          publicId,
          offerId: offer.id,
          status: "ACTIVE",
        },
        select: { id: true },
      })) as { id: string };
      comboItems.push({
        ...it,
        offerId: offer.id,
        trackingLinkId: link.id,
        publicId,
        clickUrl: buildClickUrl(publicId),
      });
    }

    // 榜单 HTML（复用 builtin-listicle 模板，cards 布局）
    const tpl = getBuiltInTemplate("builtin-listicle");
    if (!tpl) throw new AppError("榜单模板缺失", { statusCode: 500 });
    const html = renderTemplate(
      tpl.html.zh,
      {
        productName: name,
        ctaText: "查看优惠",
        products: comboItems.map((it, i) => ({
          rank: i + 1,
          name: it.title,
          blurb:
            it.rating != null
              ? `⭐ ${it.rating}${it.reviewCount != null ? `（${it.reviewCount} 条评论）` : ""}${it.brand ? ` · ${it.brand}` : ""}`
              : (it.brand ?? ""),
          price: it.price != null ? `$${it.price}` : "",
          ctaUrl: it.clickUrl,
        })),
      },
      { productsLayout: "cards" }
    );

    const row = (await prisma.comboTestRun.create({
      data: {
        id: randomUUID(),
        tenantId: info.tenantId,
        name,
        htmlContent: html,
        items: comboItems as unknown as object,
        testDays,
        targetClicks,
        status: "running",
      },
      select: { id: true, createdAt: true },
    })) as { id: string; createdAt: Date };

    return {
      runId: row.id,
      name,
      testDays,
      targetClicks,
      items: comboItems,
      htmlContent: html,
      createdAt: row.createdAt.toISOString(),
    };
  });

  /** GET /api/v1/amazon/combo-tests — 列表 */
  app.get("/api/v1/amazon/combo-tests", async (request) => {
    const info = await requireSession(deps, request);
    const rows = (await prisma.comboTestRun.findMany({
      where: { tenantId: info.tenantId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        testDays: true,
        targetClicks: true,
        status: true,
        createdAt: true,
        items: true,
      },
    })) as unknown as Array<{
      id: string;
      name: string;
      testDays: number;
      targetClicks: number;
      status: string;
      createdAt: Date;
      items: ComboTestItem[];
    }>;
    const out = [];
    for (const r of rows) {
      const totalClicks = await countRunClicks(prisma, info.tenantId, r);
      out.push({
        id: r.id,
        name: r.name,
        testDays: r.testDays,
        targetClicks: r.targetClicks,
        status: computeStatus(r, totalClicks),
        totalClicks,
        itemCount: Array.isArray(r.items) ? r.items.length : 0,
        createdAt: r.createdAt.toISOString(),
      });
    }
    return { items: out };
  });

  /** GET /api/v1/amazon/combo-tests/:id — 详情 + 排名 + 结论 */
  app.get<{
    Params: { id: string };
  }>("/api/v1/amazon/combo-tests/:id", async (request) => {
    const info = await requireSession(deps, request);
    const row = (await prisma.comboTestRun.findFirst({
      where: { id: request.params.id, tenantId: info.tenantId },
    })) as {
      id: string;
      tenantId: string;
      name: string;
      htmlContent: string | null;
      items: ComboTestItem[];
      testDays: number;
      targetClicks: number;
      status: string;
      createdAt: Date;
    } | null;
    if (!row) throw new NotFoundError("ComboTestRun", request.params.id);

    const items = Array.isArray(row.items) ? row.items : [];
    const clicksByLink: Record<string, number> = {};
    const conversionsByOffer: Record<string, number> = {};
    const since = row.createdAt;
    await Promise.all(
      items.map(async (it) => {
        const [clicks, conversions] = await Promise.all([
          prisma.click.count({
            where: {
              tenantId: info.tenantId,
              trackingLinkId: it.trackingLinkId,
              isTest: { not: true },
              createdAt: { gte: since },
            },
          }),
          prisma.conversion.count({
            where: {
              tenantId: info.tenantId,
              deletedAt: null,
              conversionTime: { gte: since },
              click: { offerId: it.offerId, isTest: { not: true } },
            },
          }),
        ]);
        clicksByLink[it.trackingLinkId] = clicks;
        conversionsByOffer[it.offerId] = conversions;
      })
    );
    const ranking = rankComboItems(items, clicksByLink, conversionsByOffer);
    const totalClicks = ranking.reduce((s, r) => s + r.clicks, 0);
    const status = computeStatus(row, totalClicks);
    if (status === "completed" && row.status !== "completed") {
      try {
        await prisma.comboTestRun.update({
          where: { id: row.id },
          data: { status: "completed" },
        });
      } catch {
        // 忽略状态回写失败
      }
    }
    const daysElapsed =
      (Date.now() - new Date(row.createdAt).getTime()) / 86400000;
    return {
      id: row.id,
      name: row.name,
      testDays: row.testDays,
      targetClicks: row.targetClicks,
      status,
      totalClicks,
      daysElapsed: Math.round(daysElapsed * 10) / 10,
      ranking,
      conclusion: status === "completed" ? buildComboConclusion(ranking, totalClicks) : null,
      htmlContent: row.htmlContent,
      createdAt: new Date(row.createdAt).toISOString(),
    };
  });
}

async function countRunClicks(
  prisma: PrismaClient,
  tenantId: string,
  row: { items: ComboTestItem[]; createdAt: Date }
): Promise<number> {
  const items = Array.isArray(row.items) ? row.items : [];
  if (items.length === 0) return 0;
  return (await prisma.click.count({
    where: {
      tenantId,
      trackingLinkId: { in: items.map((i) => i.trackingLinkId) },
      isTest: { not: true },
      createdAt: { gte: row.createdAt },
    },
  })) as number;
}

function computeStatus(
  row: { createdAt: Date | string; testDays: number; targetClicks: number },
  totalClicks: number
): "running" | "completed" {
  const daysElapsed =
    (Date.now() - new Date(row.createdAt).getTime()) / 86400000;
  if (daysElapsed >= row.testDays || totalClicks >= row.targetClicks) {
    return "completed";
  }
  return "running";
}
