/**
 * 清单 #6 — 砍线自动化规则引擎 HTTP 路由。
 *
 * Pure addition: new endpoints only. NOT wired into routes/index.ts
 * (coordinator owns that wiring — subtask scope keeps this file standalone).
 * 现有 kill-switch 路由（apps/api/src/routes/kill-switch.ts）一字未动。
 *
 * 与 kill-switch 的关系：
 * - kill-switch：原有的花费/政策止损 — offer 级配置（maxSpend、
 *   testSpendCap、pauseGoogleAdsToo 等）+ 花费口径的测试止损监控。
 * - 本引擎：独立的点击阈值判定 + 审计 — 规则按点击数与 0 转化触发，
 *   只写 KillRuleEvent 审计事件，不实际暂停任何广告系列或链接。
 *   执行动作由调用方 / 后续集成消费审计事件后决定。
 *
 * Tenant-isolated via requireTenant (same pattern as budget-rules.ts;
 * auth defaults to createAuthContext() so the coordinator can call
 * registerKillRuleRoutes(app, { prisma })).
 *   GET    /api/v1/kill-rules                  — list own tenant's rules
 *   POST   /api/v1/kill-rules                  — create rule
 *   PATCH  /api/v1/kill-rules/:id              — edit params / enabled
 *   DELETE /api/v1/kill-rules/:id              — delete own tenant's rule
 *   POST   /api/v1/kill-rules/seed-defaults    — idempotent default rules
 *   POST   /api/v1/kill-rules/evaluate         — judge + audit (no pausing)
 *   GET    /api/v1/kill-rules/events           — audit events (newest first)
 */
import type { FastifyInstance } from "fastify";
import { ValidationError } from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import {
  createAuthContext,
  requireTenant,
  type AuthContext,
} from "../auth/tenant.js";
import {
  assertNonNegativeInt,
  assertValidAction,
  assertValidClicksThreshold,
  createKillRule,
  deleteKillRule,
  evaluateKillRules,
  listKillRuleEvents,
  listKillRules,
  seedDefaultKillRules,
  serializeKillRule,
  serializeKillRuleEvent,
  updateKillRule,
} from "../services/kill-rules.js";

export interface KillRuleRouteServices {
  prisma: PrismaClient;
}

function asTrimmedString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function asBoolean(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  return undefined;
}

function asInteger(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  return undefined;
}

/** Present key = explicit null clears; absent key = untouched. */
function asNullableString(
  body: Record<string, unknown>,
  key: string
): string | null | undefined {
  if (body[key] === undefined) return undefined;
  if (body[key] === null) return null;
  return asTrimmedString(body[key]) ?? null;
}

export async function registerKillRuleRoutes(
  app: FastifyInstance,
  services: KillRuleRouteServices,
  auth: AuthContext = createAuthContext()
): Promise<void> {
  const tenantOf = (request: Parameters<typeof requireTenant>[1]): string =>
    requireTenant(auth, request);

  app.get("/api/v1/kill-rules", async (request) => {
    const tenantId = tenantOf(request);
    const rows = await listKillRules(services.prisma, tenantId);
    return { rules: rows.map(serializeKillRule) };
  });

  app.post<{ Body: Record<string, unknown> }>(
    "/api/v1/kill-rules",
    async (request, reply) => {
      const tenantId = tenantOf(request);
      const body = request.body ?? {};
      const name = asTrimmedString(body.name);
      if (!name) {
        throw new ValidationError("name is required");
      }
      const clicksThreshold = asInteger(body.clicksThreshold);
      if (clicksThreshold === undefined) {
        throw new ValidationError("clicksThreshold must be an integer");
      }
      const requireZeroConv = asBoolean(body.requireZeroConv);
      if (
        body.requireZeroConv !== undefined &&
        requireZeroConv === undefined
      ) {
        throw new ValidationError("requireZeroConv must be a boolean");
      }
      const enabled = asBoolean(body.enabled);
      if (body.enabled !== undefined && enabled === undefined) {
        throw new ValidationError("enabled must be a boolean");
      }
      const created = await createKillRule(services.prisma, tenantId, {
        name,
        offerId: asNullableString(body, "offerId") ?? null,
        clicksThreshold: assertValidClicksThreshold(clicksThreshold),
        requireZeroConv,
        action: assertValidAction(body.action),
        enabled,
      });
      void reply.code(201);
      return { rule: serializeKillRule(created) };
    }
  );

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/v1/kill-rules/:id",
    async (request) => {
      const tenantId = tenantOf(request);
      const body = request.body ?? {};
      const patch: Parameters<typeof updateKillRule>[3] = {};
      if (body.name !== undefined) {
        const name = asTrimmedString(body.name);
        if (!name) throw new ValidationError("name is required");
        patch.name = name;
      }
      if (body.offerId !== undefined) {
        patch.offerId = asNullableString(body, "offerId");
      }
      if (body.clicksThreshold !== undefined) {
        const clicksThreshold = asInteger(body.clicksThreshold);
        if (clicksThreshold === undefined) {
          throw new ValidationError("clicksThreshold must be an integer");
        }
        patch.clicksThreshold = clicksThreshold;
      }
      if (body.requireZeroConv !== undefined) {
        const requireZeroConv = asBoolean(body.requireZeroConv);
        if (requireZeroConv === undefined) {
          throw new ValidationError("requireZeroConv must be a boolean");
        }
        patch.requireZeroConv = requireZeroConv;
      }
      if (body.action !== undefined) {
        patch.action = assertValidAction(body.action);
      }
      if (body.enabled !== undefined) {
        const enabled = asBoolean(body.enabled);
        if (enabled === undefined) {
          throw new ValidationError("enabled must be a boolean");
        }
        patch.enabled = enabled;
      }
      const updated = await updateKillRule(
        services.prisma,
        tenantId,
        request.params.id,
        patch
      );
      return { rule: serializeKillRule(updated) };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/v1/kill-rules/:id",
    async (request) => {
      const tenantId = tenantOf(request);
      await deleteKillRule(services.prisma, tenantId, request.params.id);
      return { ok: true, id: request.params.id };
    }
  );

  app.post("/api/v1/kill-rules/seed-defaults", async (request, reply) => {
    const tenantId = tenantOf(request);
    const result = await seedDefaultKillRules(services.prisma, tenantId);
    if (result.created) void reply.code(201);
    return {
      created: result.created,
      rules: result.rules.map(serializeKillRule),
    };
  });

  app.post<{ Body: Record<string, unknown> }>(
    "/api/v1/kill-rules/evaluate",
    async (request) => {
      const tenantId = tenantOf(request);
      const body = request.body ?? {};
      const offerId = asTrimmedString(body.offerId);
      if (!offerId) {
        throw new ValidationError("offerId is required");
      }
      const clicks = asInteger(body.clicks);
      const conversions = asInteger(body.conversions);
      if (clicks === undefined || conversions === undefined) {
        throw new ValidationError(
          "clicks and conversions must be integers"
        );
      }
      const result = await evaluateKillRules(services.prisma, tenantId, {
        offerId,
        clicks: assertNonNegativeInt(clicks, "clicks"),
        conversions: assertNonNegativeInt(conversions, "conversions"),
      });
      return {
        offerId,
        clicks,
        conversions,
        hits: result.hits.map((h) => ({
          rule: serializeKillRule(h.rule),
          event: serializeKillRuleEvent(h.event),
        })),
        events: result.events.map(serializeKillRuleEvent),
      };
    }
  );

  app.get("/api/v1/kill-rules/events", async (request) => {
    const tenantId = tenantOf(request);
    const query = (request.query ?? {}) as { offerId?: string };
    const offerId = asTrimmedString(query.offerId) ?? null;
    const rows = await listKillRuleEvents(services.prisma, tenantId, offerId);
    return { events: rows.map(serializeKillRuleEvent) };
  });
}
