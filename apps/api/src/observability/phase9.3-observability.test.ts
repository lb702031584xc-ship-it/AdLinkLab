/**
 * Phase 9.3 — Production Observability Baseline tests.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import {
  drainRecentLogs,
  httpMetrics,
  REQUEST_ID_HEADER,
  resolveRequestId,
  sanitizeRequestId,
  MAX_REQUEST_ID_LENGTH,
  evaluateReadiness,
  setLogSink,
  type StructuredLogRecord,
} from "./index.js";

describe("Phase 9.3 observability", () => {
  const captured: StructuredLogRecord[] = [];

  beforeEach(() => {
    captured.length = 0;
    drainRecentLogs();
    httpMetrics.reset();
    setLogSink((r) => captured.push(r));
  });

  afterEach(() => {
    setLogSink(undefined);
    httpMetrics.reset();
    drainRecentLogs();
  });

  describe("request ID", () => {
    it("1. generates request ID when header absent", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/health/live" });
      expect(res.statusCode).toBe(200);
      const id = res.headers[REQUEST_ID_HEADER];
      expect(typeof id).toBe("string");
      expect(String(id).length).toBeGreaterThan(8);
      await app.close();
    });

    it("2. preserves valid client X-Request-ID", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/health/live",
        headers: { [REQUEST_ID_HEADER]: "client-req-abc-123" },
      });
      expect(res.headers[REQUEST_ID_HEADER]).toBe("client-req-abc-123");
      await app.close();
    });

    it("3. replaces overlong / illegal X-Request-ID", () => {
      expect(sanitizeRequestId("")).toBeNull();
      expect(sanitizeRequestId("   ")).toBeNull();
      expect(sanitizeRequestId("a".repeat(MAX_REQUEST_ID_LENGTH + 1))).toBeNull();
      expect(sanitizeRequestId("bad\nid")).toBeNull();
      expect(sanitizeRequestId("has space")).toBeNull();
      const replaced = resolveRequestId("a".repeat(MAX_REQUEST_ID_LENGTH + 1));
      expect(replaced).not.toHaveLength(MAX_REQUEST_ID_LENGTH + 1);
      expect(replaced.length).toBeGreaterThan(8);
    });

    it("4. HTTP response always includes X-Request-ID", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.headers[REQUEST_ID_HEADER]).toBeTruthy();
      await app.close();
    });
  });

  describe("structured logging + redaction", () => {
    it("5. HTTP log includes requestId method path statusCode durationMs", async () => {
      const app = await buildApp();
      await app.inject({ method: "GET", url: "/health/live" });
      await app.close();
      const httpLog = captured.find(
        (l) => l.path === "/health/live" && typeof l.statusCode === "number"
      );
      expect(httpLog).toBeTruthy();
      expect(httpLog?.requestId).toBeTruthy();
      expect(httpLog?.method).toBe("GET");
      expect(httpLog?.path).toBe("/health/live");
      expect(httpLog?.statusCode).toBe(200);
      expect(typeof httpLog?.durationMs).toBe("number");
    });

    it("6-9. secrets never appear in structured logs", async () => {
      const app = await buildApp();
      const secretHeaders = {
        authorization: "Bearer alk_s_super_secret_integration_token",
        "x-api-key": "alk_dev_tenant_a_secret_key_value",
        [REQUEST_ID_HEADER]: "safe-id-1",
      };
      await app.inject({
        method: "GET",
        url: "/health/live",
        headers: secretHeaders,
      });
      await app.close();
      const blob = JSON.stringify(captured);
      expect(blob).not.toMatch(/alk_s_super_secret/);
      expect(blob).not.toMatch(/alk_dev_tenant_a_secret/);
      expect(blob).not.toMatch(/Bearer /);
      expect(blob).not.toMatch(/INTEGRATION_TOKEN_PEPPER/);
      expect(blob).not.toMatch(/postgresql:\/\//i);
      expect(blob).not.toMatch(/DATABASE_URL/);
    });

    it("10. 5xx generates structured error log", async () => {
      const app = await buildApp();
      app.get("/__phase93_boom", async () => {
        throw new Error("phase93-intentional-boom");
      });
      await app.ready();
      const res = await app.inject({ method: "GET", url: "/__phase93_boom" });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toMatchObject({ error: "INTERNAL_ERROR" });
      expect(JSON.stringify(res.json())).not.toMatch(/phase93-intentional-boom/);
      await app.close();
      const errLog = captured.find(
        (l) => l.level === "error" && l.path === "/__phase93_boom"
      );
      expect(errLog).toBeTruthy();
      expect(errLog?.statusCode).toBe(500);
      expect(errLog?.requestId).toBeTruthy();
      expect(errLog?.method).toBe("GET");
      expect(typeof errLog?.durationMs).toBe("number");
      expect(JSON.stringify(errLog)).not.toMatch(/phase93-intentional-boom/);
    });
  });

  describe("health", () => {
    it("11. /health/live succeeds regardless of dependency readiness", async () => {
      const app = await buildApp();
      const live = await app.inject({ method: "GET", url: "/health/live" });
      expect(live.statusCode).toBe(200);
      expect(live.json()).toEqual({ status: "ok" });
      // Simulated unavailable deps: readiness may be ok in memory mode;
      // live must remain ok either way.
      const ready = await app.inject({ method: "GET", url: "/health/ready" });
      expect(live.statusCode).toBe(200);
      expect([200, 503]).toContain(ready.statusCode);
      await app.close();
    });

    it("12. readiness reflects database requirement (prisma without client → down)", async () => {
      const result = await evaluateReadiness({
        persistence: "prisma",
        queueMode: "off",
        prisma: undefined,
      });
      expect(result.status).toBe("not_ready");
      expect(result.checks.find((c) => c.name === "postgres")?.status).toBe(
        "down"
      );
      expect(JSON.stringify(result)).not.toMatch(/postgresql:\/\//i);
      expect(JSON.stringify(result)).not.toMatch(/password/i);
    });

    it("13. readiness reflects Redis when queueMode=redis", async () => {
      const result = await evaluateReadiness({
        persistence: "memory",
        queueMode: "redis",
        redisUrl: "redis://127.0.0.1:1",
      });
      expect(result.status).toBe("not_ready");
      expect(result.checks.find((c) => c.name === "redis")?.status).toBe("down");
      expect(JSON.stringify(result)).not.toMatch(/redis:\/\/127/);
    });

    it("14. health responses contain no secrets", async () => {
      const app = await buildApp();
      for (const url of ["/health", "/health/live", "/health/ready"]) {
        const res = await app.inject({ method: "GET", url });
        const text = res.body;
        expect(text).not.toMatch(/postgresql:\/\//i);
        expect(text).not.toMatch(/redis:\/\//i);
        expect(text).not.toMatch(/ADLINKLAB_/);
        expect(text).not.toMatch(/pepper/i);
        expect(text).not.toMatch(/Bearer /);
      }
      await app.close();
    });

    it("memory+queue off readiness is ok with skipped deps", async () => {
      const result = await evaluateReadiness({
        persistence: "memory",
        queueMode: "off",
      });
      expect(result.status).toBe("ok");
      expect(result.checks.every((c) => c.status === "skipped")).toBe(true);
    });
  });

  describe("metrics", () => {
    it("15. metrics endpoint exists", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/metrics" });
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatch(/http_requests_total/);
      await app.close();
    });

    it("16-18. request / error / duration metrics update", async () => {
      const app = await buildApp();
      app.get("/__phase93_boom2", async () => {
        throw new Error("boom2");
      });
      await app.ready();
      await app.inject({ method: "GET", url: "/health/live" });
      await app.inject({ method: "GET", url: "/__phase93_boom2" });
      const snap = httpMetrics.snapshot();
      expect(snap.requests).toBeGreaterThanOrEqual(2);
      expect(snap.errors).toBeGreaterThanOrEqual(1);
      expect(snap.durationObservations).toBeGreaterThanOrEqual(2);
      const body = httpMetrics.renderPrometheus();
      expect(body).toMatch(/http_requests_total\{/);
      expect(body).toMatch(/http_request_errors_total\{/);
      expect(body).toMatch(/http_request_duration_ms_sum\{/);
      expect(body).toMatch(/http_request_duration_ms_count\{/);
      await app.close();
    });

    it("19-20. metrics omit requestId labels and secrets", async () => {
      const app = await buildApp();
      await app.inject({
        method: "GET",
        url: "/health/live",
        headers: {
          authorization: "Bearer secret-token-xyz",
          "x-api-key": "secret-api-key-xyz",
          [REQUEST_ID_HEADER]: "uuid-should-not-be-label",
        },
      });
      const body = (await app.inject({ method: "GET", url: "/metrics" })).body;
      expect(body).not.toMatch(/request_id=/);
      expect(body).not.toMatch(/requestId=/);
      expect(body).not.toMatch(/uuid-should-not-be-label/);
      expect(body).not.toMatch(/secret-token-xyz/);
      expect(body).not.toMatch(/secret-api-key-xyz/);
      expect(body).not.toMatch(/tenantId=/);
      await app.close();
    });
  });
});
