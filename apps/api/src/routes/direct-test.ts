/**
 * 清单第 2 条 — 直链速测 API（轻量计划，跳过落地页步骤）。
 *
 * 与 ads-auto 同口径：
 * - 会话认证：与 ads-auto 同一套（request.sessionAuth 优先，否则
 *   authenticateSessionRequest；绝不自创认证）。
 * - 计划存内存、2h TTL（自有 store，形态与 adPlanStore 同款：
 *   Map + expiresAt，过期即删）。
 * - confirm 复用 ads-auto confirm 的 ScriptSyncTarget 创建方式：
 *   本租户 ACTIVE 的 Google Ads Script integration + entityType
 *   CAMPAIGN + entityId = planId + desiredVersion 1 + 任务类型
 *   create-campaign；同一计划重复确认返回已有的 target（幂等）。
 *
 *   POST /api/v1/direct-test                      — 生成速测计划
 *   POST /api/v1/direct-test/:planId/confirm      — 确认 → 建 Script 任务
 *   POST /api/v1/direct-test/:planId/upgrade      — 关联落地页，升级完整链路
 *   GET  /api/v1/direct-test/plans                — 列出本租户速测计划
 *
 * 租户隔离：跨租户的计划一律按“不存在”处理（404），不泄露存在性；
 * 计划不存在或已过期返回 410（与 ads-auto confirm 同口径）。
 *
 * upgrade 说明：现有 confirm 流程只建任务、不支持更新已建的
 * ScriptSyncTarget（重复确认返回已有 target，不改写）。因此 upgrade
 * 只记计划关联（landingPageLinked / landingPageId），不改写已有
 * target，并在响应里明说（scriptSyncUpdated=false + scriptSyncNote）。
 * 已确认的计划升级后如需把落地页推给 Google Ads，请重新走确认/
 * 脚本流程（或以升级后的计划重新生成脚本）。
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import { CREATE_CAMPAIGN_TASK_TYPE } from "./ads-auto.js";

export interface DirectTestRouteDeps {
  prisma: PrismaClient;
  /** Injectable for tests; defaults to the process-wide singleton. */
  planStore?: DirectTestPlanStore;
}

export type DirectTestPlanStatus = "DRAFT" | "CONFIRMED";

export interface DirectTestPlan {
  planId: string;
  tenantId: string;
  finalUrl: string;
  offerId: string | null;
  googleAccountId: string | null;
  status: DirectTestPlanStatus;
  /** confirm 建的 ScriptSyncTarget id（未确认时为 null）。 */
  targetId: string | null;
  landingPageLinked: boolean;
  landingPageId: string | null;
  createdAt: string;
}

export const DIRECT_TEST_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours, same as ads-auto
const DIRECT_TEST_MAX_SIZE = 500;

export function createDirectTestStore(
  ttlMs: number = DIRECT_TEST_TTL_MS,
  maxSize: number = DIRECT_TEST_MAX_SIZE
) {
  const map = new Map<
    string,
    { plan: DirectTestPlan; expiresAt: number }
  >();
  function purge(planId: string): void {
    const stored = map.get(planId);
    if (stored && stored.expiresAt <= Date.now()) map.delete(planId);
  }
  return {
    put(plan: DirectTestPlan): string {
      if (map.size >= maxSize) {
        const oldest = map.keys().next();
        if (!oldest.done) map.delete(oldest.value);
      }
      map.set(plan.planId, { plan, expiresAt: Date.now() + ttlMs });
      return plan.planId;
    },
    get(planId: string): DirectTestPlan | null {
      purge(planId);
      return map.get(planId)?.plan ?? null;
    },
    list(tenantId: string): DirectTestPlan[] {
      for (const planId of [...map.keys()]) purge(planId);
      return [...map.values()]
        .map((s) => s.plan)
        .filter((p) => p.tenantId === tenantId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    size(): number {
      return map.size;
    },
  };
}

export type DirectTestPlanStore = ReturnType<typeof createDirectTestStore>;

/** Process-wide singleton used by the routes when no store is injected. */
export const directTestStore: DirectTestPlanStore = createDirectTestStore();

async function requireSession(
  deps: DirectTestRouteDeps,
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

function asTrimmedString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asUuid(v: unknown, field: string): string | undefined {
  const s = asTrimmedString(v);
  if (s === undefined) return undefined;
  if (!UUID_RE.test(s)) {
    throw new ValidationError(`${field} must be a UUID`);
  }
  return s;
}

function assertHttpUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ValidationError(`Invalid URL: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError(`Only http(s) URLs are allowed: ${raw}`);
  }
  return parsed.toString();
}

function suggestCampaignName(finalUrl: string): string {
  try {
    return `直链速测-${new URL(finalUrl).hostname}`;
  } catch {
    return "直链速测";
  }
}

export async function registerDirectTestRoutes(
  app: FastifyInstance,
  deps: DirectTestRouteDeps
): Promise<void> {
  const { prisma, planStore = directTestStore } = deps;

  function loadPlan(planId: string, tenantId: string): DirectTestPlan {
    const plan = planStore.get(planId);
    if (!plan) {
      // Missing or TTL-expired (same 410 as ads-auto).
      throw new AppError("Direct test plan not found or expired", {
        code: "PLAN_NOT_FOUND",
        statusCode: 410,
      });
    }
    if (plan.tenantId !== tenantId) {
      throw new NotFoundError("DirectTestPlan", planId);
    }
    return plan;
  }

  /**
   * 生成轻量速测计划：跳过落地页步骤，只记终链 + 可选 offer /
   * Google 账号。计划存内存，2h TTL。
   */
  app.post<{
    Body: {
      finalUrl?: unknown;
      offerId?: unknown;
      googleAccountId?: unknown;
    };
  }>("/api/v1/direct-test", async (request) => {
    const info = await requireSession(deps, request);
    const body = request.body ?? {};
    const rawUrl = asTrimmedString(body.finalUrl);
    if (!rawUrl) {
      throw new ValidationError("finalUrl is required");
    }
    const finalUrl = assertHttpUrl(rawUrl);
    const offerId = asUuid(body.offerId, "offerId") ?? null;
    const googleAccountId =
      asUuid(body.googleAccountId, "googleAccountId") ?? null;
    const plan: DirectTestPlan = {
      planId: randomUUID(),
      tenantId: info.tenantId,
      finalUrl,
      offerId,
      googleAccountId,
      status: "DRAFT",
      targetId: null,
      landingPageLinked: false,
      landingPageId: null,
      createdAt: new Date().toISOString(),
    };
    planStore.put(plan);
    return {
      planId: plan.planId,
      plan,
      suggestedCampaignName: suggestCampaignName(finalUrl),
      finalUrl,
      expiresInSeconds: DIRECT_TEST_TTL_MS / 1000,
    };
  });

  /**
   * 确认速测计划：与 ads-auto confirm 同款 ScriptSyncTarget 创建
   * （ACTIVE integration + create-campaign + 幂等）。计划状态变
   * CONFIRMED。
   */
  app.post<{
    Params: { planId: string };
  }>("/api/v1/direct-test/:planId/confirm", async (request) => {
    const info = await requireSession(deps, request);
    const plan = loadPlan(request.params.planId, info.tenantId);

    // 与 ads-auto confirm 同款：封停账号不进发布流程（显性拒绝）。
    if (plan.googleAccountId) {
      const acct = await prisma.googleAccount.findFirst({
        where: { id: plan.googleAccountId, tenantId: info.tenantId },
        select: { healthStatus: true, suspensionReason: true },
      });
      if (acct?.healthStatus === "suspended") {
        throw new ValidationError(
          `Google 账号已封停，无法发布${acct.suspensionReason ? `（${acct.suspensionReason}）` : ""}。请处理申诉后再试。`
        );
      }
    }
    const integrationWhere: Record<string, unknown> = {
      tenantId: info.tenantId,
      status: "ACTIVE",
    };
    if (plan.googleAccountId) {
      integrationWhere.googleAccountId = plan.googleAccountId;
    }
    const integration = await prisma.googleAdsScriptIntegration.findFirst({
      where: integrationWhere,
    });
    if (!integration) {
      throw new ValidationError(
        "No active Google Ads Script integration found for this tenant" +
          (plan.googleAccountId ? " and Google account" : "") +
          ". Set up a Script integration first."
      );
    }

    // Idempotent: confirming the same plan twice returns the existing target.
    const existing = await prisma.scriptSyncTarget.findFirst({
      where: {
        tenantId: info.tenantId,
        integrationId: integration.id,
        entityType: "CAMPAIGN",
        entityId: plan.planId,
      },
    });
    if (existing) {
      plan.status = "CONFIRMED";
      plan.targetId = existing.id;
      return {
        planId: plan.planId,
        plan,
        targetId: existing.id,
        taskType: CREATE_CAMPAIGN_TASK_TYPE,
        status: "QUEUED",
        alreadyQueued: true,
      };
    }

    const target = await prisma.scriptSyncTarget.create({
      data: {
        id: randomUUID(),
        tenantId: info.tenantId,
        integrationId: integration.id,
        entityType: "CAMPAIGN",
        // Polymorphic reference: the in-memory plan id (UUID).
        entityId: plan.planId,
        desiredVersion: 1,
      },
    });
    plan.status = "CONFIRMED";
    plan.targetId = target.id;
    return {
      planId: plan.planId,
      plan,
      targetId: target.id,
      taskType: CREATE_CAMPAIGN_TASK_TYPE,
      status: "QUEUED",
      alreadyQueued: false,
      integrationId: integration.id,
    };
  });

  /**
   * 一键升级为完整链路：把 landingPageId 关联到计划上。
   * 现有 confirm 流程不支持更新已建的 ScriptSyncTarget，故这里只记
   * 计划关联，并在响应里明说（scriptSyncUpdated=false）。
   */
  app.post<{
    Params: { planId: string };
    Body: { landingPageId?: unknown };
  }>("/api/v1/direct-test/:planId/upgrade", async (request) => {
    const info = await requireSession(deps, request);
    const plan = loadPlan(request.params.planId, info.tenantId);
    const landingPageId = asTrimmedString(request.body?.landingPageId);
    if (!landingPageId) {
      throw new ValidationError("landingPageId is required");
    }
    plan.landingPageLinked = true;
    plan.landingPageId = landingPageId;

    const existingTarget = await prisma.scriptSyncTarget.findFirst({
      where: {
        tenantId: info.tenantId,
        entityType: "CAMPAIGN",
        entityId: plan.planId,
      },
    });
    return {
      plan,
      planId: plan.planId,
      landingPageLinked: true,
      landingPageId,
      targetId: existingTarget?.id ?? null,
      scriptSyncUpdated: false,
      scriptSyncNote:
        "只记录了计划与落地页的关联；现有 confirm 流程不支持更新已建的 " +
        "ScriptSyncTarget，已确认的任务仍指向原终链。如需把落地页推给 " +
        "Google Ads，请以升级后的计划重新走确认/脚本流程。",
    };
  });

  /** 列出本租户速测计划（newest first；过期计划不出现）。 */
  app.get("/api/v1/direct-test/plans", async (request) => {
    const info = await requireSession(deps, request);
    return { plans: planStore.list(info.tenantId) };
  });
}
