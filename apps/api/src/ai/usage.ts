/**
 * P0-6 — AI 成本记账 + 每租户配额。
 *
 * 记账永不阻塞业务：recordAiUsage 内部 try/catch，DB 故障时只记 warn。
 * 配额检查 DB 故障时 fail-open（放行），避免记账表故障拖垮 AI 功能。
 */
import { randomUUID } from "node:crypto";
import { AppError } from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import { appLogger } from "../observability/logger.js";

export interface AiUsageTotals {
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  calls: number;
}

export const ZERO_TOTALS: AiUsageTotals = {
  tokensIn: 0,
  tokensOut: 0,
  costCents: 0,
  calls: 0,
};

export interface AiQuotaLimits {
  /** 每租户每天成本上限（美分）。默认 50000 = $500/天/租户。 */
  dailyCostCents: number;
  /** 每租户每天调用次数上限。默认 1000 次/天/租户。 */
  dailyCalls: number;
}

export const DEFAULT_AI_QUOTA_LIMITS: AiQuotaLimits = {
  dailyCostCents: 50000,
  dailyCalls: 1000,
};

/** 从环境变量解析配额；非法值回落默认。 */
export function resolveAiQuotaLimits(
  env: NodeJS.ProcessEnv = process.env
): AiQuotaLimits {
  const parse = (raw: string | undefined, fallback: number): number => {
    if (raw === undefined || raw.trim() === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };
  return {
    dailyCostCents: parse(
      env.AI_DAILY_COST_CENTS_LIMIT,
      DEFAULT_AI_QUOTA_LIMITS.dailyCostCents
    ),
    dailyCalls: parse(
      env.AI_DAILY_CALLS_LIMIT,
      DEFAULT_AI_QUOTA_LIMITS.dailyCalls
    ),
  };
}

/** UTC 午夜（AiUsageDaily.date 是 UTC 日历日期）。 */
export function utcDayStart(d: Date = new Date()): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
}

/** 距下一个 UTC 午夜的秒数（配额超限时 Retry-After 用）。 */
export function secondsUntilUtcMidnight(now: Date = new Date()): number {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1
  );
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

export interface QuotaDecision {
  allowed: boolean;
  reason?: "cost" | "calls";
  retryAfterSeconds: number;
}

/**
 * 纯函数配额判断（可单测）：任一维度超限即拒绝；等于上限不算超限。
 * fail-open 不在这里处理——调用方 checkAiQuota 在 DB 故障时直接放行。
 */
export function evaluateQuota(
  usage: AiUsageTotals,
  limits: AiQuotaLimits,
  now: Date = new Date()
): QuotaDecision {
  const retryAfterSeconds = secondsUntilUtcMidnight(now);
  if (usage.costCents > limits.dailyCostCents) {
    return { allowed: false, reason: "cost", retryAfterSeconds };
  }
  if (usage.calls > limits.dailyCalls) {
    return { allowed: false, reason: "calls", retryAfterSeconds };
  }
  return { allowed: true, retryAfterSeconds };
}

export interface QuotaCheckResult extends QuotaDecision {
  usage: AiUsageTotals;
  limits: AiQuotaLimits;
}

/**
 * 查租户当天 AiUsageDaily 并判断配额。DB 故障时 fail-open（记 warn、放行）。
 */
export async function checkAiQuota(
  prisma: PrismaClient,
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date()
): Promise<QuotaCheckResult> {
  const limits = resolveAiQuotaLimits(env);
  try {
    const row = await prisma.aiUsageDaily.findUnique({
      where: { tenantId_date: { tenantId, date: utcDayStart(now) } },
      select: { tokensIn: true, tokensOut: true, costCents: true, calls: true },
    });
    const usage: AiUsageTotals = row ?? { ...ZERO_TOTALS };
    return { ...evaluateQuota(usage, limits, now), usage, limits };
  } catch (e) {
    appLogger.warn({
      msg: "AI quota check failed, failing open",
      tenantId,
      errorName: e instanceof Error ? e.name : "Error",
    });
    return {
      allowed: true,
      retryAfterSeconds: secondsUntilUtcMidnight(now),
      usage: { ...ZERO_TOTALS },
      limits,
    };
  }
}

/**
 * 配额守门：超限抛 429 AppError（code AI_QUOTA_EXCEEDED），
 * details 带 limit/current/retryAfterSeconds；错误处理层据此写 Retry-After 头。
 */
export async function enforceAiQuota(
  prisma: PrismaClient,
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date()
): Promise<void> {
  const result = await checkAiQuota(prisma, tenantId, env, now);
  if (result.allowed) return;
  const limit =
    result.reason === "cost" ? result.limits.dailyCostCents : result.limits.dailyCalls;
  const current =
    result.reason === "cost" ? result.usage.costCents : result.usage.calls;
  throw new AppError("AI daily quota exceeded", {
    code: "AI_QUOTA_EXCEEDED",
    statusCode: 429,
    details: {
      reason: result.reason,
      limit,
      current,
      retryAfterSeconds: result.retryAfterSeconds,
    },
  });
}

export interface RecordAiUsageInput {
  tenantId: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  /** 本次记账的调用次数（单次调用=1；批量接口可传 N）。 */
  calls: number;
}

/**
 * 每次 AI 调用后 upsert 当天 AiUsageDaily（tokens/cost/calls 原子累加）。
 * best-effort：失败不抛；upsert 竞态冲突时回落为一次 update 重试。
 */
export async function recordAiUsage(
  prisma: PrismaClient,
  input: RecordAiUsageInput,
  now: Date = new Date()
): Promise<void> {
  const date = utcDayStart(now);
  const data = {
    tokensIn: Math.max(0, Math.floor(input.tokensIn) || 0),
    tokensOut: Math.max(0, Math.floor(input.tokensOut) || 0),
    costCents: Math.max(0, Math.floor(input.costCents) || 0),
    calls: Math.max(0, Math.floor(input.calls) || 0),
  };
  try {
    await prisma.aiUsageDaily.upsert({
      where: { tenantId_date: { tenantId: input.tenantId, date } },
      create: {
        id: randomUUID(),
        tenantId: input.tenantId,
        date,
        ...data,
      },
      update: {
        tokensIn: { increment: data.tokensIn },
        tokensOut: { increment: data.tokensOut },
        costCents: { increment: data.costCents },
        calls: { increment: data.calls },
      },
    });
  } catch (e) {
    // upsert 唯一键竞态：改走 update 再试一次；再失败则放弃（只记 warn）。
    try {
      await prisma.aiUsageDaily.update({
        where: { tenantId_date: { tenantId: input.tenantId, date } },
        data: {
          tokensIn: { increment: data.tokensIn },
          tokensOut: { increment: data.tokensOut },
          costCents: { increment: data.costCents },
          calls: { increment: data.calls },
        },
      });
    } catch {
      appLogger.warn({
        msg: "recordAiUsage failed, dropping usage record",
        tenantId: input.tenantId,
        model: input.model,
        errorName: e instanceof Error ? e.name : "Error",
      });
    }
  }
}

export interface AiUsageSummary {
  tenantId: string;
  today: AiUsageTotals;
  month: AiUsageTotals;
}

function sumTotals(
  row: {
    _sum?: {
      tokensIn?: number | null;
      tokensOut?: number | null;
      costCents?: number | null;
      calls?: number | null;
    } | null;
  } | null
): AiUsageTotals {
  const s = row?._sum;
  return {
    tokensIn: s?.tokensIn ?? 0,
    tokensOut: s?.tokensOut ?? 0,
    costCents: s?.costCents ?? 0,
    calls: s?.calls ?? 0,
  };
}

/**
 * 今日 + 本月（UTC）汇总，供 /admin/ai-settings 用量卡片展示。
 * DB 故障时返回零值（前端展示 0，不阻塞设置页）。
 */
export async function getAiUsageSummary(
  prisma: PrismaClient,
  tenantId: string,
  now: Date = new Date()
): Promise<AiUsageSummary> {
  const today = utcDayStart(now);
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  try {
    const [todayRow, monthRow] = await Promise.all([
      prisma.aiUsageDaily.aggregate({
        where: { tenantId, date: today },
        _sum: { tokensIn: true, tokensOut: true, costCents: true, calls: true },
      }),
      prisma.aiUsageDaily.aggregate({
        where: { tenantId, date: { gte: monthStart, lte: today } },
        _sum: { tokensIn: true, tokensOut: true, costCents: true, calls: true },
      }),
    ]);
    return {
      tenantId,
      today: sumTotals(todayRow),
      month: sumTotals(monthRow),
    };
  } catch (e) {
    appLogger.warn({
      msg: "getAiUsageSummary failed, returning zeros",
      tenantId,
      errorName: e instanceof Error ? e.name : "Error",
    });
    return { tenantId, today: { ...ZERO_TOTALS }, month: { ...ZERO_TOTALS } };
  }
}
