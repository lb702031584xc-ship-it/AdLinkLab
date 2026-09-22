/**
 * Phase 9.3 — Fastify HTTP observability hooks (correlation, logs, metrics).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "@adlinklab/shared";
import { appLogger } from "./logger.js";
import { httpMetrics } from "./metrics.js";
import {
  REQUEST_ID_HEADER,
  resolveRequestId,
} from "./request-id.js";

declare module "fastify" {
  interface FastifyRequest {
    requestId: string;
    observabilityStartedAt: number;
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

export async function registerObservability(
  app: FastifyInstance
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
      return reply.status(error.statusCode).header(REQUEST_ID_HEADER, request.requestId).send({
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

    return reply.status(500).header(REQUEST_ID_HEADER, request.requestId).send({
      error: "INTERNAL_ERROR",
      message: "Internal server error",
    });
  };
}
