/**
 * §5 — 管理员授权 API：申请 / 我的申请 / 管理员列表 / 审批 / 拒绝 / 吊销 / 审计。
 * 默认关闭：普通用户只有申请入口，没有启用按钮；审批需 owner/admin 且 ≠ 申请人。
 */
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { ForbiddenError, ValidationError } from "@adlinklab/shared";
import { requireSession } from "./auth.js";
import { canApprove } from "../auth/rbac.js";
import {
  applyForGrant,
  approveGrant,
  rejectGrant,
  revokeGrant,
  GRANT_MAX_DAYS,
  GRANT_MIN_DAYS,
} from "../services/admin-grants.js";

function parsePagination(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export async function registerAdminGrantRoutes(
  app: FastifyInstance,
  deps: { prisma: PrismaClient }
): Promise<void> {
  const { prisma } = deps;

  // 申请授权（任何已登录用户；仅申请）。
  app.post("/api/v1/admin/grants/apply", async (request) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const appRow = await applyForGrant(prisma, {
      tenantId: info.tenantId,
      applicantId: info.id,
      capability: body.capability,
      purpose: body.purpose,
      whitelist: body.whitelist,
      evidence: body.evidence,
      requestedDays: body.requestedDays,
      usageLimit: body.usageLimit,
    });
    return { application: appRow };
  });

  // 我的申请。
  app.get("/api/v1/admin/grants/applications/mine", async (request) => {
    const info = await requireSession(deps, request);
    const { page, pageSize, skip } = parsePagination(
      (request.query ?? {}) as Record<string, unknown>
    );
    const [items, total] = await Promise.all([
      prisma.adminGrantApplication.findMany({
        where: { tenantId: info.tenantId, applicantId: info.id },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.adminGrantApplication.count({
        where: { tenantId: info.tenantId, applicantId: info.id },
      }),
    ]);
    return { items, total, page, pageSize };
  });

  // 管理员：全部申请。
  app.get("/api/v1/admin/grants/applications", async (request) => {
    const info = await requireSession(deps, request);
    if (!canApprove(info.role)) throw new ForbiddenError("Admin access required");
    const { page, pageSize, skip } = parsePagination(
      (request.query ?? {}) as Record<string, unknown>
    );
    const where: Record<string, unknown> = { tenantId: info.tenantId };
    const status = (request.query as Record<string, unknown>)?.status;
    if (typeof status === "string" && status) where.status = status;
    const [items, total] = await Promise.all([
      prisma.adminGrantApplication.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.adminGrantApplication.count({ where }),
    ]);
    return { items, total, page, pageSize };
  });

  // 管理员：全部授权。
  app.get("/api/v1/admin/grants", async (request) => {
    const info = await requireSession(deps, request);
    if (!canApprove(info.role)) throw new ForbiddenError("Admin access required");
    const { page, pageSize, skip } = parsePagination(
      (request.query ?? {}) as Record<string, unknown>
    );
    const [items, total] = await Promise.all([
      prisma.adminGrant.findMany({
        where: { tenantId: info.tenantId },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.adminGrant.count({ where: { tenantId: info.tenantId } }),
    ]);
    return { items, total, page, pageSize };
  });

  // 审批通过（approver ≠ applicant；有效期 7–90 天已在申请时校验）。
  app.post("/api/v1/admin/grants/applications/:id/approve", async (request) => {
    const info = await requireSession(deps, request);
    if (!canApprove(info.role)) throw new ForbiddenError("Admin access required");
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const grant = await approveGrant(prisma, {
      tenantId: info.tenantId,
      applicationId: id,
      approverId: info.id,
      decisionNote:
        typeof body.decisionNote === "string" ? body.decisionNote : undefined,
      usageLimit: body.usageLimit,
    });
    return { grant };
  });

  // 拒绝。
  app.post("/api/v1/admin/grants/applications/:id/reject", async (request) => {
    const info = await requireSession(deps, request);
    if (!canApprove(info.role)) throw new ForbiddenError("Admin access required");
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    await rejectGrant(prisma, {
      tenantId: info.tenantId,
      applicationId: id,
      approverId: info.id,
      decisionNote:
        typeof body.decisionNote === "string" ? body.decisionNote : undefined,
    });
    return { ok: true };
  });

  // 吊销（管理员；需 reason）。
  app.post("/api/v1/admin/grants/:id/revoke", async (request) => {
    const info = await requireSession(deps, request);
    if (!canApprove(info.role)) throw new ForbiddenError("Admin access required");
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) throw new ValidationError("reason is required");
    await revokeGrant(prisma, {
      tenantId: info.tenantId,
      grantId: id,
      actorId: info.id,
      reason,
    });
    return { ok: true };
  });

  // 审计列表（管理员；申请人的申请/授权审计对申请人可见 — 此处仅管理员，避免跨租户泄露）。
  app.get("/api/v1/admin/grants/audits", async (request) => {
    const info = await requireSession(deps, request);
    if (!canApprove(info.role)) throw new ForbiddenError("Admin access required");
    const { page, pageSize, skip } = parsePagination(
      (request.query ?? {}) as Record<string, unknown>
    );
    const [items, total] = await Promise.all([
      prisma.adminGrantAudit.findMany({
        where: { tenantId: info.tenantId },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.adminGrantAudit.count({ where: { tenantId: info.tenantId } }),
    ]);
    return { items, total, page, pageSize };
  });
}

export { GRANT_MAX_DAYS, GRANT_MIN_DAYS };
