/**
 * 创意管理库（租户自有 RSA 文案资产）。
 *
 * GET    /api/v1/creatives?status=&offerId=&q=&page=&pageSize=
 * POST   /api/v1/creatives                     { title, description, finalUrl?, angle?, offerId?, source? }
 * PUT    /api/v1/creatives/:id                 { title?, description?, finalUrl?, angle?, offerId?, status? }
 * DELETE /api/v1/creatives/:id                 （软删 deletedAt）
 * POST   /api/v1/creatives/import-archive      { archiveId? } — 从投放档案 adCopy 导入为草稿（去重）
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { AppError, NotFoundError } from "@adlinklab/shared";
import { requireSession } from "./auth.js";

export interface CreativesRouteDeps {
  prisma: PrismaClient;
}

const STATUSES = ["DRAFT", "USED", "ARCHIVED"] as const;
const SOURCES = ["MANUAL", "AI", "ARCHIVE"] as const;

function badRequest(message: string): AppError {
  return new AppError(message, { code: "VALIDATION_ERROR", statusCode: 400 });
}

function asTrimmed(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

/** Exported for tests. */
export function parseCreativeBody(body: Record<string, unknown>, partial: boolean) {
  const out: {
    title?: string;
    description?: string;
    finalUrl?: string | null;
    angle?: string | null;
    offerId?: string | null;
    status?: string;
    source?: string;
  } = {};
  const title = asTrimmed(body.title);
  const description = asTrimmed(body.description);
  if (!partial || title !== undefined) {
    if (!title || title.length > 200) throw badRequest("title is required (max 200 chars)");
    out.title = title;
  }
  if (!partial || description !== undefined) {
    if (!description || description.length > 500)
      throw badRequest("description is required (max 500 chars)");
    out.description = description;
  }
  if (body.finalUrl !== undefined) {
    const u = asTrimmed(body.finalUrl);
    if (u && (!/^https?:\/\//i.test(u) || u.length > 2000))
      throw badRequest("finalUrl must be an http(s) URL");
    out.finalUrl = u ?? null;
  }
  if (body.angle !== undefined) out.angle = asTrimmed(body.angle) ?? null;
  if (body.offerId !== undefined) out.offerId = asTrimmed(body.offerId) ?? null;
  if (body.status !== undefined) {
    if (!(STATUSES as readonly string[]).includes(body.status as string))
      throw badRequest("status must be DRAFT, USED or ARCHIVED");
    out.status = body.status as string;
  }
  if (body.source !== undefined) {
    if (!(SOURCES as readonly string[]).includes(body.source as string))
      throw badRequest("source must be MANUAL, AI or ARCHIVE");
    out.source = body.source as string;
  }
  return out;
}

type CreativeRow = {
  id: string;
  tenantId: string;
  offerId: string | null;
  title: string;
  description: string;
  finalUrl: string | null;
  angle: string | null;
  status: string;
  source: string;
  createdAt: Date;
  updatedAt: Date;
  offer?: { name: string } | null;
};

export function serializeCreative(row: CreativeRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    offerId: row.offerId,
    offerName: row.offer?.name ?? null,
    title: row.title,
    description: row.description,
    finalUrl: row.finalUrl,
    angle: row.angle,
    status: row.status,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function registerCreativesRoutes(
  app: FastifyInstance,
  deps: CreativesRouteDeps
): Promise<void> {
  const { prisma } = deps;

  app.get("/api/v1/creatives", async (request) => {
    const info = await requireSession(deps, request);
    const q = request.query as Record<string, unknown>;
    const page = Math.max(1, Number(q.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 50) || 50));
    const where: Record<string, unknown> = {
      tenantId: info.tenantId,
      deletedAt: null,
    };
    if (typeof q.status === "string" && (STATUSES as readonly string[]).includes(q.status))
      where.status = q.status;
    if (typeof q.offerId === "string" && q.offerId.trim()) where.offerId = q.offerId.trim();
    const search = asTrimmed(q.q);
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { angle: { contains: search, mode: "insensitive" } },
      ];
    }
    const [items, total] = await Promise.all([
      prisma.creative.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { offer: { select: { name: true } } },
      }),
      prisma.creative.count({ where }),
    ]);
    return { items: (items as CreativeRow[]).map(serializeCreative), total, page, pageSize };
  });

  app.post("/api/v1/creatives", async (request) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const data = parseCreativeBody(body, false);
    if (data.offerId) {
      const offer = await prisma.offer.findFirst({
        where: { id: data.offerId, tenantId: info.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!offer) throw new NotFoundError("Offer", data.offerId);
    }
    const row = await prisma.creative.create({
      data: {
        id: randomUUID(),
        tenantId: info.tenantId,
        offerId: data.offerId ?? null,
        title: data.title as string,
        description: data.description as string,
        finalUrl: data.finalUrl ?? null,
        angle: data.angle ?? null,
        status: (data.status ?? "DRAFT") as never,
        source: (data.source ?? "MANUAL") as never,
      },
      include: { offer: { select: { name: true } } },
    });
    return { creative: serializeCreative(row as CreativeRow) };
  });

  app.put("/api/v1/creatives/:id", async (request) => {
    const info = await requireSession(deps, request);
    const { id } = request.params as { id: string };
    const existing = await prisma.creative.findFirst({
      where: { id, tenantId: info.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError("Creative", id);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const data = parseCreativeBody(body, true);
    const row = await prisma.creative.update({
      where: { id },
      data: data as never,
      include: { offer: { select: { name: true } } },
    });
    return { creative: serializeCreative(row as CreativeRow) };
  });

  app.delete("/api/v1/creatives/:id", async (request) => {
    const info = await requireSession(deps, request);
    const { id } = request.params as { id: string };
    const existing = await prisma.creative.findFirst({
      where: { id, tenantId: info.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError("Creative", id);
    await prisma.creative.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  });

  /**
   * 从投放档案导入 RSA 文案：取租户的 launch archives 的 adCopy
   * （{ headlines, descriptions }），标题×描述组合成草稿创意。
   * 去重口径：同租户 + 同 offerId + 同标题 + 同描述（未删除）已存在则跳过。
   */
  app.post("/api/v1/creatives/import-archive", async (request) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as { archiveId?: unknown };
    const archiveId = asTrimmed(body.archiveId);
    const archives = await prisma.launchArchive.findMany({
      where: {
        tenantId: info.tenantId,
        ...(archiveId ? { id: archiveId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: archiveId ? 1 : 200,
      select: { id: true, offerId: true, offerName: true, adCopy: true },
    });
    let created = 0;
    let skipped = 0;
    for (const a of archives) {
      const adCopy = (a.adCopy ?? {}) as {
        headlines?: unknown;
        descriptions?: unknown;
      };
      const headlines = Array.isArray(adCopy.headlines)
        ? adCopy.headlines.filter((h): h is string => typeof h === "string" && h.trim() !== "")
        : [];
      const descriptions = Array.isArray(adCopy.descriptions)
        ? adCopy.descriptions.filter(
            (d): d is string => typeof d === "string" && d.trim() !== ""
          )
        : [];
      // RSA 组合：标题与描述一一配对（按较短的一方截断，避免笛卡尔爆炸）。
      const pairs = Math.min(headlines.length, descriptions.length);
      for (let i = 0; i < pairs; i++) {
        const title = (headlines[i] as string).trim().slice(0, 200);
        const description = (descriptions[i] as string).trim().slice(0, 500);
        const dup = await prisma.creative.findFirst({
          where: {
            tenantId: info.tenantId,
            offerId: a.offerId ?? null,
            title,
            description,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (dup) {
          skipped += 1;
          continue;
        }
        await prisma.creative.create({
          data: {
            id: randomUUID(),
            tenantId: info.tenantId,
            offerId: a.offerId ?? null,
            title,
            description,
            status: "DRAFT" as never,
            source: "ARCHIVE" as never,
          },
        });
        created += 1;
      }
    }
    return { created, skipped, archives: archives.length };
  });
}
