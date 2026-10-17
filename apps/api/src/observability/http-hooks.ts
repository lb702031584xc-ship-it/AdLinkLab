/**
 * Phase 9.3 — Fastify HTTP observability hooks (correlation, logs, metrics).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import { appLogger } from "./logger.js";
import { httpMetrics } from "./metrics.js";
import {
  REQUEST_ID_HEADER,
  resolveRequestId,
} from "./request-id.js";
import { recordErrorReport } from "./error-reports.js";

declare module "fastify" {
  interface FastifyRequest {
    requestId: string;
    observabilityStartedAt: number;
    /**
     * P0-8 — 错误处理层留下的安全错误文案（AppError.message / 通用 500 文案），
     * onResponse 用它作为 error_reports.message；未经过错误处理层时为空。
     */
    lastErrorMessage?: string;
  }
}

function routePattern(request: FastifyRequest): string {
  const fromOptions = request.routeOptions?.url;
  if (typeof fromOptions === "string" && fromOptions.length > 0) {
    return fromOptions;
  }
  return request.url.split("?")[0] ?? "/";
}

function logLevelForStatus(statusCode: number): "info" | "warn" | "error" {
  if (statusCode >= 500) return "error";
  if (statusCode >= 400) return "warn";
  return "info";
}

export interface ObservabilityOptions {
  /**
   * P0-8 — 传入后，5xx 响应在 onResponse 里立即写 error_reports。
   * 不传则只记日志（内存模式/单测）。
   */
  prisma?: PrismaClient;
}

export async function registerObservability(
  app: FastifyInstance,
  opts: ObservabilityOptions = {}
): Promise<void> {
  app.addHook("onRequest", async (request, reply) => {
    const requestId = resolveRequestId(request.headers[REQUEST_ID_HEADER]);
    request.requestId = requestId;
    request.observabilityStartedAt = Date.now();
    void reply.header(REQUEST_ID_HEADER, requestId);
  });

  app.addHook("onResponse", async (request, reply) => {
    const durationMs = Math.max(
      0,
      Date.now() - (request.observabilityStartedAt ?? Date.now())
    );
    const statusCode = reply.statusCode;
    const route = routePattern(request);
    const path = request.url.split("?")[0] ?? "/";

    httpMetrics.observe({
      method: request.method,
      route,
      statusCode,
      durationMs,
    });

    const fields = {
      requestId: request.requestId,
      method: request.method,
      path,
      route,
      statusCode,
      durationMs,
    };

    const level = logLevelForStatus(statusCode);
    if (level === "error") {
      appLogger.error({
        ...fields,
        errorName: "HttpError",
      });
    } else if (level === "warn") {
      appLogger.warn(fields);
    } else {
      appLogger.info(fields);
    }

    // P0-8 — 5xx 立即写 error_reports（唯一上报点：错误处理层已发送的
    // 5xx 也会走到这里，避免重复上报。recordErrorReport 自身 best-effort）。
    if (opts.prisma && statusCode >= 500) {
      await recordErrorReport(opts.prisma, {
        tenantId: request.sessionAuth?.tenantId ?? null,
        level: "error",
        message: request.lastErrorMessage ?? `HTTP ${statusCode}`,
        requestId: request.requestId,
        path,
        method: request.method,
        statusCode,
      });
    }
  });
}

/**
 * Wrap existing error handler: log 5xx safely, never leak secrets to client.
 */
export function createObservabilityErrorHandler() {
  return function observabilityErrorHandler(
    error: unknown,
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    const durationMs = Math.max(
      0,
      Date.now() - (request.observabilityStartedAt ?? Date.now())
    );
    const path = request.url.split("?")[0] ?? "/";

    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        appLogger.error({
          requestId: request.requestId,
          method: request.method,
          path,
          statusCode: error.statusCode,
          errorName: error.name,
          durationMs,
        });
      }
      // P0-8 — onResponse 用它作为 error_reports.message（AppError 文案是安全的）。
      request.lastErrorMessage = error.message;
      // P0-6 — AI 配额超限带 Retry-After 头。
      const retryAfter =
        error.code === "AI_QUOTA_EXCEEDED" &&
        typeof error.details?.retryAfterSeconds === "number"
          ? String(error.details.retryAfterSeconds)
          : undefined;
      const errorReply = reply
        .status(error.statusCode)
        .header(REQUEST_ID_HEADER, request.requestId);
      if (retryAfter !== undefined) {
        errorReply.header("Retry-After", retryAfter);
      }
      return errorReply.send({
        error: error.code,
        message: error.message,
        details: error.details,
      });
    }

    // Preserve Fastify/plugin HTTP errors (e.g. @fastify/rate-limit → 429)
    const fastifyStatus =
      error &&
      typeof error === "object" &&
      "statusCode" in error &&
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : undefined;
    if (
      typeof fastifyStatus === "number" &&
      fastifyStatus >= 400 &&
      fastifyStatus < 500
    ) {
      const message =
        error instanceof Error ? error.message : "Request failed";
      return reply
        .status(fastifyStatus)
        .header(REQUEST_ID_HEADER, request.requestId)
        .send({
          error: fastifyStatus === 429 ? "RATE_LIMITED" : "HTTP_ERROR",
          message,
        });
    }

    const errorName = error instanceof Error ? error.name : "Error";
    appLogger.error({
      requestId: request.requestId,
      method: request.method,
      path,
      statusCode: 500,
      errorName,
      durationMs,
    });
    // P0-8 — 未知错误不向客户端泄露细节；error_reports 只记通用文案。
    request.lastErrorMessage = "Internal server error";

    return reply.status(500).header(REQUEST_ID_HEADER, request.requestId).send({
      error: "INTERNAL_ERROR",
      message: "Internal server error",
    });
  };
}
