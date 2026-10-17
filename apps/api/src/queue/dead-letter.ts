/**
 * P1-21：死信队列（DLQ）helper。
 *
 * recordDeadLetter(prisma, { tenantId, jobName, payload, error })：
 * - 写 DeadLetterJob（status=queued），best-effort（自身失败绝不抛错）。
 * - 去重：同一租户 + 同一 jobName + 同一错误文案，1 小时内已有 queued
 *   记录时不再重复写（避免 BullMQ 重试把 DLQ 刷爆）。
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";

export interface DeadLetterInput {
  tenantId: string;
  jobName: string;
  payload?: Record<string, unknown>;
  error: string;
}

export async function recordDeadLetter(
  prisma: PrismaClient,
  input: DeadLetterInput
): Promise<string | null> {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const existing = await prisma.deadLetterJob.findFirst({
      where: {
        tenantId: input.tenantId,
        jobName: input.jobName,
        error: input.error,
        status: "queued",
        createdAt: { gte: oneHourAgo },
      },
      select: { id: true },
    });
    if (existing) return existing.id;
    const row = await prisma.deadLetterJob.create({
      data: {
        id: randomUUID(),
        tenantId: input.tenantId,
        jobName: input.jobName,
        payload: (input.payload ?? {}) as never,
        error: input.error.slice(0, 2000),
        status: "queued",
      },
    });
    return row.id;
  } catch (e) {
    console.error("[dlq] recordDeadLetter failed", e);
    return null;
  }
}
