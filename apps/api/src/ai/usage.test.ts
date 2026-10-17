import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@adlinklab/database";
import {
  checkAiQuota,
  enforceAiQuota,
  evaluateQuota,
  getAiUsageSummary,
  recordAiUsage,
  resolveAiQuotaLimits,
  secondsUntilUtcMidnight,
  utcDayStart,
  ZERO_TOTALS,
} from "./usage.js";

function fakePrisma(overrides: Record<string, unknown> = {}): PrismaClient {
  return {
    aiUsageDaily: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      aggregate: vi.fn(async () => ({ _sum: null })),
      ...((overrides.aiUsageDaily ?? {}) as Record<string, unknown>),
    },
  } as unknown as PrismaClient;
}

describe("utcDayStart / secondsUntilUtcMidnight", () => {
  it("取 UTC 午夜", () => {
    expect(utcDayStart(new Date("2026-10-17T15:30:00.000Z"))).toEqual(
      new Date("2026-10-17T00:00:00.000Z")
    );
  });

  it("Retry-After 在 (0, 86400] 秒之间", () => {
    const s = secondsUntilUtcMidnight(new Date("2026-10-17T12:00:00.000Z"));
    expect(s).toBe(12 * 3600);
  });
});

describe("resolveAiQuotaLimits", () => {
  it("默认 50000 美分 / 1000 次", () => {
    expect(resolveAiQuotaLimits({})).toEqual({
      dailyCostCents: 50000,
      dailyCalls: 1000,
    });
  });

  it("环境变量覆盖；非法值回落默认", () => {
    expect(
      resolveAiQuotaLimits({
        AI_DAILY_COST_CENTS_LIMIT: "100",
        AI_DAILY_CALLS_LIMIT: "5",
      })
    ).toEqual({ dailyCostCents: 100, dailyCalls: 5 });
    expect(
      resolveAiQuotaLimits({
        AI_DAILY_COST_CENTS_LIMIT: "abc",
        AI_DAILY_CALLS_LIMIT: "-1",
      })
    ).toEqual({ dailyCostCents: 50000, dailyCalls: 1000 });
  });
});

describe("evaluateQuota（纯函数）", () => {
  const limits = { dailyCostCents: 50000, dailyCalls: 1000 };

  it("未超限放行", () => {
    expect(
      evaluateQuota({ ...ZERO_TOTALS, costCents: 100, calls: 10 }, limits)
    ).toMatchObject({ allowed: true });
  });

  it("等于上限不算超限", () => {
    expect(
      evaluateQuota(
        { ...ZERO_TOTALS, costCents: 50000, calls: 1000 },
        limits
      )
    ).toMatchObject({ allowed: true });
  });

  it("成本超限拒绝，reason=cost", () => {
    expect(
      evaluateQuota({ ...ZERO_TOTALS, costCents: 50001, calls: 1 }, limits)
    ).toMatchObject({ allowed: false, reason: "cost" });
  });

  it("次数超限拒绝，reason=calls", () => {
    expect(
      evaluateQuota({ ...ZERO_TOTALS, costCents: 1, calls: 1001 }, limits)
    ).toMatchObject({ allowed: false, reason: "calls" });
  });
});

describe("checkAiQuota / enforceAiQuota", () => {
  it("当天无记录 → 放行，usage 为零值", async () => {
    const prisma = fakePrisma();
    const r = await checkAiQuota(prisma, "t1");
    expect(r.allowed).toBe(true);
    expect(r.usage).toEqual(ZERO_TOTALS);
  });

  it("当天成本超限 → 拒绝", async () => {
    const prisma = fakePrisma({
      aiUsageDaily: {
        findUnique: vi.fn(async () => ({
          tokensIn: 0,
          tokensOut: 0,
          costCents: 50001,
          calls: 1,
        })),
      },
    });
    const r = await checkAiQuota(prisma, "t1");
    expect(r).toMatchObject({ allowed: false, reason: "cost" });
  });

  it("DB 故障 fail-open：放行，不抛错", async () => {
    const prisma = fakePrisma({
      aiUsageDaily: {
        findUnique: vi.fn(async () => {
          throw new Error("db down");
        }),
      },
    });
    const r = await checkAiQuota(prisma, "t1");
    expect(r.allowed).toBe(true);
  });

  it("enforceAiQuota 超限抛 429 + AI_QUOTA_EXCEEDED + Retry-After", async () => {
    const prisma = fakePrisma({
      aiUsageDaily: {
        findUnique: vi.fn(async () => ({
          tokensIn: 0,
          tokensOut: 0,
          costCents: 0,
          calls: 1001,
        })),
      },
    });
    await expect(enforceAiQuota(prisma, "t1")).rejects.toMatchObject({
      statusCode: 429,
      code: "AI_QUOTA_EXCEEDED",
    });
    try {
      await enforceAiQuota(prisma, "t1");
      expect.unreachable();
    } catch (e) {
      const details = (e as { details?: Record<string, unknown> }).details;
      expect(details?.reason).toBe("calls");
      expect(typeof details?.retryAfterSeconds).toBe("number");
    }
  });

  it("enforceAiQuota 未超限不抛", async () => {
    await expect(enforceAiQuota(fakePrisma(), "t1")).resolves.toBeUndefined();
  });
});

describe("recordAiUsage", () => {
  it("upsert 当天行，增量字段用 increment", async () => {
    const upsert = vi.fn(async () => ({}));
    const prisma = fakePrisma({ aiUsageDaily: { upsert } });
    await recordAiUsage(prisma, {
      tenantId: "t1",
      model: "deepseek-chat",
      tokensIn: 100,
      tokensOut: 50,
      costCents: 3,
      calls: 1,
    });
    expect(upsert).toHaveBeenCalledOnce();
    const args = upsert.mock.calls[0][0] as {
      update: Record<string, { increment: number }>;
      create: Record<string, unknown>;
    };
    expect(args.update.tokensIn).toEqual({ increment: 100 });
    expect(args.update.costCents).toEqual({ increment: 3 });
    expect(args.update.calls).toEqual({ increment: 1 });
    expect(args.create.tenantId).toBe("t1");
  });

  it("upsert 竞态失败时回落 update；都失败也不抛", async () => {
    const update = vi.fn(async () => ({}));
    const prisma = fakePrisma({
      aiUsageDaily: {
        upsert: vi.fn(async () => {
          throw new Error("unique violation");
        }),
        update,
      },
    });
    await expect(
      recordAiUsage(prisma, {
        tenantId: "t1",
        model: "m",
        tokensIn: 1,
        tokensOut: 1,
        costCents: 1,
        calls: 1,
      })
    ).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledOnce();

    const prisma2 = fakePrisma({
      aiUsageDaily: {
        upsert: vi.fn(async () => {
          throw new Error("down");
        }),
        update: vi.fn(async () => {
          throw new Error("down");
        }),
      },
    });
    await expect(
      recordAiUsage(prisma2, {
        tenantId: "t1",
        model: "m",
        tokensIn: 1,
        tokensOut: 1,
        costCents: 1,
        calls: 1,
      })
    ).resolves.toBeUndefined();
  });
});

describe("getAiUsageSummary", () => {
  it("今日 + 本月聚合；DB 故障返回零值", async () => {
    const aggregate = vi
      .fn()
      .mockResolvedValueOnce({
        _sum: { tokensIn: 10, tokensOut: 5, costCents: 2, calls: 1 },
      })
      .mockResolvedValueOnce({
        _sum: { tokensIn: 100, tokensOut: 50, costCents: 20, calls: 9 },
      });
    const prisma = fakePrisma({ aiUsageDaily: { aggregate } });
    const s = await getAiUsageSummary(
      prisma,
      "t1",
      new Date("2026-10-17T12:00:00.000Z")
    );
    expect(s.today).toEqual({
      tokensIn: 10,
      tokensOut: 5,
      costCents: 2,
      calls: 1,
    });
    expect(s.month.calls).toBe(9);
    // 本月查询下界为 10 月 1 日 UTC
    const monthArgs = aggregate.mock.calls[1][0] as {
      where: { date: { gte: Date; lte: Date } };
    };
    expect(monthArgs.where.date.gte).toEqual(new Date("2026-10-01T00:00:00.000Z"));

    const prisma2 = fakePrisma({
      aiUsageDaily: {
        aggregate: vi.fn(async () => {
          throw new Error("down");
        }),
      },
    });
    const s2 = await getAiUsageSummary(prisma2, "t1");
    expect(s2.today).toEqual(ZERO_TOTALS);
    expect(s2.month).toEqual(ZERO_TOTALS);
  });
});
