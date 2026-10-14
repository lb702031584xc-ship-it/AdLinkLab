/**
 * 工作台状态持久化：AI 分析 worksheet / 投放选词 / 需求验证 的自动保存快照。
 * 解决刷新、隔夜后分析进度丢失、无历史记录的问题。
 *
 * - PUT /api/v1/work-state        保存（同一租户+页面+offer 只保留最新一条）
 * - GET /api/v1/work-state        读取最新快照
 * - GET /api/v1/work-state/history 历史列表（label + updatedAt）
 *
 * 全部租户隔离（session auth）。
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";

export interface WorkStateRouteDeps {
  prisma: PrismaClient;
}

/** 允许自动保存的页面 key（白名单，防止 state 表被滥用）。需与 web 端 WorkStatePage 保持一致。 */
const ALLOWED_PAGES = [
  "ai-worksheet",
  "keyword-launch",
  "keyword-research",
  "traffic-planner",
  "ai-terms",
  "ai-compliance",
  "ai-blueprint",
  "ads-auto",
] as const;
type WorkStatePage = (typeof ALLOWED_PAGES)[number];

/** 快照 JSON 上限 200KB：防止误传超大 state。 */
const MAX_STATE_BYTES = 200 * 1024;

async function requireSession(
  deps: WorkStateRouteDeps,
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

function parsePage(v: unknown): WorkStatePage {
  if (typeof v === "string" && (ALLOWED_PAGES as readonly string[]).includes(v)) {
    return v as WorkStatePage;
  }
  throw new ValidationError(`page must be one of: ${ALLOWED_PAGES.join(", ")}`);
}

function parseOfferId(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v !== "string" || !/^[0-9a-f-]{36}$/i.test(v)) {
    throw new ValidationError("offerId must be a UUID");
  }
  return v;
}

function parseLabel(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== "string") throw new ValidationError("label must be a string");
  const t = v.trim().slice(0, 120);
  return t || null;
}

export async function registerWorkStateRoutes(
  app: FastifyInstance,
  deps: WorkStateRouteDeps
) {
  const prisma = deps.prisma;

  /** 保存快照（upsert）。 */
  app.put("/api/v1/work-state", async (request) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as {
      page?: unknown;
      offerId?: unknown;
      label?: unknown;
      state?: unknown;
    };
    const page = parsePage(body.page);
    const offerId = parseOfferId(body.offerId);
    const label = parseLabel(body.label);
    const state = body.state;
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      throw new ValidationError("state must be a JSON object");
    }
    const bytes = Buffer.byteLength(JSON.stringify(state), "utf8");
    if (bytes > MAX_STATE_BYTES) {
      throw new ValidationError("state too large (max 200KB)");
    }

    const where = { tenantId: info.tenantId, page, offerId };
    const existing = await prisma.workState.findFirst({
      where,
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    let row;
    if (existing) {
      row = await prisma.workState.update({
        where: { id: existing.id },
        data: { label, state: state as object, updatedAt: new Date() },
        select: { id: true, updatedAt: true },
      });
    } else {
      row = await prisma.workState.create({
        data: {
          id: randomUUID(),
          tenantId: info.tenantId,
          page,
          offerId,
          label,
          state: state as object,
        },
        select: { id: true, updatedAt: true },
      });
    }
    return { id: row.id, updatedAt: row.updatedAt.toISOString() };
  });

  /** 读取最新快照。 */
  app.get("/api/v1/work-state", async (request) => {
    const info = await requireSession(deps, request);
    const query = (request.query ?? {}) as { page?: unknown; offerId?: unknown };
    const page = parsePage(query.page);
    const offerId = parseOfferId(query.offerId);
    const row = await prisma.workState.findFirst({
      where: { tenantId: info.tenantId, page, offerId },
      orderBy: { updatedAt: "desc" },
    });
    if (!row) return { state: null };
    return {
      state: row.state,
      label: row.label,
      updatedAt:
        row.updatedAt instanceof Date
          ? row.updatedAt.toISOString()
          : String(row.updatedAt),
    };
  });

  /** 历史列表（不返回 state 全量，只给 label + 时间）。 */
  app.get("/api/v1/work-state/history", async (request) => {
    const info = await requireSession(deps, request);
    const query = (request.query ?? {}) as {
      page?: unknown;
      offerId?: unknown;
      limit?: unknown;
    };
    const page = parsePage(query.page);
    const offerId = query.offerId != null ? parseOfferId(query.offerId) : undefined;
    const limitRaw = Number(query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20;
    const rows = await prisma.workState.findMany({
      where: {
        tenantId: info.tenantId,
        page,
        ...(offerId !== undefined ? { offerId } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { id: true, offerId: true, label: true, updatedAt: true },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        offerId: r.offerId,
        label: r.label,
        updatedAt:
          r.updatedAt instanceof Date
            ? r.updatedAt.toISOString()
            : String(r.updatedAt),
      })),
    };
  });
}
