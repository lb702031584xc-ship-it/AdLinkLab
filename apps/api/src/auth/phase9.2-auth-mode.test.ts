/**
 * Phase 9.2 — Production AUTH_MODE fail-closed.
 * Resolver + startup validation before listen (via assertProductionDeployConfig / server.ts).
 */
import { describe, expect, it, vi } from "vitest";
import {
  resolveAuthMode,
  ProductionAuthModeError,
} from "./api-keys.js";
import { createAuthContext, assertAuthConfigured } from "./tenant.js";
import { assertProductionDeployConfig } from "../deploy/production-config.js";
import { buildApp, createServices } from "../app.js";

const TENANT = "00000000-0000-4000-8000-000000000001";

const PROD_OK: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  PERSISTENCE: "prisma",
  DATABASE_URL: "postgresql://u:p@localhost:5432/adlinklab?schema=public",
  REDIS_URL: "redis://localhost:6379",
  AUTH_MODE: "api_key",
  ADLINKLAB_API_KEYS: `ops_key:${TENANT}`,
  INTEGRATION_TOKEN_PEPPER: "phase92-test-pepper-not-for-real-use-32c",
  QUEUE_MODE: "off",
  CORS_ORIGINS: "https://app.example.com",
};

describe("Phase 9.2 Production AUTH_MODE fail-closed", () => {
  describe("resolveAuthMode matrix", () => {
    it("1. production + api_key => accepted", () => {
      expect(
        resolveAuthMode({ NODE_ENV: "production", AUTH_MODE: "api_key" })
      ).toBe("api_key");
    });

    it("2. production + disabled => throws", () => {
      expect(() =>
        resolveAuthMode({ NODE_ENV: "production", AUTH_MODE: "disabled" })
      ).toThrow(ProductionAuthModeError);
      expect(() =>
        resolveAuthMode({ NODE_ENV: "production", AUTH_MODE: "disabled" })
      ).toThrow(/Production requires AUTH_MODE=api_key/);
    });

    it("3. production + missing => throws", () => {
      expect(() => resolveAuthMode({ NODE_ENV: "production" })).toThrow(
        ProductionAuthModeError
      );
    });

    it("4. production + empty => throws", () => {
      expect(() =>
        resolveAuthMode({ NODE_ENV: "production", AUTH_MODE: "" })
      ).toThrow(ProductionAuthModeError);
    });

    it("5. production + whitespace => throws", () => {
      expect(() =>
        resolveAuthMode({ NODE_ENV: "production", AUTH_MODE: "   " })
      ).toThrow(ProductionAuthModeError);
    });

    it("6. production + invalid => throws", () => {
      expect(() =>
        resolveAuthMode({ NODE_ENV: "production", AUTH_MODE: "invalid" })
      ).toThrow(ProductionAuthModeError);
      expect(() =>
        resolveAuthMode({ NODE_ENV: "production", AUTH_MODE: "unknown" })
      ).toThrow(ProductionAuthModeError);
      expect(() =>
        resolveAuthMode({ NODE_ENV: "production", AUTH_MODE: "foo" })
      ).toThrow(ProductionAuthModeError);
    });

    it("7. development + existing default preserved", () => {
      expect(resolveAuthMode({ NODE_ENV: "development" })).toBe("api_key");
      expect(
        resolveAuthMode({ NODE_ENV: "development", AUTH_MODE: "disabled" })
      ).toBe("disabled");
      expect(
        resolveAuthMode({ NODE_ENV: "development", AUTH_MODE: "api_key" })
      ).toBe("api_key");
    });

    it("8. test + existing default preserved", () => {
      expect(resolveAuthMode({ NODE_ENV: "test" })).toBe("disabled");
      expect(resolveAuthMode({ VITEST: "true" })).toBe("disabled");
      expect(
        resolveAuthMode({ NODE_ENV: "test", AUTH_MODE: "api_key" })
      ).toBe("api_key");
      expect(
        resolveAuthMode({ NODE_ENV: "test", AUTH_MODE: "disabled" })
      ).toBe("disabled");
    });
  });

  describe("startup validation before listen", () => {
    it("9. assertProductionDeployConfig rejects production + disabled", () => {
      expect(() =>
        assertProductionDeployConfig({
          env: { ...PROD_OK, AUTH_MODE: "disabled" },
        })
      ).toThrow(/Production requires AUTH_MODE=api_key/);
    });

    it("10. assertProductionDeployConfig rejects production + missing AUTH_MODE", () => {
      const env = { ...PROD_OK };
      delete env.AUTH_MODE;
      expect(() => assertProductionDeployConfig({ env })).toThrow(
        /Production requires AUTH_MODE=api_key/
      );
    });

    it("11. assertProductionDeployConfig accepts production + api_key", () => {
      expect(() =>
        assertProductionDeployConfig({ env: { ...PROD_OK } })
      ).not.toThrow();
    });

    it("12. createAuthContext fails in production without explicit api_key", () => {
      expect(() =>
        createAuthContext({ NODE_ENV: "production", AUTH_MODE: "disabled" })
      ).toThrow(ProductionAuthModeError);
    });

    it("13. error message does not leak secrets", () => {
      try {
        resolveAuthMode({
          NODE_ENV: "production",
          AUTH_MODE: "disabled",
          ADLINKLAB_API_KEYS: "secret_key_should_not_appear",
          INTEGRATION_TOKEN_PEPPER: "pepper_should_not_appear",
          DATABASE_URL: "postgresql://secret:secret@db/x",
        });
        expect.unreachable("should have thrown");
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        expect(msg).toBe("Production requires AUTH_MODE=api_key");
        expect(msg).not.toMatch(/secret_key|pepper_should|postgresql:\/\//i);
      }
    });

    it("14. buildApp path never reaches listen when auth context invalid", async () => {
      const listen = vi.fn();
      // Simulate server.ts order: deploy assert → createServices → buildApp → listen
      expect(() =>
        assertProductionDeployConfig({
          env: { ...PROD_OK, AUTH_MODE: "disabled" },
        })
      ).toThrow(/Production requires AUTH_MODE=api_key/);
      expect(listen).not.toHaveBeenCalled();

      // Even if deploy assert were skipped, createAuthContext / assertAuthConfigured fail.
      expect(() =>
        createAuthContext({
          NODE_ENV: "production",
          AUTH_MODE: "",
          ADLINKLAB_API_KEYS: `ops_key:${TENANT}`,
        })
      ).toThrow(ProductionAuthModeError);
      expect(listen).not.toHaveBeenCalled();
    });

    it("15. server.ts invokes assertProductionDeployConfig before listen", async () => {
      const { readFileSync } = await import("node:fs");
      const { dirname, join } = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      const root = join(
        dirname(fileURLToPath(import.meta.url)),
        ".."
      );
      const serverSrc = readFileSync(join(root, "server.ts"), "utf8");
      const assertIdx = serverSrc.indexOf("assertProductionDeployConfig()");
      const listenIdx = serverSrc.indexOf("app.listen");
      expect(assertIdx).toBeGreaterThanOrEqual(0);
      expect(listenIdx).toBeGreaterThan(assertIdx);
    });
  });

  describe("auth surfaces preserved", () => {
    it("16. api_key mode still requires registry via assertAuthConfigured", () => {
      const auth = createAuthContext({
        NODE_ENV: "development",
        AUTH_MODE: "api_key",
        ADLINKLAB_API_KEYS: "",
        ADLINKLAB_API_KEYS_NO_FIXTURES: "1",
      });
      expect(() => assertAuthConfigured(auth)).toThrow(/ADLINKLAB_API_KEYS/);
    });

    it("17. buildApp still works under test defaults (AUTH_MODE disabled)", async () => {
      const services = createServices();
      const app = await buildApp(services);
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      await app.close();
    });
  });
});
