/**
 * P1-21：死信队列（DLQ）API。
 *
 * - GET /api/v1/jobs/dead-letter?status=queued — DLQ 列表（租户隔离）。
 * - POST /api/v1/jobs/dead-letter/:id/retry — 标记为 queued 待下一次
 *   定时调度重试（traffic-monitor / dead-link 均为可重复定时任务，
 *   下一次调度会重新执行；不做立即重入队，避免与调度器竞态）。
 * - POST /api/v1/jobs/dead-letter/:id/discard — 标记 discarded + resolvedAt。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import { authenticateSessionRequest, type SessionAuthInfo } from "../auth/sessions.js";

export interface DeadLetterDeps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: DeadLetterDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) throw new UnauthorizedError("Authentication required");
  return info;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function registerDeadLetterRoutes(
  app: FastifyInstance,
  deps: DeadLetterDeps
): Promise<void> {
  const { prisma } = deps;

  app.get<{
    Querystring: { status?: string; page?: string; pageSize?: string };
  }>("/api/v1/jobs/dead-letter", async (request) => {
    const info = await requireSession(deps, request);
    const page = Math.max(1, Number(request.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(request.query.pageSize) || 20));
    const where: Record<string, unknown> = { tenantId: info.tenantId };
    if (request.query.status) where.status = request.query.status;
    const [items, total] = await Promise.all([
      prisma.deadLetterJob.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.deadLetterJob.count({ where }),
    ]);
    return { items, total, page, pageSize };
  });

  app.post<{
    Params: { id: string };
  }>("/api/v1/jobs/dead-letter/:id/retry", async (request) => {
    const info = await requireSession(deps, request);
    if (!UUID_RE.test(request.params.id)) throw new ValidationError("id must be a UUID");
    const row = await prisma.deadLetterJob.findFirst({
      where: { id: request.params.id, tenantId: info.tenantId },
    });
    if (!row) throw new NotFoundError("DeadLetterJob", request.params.id);
    const updated = await prisma.deadLetterJob.update({
      where: { id: row.id },
      data: { status: "queued", retryCount: row.retryCount + 1, resolvedAt: null },
    });
    return {
      ...updated,
      note: "已标记为待重试：下一次定时调度会重新执行该任务（非立即重入队）。",
    };
  });

  app.post<{
    Params: { id: string };
  }>("/api/v1/jobs/dead-letter/:id/discard", async (request) => {
    const info = await requireSession(deps, request);
    if (!UUID_RE.test(request.params.id)) throw new ValidationError("id must be a UUID");
    const row = await prisma.deadLetterJob.findFirst({
      where: { id: request.params.id, tenantId: info.tenantId },
    });
    if (!row) throw new NotFoundError("DeadLetterJob", request.params.id);
    return prisma.deadLetterJob.update({
      where: { id: row.id },
      data: { status: "discarded", resolvedAt: new Date() },
    });
  });
}
