/**
 * P1-7 / P1-8：Google 账号双类型 + 健康 + 申诉。
 *
 * - GET /api/v1/google-accounts/:id/sub-accounts — MCC 展开子账号
 *   （managerCustomerId == MCC customerId，同租户）；个人账户显性 400。
 * - POST /api/v1/google-accounts/:id/suspension — 记录封停
 *   （healthStatus=suspended + reason + suspendedAt；写 AuditLog）。
 *   封停只记录平台通知，不自动申诉。
 * - POST /api/v1/google-accounts/:id/appeals — 记录一次平台侧申诉
 *   （level/status/note；只做记录，不自动申诉；approved → 恢复 active）。
 * - GET /api/v1/google-accounts/:id/appeals — 申诉记录列表。
 *
 * P1-8：封停账号在发布流程中被过滤（见 ads-auto confirm）。
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
import type { GoogleAccountService } from "../services/index.js";

export interface GoogleAccountsExtraDeps {
  prisma: PrismaClient;
  googleAccounts: GoogleAccountService;
}

async function requireSession(
  deps: GoogleAccountsExtraDeps,
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

export async function registerGoogleAccountsExtraRoutes(
  app: FastifyInstance,
  deps: GoogleAccountsExtraDeps
): Promise<void> {
  const { prisma, googleAccounts } = deps;

  app.get<{
    Params: { id: string };
  }>("/api/v1/google-accounts/:id/sub-accounts", async (request) => {
    const info = await requireSession(deps, request);
    if (!UUID_RE.test(request.params.id)) {
      throw new ValidationError("id must be a UUID");
    }
    const subs = await googleAccounts.listSubAccounts(info.tenantId, request.params.id);
    return { items: subs };
  });

  app.post<{
    Params: { id: string };
    Body: { suspensionReason?: unknown };
  }>("/api/v1/google-accounts/:id/suspension", async (request) => {
    const info = await requireSession(deps, request);
    if (!UUID_RE.test(request.params.id)) {
      throw new ValidationError("id must be a UUID");
    }
    const reason =
      typeof request.body?.suspensionReason === "string"
        ? request.body.suspensionReason.trim()
        : "";
    if (!reason) throw new ValidationError("suspensionReason is required");
    const account = await prisma.googleAccount.findFirst({
      where: { id: request.params.id, tenantId: info.tenantId },
    });
    if (!account) throw new NotFoundError("GoogleAccount", request.params.id);
    const updated = await prisma.googleAccount.update({
      where: { id: account.id },
      data: {
        healthStatus: "suspended",
        suspensionReason: reason,
        suspendedAt: new Date(),
      },
    });
    await prisma.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId: info.tenantId,
        actorId: info.id,
        action: "GOOGLE_ACCOUNT_SUSPENDED",
        entityType: "GoogleAccount",
        entityId: account.id,
        before: { healthStatus: account.healthStatus },
        after: { healthStatus: "suspended", suspensionReason: reason },
        reason: "P1-8: suspension recorded from platform notice (no auto-appeal)",
      },
    });
    return updated;
  });

  app.post<{
    Params: { id: string };
    Body: { level?: unknown; status?: unknown; note?: unknown };
  }>("/api/v1/google-accounts/:id/appeals", async (request) => {
    const info = await requireSession(deps, request);
    if (!UUID_RE.test(request.params.id)) {
      throw new ValidationError("id must be a UUID");
    }
    const body = request.body ?? {};
    const level =
      typeof body.level === "string" ? body.level.trim().toUpperCase() : "";
    const status =
      typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
    if (!["MCC", "SUBACCOUNT", "PERSONAL"].includes(level)) {
      throw new ValidationError("level must be MCC, SUBACCOUNT or PERSONAL");
    }
    if (!["draft", "submitted", "approved", "rejected"].includes(status)) {
      throw new ValidationError("status must be draft, submitted, approved or rejected");
    }
    const note =
      typeof body.note === "string" ? body.note.trim().slice(0, 2000) : null;
    const account = await prisma.googleAccount.findFirst({
      where: { id: request.params.id, tenantId: info.tenantId },
    });
    if (!account) throw new NotFoundError("GoogleAccount", request.params.id);
    const appeal = await prisma.googleAccountAppeal.create({
      data: {
        id: randomUUID(),
        tenantId: info.tenantId,
        googleAccountId: account.id,
        level,
        status,
        note,
      },
    });
    // 申诉状态映射到账号：submitted → pending；approved → 恢复 active；
    // rejected → rejected（保持 suspended，需人工处理）。
    const appealStatus =
      status === "submitted"
        ? "pending"
        : status === "approved"
          ? "approved"
          : status === "rejected"
            ? "rejected"
            : account.appealStatus;
    await prisma.googleAccount.update({
      where: { id: account.id },
      data: {
        appealStatus,
        appealNote: note,
        ...(status === "approved"
          ? { healthStatus: "active", suspensionReason: null, suspendedAt: null }
          : {}),
      },
    });
    await prisma.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId: info.tenantId,
        actorId: info.id,
        action: "GOOGLE_ACCOUNT_APPEAL_RECORDED",
        entityType: "GoogleAccount",
        entityId: account.id,
        before: { appealStatus: account.appealStatus, healthStatus: account.healthStatus },
        after: { appealStatus, status, level },
        reason: "P1-8: platform-side appeal outcome recorded (no auto-appeal)",
      },
    });
    return appeal;
  });

  app.get<{
    Params: { id: string };
  }>("/api/v1/google-accounts/:id/appeals", async (request) => {
    const info = await requireSession(deps, request);
    if (!UUID_RE.test(request.params.id)) {
      throw new ValidationError("id must be a UUID");
    }
    const account = await prisma.googleAccount.findFirst({
      where: { id: request.params.id, tenantId: info.tenantId },
    });
    if (!account) throw new NotFoundError("GoogleAccount", request.params.id);
    const items = await prisma.googleAccountAppeal.findMany({
      where: { googleAccountId: account.id, tenantId: info.tenantId },
      orderBy: { createdAt: "desc" },
    });
    return { items };
  });
}
