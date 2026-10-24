/**
 * 封号复盘库（清单 #5）HTTP 路由。
 *
 * Pure addition: new endpoints only. NOT wired into routes/index.ts
 * (coordinator owns that wiring — subtask scope keeps this file standalone).
 *
 *   GET    /api/v1/ban-events                — 列出本租户复盘记录
 *   POST   /api/v1/ban-events                — 手动记一条
 *   PATCH  /api/v1/ban-events/:id/recovered  — 标记恢复（申诉成功/解封）
 *   GET    /api/v1/ban-events/survival-stats — 按 network×operationType 分组统计
 *
 * 租户隔离：全部经 requireTenant（与 budget-rules.ts 同款），跨租户记录
 * 一律按“不存在”处理（404）。
 *
 * survival-stats 口径（注释即定义，响应里同样写明）：
 *   observedBanShare = banCount / max(1, banCount + activeSlotCount)
 * 其中 activeSlotCount = 该 network 当前 ACTIVE/PAUSED 槽位数（槽位没有
 * operationType 维度，故同一 network 的各 operationType 组共用该数）。
 * 这是“观测值，非精确存活率”：分母不是历史同期 cohort（已封的槽位
 * 不再计入 active，早期封号也不会被回溯进分母），只能用于组间比较
 * 与成本账封号概率参数的参考，不能直接当作“该操作存活率 X%”对外宣称。
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { NotFoundError, ValidationError } from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import {
  createAuthContext,
  requireTenant,
  type AuthContext,
} from "../auth/tenant.js";
import {
  isOperationType,
  toNumber,
} from "../services/account-matrix.js";

export interface BanLogRouteServices {
  prisma: PrismaClient;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any;
interface BanEventDelegate {
  findMany: (args: unknown) => Promise<AnyRow[]>;
  findFirst: (args: unknown) => Promise<AnyRow | null>;
  create: (args: unknown) => Promise<AnyRow>;
  update: (args: unknown) => Promise<AnyRow>;
}
interface AccountSlotDelegate {
  findMany: (args: unknown) => Promise<AnyRow[]>;
}

function delegates(prisma: PrismaClient): {
  banEvent: BanEventDelegate;
  accountSlot: AccountSlotDelegate;
} {
  const p = prisma as unknown as {
    banEvent: BanEventDelegate;
    accountSlot: AccountSlotDelegate;
  };
  return { banEvent: p.banEvent, accountSlot: p.accountSlot };
}

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

function asMoney(v: unknown, field: string): number | undefined {
  if (v === undefined) return undefined;
  const n = asNumber(v);
  if (n === undefined || n < 0) {
    throw new ValidationError(`${field} must be a number >= 0`);
  }
  return n;
}

interface BanEventLike {
  id: string;
  tenantId: string;
  network: string;
  offerId: string | null;
  operationType: string;
  lostBalanceUsd: unknown;
  lostPendingUsd: unknown;
  recovered: boolean;
  recoveredUsd: unknown;
  note: string | null;
  occurredAt: unknown;
  createdAt?: unknown;
}

function serializeBanEvent(row: BanEventLike): Record<string, unknown> {
  return {
    id: row.id,
    tenantId: row.tenantId,
    network: row.network,
    offerId: row.offerId ?? null,
    operationType: row.operationType,
    lostBalanceUsd: toNumber(row.lostBalanceUsd),
    lostPendingUsd: toNumber(row.lostPendingUsd),
    recovered: row.recovered,
    recoveredUsd: toNumber(row.recoveredUsd),
    note: row.note ?? null,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
  };
}

export async function registerBanLogRoutes(
  app: FastifyInstance,
  services: BanLogRouteServices,
  auth: AuthContext = createAuthContext()
): Promise<void> {
  const { banEvent, accountSlot } = delegates(services.prisma);

  const resolveTenant = (
    request: Parameters<typeof requireTenant>[1]
  ): string => requireTenant(auth, request);

  // GET /api/v1/ban-events — newest first
  app.get("/api/v1/ban-events", async (request) => {
    const tenantId = resolveTenant(request);
    const rows = await banEvent.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
    return { banEvents: (rows as BanEventLike[]).map(serializeBanEvent) };
  });

  // POST /api/v1/ban-events — 手动记一条
  app.post<{ Body: Record<string, unknown> }>(
    "/api/v1/ban-events",
    async (request, reply) => {
      const tenantId = resolveTenant(request);
      const body = request.body ?? {};
      const network = asTrimmedString(body.network);
      if (!network) throw new ValidationError("network is required");
      if (!isOperationType(body.operationType)) {
        throw new ValidationError(
          "operationType must be one of DIRECT_LINK, BRAND_KEYWORD, OTHER"
        );
      }
      const lostBalanceUsd = asMoney(body.lostBalanceUsd, "lostBalanceUsd") ?? 0;
      const lostPendingUsd = asMoney(body.lostPendingUsd, "lostPendingUsd") ?? 0;
      let occurredAt = new Date();
      if (body.occurredAt !== undefined && body.occurredAt !== null) {
        const d = new Date(String(body.occurredAt));
        if (Number.isNaN(d.getTime())) {
          throw new ValidationError("occurredAt must be a valid date");
        }
        occurredAt = d;
      }
      const offerId =
        body.offerId === undefined || body.offerId === null
          ? null
          : asTrimmedString(body.offerId);
      if (body.offerId !== undefined && body.offerId !== null && !offerId) {
        throw new ValidationError("offerId must be a non-empty string or null");
      }
      const created = await banEvent.create({
        data: {
          id: randomUUID(),
          tenantId,
          network,
          offerId,
          operationType: body.operationType,
          lostBalanceUsd,
          lostPendingUsd,
          recovered: false,
          recoveredUsd: 0,
          note: asTrimmedString(body.note) ?? null,
          occurredAt,
        },
      });
      void reply.code(201);
      return { banEvent: serializeBanEvent(created as BanEventLike) };
    }
  );

  // PATCH /api/v1/ban-events/:id/recovered — 标记恢复
  app.patch<{
    Params: { id: string };
    Body: Record<string, unknown>;
  }>("/api/v1/ban-events/:id/recovered", async (request) => {
    const tenantId = resolveTenant(request);
    const existing = await banEvent.findFirst({
      where: { id: request.params.id, tenantId },
    });
    if (!existing) throw new NotFoundError("BanEvent", request.params.id);
    const recoveredUsd = asMoney(
      request.body?.recoveredUsd,
      "recoveredUsd"
    );
    if (recoveredUsd === undefined) {
      throw new ValidationError("recoveredUsd is required and must be >= 0");
    }
    const updated = await banEvent.update({
      where: { id: request.params.id },
      data: { recovered: true, recoveredUsd },
    });
    return { banEvent: serializeBanEvent(updated as BanEventLike) };
  });

  // GET /api/v1/ban-events/survival-stats — 按 network×operationType 分组
  app.get("/api/v1/ban-events/survival-stats", async (request) => {
    const tenantId = resolveTenant(request);
    const events = (await banEvent.findMany({
      where: { tenantId },
    })) as BanEventLike[];
    const slots = (await accountSlot.findMany({
      where: { tenantId },
    })) as Array<{ network: string; status: string }>;

    // 该 network 当前 ACTIVE/PAUSED 槽位数（槽位无 operationType 维度，
    // 同一 network 的各 operationType 组共用该数——见文件头口径说明）。
    const liveByNetwork = new Map<string, number>();
    for (const s of slots) {
      if (s.status === "ACTIVE" || s.status === "PAUSED") {
        liveByNetwork.set(s.network, (liveByNetwork.get(s.network) ?? 0) + 1);
      }
    }

    const groups = new Map<
      string,
      {
        network: string;
        operationType: string;
        banCount: number;
        totalLostUsd: number;
        totalRecoveredUsd: number;
      }
    >();
    for (const e of events) {
      const key = `${e.network}::${e.operationType}`;
      const g =
        groups.get(key) ??
        {
          network: e.network,
          operationType: e.operationType,
          banCount: 0,
          totalLostUsd: 0,
          totalRecoveredUsd: 0,
        };
      g.banCount += 1;
      g.totalLostUsd += toNumber(e.lostBalanceUsd) + toNumber(e.lostPendingUsd);
      g.totalRecoveredUsd += toNumber(e.recoveredUsd);
      groups.set(key, g);
    }

    const stats = [...groups.values()].map((g) => {
      const activeSlotCount = liveByNetwork.get(g.network) ?? 0;
      return {
        ...g,
        activeSlotCount,
        // 观测值，非精确存活率：分母 = 封号数 + 当前存活槽位数，
        // 不是历史同期 cohort；仅作组间比较与成本账参数参考。
        observedBanShare: g.banCount / Math.max(1, g.banCount + activeSlotCount),
        observedBanShareDefinition:
          "observed value, not an exact survival rate: " +
          "banCount / max(1, banCount + activeSlotCount), where " +
          "activeSlotCount is the network's current ACTIVE/PAUSED slots.",
      };
    });
    return { stats };
  });
}
