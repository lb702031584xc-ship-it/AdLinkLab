/**
 * 清单 #1 — 成本账 HTTP 路由（纯新增；不由本文件改线，
 * 协调员负责在 routes/index.ts 接线）。
 *
 * 租户隔离：requireTenant（与 budget-rules.ts 同写法；auth 参数
 * 省略时默认 disabled 模式，测试用 x-tenant-id 头）。
 *
 *   GET    /api/v1/cost-ledger/risk-params
 *          — 列出本租户封号概率覆盖值
 *   POST   /api/v1/cost-ledger/risk-params
 *          { network, operationType, banProbability 0–1 } — upsert 覆盖值
 *   GET    /api/v1/cost-ledger/evaluate
 *          ?offerId=&network=&operationType=&balanceUsd=&pendingUsd=
 *          &expectedProfitUsd=
 *          — 返回封号概率及其来源（override|default）、沉没成本、
 *            预期损失、损失/利润比、风险档；offerId 给出时同时原样
 *            返回该 Offer 现有 verdict（只展示，绝不拦截任何操作）
 *   GET    /api/v1/cost-ledger/bid-math
 *          ?cpcUsd=&roiTarget=&payoutUsd=&budgetUsd=&geo=&format=
 *          — 联盟出价测算：默认 CPC $0.20（可按 GEO/格式传 cpcUsd
 *            覆盖）；返回盈亏平衡 EPC（CPC×ROI 目标）、payout 反推
 *            所需转化率、预算可买点击数及量级提示
 *
 * 注意：Offer 行现有的 verdict 字段是 prescreenVerdict（go / unknown /
 * stop）；条款解析的 go / caution / stop 存在 AiAnalysis 结果 JSON
 * 内、无 offerId 外键，无法按 offerId 可靠取回——本端点原样返回
 * Offer 行 verdict，不拼凑、不改写。
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  AppError,
  NotFoundError,
  ValidationError,
} from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import { requireTenant, type AuthContext } from "../auth/tenant.js";
import {
  DEFAULT_AFFILIATE_CPC_USD,
  DEFAULT_ROI_TARGET,
  calcBidMath,
  evaluateCostLedger,
  normalizeOperationType,
  resolveBanProbability,
  riskTierForOperationType,
  serializeRiskParam,
  type RiskParamStore,
} from "../services/cost-ledger.js";

export interface CostLedgerRouteServices {
  prisma: PrismaClient;
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

/** 生成客户端滞后于 schema 时 riskParam 委托可能缺失：读退回默认，写明确报错。 */
function riskParamStore(
  prisma: PrismaClient
): RiskParamStore | null {
  const delegate = (prisma as unknown as { riskParam?: RiskParamStore })
    .riskParam;
  return delegate ?? null;
}

export async function registerCostLedgerRoutes(
  app: FastifyInstance,
  services: CostLedgerRouteServices,
  auth: AuthContext = { mode: "disabled", registry: [] }
): Promise<void> {
  const resolveTenant = (
    request: Parameters<typeof requireTenant>[1]
  ): string => requireTenant(auth, request);

  app.get("/api/v1/cost-ledger/risk-params", async (request) => {
    const tenantId = resolveTenant(request);
    const store = riskParamStore(services.prisma);
    const rows = store
      ? await store.findMany({
          where: { tenantId },
          orderBy: { network: "asc" },
        })
      : [];
    return { params: rows.map(serializeRiskParam) };
  });

  app.post<{ Body: Record<string, unknown> }>(
    "/api/v1/cost-ledger/risk-params",
    async (request) => {
      const tenantId = resolveTenant(request);
      const store = riskParamStore(services.prisma);
      if (!store) {
        throw new AppError(
          "RiskParam store is unavailable (regenerate the Prisma client)",
          { code: "STORE_UNAVAILABLE", statusCode: 503 }
        );
      }
      const body = request.body ?? {};
      const network = asTrimmedString(body.network);
      if (!network) {
        throw new ValidationError("network is required");
      }
      const operationType = normalizeOperationType(body.operationType);
      const banProbability = asNumber(body.banProbability);
      if (
        banProbability === undefined ||
        banProbability < 0 ||
        banProbability > 1
      ) {
        throw new ValidationError("banProbability must be a number in [0, 1]");
      }
      const row = await store.upsert({
        where: {
          tenantId_network_operationType: { tenantId, network, operationType },
        },
        create: {
          id: randomUUID(),
          tenantId,
          network,
          operationType,
          banProbability,
        },
        update: { banProbability },
      });
      return { param: serializeRiskParam(row) };
    }
  );

  app.get<{
    Querystring: {
      offerId?: string;
      network?: string;
      operationType?: string;
      balanceUsd?: string;
      pendingUsd?: string;
      expectedProfitUsd?: string;
    };
  }>("/api/v1/cost-ledger/evaluate", async (request) => {
    const tenantId = resolveTenant(request);
    const q = request.query ?? {};
    const network = asTrimmedString(q.network);
    if (!network) {
      throw new ValidationError("network is required");
    }
    const operationType = normalizeOperationType(q.operationType);
    const balanceUsd = q.balanceUsd === undefined ? 0 : asNumber(q.balanceUsd);
    const pendingUsd = q.pendingUsd === undefined ? 0 : asNumber(q.pendingUsd);
    if (balanceUsd === undefined || balanceUsd < 0) {
      throw new ValidationError("balanceUsd must be a number >= 0");
    }
    if (pendingUsd === undefined || pendingUsd < 0) {
      throw new ValidationError("pendingUsd must be a number >= 0");
    }
    // 预期利润：缺失或 ≤0 时损失/利润比为 null（服务层处理），
    // 故这里只拦"给出了但不是数字"；负数不拦，交给比值规则。
    let expectedProfitUsd: number | null = null;
    if (q.expectedProfitUsd !== undefined) {
      const parsed = asNumber(q.expectedProfitUsd);
      if (parsed === undefined) {
        throw new ValidationError("expectedProfitUsd must be a number");
      }
      expectedProfitUsd = parsed;
    }

    const { banProbability, source } = await resolveBanProbability(
      riskParamStore(services.prisma),
      tenantId,
      network,
      operationType
    );
    const evaluation = evaluateCostLedger({
      banProbability,
      balanceUsd,
      pendingUsd,
      expectedProfitUsd,
    });

    // offerId 给出时：原样展示该 Offer 现有 verdict，不做任何拦截判断。
    // 未给出时 offer 为 null；给出了但本租户无此 Offer 时 404。
    let offer: {
      id: string;
      prescreenVerdict: string | null;
      prescreenReason: string | null;
    } | null = null;
    const offerId = asTrimmedString(q.offerId);
    if (offerId) {
      const offerDelegate = (
        services.prisma as unknown as {
          offer?: {
            findFirst(args: unknown): Promise<{
              id: string;
              prescreenVerdict: string | null;
              prescreenReason: string | null;
            } | null>;
          };
        }
      ).offer;
      const row = await offerDelegate?.findFirst({
        where: { id: offerId, tenantId },
        select: { id: true, prescreenVerdict: true, prescreenReason: true },
      });
      if (!row) throw new NotFoundError("Offer", offerId);
      offer = {
        id: row.id,
        prescreenVerdict: row.prescreenVerdict,
        prescreenReason: row.prescreenReason,
      };
    }

    return {
      network,
      operationType,
      banProbability,
      banProbabilitySource: source,
      balanceUsd,
      pendingUsd,
      sunkCost: evaluation.sunkCost,
      expectedLossUsd: evaluation.expectedLossUsd,
      expectedProfitUsd,
      lossToProfitRatio: evaluation.lossToProfitRatio,
      riskTier: riskTierForOperationType(operationType),
      offer,
    };
  });

  /**
   * 联盟出价测算（用户 2026-10-24 实战基准）：默认 CPC $0.20，
   * ROI 目标默认 2；cpcUsd 可按 GEO / 格式覆盖（geo、format 仅
   * 回显覆盖维度，不参与计算）。非法参数（CPC ≤0、ROI ≤0、
   * payout ≤0、budget <0、非数字）一律 400。
   */
  app.get<{
    Querystring: {
      cpcUsd?: string;
      roiTarget?: string;
      payoutUsd?: string;
      budgetUsd?: string;
      geo?: string;
      format?: string;
    };
  }>("/api/v1/cost-ledger/bid-math", async (request) => {
    // 纯测算不读租户数据，但与其他成本账端点一致要求租户身份。
    resolveTenant(request);
    const q = request.query ?? {};
    const cpcUsd =
      q.cpcUsd === undefined
        ? DEFAULT_AFFILIATE_CPC_USD
        : asNumber(q.cpcUsd);
    if (cpcUsd === undefined || cpcUsd <= 0) {
      throw new ValidationError("cpcUsd must be a number > 0");
    }
    const roiTarget =
      q.roiTarget === undefined
        ? DEFAULT_ROI_TARGET
        : asNumber(q.roiTarget);
    if (roiTarget === undefined || roiTarget <= 0) {
      throw new ValidationError("roiTarget must be a number > 0");
    }
    let payoutUsd: number | null = null;
    if (q.payoutUsd !== undefined) {
      const parsed = asNumber(q.payoutUsd);
      if (parsed === undefined || parsed <= 0) {
        throw new ValidationError("payoutUsd must be a number > 0");
      }
      payoutUsd = parsed;
    }
    let budgetUsd: number | null = null;
    if (q.budgetUsd !== undefined) {
      const parsed = asNumber(q.budgetUsd);
      if (parsed === undefined || parsed < 0) {
        throw new ValidationError("budgetUsd must be a number >= 0");
      }
      budgetUsd = parsed;
    }
    const result = calcBidMath({ cpcUsd, roiTarget, payoutUsd, budgetUsd });
    return {
      ...result,
      payoutUsd,
      budgetUsd,
      geo: asTrimmedString(q.geo) ?? null,
      format: asTrimmedString(q.format) ?? null,
    };
  });
}
