/**
 * Automation pack 4/5 — budget pacer HTTP routes.
 *
 * Pure addition: new endpoints only. NOT wired into routes/index.ts
 * (coordinator owns that wiring — subtask scope keeps this file standalone).
 *
 * Session-auth management API (tenant-isolated via requireTenant):
 *   GET    /api/v1/budget-rules            — list rules (newest first)
 *   POST   /api/v1/budget-rules            — create rule (enabled defaults false)
 *   PATCH  /api/v1/budget-rules/:id        — update params / enable / disable
 *   GET    /api/v1/budget-rules/:id/history — lastAction entry (single entry;
 *                                            no history table by design)
 *
 * Google Ads Script dispatch channel (integration-token auth), mirroring the
 * campaign-toggle endpoints — this is how queued budget pushes reach the
 * user's script. Budget changes NEVER go through the Google Ads API
 * directly; they are SyncJob task records consumed here:
 *   GET    /api/v1/script/budget-pacer-tasks  — pending pushes for this
 *                                               integration's tenant+account
 *   POST   /api/v1/script/budget-pacer-result — script writeback
 *                                               (COMPLETED / FAILED)
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { NotFoundError, ValidationError } from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import { PrismaGoogleAdsScriptIntegrationRepository } from "@adlinklab/database";
import { requireTenant, type AuthContext } from "../auth/tenant.js";
import { requireScriptIntegrationAuth } from "../auth/integration-auth.js";
import {
  BUDGET_PACER_RESULT_ACTION,
  BUDGET_PACER_TASK_TYPE,
  createRule,
  getRuleHistory,
  resolveBudgetPacerPayload,
  serializeBudgetRule,
  updateRule,
  type BudgetRuleRow,
  type CreateBudgetRuleInput,
  type UpdateBudgetRulePatch,
} from "../services/budget-pacer-service.js";

export interface BudgetRuleRouteServices {
  prisma: PrismaClient;
  scriptIntegrations?: PrismaGoogleAdsScriptIntegrationRepository;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asTrimmedString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asBoolean(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  return undefined;
}

export async function registerBudgetRuleRoutes(
  app: FastifyInstance,
  services: BudgetRuleRouteServices,
  auth: AuthContext
): Promise<void> {
  const scriptIntegrations =
    services.scriptIntegrations ??
    new PrismaGoogleAdsScriptIntegrationRepository(services.prisma);

  const resolveTenant = (
    request: Parameters<typeof requireTenant>[1]
  ): string => requireTenant(auth, request);

  // ------------------------------------------------------------------
  // Management API (session auth, tenant-isolated)
  // ------------------------------------------------------------------

  app.get("/api/v1/budget-rules", async (request) => {
    const tenantId = resolveTenant(request);
    const rows = (await services.prisma.budgetRule.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    })) as unknown as BudgetRuleRow[];
    return { rules: rows.map(serializeBudgetRule) };
  });

  app.post<{ Body: Record<string, unknown> }>(
    "/api/v1/budget-rules",
    async (request, reply) => {
      const tenantId = resolveTenant(request);
      const body = request.body ?? {};
      const input: CreateBudgetRuleInput = {
        googleAccountId: asTrimmedString(body.googleAccountId) ?? "",
        campaignName: asTrimmedString(body.campaignName) ?? "",
        campaignId: asTrimmedString(body.campaignId) ?? null,
        targetRoas: asNumber(body.targetRoas) ?? NaN,
        minDailyBudget: asNumber(body.minDailyBudget) ?? NaN,
        maxDailyBudget: asNumber(body.maxDailyBudget) ?? NaN,
        increasePct: asNumber(body.increasePct),
        decreasePct: asNumber(body.decreasePct),
        checkIntervalDays: asNumber(body.checkIntervalDays),
        enabled: asBoolean(body.enabled),
        initialBudget: asNumber(body.initialBudget),
        reason: asTrimmedString(body.reason),
        // P0-9: null = breaker disabled; number >= 0 = cap. A present-but-
        // unparseable value is rejected (not silently treated as disabled).
        maxSpendCap: (() => {
          if (body.maxSpendCap === null || body.maxSpendCap === undefined)
            return null;
          const cap = asNumber(body.maxSpendCap);
          if (cap === undefined || cap < 0) {
            throw new ValidationError("maxSpendCap must be >= 0 or null");
          }
          return cap;
        })(),
        autoPauseOnBreach: asBoolean(body.autoPauseOnBreach),
      };
      // enabled defaults to false — the user turns the rule on deliberately
      // after reviewing it.
      const created = await createRule(
        services.prisma,
        tenantId,
        input,
        input.reason
      );
      void reply.code(201);
      return { rule: created };
    }
  );

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/v1/budget-rules/:id",
    async (request) => {
      const tenantId = resolveTenant(request);
      const id = request.params.id;
      if (!UUID_RE.test(id)) {
        throw new NotFoundError("BudgetRule", id);
      }
      const body = request.body ?? {};
      const patch: UpdateBudgetRulePatch = {};
      const campaignName = asTrimmedString(body.campaignName);
      if (campaignName !== undefined) patch.campaignName = campaignName;
      if (body.campaignId !== undefined)
        patch.campaignId = asTrimmedString(body.campaignId) ?? null;
      const targetRoas = asNumber(body.targetRoas);
      if (targetRoas !== undefined) patch.targetRoas = targetRoas;
      const minDailyBudget = asNumber(body.minDailyBudget);
      if (minDailyBudget !== undefined) patch.minDailyBudget = minDailyBudget;
      const maxDailyBudget = asNumber(body.maxDailyBudget);
      if (maxDailyBudget !== undefined) patch.maxDailyBudget = maxDailyBudget;
      const increasePct = asNumber(body.increasePct);
      if (increasePct !== undefined) patch.increasePct = increasePct;
      const decreasePct = asNumber(body.decreasePct);
      if (decreasePct !== undefined) patch.decreasePct = decreasePct;
      const checkIntervalDays = asNumber(body.checkIntervalDays);
      if (checkIntervalDays !== undefined)
        patch.checkIntervalDays = checkIntervalDays;
      const enabled = asBoolean(body.enabled);
      if (enabled !== undefined) patch.enabled = enabled;
      // P0-9: explicit null clears the cap; omitted key leaves it unchanged;
      // a present-but-unparseable value is rejected (not silently ignored).
      if (body.maxSpendCap !== undefined) {
        if (body.maxSpendCap === null) {
          patch.maxSpendCap = null;
        } else {
          const cap = asNumber(body.maxSpendCap);
          if (cap === undefined || cap < 0) {
            throw new ValidationError("maxSpendCap must be >= 0 or null");
          }
          patch.maxSpendCap = cap;
        }
      }
      const autoPauseOnBreach = asBoolean(body.autoPauseOnBreach);
      if (autoPauseOnBreach !== undefined)
        patch.autoPauseOnBreach = autoPauseOnBreach;
      const updated = await updateRule(
        services.prisma,
        tenantId,
        id,
        patch
      );
      return { rule: updated };
    }
  );

  app.get<{ Params: { id: string } }>(
    "/api/v1/budget-rules/:id/history",
    async (request) => {
      const tenantId = resolveTenant(request);
      const id = request.params.id;
      if (!UUID_RE.test(id)) {
        throw new NotFoundError("BudgetRule", id);
      }
      return getRuleHistory(services.prisma, tenantId, id);
    }
  );

  // ------------------------------------------------------------------
  // Script dispatch channel (integration-token auth)
  // ------------------------------------------------------------------

  app.get("/api/v1/script/budget-pacer-tasks", async (request) => {
    const ctx = await requireScriptIntegrationAuth(
      { scriptIntegrations },
      request
    );
    const rows = (await services.prisma.syncJob.findMany({
      where: {
        tenantId: ctx.tenantId,
        type: BUDGET_PACER_TASK_TYPE,
        status: "PENDING",
        externalAccountId: ctx.googleAccountId,
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    })) as Array<{ id: string }>;
    const tasks = [];
    for (const row of rows) {
      const payload = await resolveBudgetPacerPayload(
        services.prisma,
        ctx.tenantId,
        row.id
      );
      if (payload) tasks.push(payload);
    }
    return { tasks };
  });

  app.post<{
    Body: {
      taskId?: unknown;
      result?: unknown;
      errorCode?: unknown;
      errorMessage?: unknown;
    };
  }>("/api/v1/script/budget-pacer-result", async (request) => {
    const ctx = await requireScriptIntegrationAuth(
      { scriptIntegrations },
      request
    );
    const body = request.body ?? {};
    const taskId = asTrimmedString(body.taskId);
    if (!taskId || !UUID_RE.test(taskId)) {
      throw new ValidationError("taskId must be a UUID");
    }
    const result = body.result;
    if (result !== "SUCCESS" && result !== "FAILED") {
      throw new ValidationError('result must be "SUCCESS" or "FAILED"');
    }
    const task = (await services.prisma.syncJob.findFirst({
      where: {
        id: taskId,
        tenantId: ctx.tenantId,
        type: BUDGET_PACER_TASK_TYPE,
      },
    })) as { id: string; status: string } | null;
    if (!task) {
      throw new NotFoundError("BudgetPacerTask", taskId);
    }
    if (task.status === "COMPLETED" || task.status === "FAILED") {
      return { ok: true, taskId, status: task.status, alreadyApplied: true };
    }

    const errorCode = asTrimmedString(body.errorCode);
    const errorMessage = asTrimmedString(body.errorMessage);
    const error =
      [errorCode, errorMessage].filter(Boolean).join(": ") || null;
    const updated = (await services.prisma.syncJob.update({
      where: { id: taskId },
      data: {
        status: result === "SUCCESS" ? "COMPLETED" : "FAILED",
        completedAt: new Date(),
        error,
      },
    })) as { status: string };

    await services.prisma.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId: ctx.tenantId,
        actorId: ctx.tokenKeyId,
        action: BUDGET_PACER_RESULT_ACTION,
        entityType: "SyncJob",
        entityId: taskId,
        after: {
          taskId,
          result,
          errorCode: errorCode ?? null,
          errorMessage: errorMessage ?? null,
        },
        reason: "reported by Google Ads Script",
      },
    });

    return { ok: true, taskId, status: updated.status };
  });
}
