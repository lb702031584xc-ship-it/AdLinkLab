/**
 * 账号矩阵（清单 #4）HTTP 路由。
 *
 * Pure addition: new endpoints only. NOT wired into routes/index.ts
 * (coordinator owns that wiring — subtask scope keeps this file standalone).
 *
 *   POST   /api/v1/account-matrix/slots/template   — 建 10 个 EMPTY 槽位
 *   GET    /api/v1/account-matrix/slots            — 列出本租户槽位
 *   PATCH  /api/v1/account-matrix/slots/:id        — 改状态/金额/挂 offer/标签
 *   POST   /api/v1/account-matrix/slots/:id/assign — 挂 offer（1 号 1 offer
 *                                                     警告不拦截）
 *   POST   /api/v1/account-matrix/slots/:id/mark-banned — 标 BANNED + 写
 *                                                     BanEvent + 自动补位
 *   GET    /api/v1/account-matrix/portfolio        — 组合视图 + 预算公式
 *
 * 租户隔离：全部经 requireTenant（与 budget-rules.ts 同款），跨租户的槽位
 * 一律按“不存在”处理（404），不泄露他租户记录的存在性。
 *
 * 硬线：accountLabel 只是自由文本标签，绝不存任何账号凭证；不实现
 * 补点击、买号冒用、规避检测的多账号分散、规避检测的 IP/UA/指纹轮换、
 * 批量起号绕过封禁。
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import {
  createAuthContext,
  requireTenant,
  type AuthContext,
} from "../auth/tenant.js";
import {
  buildAssignWarnings,
  buildTemplateLabels,
  computePortfolio,
  isOperationType,
  isSlotStatus,
  serializeSlot,
  type SlotLike,
} from "../services/account-matrix.js";

export interface AccountMatrixRouteServices {
  prisma: PrismaClient;
}

/**
 * 最小 delegate 接口：生成客户端若尚未含新模型也能编译；
 * 运行时以真实 Prisma delegate 为准（字段名以 schema 为准）。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any;
interface AccountSlotDelegate {
  findMany: (args: unknown) => Promise<AnyRow[]>;
  findFirst: (args: unknown) => Promise<AnyRow | null>;
  create: (args: unknown) => Promise<AnyRow>;
  update: (args: unknown) => Promise<AnyRow>;
}
interface BanEventDelegate {
  create: (args: unknown) => Promise<AnyRow>;
}

function delegates(prisma: PrismaClient): {
  accountSlot: AccountSlotDelegate;
  banEvent: BanEventDelegate;
} {
  const p = prisma as unknown as {
    accountSlot: AccountSlotDelegate;
    banEvent: BanEventDelegate;
  };
  return { accountSlot: p.accountSlot, banEvent: p.banEvent };
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

/** 金额字段：必须是 >= 0 的数；缺省返回 undefined（调用方再定默认值）。 */
function asMoney(v: unknown, field: string): number | undefined {
  if (v === undefined) return undefined;
  const n = asNumber(v);
  if (n === undefined || n < 0) {
    throw new ValidationError(`${field} must be a number >= 0`);
  }
  return n;
}

export async function registerAccountMatrixRoutes(
  app: FastifyInstance,
  services: AccountMatrixRouteServices,
  auth: AuthContext = createAuthContext()
): Promise<void> {
  const { accountSlot, banEvent } = delegates(services.prisma);

  const resolveTenant = (
    request: Parameters<typeof requireTenant>[1]
  ): string => requireTenant(auth, request);

  async function findOwnSlot(
    tenantId: string,
    id: string
  ): Promise<SlotLike> {
    const row = await accountSlot.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundError("AccountSlot", id);
    return row as SlotLike;
  }

  // ------------------------------------------------------------------
  // POST /api/v1/account-matrix/slots/template — 10 个 EMPTY 槽位
  // ------------------------------------------------------------------
  app.post<{ Body: Record<string, unknown> }>(
    "/api/v1/account-matrix/slots/template",
    async (request, reply) => {
      const tenantId = resolveTenant(request);
      const body = request.body ?? {};
      const network = asTrimmedString(body.network);
      const labelPrefix = asTrimmedString(body.labelPrefix);
      if (!network) throw new ValidationError("network is required");
      if (!labelPrefix) throw new ValidationError("labelPrefix is required");

      const existing = await accountSlot.findMany({
        where: { tenantId, network },
      });
      if (existing.length > 0) {
        throw new ConflictError(
          `Account slots for network "${network}" already exist for this ` +
            `tenant (${existing.length} slots); refusing to create duplicates. ` +
            `Use PATCH /api/v1/account-matrix/slots/:id to edit them.`,
          { network, existingCount: existing.length }
        );
      }

      const slots: SlotLike[] = [];
      for (const label of buildTemplateLabels(labelPrefix)) {
        const index = slots.length + 1;
        const row = await accountSlot.create({
          data: {
            id: randomUUID(),
            tenantId,
            slotIndex: index,
            accountLabel: label,
            network,
            offerId: null,
            status: "EMPTY",
            balanceUsd: 0,
            pendingUsd: 0,
            investedUsd: 0,
            earnedUsd: 0,
          },
        });
        slots.push(row as SlotLike);
      }
      void reply.code(201);
      return { slots: slots.map(serializeSlot) };
    }
  );

  // ------------------------------------------------------------------
  // GET /api/v1/account-matrix/slots — newest first，含 offer 基本信息
  // ------------------------------------------------------------------
  app.get("/api/v1/account-matrix/slots", async (request) => {
    const tenantId = resolveTenant(request);
    const rows = await accountSlot.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      include: { offer: { select: { id: true, name: true } } },
    });
    return { slots: (rows as SlotLike[]).map(serializeSlot) };
  });

  // ------------------------------------------------------------------
  // PATCH /api/v1/account-matrix/slots/:id — 只改本租户记录
  // ------------------------------------------------------------------
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/v1/account-matrix/slots/:id",
    async (request) => {
      const tenantId = resolveTenant(request);
      const slot = await findOwnSlot(tenantId, request.params.id);
      const body = request.body ?? {};
      const data: Record<string, unknown> = {};

      if (body.status !== undefined) {
        if (!isSlotStatus(body.status)) {
          throw new ValidationError(
            "status must be one of EMPTY, ACTIVE, PAUSED, BANNED"
          );
        }
        data.status = body.status;
      }
      for (const field of [
        "balanceUsd",
        "pendingUsd",
        "investedUsd",
        "earnedUsd",
      ] as const) {
        const v = asMoney(body[field], field);
        if (v !== undefined) data[field] = v;
      }
      if (body.offerId !== undefined) {
        data.offerId =
          body.offerId === null ? null : asTrimmedString(body.offerId);
        if (body.offerId !== null && data.offerId === undefined) {
          throw new ValidationError("offerId must be a string or null");
        }
      }
      const label = asTrimmedString(body.accountLabel);
      if (body.accountLabel !== undefined) {
        if (label === undefined) {
          throw new ValidationError("accountLabel must be a non-empty string");
        }
        data.accountLabel = label;
      }
      void slot;
      const updated = await accountSlot.update({
        where: { id: request.params.id },
        data,
      });
      return { slot: serializeSlot(updated as SlotLike) };
    }
  );

  // ------------------------------------------------------------------
  // POST /api/v1/account-matrix/slots/:id/assign — 挂 offer，警告不拦截
  // ------------------------------------------------------------------
  app.post<{
    Params: { id: string };
    Body: Record<string, unknown>;
  }>("/api/v1/account-matrix/slots/:id/assign", async (request) => {
    const tenantId = resolveTenant(request);
    const slot = await findOwnSlot(tenantId, request.params.id);
    const offerId = asTrimmedString(request.body?.offerId);
    if (!offerId) throw new ValidationError("offerId is required");
    if (slot.status === "BANNED") {
      throw new ValidationError(
        "Cannot assign an offer to a BANNED slot; use the auto-refill slot instead."
      );
    }
    const all = (await accountSlot.findMany({
      where: { tenantId },
    })) as SlotLike[];
    const warnings = buildAssignWarnings(slot, all, offerId);
    const updated = await accountSlot.update({
      where: { id: slot.id },
      data: {
        offerId,
        // 空槽位挂 offer 即投入使用；非 EMPTY 状态保持原状。
        ...(slot.status === "EMPTY" ? { status: "ACTIVE" } : {}),
      },
    });
    return { slot: serializeSlot(updated as SlotLike), warnings };
  });

  // ------------------------------------------------------------------
  // POST /api/v1/account-matrix/slots/:id/mark-banned
  // 标 BANNED + 写 BanEvent + 自动补位（新 EMPTY 槽位，slotIndex = 最大 +1）
  // ------------------------------------------------------------------
  app.post<{
    Params: { id: string };
    Body: Record<string, unknown>;
  }>("/api/v1/account-matrix/slots/:id/mark-banned", async (request) => {
    const tenantId = resolveTenant(request);
    const slot = await findOwnSlot(tenantId, request.params.id);
    const body = request.body ?? {};
    if (!isOperationType(body.operationType)) {
      throw new ValidationError(
        "operationType must be one of DIRECT_LINK, BRAND_KEYWORD, OTHER"
      );
    }
    const lostBalanceUsd = asMoney(body.lostBalanceUsd, "lostBalanceUsd") ?? 0;
    const lostPendingUsd = asMoney(body.lostPendingUsd, "lostPendingUsd") ?? 0;
    const note = asTrimmedString(body.note) ?? null;

    const event = await banEvent.create({
      data: {
        id: randomUUID(),
        tenantId,
        network: slot.network,
        offerId: slot.offerId,
        operationType: body.operationType,
        lostBalanceUsd,
        lostPendingUsd,
        recovered: false,
        recoveredUsd: 0,
        note,
        occurredAt: new Date(),
      },
    });

    const banned = await accountSlot.update({
      where: { id: slot.id },
      data: { status: "BANNED" },
    });

    const all = (await accountSlot.findMany({
      where: { tenantId },
    })) as SlotLike[];
    const maxIndex = all.reduce((m, s) => Math.max(m, s.slotIndex), 0);
    const refill = await accountSlot.create({
      data: {
        id: randomUUID(),
        tenantId,
        slotIndex: maxIndex + 1,
        // 补位槽位沿用被封槽位标签 + 后缀，便于追溯，不另起易混淆的编号。
        accountLabel: `${slot.accountLabel}-refill`,
        network: slot.network,
        offerId: null,
        status: "EMPTY",
        balanceUsd: 0,
        pendingUsd: 0,
        investedUsd: 0,
        earnedUsd: 0,
      },
    });

    return {
      slot: serializeSlot(banned as SlotLike),
      banEvent: {
        id: event.id,
        tenantId: event.tenantId,
        network: event.network,
        offerId: event.offerId ?? null,
        operationType: event.operationType,
        lostBalanceUsd,
        lostPendingUsd,
        recovered: false,
        recoveredUsd: 0,
        note,
        occurredAt: event.occurredAt,
      },
      refillSlot: serializeSlot(refill as SlotLike),
    };
  });

  // ------------------------------------------------------------------
  // GET /api/v1/account-matrix/portfolio — 组合视图 + 预算公式
  // ------------------------------------------------------------------
  app.get<{ Querystring: Record<string, string | undefined> }>(
    "/api/v1/account-matrix/portfolio",
    async (request) => {
      const tenantId = resolveTenant(request);
      const q = request.query ?? {};
      let expectedSurvivors = 2;
      if (q.expectedSurvivors !== undefined) {
        const n = Number(q.expectedSurvivors);
        if (!Number.isFinite(n) || n < 0) {
          throw new ValidationError("expectedSurvivors must be a number >= 0");
        }
        expectedSurvivors = n;
      }
      let perSlotCommissionUsd: number | null = null;
      if (q.perSlotCommissionUsd !== undefined) {
        const n = Number(q.perSlotCommissionUsd);
        if (!Number.isFinite(n) || n < 0) {
          throw new ValidationError(
            "perSlotCommissionUsd must be a number >= 0"
          );
        }
        perSlotCommissionUsd = n;
      }
      const rows = (await accountSlot.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
      })) as SlotLike[];
      return {
        portfolio: computePortfolio(rows, {
          expectedSurvivors,
          perSlotCommissionUsd,
        }),
      };
    }
  );
}
