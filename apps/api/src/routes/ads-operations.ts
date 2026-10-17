/**
 * P1-16：批量审计 + 回滚。
 *
 * - GET /api/v1/ads/operations — 批量审计日志（BULK_CREATE_BEFORE /
 *   BULK_CREATE_AFTER / BULK_CREATE_ROLLBACK_*），租户隔离。
 * - POST /api/v1/ads/operations/rollback { auditLogId } — 人工确认后回滚：
 *   审计记录必须是本租户的 BEFORE/AFTER 记录。回滚语义诚实说明：
 *   · 若 Script 任务尚未执行（syncState=NEVER_APPLIED），删除待执行任务，
 *     阻止它继续运行 → 记 BULK_CREATE_ROLLBACK_APPLIED；
 *   · 若任务已执行，系统不存储已创建的 Google campaign ID，无法自动
 *     删除未知实体 → 记 BULK_CREATE_ROLLBACK_REQUESTED 并返回人工逆向
 *     任务清单（按系列名在 Google Ads 中手动暂停/删除），绝不假装已删除。
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import { authenticateSessionRequest, type SessionAuthInfo } from "../auth/sessions.js";

export interface AdsOperationsDeps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: AdsOperationsDeps,
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

const BULK_ACTIONS = [
  "BULK_CREATE_BEFORE",
  "BULK_CREATE_AFTER",
  "BULK_CREATE_ROLLBACK_REQUESTED",
  "BULK_CREATE_ROLLBACK_APPLIED",
];

export async function registerAdsOperationsRoutes(
  app: FastifyInstance,
  deps: AdsOperationsDeps
): Promise<void> {
  const { prisma } = deps;

  app.get<{
    Querystring: { page?: string; pageSize?: string };
  }>("/api/v1/ads/operations", async (request) => {
    const info = await requireSession(deps, request);
    const page = Math.max(1, Number(request.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(request.query.pageSize) || 20));
    const where = { tenantId: info.tenantId, action: { in: BULK_ACTIONS } };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.auditLog.count({ where }),
    ]);
    return { items, total, page, pageSize };
  });

  app.post<{
    Body: { auditLogId?: unknown; confirm?: unknown };
  }>("/api/v1/ads/operations/rollback", async (request) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const auditLogId = typeof body.auditLogId === "string" ? body.auditLogId : "";
    if (!auditLogId || !UUID_RE.test(auditLogId)) {
      throw new ValidationError("auditLogId must be a UUID");
    }
    // 显性人工确认（前端复选框），防止误点回滚。
    if (body.confirm !== true) {
      throw new ValidationError("rollback requires confirm: true");
    }
    const record = await prisma.auditLog.findFirst({
      where: { id: auditLogId, tenantId: info.tenantId },
    });
    if (!record) throw new NotFoundError("AuditLog", auditLogId);
    if (!BULK_ACTIONS.includes(record.action)) {
      throw new ValidationError("auditLogId must reference a BULK_CREATE audit record");
    }
    const after = (record.after ?? {}) as Record<string, unknown>;
    const planId =
      (typeof after.planId === "string" && after.planId) ||
      (record.action === "BULK_CREATE_BEFORE" && record.entityType === "AdPlan"
        ? record.entityId
        : null);

    // 找到配对的 AFTER 记录（拿到 targetId / campaignName）。
    let campaignName: string | null = null;
    let target: { id: string; syncState: string } | null = null;
    if (planId) {
      // 在配对记录中按 planId 精确匹配（after.planId），不取最近一条。
      const candidates = await prisma.auditLog.findMany({
        where: {
          tenantId: info.tenantId,
          action: "BULK_CREATE_AFTER",
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      const paired = candidates.find(
        (c) => (c.after as Record<string, unknown> | null)?.planId === planId
      );
      if (paired) {
        campaignName =
          typeof (paired.after as Record<string, unknown>).campaignName === "string"
            ? ((paired.after as Record<string, unknown>).campaignName as string)
            : null;
        // entityId 理论上是 target id；类型为 string|null 时先收窄，null 则不查（走人工逆向路径）。
        target =
          typeof paired.entityId === "string"
            ? await prisma.scriptSyncTarget.findFirst({
                where: { id: paired.entityId, tenantId: info.tenantId },
                select: { id: true, syncState: true },
              })
            : null;
      }
    }

    const manualSteps = [
      campaignName
        ? `在 Google Ads 中找到系列 "${campaignName}"，手动暂停（Pause）或删除。`
        : "在 Google Ads 中按系列名找到本次创建的系列，手动暂停或删除。",
      "已创建的 Google campaign ID 未由系统存储，请按系列名核对，不要批量删除其他系列。",
      "如 Script 任务尚未执行，本次回滚已删除待执行任务；已执行的任务无法自动撤回。",
    ];

    if (target && target.syncState === "NEVER_APPLIED") {
      await prisma.scriptSyncTarget.delete({ where: { id: target.id } });
      await prisma.auditLog.create({
        data: {
          id: randomUUID(),
          tenantId: info.tenantId,
          actorId: info.id,
          action: "BULK_CREATE_ROLLBACK_APPLIED",
          entityType: "ScriptSyncTarget",
          entityId: target.id,
          before: { auditLogId, planId },
          after: { pendingTargetDeleted: true, campaignName },
          reason: "P1-16: rollback applied — pending Script task deleted before execution",
        },
      });
      return {
        applied: true,
        pendingTargetDeleted: true,
        campaignName,
        manualSteps,
      };
    }

    await prisma.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId: info.tenantId,
        actorId: info.id,
        action: "BULK_CREATE_ROLLBACK_REQUESTED",
        entityType: "AuditLog",
        entityId: auditLogId,
        before: { auditLogId, planId },
        after: { campaignName, manualSteps },
        reason: "P1-16: rollback requested — task already applied or no pending task; manual inverse steps returned",
      },
    });
    return { applied: false, pendingTargetDeleted: false, campaignName, manualSteps };
  });
}
