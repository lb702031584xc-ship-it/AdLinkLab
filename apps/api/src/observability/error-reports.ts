/**
 * P0-8 — 5xx 错误上报：立即写 error_reports 表，1 小时内同组去重。
 *
 * 去重组：(tenantId, message, path, statusCode)，lastSeenAt 在 1 小时内命中
 * 则 count+1、lastSeenAt=now，否则新建一行。
 * 所有 DB 操作 best-effort：失败只吞掉（调用方不 await 也可，但 onResponse
 * 里 await 更稳——recordErrorReport 自身永不抛错、不阻塞响应）。
 */
import { randomUUID } from "node:crypto";
import { appLogger } from "./logger.js";

/** 去重窗口：1 小时。 */
export const ERROR_REPORT_DEDUP_WINDOW_MS = 60 * 60 * 1000;

export const MAX_ERROR_MESSAGE_LENGTH = 500;

/** 仅 5xx 上报（4xx 是客户端问题，不进 error_reports）。 */
export function shouldRecordError(statusCode: number): boolean {
  return Number.isInteger(statusCode) && statusCode >= 500;
}

export function isWithinDedupWindow(
  lastSeenAt: Date,
  now: Date = new Date()
): boolean {
  return now.getTime() - lastSeenAt.getTime() < ERROR_REPORT_DEDUP_WINDOW_MS;
}

/** 去重组键（纯函数，供测试与排障用）。 */
export function errorDedupKey(input: {
  message: string;
  path?: string | null;
  statusCode?: number | null;
}): string {
  return `${input.statusCode ?? ""}\n${input.path ?? ""}\n${input.message}`;
}

export interface ErrorReportInput {
  tenantId?: string | null;
  level: string;
  message: string;
  requestId?: string | null;
  path?: string | null;
  method?: string | null;
  statusCode?: number | null;
}

/**
 * PrismaClient 的最小结构面（只用 errorReport delegate），便于测试替身。
 * 生产调用传完整 PrismaClient 即可（结构兼容）。
 */
export interface ErrorReportStore {
  errorReport: {
    findFirst(args: unknown): Promise<{
      id: string;
      lastSeenAt: Date;
    } | null>;
    update(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<unknown>;
  };
}

function normalizeMessage(input: ErrorReportInput): string {
  const fallback = `HTTP ${input.statusCode ?? 500}`;
  const raw = (input.message ?? "").trim() || fallback;
  return raw.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

export async function recordErrorReport(
  store: ErrorReportStore,
  input: ErrorReportInput,
  now: Date = new Date()
): Promise<void> {
  if (!shouldRecordError(input.statusCode ?? 500)) return;
  const message = normalizeMessage(input);
  const tenantId = input.tenantId ?? null;
  const path = input.path ?? null;
  const statusCode = input.statusCode ?? null;
  try {
    const existing = await store.errorReport.findFirst({
      where: {
        tenantId,
        message,
        path,
        statusCode,
        lastSeenAt: {
          gte: new Date(now.getTime() - ERROR_REPORT_DEDUP_WINDOW_MS),
        },
      },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, lastSeenAt: true },
    });
    if (existing) {
      await store.errorReport.update({
        where: { id: existing.id },
        data: {
          count: { increment: 1 },
          lastSeenAt: now,
          requestId: input.requestId ?? undefined,
        },
      });
      return;
    }
    await store.errorReport.create({
      data: {
        id: randomUUID(),
        tenantId,
        level: input.level,
        message,
        requestId: input.requestId ?? null,
        path,
        method: input.method ?? null,
        statusCode,
        count: 1,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });
  } catch (e) {
    // best-effort：上报失败绝不影响主响应。
    appLogger.warn({
      msg: "recordErrorReport failed, dropping error report",
      errorName: e instanceof Error ? e.name : "Error",
      path: path ?? undefined,
      statusCode: statusCode ?? undefined,
    });
  }
}
