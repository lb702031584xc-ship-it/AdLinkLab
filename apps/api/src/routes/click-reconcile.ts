/**
 * POST /api/v1/tracking/click-reconcile
 *
 * 手动对账：把 Google Ads 点击数、联盟点击数填进来，返回损耗率与排查顺序。
 * 不依赖任何外部集成——现在就能用。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { UnauthorizedError, ValidationError } from "@adlinklab/shared";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import { reconcileClicks, type DailyClicks } from "../services/click-reconcile.js";

export interface ClickReconcileRouteDeps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: ClickReconcileRouteDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) throw new UnauthorizedError("Authentication required");
  return info;
}

function nonNegative(v: unknown, field: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    throw new ValidationError(`${field} 必须为非负数`);
  }
  return n;
}

export async function registerClickReconcileRoutes(
  app: FastifyInstance,
  deps: ClickReconcileRouteDeps
): Promise<void> {
  app.post<{ Body: Record<string, unknown> }>(
    "/api/v1/tracking/click-reconcile",
    async (request) => {
      await requireSession(deps, request);
      const body = (request.body ?? {}) as Record<string, unknown>;

      const rawDays = body.days;
      let days: DailyClicks[] | undefined;
      if (rawDays !== undefined) {
        if (!Array.isArray(rawDays) || rawDays.length > 90) {
          throw new ValidationError("days 必须为数组（最多 90 条）");
        }
        days = rawDays.map((d, i) => {
          const row = (d ?? {}) as Record<string, unknown>;
          if (typeof row.date !== "string" || !row.date.trim()) {
            throw new ValidationError(`days[${i}].date 必须为字符串`);
          }
          return {
            date: row.date,
            googleClicks: nonNegative(row.googleClicks ?? 0, `days[${i}].googleClicks`),
            networkClicks: nonNegative(
              row.networkClicks ?? 0,
              `days[${i}].networkClicks`
            ),
          };
        });
        if (days.length === 0) throw new ValidationError("days 不能为空数组");
      }

      if (!days && body.googleClicks === undefined) {
        throw new ValidationError("需要 days 或 googleClicks");
      }

      return reconcileClicks({
        days,
        googleClicks:
          body.googleClicks === undefined
            ? undefined
            : nonNegative(body.googleClicks, "googleClicks"),
        networkClicks:
          body.networkClicks === undefined
            ? undefined
            : nonNegative(body.networkClicks, "networkClicks"),
      });
    }
  );
}
